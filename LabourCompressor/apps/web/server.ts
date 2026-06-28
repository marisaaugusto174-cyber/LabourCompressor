import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PLATFORM_CREDENTIAL_CONFIG_PATH,
  DEFAULT_PLATFORM_CREDENTIAL_TEMPLATE_PATH,
  DEFAULT_PROVIDER_TEMPLATE_PATH
} from '../cli/pipeline/options.ts';
import { projectPath } from '../cli/project-paths.ts';
import { dispatchWebRoute } from './api/routes/index.ts';
import { createConfiguredRuntimeTaskService } from './task-service.ts';
import {
  ensureDouyinCredentialFallback,
  ensureDefaultMasterSpreadsheet,
  ensureFirstRunLocalState
} from './runtime-support.ts';

const WEB_PORT = Number(process.env.LABOUR_COMPRESSOR_WEB_PORT ?? '4311');
const WEB_HOST = process.env.LABOUR_COMPRESSOR_WEB_HOST ?? '127.0.0.1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const DEFAULT_MASTER_SPREADSHEET = projectPath('视频数据采集总表.xlsx');
const DEFAULT_PROVIDER_CONFIG = projectPath('config/model-providers/providers.local.json');
const DEFAULT_PLATFORM_CREDENTIAL_CONFIG = DEFAULT_PLATFORM_CREDENTIAL_CONFIG_PATH;
const DEFAULT_CACHE_ROOT = projectPath('.cache/video-tagging');
const UPLOADS_DIR = projectPath('.runtime-uploads');
const RUNTIME_TASK_STATE_FILE = projectPath('.runtime-state/tasks.json');

const taskService = await createConfiguredRuntimeTaskService({
  defaultJsonPath: RUNTIME_TASK_STATE_FILE
});

await ensureFirstRunLocalState({
  providerTemplatePath: DEFAULT_PROVIDER_TEMPLATE_PATH,
  providerLocalPath: DEFAULT_PROVIDER_CONFIG,
  platformTemplatePath: DEFAULT_PLATFORM_CREDENTIAL_TEMPLATE_PATH,
  platformLocalPath: DEFAULT_PLATFORM_CREDENTIAL_CONFIG,
  runtimeDirectories: [
    UPLOADS_DIR,
    path.dirname(RUNTIME_TASK_STATE_FILE),
    DEFAULT_CACHE_ROOT
  ]
});
await ensureDouyinCredentialFallback({
  platformCredentialConfigPath: DEFAULT_PLATFORM_CREDENTIAL_CONFIG
});
await ensureDefaultMasterSpreadsheet(DEFAULT_MASTER_SPREADSHEET);

const server = createServer(async (request, response) => {
  try {
    await dispatchWebRoute({
      request,
      response,
      url: new URL(request.url ?? '/', `http://${request.headers.host ?? `${WEB_HOST}:${WEB_PORT}`}`),
      context: {
        webHost: WEB_HOST,
        webPort: WEB_PORT,
        publicDir: PUBLIC_DIR,
        defaultMasterSpreadsheet: DEFAULT_MASTER_SPREADSHEET,
        defaultProviderConfig: DEFAULT_PROVIDER_CONFIG,
        defaultPlatformCredentialConfig: DEFAULT_PLATFORM_CREDENTIAL_CONFIG,
        defaultCacheRoot: DEFAULT_CACHE_ROOT,
        uploadsDir: UPLOADS_DIR,
        taskService
      }
    });
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(`${JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    }, null, 2)}\n`);
  }
});

server.listen(WEB_PORT, WEB_HOST, () => {
  console.log(`Labour Compressor Web UI: http://${WEB_HOST}:${WEB_PORT}`);
});
