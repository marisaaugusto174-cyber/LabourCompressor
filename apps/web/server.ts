import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listVideoModelProfiles } from '../../packages/features/tagging/domain/index.ts';
import { type SupportedPlatform } from '../../packages/features/download/domain/index.ts';
import { type RunLocalPipelineOptions } from '../cli/local-pipeline-command.ts';
import { listTaxonomyPresets, resolveTaxonomyInput } from '../cli/taxonomy-presets.ts';
import { createRuntimeTaskService } from './task-service.ts';
import { buildPostEditRecordSheet, chooseLocalPath, clearVideoCache, ensureDefaultMasterSpreadsheet, exportFailuresAsCsv, getSelectedProviderConfigSummary, getVideoCacheStats, loadPlatformCredentialSummary, loadProviderConfigSummary, probePlatformDownload, probeSelectedProvider, runPipelinePreflight, savePlatformCredentialConfig, saveSelectedProviderApiKey } from './runtime-support.ts';

const WEB_PORT = Number(process.env.LABOUR_COMPRESSOR_WEB_PORT ?? '4311');
const WEB_HOST = process.env.LABOUR_COMPRESSOR_WEB_HOST ?? '127.0.0.1';
const PROJECT_ROOT = process.cwd();
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const DEFAULT_MASTER_SPREADSHEET = path.join(PROJECT_ROOT, '视频数据采集总表.xlsx');
const DEFAULT_PROMPT_LIBRARY = path.join(
  PROJECT_ROOT,
  'config/prompts/video-data-collection-v0-prompt-library.md'
);
const PROMPT_LIBRARY_BY_PRESET = Object.freeze({
  business: DEFAULT_PROMPT_LIBRARY,
  v0: DEFAULT_PROMPT_LIBRARY
});
const DEFAULT_PROVIDER_CONFIG = path.join(
  PROJECT_ROOT,
  'config/model-providers/providers.local.json'
);
const DEFAULT_PLATFORM_CREDENTIAL_CONFIG = path.join(
  PROJECT_ROOT,
  'config/download-platform-credentials.local.json'
);
const DEFAULT_CACHE_ROOT = path.join(PROJECT_ROOT, '.cache', 'video-tagging');
const UPLOADS_DIR = path.join(PROJECT_ROOT, '.runtime-uploads');
const RUNTIME_TASK_STATE_FILE = path.join(PROJECT_ROOT, '.runtime-state', 'tasks.json');

const taskService = createRuntimeTaskService({
  stateFilePath: RUNTIME_TASK_STATE_FILE
});

await ensureDefaultMasterSpreadsheet(DEFAULT_MASTER_SPREADSHEET);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${WEB_HOST}:${WEB_PORT}`}`);

    if (request.method === 'GET' && url.pathname === '/') {
      return serveStatic(response, 'index.html', 'text/html; charset=utf-8');
    }

    if (request.method === 'GET' && url.pathname === '/app.js') {
      return serveStatic(response, 'app.js', 'text/javascript; charset=utf-8');
    }

    if (request.method === 'GET' && /^\/[a-z0-9-]+\.js$/u.test(url.pathname)) {
      return serveStatic(response, url.pathname.slice(1), 'text/javascript; charset=utf-8');
    }

    if (request.method === 'GET' && url.pathname === '/styles.css') {
      return serveStatic(response, 'styles.css', 'text/css; charset=utf-8');
    }

    if (request.method === 'GET' && url.pathname === '/api/defaults') {
      return sendJson(response, {
        cwd: PROJECT_ROOT,
        taxonomyPresets: listTaxonomyPresets(),
        modelProfiles: listVideoModelProfiles(),
        defaults: {
          taxonomyPreset: 'v0',
          promptLibrary: DEFAULT_PROMPT_LIBRARY,
          promptLibraryByPreset: PROMPT_LIBRARY_BY_PRESET,
          providerConfigPath: DEFAULT_PROVIDER_CONFIG,
          platformCredentialConfigPath: DEFAULT_PLATFORM_CREDENTIAL_CONFIG,
          masterSpreadsheetPath: DEFAULT_MASTER_SPREADSHEET,
          writebackTarget: 'both',
          downloaderMode: 'yt-dlp',
          mergeMode: 'ffmpeg',
          taggingMode: 'qwen',
          downloadDir: path.join(PROJECT_ROOT, '视频数据下载缓存'),
          archiveRoot: path.dirname(PROJECT_ROOT),
          afterEditDirectoryName: 'AfterEdit',
          manualEditGate: true,
          selectedModelProfileId: 'qwen-3.6-flash'
        }
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/tasks') {
      return sendJson(response, { tasks: taskService.listTasks() });
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/events')) {
      return handleTaskEvents(request, response, url.pathname.split('/')[3] ?? '');
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/failures.csv')) {
      const taskId = url.pathname.split('/')[3] ?? '';
      const task = taskService.getTask(taskId);

      if (task?.result === undefined) {
        return sendJson(response, { error: 'Task result not found.' }, 404);
      }

      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${taskId}-failures.csv"`
      });
      response.end(exportFailuresAsCsv(task.result));
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/tasks/')) {
      const taskId = url.pathname.split('/')[3] ?? '';
      const task = taskService.getTask(taskId);
      return task === undefined
        ? sendJson(response, { error: 'Task not found.' }, 404)
        : sendJson(response, task);
    }

    if (request.method === 'POST' && url.pathname === '/api/preflight') {
      const uiOptions = await readJsonBody(request);
      const options = resolveUiOptions(uiOptions);
      return sendJson(response, {
        checks: await runPipelinePreflight(options)
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/tasks') {
      const uiOptions = await readJsonBody(request);
      const options = resolveUiOptions(uiOptions);
      await ensureDefaultMasterSpreadsheet(options.masterSpreadsheetPath ?? DEFAULT_MASTER_SPREADSHEET);
      const task = await taskService.startTask(options);
      return sendJson(response, task, 201);
    }

    if (request.method === 'POST' && url.pathname === '/api/post-edit-sheet') {
      const body = await readJsonBody(request);
      return sendJson(
        response,
        await buildPostEditRecordSheet({
          downloadDirectory: requireBodyString(body, 'downloadDir'),
          afterEditDirectoryName: readString(body.afterEditDirectoryName) || 'AfterEdit',
          outputFilePath: readString(body.outputFilePath) || undefined
        })
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/dialog/open-file') {
      const body = await readJsonBody(request);
      return sendJson(
        response,
        await chooseLocalPath({
          kind: 'file',
          prompt: readString(body.prompt) || '选择文件',
          defaultPath: readString(body.defaultPath) || undefined
        })
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/dialog/open-folder') {
      const body = await readJsonBody(request);
      return sendJson(
        response,
        await chooseLocalPath({
          kind: 'folder',
          prompt: readString(body.prompt) || '选择文件夹',
          defaultPath: readString(body.defaultPath) || undefined
        })
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/upload-file') {
      const fileName = sanitizeUploadedFileName(url.searchParams.get('fileName') ?? 'uploaded.bin');
      const filePath = path.join(UPLOADS_DIR, `${Date.now()}-${fileName}`);
      const body = await readBinaryBody(request);
      await mkdir(UPLOADS_DIR, { recursive: true });
      await writeFile(filePath, body);
      return sendJson(response, { storedPath: filePath });
    }

    if (request.method === 'GET' && url.pathname === '/api/cache') {
      return sendJson(response, await getVideoCacheStats(DEFAULT_CACHE_ROOT));
    }

    if (request.method === 'POST' && url.pathname === '/api/cache/clear') {
      const body = await readJsonBody(request);
      return sendJson(
        response,
        await clearVideoCache({
          cacheRootDirectory: DEFAULT_CACHE_ROOT,
          mode: body.mode === 'expired' ? 'expired' : 'all'
        })
      );
    }

    if (request.method === 'GET' && url.pathname === '/api/providers') {
      const providerConfigPath =
        url.searchParams.get('providerConfigPath') ?? DEFAULT_PROVIDER_CONFIG;
      return sendJson(response, await loadProviderConfigSummary(providerConfigPath));
    }

    if (request.method === 'POST' && url.pathname === '/api/providers/probe') {
      const body = await readJsonBody(request);
      return sendJson(
        response,
        await probeSelectedProvider({
          providerConfigPath: body.providerConfigPath ?? DEFAULT_PROVIDER_CONFIG,
          selectedModelProfileId: readString(body.selectedModelProfileId) || 'qwen-3.6-flash'
        })
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/provider-config/summary') {
      const body = await readJsonBody(request);
      return sendJson(
        response,
        await getSelectedProviderConfigSummary({
          providerConfigPath: readString(body.providerConfigPath) || DEFAULT_PROVIDER_CONFIG,
          selectedModelProfileId: readString(body.selectedModelProfileId) || 'qwen-3.6-flash'
        })
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/provider-config/save-api-key') {
      const body = await readJsonBody(request);
      return sendJson(
        response,
        await saveSelectedProviderApiKey({
          providerConfigPath: readString(body.providerConfigPath) || DEFAULT_PROVIDER_CONFIG,
          selectedModelProfileId: readString(body.selectedModelProfileId) || 'qwen-3.6-flash',
          apiKey: requireBodyString(body, 'apiKey')
        })
      );
    }

    if (request.method === 'GET' && url.pathname === '/api/platform-credentials') {
      const filePath =
        url.searchParams.get('platformCredentialConfigPath') ??
        DEFAULT_PLATFORM_CREDENTIAL_CONFIG;
      return sendJson(response, await loadPlatformCredentialSummary(filePath));
    }

    if (request.method === 'POST' && url.pathname === '/api/platform-credentials/save') {
      const body = await readJsonBody(request);
      return sendJson(
        response,
        await savePlatformCredentialConfig({
          filePath:
            readString(body.platformCredentialConfigPath) ??
            DEFAULT_PLATFORM_CREDENTIAL_CONFIG,
          platform: requireSupportedPlatform(body.platform),
          cookiesFilePath: readString(body.cookiesFilePath) || undefined,
          cookiesFromBrowser: readString(body.cookiesFromBrowser) || undefined
        })
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/download/probe') {
      const body = await readJsonBody(request);
      return sendJson(
        response,
        await probePlatformDownload({
          url: body.url,
          outputDirectory: body.outputDirectory ?? path.join(PROJECT_ROOT, '.runtime-probe'),
          ytDlpBinary: body.ytDlpBinary,
          cookiesFilePath: body.cookiesFilePath,
          cookiesFromBrowser: body.cookiesFromBrowser,
          platformCredentialConfigPath:
            readString(body.platformCredentialConfigPath) ??
            DEFAULT_PLATFORM_CREDENTIAL_CONFIG
        })
      );
    }

    sendJson(response, { error: 'Not found.' }, 404);
  } catch (error) {
    sendJson(
      response,
      {
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
});

server.listen(WEB_PORT, WEB_HOST, () => {
  console.log(`Labour Compressor Web UI: http://${WEB_HOST}:${WEB_PORT}`);
});

async function serveStatic(
  response: import('node:http').ServerResponse,
  fileName: string,
  contentType: string
): Promise<void> {
  const filePath = path.join(PUBLIC_DIR, fileName);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  response.end(await readFile(filePath));
}

function resolveUiOptions(body: Record<string, unknown>): RunLocalPipelineOptions {
  const taxonomyPreset = readString(body.taxonomyPreset) || 'v0';
  const taxonomyPath = readString(body.taxonomyPath);

  return Object.freeze({
    spreadsheet: requireBodyString(body, 'spreadsheet'),
    downloadDir: requireBodyString(body, 'downloadDir'),
    taxonomy: resolveTaxonomyInput({
      taxonomyPath: taxonomyPath.length === 0 ? undefined : taxonomyPath,
      taxonomyPreset
    }),
    promptLibrary: requireBodyString(body, 'promptLibrary'),
    archiveRoot: requireBodyString(body, 'archiveRoot'),
    downloadFixtures: readString(body.downloadFixtures) || undefined,
    candidateFixtures: readString(body.candidateFixtures) || undefined,
    workflowSessionId: readString(body.workflowSessionId) || undefined,
    acceptedTagsColumnName: readString(body.acceptedTagsColumnName) || undefined,
    timestamp: readString(body.timestamp) || undefined,
    downloaderMode: (readString(body.downloaderMode) as 'simulated' | 'yt-dlp') || 'yt-dlp',
    mergeMode: (readString(body.mergeMode) as 'local' | 'ffmpeg') || 'ffmpeg',
    taggingMode: (readString(body.taggingMode) as 'simulated' | 'qwen') || 'qwen',
    providerConfigPath: readString(body.providerConfigPath) || DEFAULT_PROVIDER_CONFIG,
    platformCredentialConfigPath:
      readString(body.platformCredentialConfigPath) || DEFAULT_PLATFORM_CREDENTIAL_CONFIG,
    ytDlpBinary: readString(body.ytDlpBinary) || undefined,
    cookiesFilePath: readString(body.cookiesFilePath) || undefined,
    cookiesFromBrowser: readString(body.cookiesFromBrowser) || undefined,
    writebackTarget: (readString(body.writebackTarget) as 'user' | 'master' | 'both') || 'both',
    masterSpreadsheetPath: readString(body.masterSpreadsheetPath) || DEFAULT_MASTER_SPREADSHEET,
    manualEditGate: readBoolean(body.manualEditGate, true),
    afterEditDirectoryName: readString(body.afterEditDirectoryName) || 'AfterEdit',
    selectedModelProfileId: readString(body.selectedModelProfileId) || 'qwen-3.6-flash'
  });
}

function requireSupportedPlatform(input: unknown): SupportedPlatform {
  const value = readString(input);
  if (
    value === 'bilibili' ||
    value === 'youtube' ||
    value === 'douyin' ||
    value === 'tiktok'
  ) {
    return value;
  }

  throw new Error(`Unsupported platform value: "${String(input)}"`);
}

async function handleTaskEvents(
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
  taskId: string
): Promise<void> {
  const task = taskService.getTask(taskId);

  if (task === undefined) {
    return sendJson(response, { error: 'Task not found.' }, 404);
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  for (const event of taskService.getTaskEvents(taskId)) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const unsubscribe = taskService.subscribe(taskId, (event) => {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  request.on('close', () => {
    unsubscribe?.();
    response.end();
  });
}

async function readJsonBody(
  request: import('node:http').IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

async function readBinaryBody(
  request: import('node:http').IncomingMessage
): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function sendJson(
  response: import('node:http').ServerResponse,
  body: unknown,
  statusCode = 200
): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function requireBodyString(body: Record<string, unknown>, key: string): string {
  const value = readString(body[key]);

  if (value.length === 0) {
    throw new Error(`Missing required body field: ${key}`);
  }

  return value;
}

function sanitizeUploadedFileName(fileName: string): string {
  const normalized = fileName.trim().length > 0 ? fileName.trim() : 'uploaded.bin';
  return normalized.replace(/[^\p{L}\p{N}._-]+/gu, '_');
}
