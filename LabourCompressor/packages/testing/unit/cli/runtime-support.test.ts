import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  buildPostEditRecordSheet,
  ensureDouyinCredentialFallback,
  ensureFirstRunLocalState,
  exportFailuresAsCsv,
  importAndProbePlatformCredentialFile,
  importPlatformCredentialFile,
  loadPlatformCredentialSummary,
  loadProviderConfigSummary,
  probePlatformCredentialConnectivity,
  probePlatformDownload,
  savePlatformCredentialConfig
} from '../../../../apps/web/runtime-support.ts';

const xlsx = XLSX.default ?? XLSX;

test('exports pipeline failures as csv', () => {
  const csv = exportFailuresAsCsv({
    workflowSessionId: 'workflow-1',
    startedAt: '2026-05-02T10:00:00.000Z',
    completedAt: '2026-05-02T10:01:00.000Z',
    totalRows: 1,
    succeededRows: 0,
    failedRows: 1,
    results: Object.freeze([]),
    failures: Object.freeze([
      {
        rowNumber: 3,
        url: 'https://example.com/watch?v=1',
        phase: 'download',
        errorCode: 'missing-credentials',
        errorMessage: '需要 cookies',
        timestamp: '2026-05-02T10:00:30.000Z'
      }
    ])
  });

  assert.equal(
    csv,
    'row_number,url,phase,error_code,error_message,timestamp\n3,https://example.com/watch?v=1,download,missing-credentials,需要 cookies,2026-05-02T10:00:30.000Z\n'
  );
});

test('loads platform credential summary for supported platforms', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-runtime-'));
  const filePath = path.join(tempDir, 'download-platform-credentials.local.json');

  try {
    writeFileSync(
      filePath,
      `${JSON.stringify({
        bilibili: { cookiesFilePath: '/tmp/bili.txt', cookiesFromBrowser: 'chrome' },
        youtube: { cookiesFromBrowser: 'safari' }
      }, null, 2)}\n`
    );

    const summary = await loadPlatformCredentialSummary(filePath);

    assert.deepEqual(summary, [
      {
        platform: 'bilibili',
        cookiesFilePath: '/tmp/bili.txt',
        cookiesFromBrowser: 'chrome'
      },
      {
        platform: 'youtube',
        cookiesFilePath: undefined,
        cookiesFromBrowser: 'safari'
      },
      {
        platform: 'douyin',
        cookiesFilePath: undefined,
        cookiesFromBrowser: undefined
      },
      {
        platform: 'tiktok',
        cookiesFilePath: undefined,
        cookiesFromBrowser: undefined
      }
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('saving an empty platform credential keeps the existing saved credential', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-credential-save-'));
  const filePath = path.join(tempDir, 'download-platform-credentials.local.json');

  try {
    writeFileSync(
      filePath,
      `${JSON.stringify({
        douyin: {
          cookiesFilePath: '/tmp/douyin.txt',
          cookiesFromBrowser: ''
        }
      }, null, 2)}\n`
    );

    const summary = await savePlatformCredentialConfig({
      filePath,
      platform: 'douyin',
      cookiesFilePath: undefined,
      cookiesFromBrowser: undefined
    });
    const douyin = summary.find((entry) => entry.platform === 'douyin');

    assert.equal(douyin?.cookiesFilePath, '/tmp/douyin.txt');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('importPlatformCredentialFile copies cookies into repository and replaces old platform files', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-credential-import-'));
  const filePath = path.join(tempDir, 'download-platform-credentials.local.json');
  const credentialRepositoryRoot = path.join(tempDir, '.runtime-credentials', 'download');
  const firstCookiesPath = path.join(tempDir, 'douyin-first.txt');
  const secondCookiesPath = path.join(tempDir, 'douyin-second.txt');
  const oldRepositoryFile = path.join(credentialRepositoryRoot, 'douyin', 'old.txt');

  try {
    writeFileSync(firstCookiesPath, 'first-cookie');
    writeFileSync(secondCookiesPath, 'second-cookie');
    mkdirSync(path.dirname(oldRepositoryFile), { recursive: true });
    writeFileSync(oldRepositoryFile, 'old-cookie');

    const firstSummary = await importPlatformCredentialFile({
      filePath,
      platform: 'douyin',
      sourceCookiesFilePath: firstCookiesPath,
      credentialRepositoryRoot,
      now: new Date('2026-06-26T08:00:00.000Z')
    });
    const firstDouyin = firstSummary.find((entry) => entry.platform === 'douyin');

    assert.equal(firstDouyin?.cookiesFilePath, path.join(credentialRepositoryRoot, 'douyin', 'cookies.txt'));
    assert.equal(firstDouyin?.credentialStorePath, path.join(credentialRepositoryRoot, 'douyin', 'cookies.txt'));
    assert.equal(firstDouyin?.credentialUploadedAt, '2026-06-26T08:00:00.000Z');
    assert.equal(readFileSync(firstDouyin?.cookiesFilePath ?? '', 'utf8'), 'first-cookie');
    assert.equal(existsSync(oldRepositoryFile), false);

    const secondSummary = await importPlatformCredentialFile({
      filePath,
      platform: 'douyin',
      sourceCookiesFilePath: secondCookiesPath,
      credentialRepositoryRoot,
      now: new Date('2026-06-26T09:00:00.000Z')
    });
    const secondDouyin = secondSummary.find((entry) => entry.platform === 'douyin');
    const repositoryFiles = readdirSync(path.join(credentialRepositoryRoot, 'douyin')).sort();

    assert.deepEqual(repositoryFiles, ['cookies.txt', 'metadata.json']);
    assert.equal(readFileSync(secondDouyin?.cookiesFilePath ?? '', 'utf8'), 'second-cookie');
    assert.equal(secondDouyin?.credentialUploadedAt, '2026-06-26T09:00:00.000Z');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('importPlatformCredentialFile normalizes headerless Netscape cookies for yt-dlp', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-credential-import-header-'));
  const filePath = path.join(tempDir, 'download-platform-credentials.local.json');
  const credentialRepositoryRoot = path.join(tempDir, '.runtime-credentials', 'download');
  const cookiesPath = path.join(tempDir, 'bilibili.txt');
  const cookieLine = '.bilibili.com\tTRUE\t/\tFALSE\t4102444800\tSESSDATA\tabc';

  try {
    writeFileSync(cookiesPath, `${cookieLine}\n`);

    const summary = await importPlatformCredentialFile({
      filePath,
      platform: 'bilibili',
      sourceCookiesFilePath: cookiesPath,
      credentialRepositoryRoot
    });
    const bilibili = summary.find((entry) => entry.platform === 'bilibili');
    const storedContent = readFileSync(bilibili?.cookiesFilePath ?? '', 'utf8');

    assert.equal(storedContent.startsWith('# Netscape HTTP Cookie File\n'), true);
    assert.equal(storedContent.includes(cookieLine), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('importAndProbePlatformCredentialFile imports cookies and probes the first homepage video', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-credential-import-probe-'));
  const filePath = path.join(tempDir, 'download-platform-credentials.local.json');
  const credentialRepositoryRoot = path.join(tempDir, '.runtime-credentials', 'download');
  const cookiesPath = path.join(tempDir, 'bilibili.txt');
  const homepageUrl = 'https://www.bilibili.com/video/BV1autoProbe';
  let probedSampleUrl = '';
  let probedCookiesFilePath = '';

  try {
    writeFileSync(
      cookiesPath,
      '.bilibili.com\tTRUE\t/\tFALSE\t4102444800\tSESSDATA\tabc\n'
    );

    const result = await importAndProbePlatformCredentialFile({
      filePath,
      platform: 'bilibili',
      sourceCookiesFilePath: cookiesPath,
      credentialRepositoryRoot,
      homepageFetch: async () => ({
        ok: true,
        text: async () => `<a href="${homepageUrl}">first</a>`
      }),
      probe: async (input) => {
        probedSampleUrl = input.sampleUrl ?? '';
        probedCookiesFilePath = input.cookiesFilePath ?? '';
        return {
          key: 'platform-credential-probe',
          ok: true,
          message: 'cookies 连通性测试通过。',
          details: {
            platform: input.platform,
            sampleUrl: input.sampleUrl ?? null
          }
        };
      }
    });
    const bilibili = result.summary.find((entry) => entry.platform === 'bilibili');

    assert.equal(bilibili?.cookiesFilePath, path.join(credentialRepositoryRoot, 'bilibili', 'cookies.txt'));
    assert.equal(probedSampleUrl, homepageUrl);
    assert.equal(probedCookiesFilePath, bilibili?.cookiesFilePath);
    assert.equal(result.probe.ok, true);
    assert.equal(result.probe.details?.sampleUrl, homepageUrl);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('douyin credential fallback fills an empty config from a readable default cookies file', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-douyin-fallback-'));
  const filePath = path.join(tempDir, 'download-platform-credentials.local.json');
  const defaultCookiesPath = path.join(tempDir, 'douyin.txt');

  try {
    writeFileSync(filePath, `${JSON.stringify({ douyin: { cookiesFilePath: '' } }, null, 2)}\n`);
    writeFileSync(
      defaultCookiesPath,
      '.douyin.com\tTRUE\t/\tFALSE\t4102444800\tsid_guard\tabc\n'
    );

    const result = await ensureDouyinCredentialFallback({
      platformCredentialConfigPath: filePath,
      candidateCookiesPaths: [defaultCookiesPath]
    });
    const summary = await loadPlatformCredentialSummary(filePath);
    const douyin = summary.find((entry) => entry.platform === 'douyin');

    assert.equal(result.applied, true);
    assert.equal(douyin?.cookiesFilePath, defaultCookiesPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('first-run setup creates local config files and runtime directories from templates', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-first-run-'));
  const providerTemplatePath = path.join(tempDir, 'providers.template.json');
  const providerLocalPath = path.join(tempDir, 'providers.local.json');
  const platformTemplatePath = path.join(tempDir, 'download-platform-credentials.template.json');
  const platformLocalPath = path.join(tempDir, 'download-platform-credentials.local.json');
  const uploadsDirectory = path.join(tempDir, '.runtime-uploads');
  const runtimeStateDirectory = path.join(tempDir, '.runtime-state');
  const cacheDirectory = path.join(tempDir, '.cache', 'video-tagging');

  try {
    writeFileSync(
      providerTemplatePath,
      `${JSON.stringify({
        qwen: {
          enabled: false,
          provider: 'qwen',
          authMode: 'api-key',
          modelName: 'qwen3.6-flash',
          apiKey: '',
          oauth: { authorizeUrl: '', clientId: '', redirectUri: '', scope: [] }
        }
      }, null, 2)}\n`
    );
    writeFileSync(
      platformTemplatePath,
      `${JSON.stringify({
        global: { cookiesFilePath: '', cookiesFromBrowser: '' },
        bilibili: { cookiesFilePath: '', cookiesFromBrowser: '' },
        youtube: { cookiesFilePath: '', cookiesFromBrowser: '' },
        douyin: { cookiesFilePath: '', cookiesFromBrowser: '' },
        tiktok: { cookiesFilePath: '', cookiesFromBrowser: '' }
      }, null, 2)}\n`
    );

    const result = await ensureFirstRunLocalState({
      providerTemplatePath,
      providerLocalPath,
      platformTemplatePath,
      platformLocalPath,
      runtimeDirectories: [uploadsDirectory, runtimeStateDirectory, cacheDirectory]
    });

    assert.equal(result.createdFiles.includes(providerLocalPath), true);
    assert.equal(result.createdFiles.includes(platformLocalPath), true);
    assert.equal(existsSync(providerLocalPath), true);
    assert.equal(existsSync(platformLocalPath), true);
    assert.equal(existsSync(uploadsDirectory), true);
    assert.equal(existsSync(runtimeStateDirectory), true);
    assert.equal(existsSync(cacheDirectory), true);

    const providerSummary = await loadProviderConfigSummary(providerLocalPath);
    const platformSummary = await loadPlatformCredentialSummary(platformLocalPath);

    assert.equal((providerSummary.qwen as Record<string, unknown>).enabled, false);
    assert.equal(platformSummary.length, 4);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('renames duplicate standardized AfterEdit stems when building post-edit record sheet', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-runtime-'));
  const downloadDirectory = path.join(tempDir, 'downloads');
  const afterEditDirectory = path.join(downloadDirectory, 'AfterEdit');

  try {
    mkdirSync(afterEditDirectory, { recursive: true });
    writeFileSync(path.join(afterEditDirectory, '样本A_720P_260427_000010.mp4'), '');
    writeFileSync(path.join(afterEditDirectory, '样本A_720P_260427_000010.mov'), '');

    const result = await buildPostEditRecordSheet({ downloadDirectory });
    const fileNames = (result.files as readonly Record<string, unknown>[])
      .map((file) => String(file.fileName))
      .sort((left, right) => left.localeCompare(right));

    assert.equal(fileNames.length, 2);
    assert.equal(fileNames.every((fileName) => /^[\p{Script=Han}A-Za-z0-9_]+_[A-Z0-9]+P_\d{6}_\d{6}\.[A-Za-z0-9]+$/u.test(fileName)), true);
    assert.equal(fileNames.some((fileName) => fileName.includes('_02_720P_')), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('builds post-edit record sheet for only the selected AfterEdit batch sample', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-runtime-'));
  const downloadDirectory = path.join(tempDir, 'downloads');
  const afterEditDirectory = path.join(downloadDirectory, 'AfterEdit');
  const samplePath = path.join(afterEditDirectory, '粤语版_1600P_260611_000004_715.mp4');

  try {
    mkdirSync(afterEditDirectory, { recursive: true });
    writeFileSync(samplePath, '');
    writeFileSync(path.join(afterEditDirectory, '粤语版_1600P_260611_000005_716.mp4'), '');
    writeFileSync(path.join(afterEditDirectory, '粤语版_1600P_260612_000004_01.mp4'), '');
    writeFileSync(path.join(afterEditDirectory, '其他_720P_260611_000004_01.mp4'), '');

    const result = await buildPostEditRecordSheet({
      downloadDirectory,
      batchSampleFilePath: samplePath
    });
    const fileNames = (result.files as readonly Record<string, unknown>[])
      .map((file) => String(file.fileName))
      .sort((left, right) => left.localeCompare(right));

    assert.equal(result.filterMode, 'batch-sample');
    assert.equal(result.batchKey, '粤语版_1600P_260611');
    assert.equal(result.fileCount, 2);
    assert.equal(path.basename(String(result.outputFilePath)), 'AfterEdit_归档记录表_粤语版_1600P_260611.xlsx');
    assert.deepEqual(fileNames, [
      '粤语版_1600P_260611_000004_715.mp4',
      '粤语版_1600P_260611_000005_716.mp4'
    ]);

    const workbook = xlsx.readFile(String(result.outputFilePath));
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets[workbook.SheetNames[0]!]!,
      { defval: '' }
    );

    assert.equal(records.length, 2);
    assert.equal(
      records.every((record) => record.文件名.startsWith('粤语版_1600P_260611_')),
      true
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('recursively scans AfterEdit and renames invalid exported files before sheet creation', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-runtime-'));
  const downloadDirectory = path.join(tempDir, 'downloads');
  const nestedDirectory = path.join(downloadDirectory, 'AfterEdit', '崩铁二创测试output');
  const exportedPath = path.join(nestedDirectory, '崩铁二创测试output-1.mp4');

  try {
    mkdirSync(nestedDirectory, { recursive: true });
    writeTinyVideo(exportedPath);
    const exportedAt = new Date('2026-05-03T10:20:00.000Z');
    utimesSync(exportedPath, exportedAt, exportedAt);

    const result = await buildPostEditRecordSheet({ downloadDirectory });
    const renamed = result.files?.[0] as Record<string, unknown> | undefined;

    assert.equal(result.fileCount, 1);
    assert.equal(result.renamedCount, 1);
    assert.equal(renamed?.originalRelativePath, '崩铁二创测试output/崩铁二创测试output-1.mp4');
    assert.equal(renamed?.fileName, '崩铁二创测试output1_720P_260503_000001.mp4');
    assert.equal(renamed?.relativePath, '崩铁二创测试output/崩铁二创测试output1_720P_260503_000001.mp4');
    assert.equal(existsSync(path.join(nestedDirectory, '崩铁二创测试output1_720P_260503_000001.mp4')), true);
    assert.equal(existsSync(exportedPath), false);

    const workbook = xlsx.readFile(String(result.outputFilePath));
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets[workbook.SheetNames[0]!]!,
      { defval: '' }
    );
    const expectedPath = path.join(downloadDirectory, 'AfterEdit', '崩铁二创测试output', '崩铁二创测试output1_720P_260503_000001.mp4');

    assert.equal(records[0]?.归档状态, '待压缩');
    assert.equal(records[0]?.源文件路径, expectedPath);
    assert.equal(records[0]?.当前文件路径, expectedPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('builds resume record sheet directly from a plain video folder', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-video-folder-'));
  const videoDirectory = path.join(tempDir, 'videos-only');
  const sourcePath = path.join(videoDirectory, 'plain export.mp4');

  try {
    mkdirSync(videoDirectory, { recursive: true });
    writeTinyVideo(sourcePath);
    const exportedAt = new Date('2026-06-24T08:00:00.000Z');
    utimesSync(sourcePath, exportedAt, exportedAt);

    const result = await buildPostEditRecordSheet({ videoDirectoryPath: videoDirectory });
    const outputFilePath = String(result.outputFilePath);

    assert.equal(result.afterEditDirectoryPath, videoDirectory);
    assert.equal(path.dirname(outputFilePath), videoDirectory);
    assert.equal(path.basename(outputFilePath), 'AfterEdit_归档记录表.xlsx');
    assert.equal(result.fileCount, 1);
    assert.equal(result.renamedCount, 1);

    const workbook = xlsx.readFile(outputFilePath);
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets[workbook.SheetNames[0]!]!,
      { defval: '' }
    );

    assert.equal(records[0]?.归档状态, '待压缩');
    assert.equal(records[0]?.源文件路径, records[0]?.当前文件路径);
    assert.equal(String(records[0]?.当前文件路径 ?? '').startsWith(videoDirectory), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('appends numeric suffix when standardized AfterEdit names collide', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-runtime-'));
  const downloadDirectory = path.join(tempDir, 'downloads');
  const afterEditDirectory = path.join(downloadDirectory, 'AfterEdit');
  const firstPath = path.join(afterEditDirectory, 'clip@one.mp4');
  const secondPath = path.join(afterEditDirectory, 'clip-one.mp4');

  try {
    mkdirSync(afterEditDirectory, { recursive: true });
    writeTinyVideo(firstPath);
    writeTinyVideo(secondPath);
    const exportedAt = new Date('2026-05-03T10:20:00.000Z');
    utimesSync(firstPath, exportedAt, exportedAt);
    utimesSync(secondPath, exportedAt, exportedAt);

    const result = await buildPostEditRecordSheet({ downloadDirectory });
    const fileNames = (result.files as readonly Record<string, unknown>[])
      .map((file) => String(file.fileName))
      .sort((left, right) => left.localeCompare(right));

    assert.deepEqual(new Set(fileNames), new Set([
      'clipone_720P_260503_000001.mp4',
      'clipone_02_720P_260503_000001.mp4'
    ]));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('download probe reports platform, credential source, and real-layer entry on classified failures', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-runtime-'));
  const credentialPath = path.join(tempDir, 'download-platform-credentials.local.json');

  try {
    writeFileSync(
      credentialPath,
      `${JSON.stringify({
        global: { cookiesFromBrowser: 'chrome' }
      }, null, 2)}\n`
    );

    const result = await probePlatformDownload({
      url: 'https://www.youtube.com/watch?v=abc',
      outputDirectory: tempDir,
      ytDlpBinary: '/path/to/missing-yt-dlp',
      platformCredentialConfigPath: credentialPath
    });

    assert.equal(result.ok, false);
    assert.equal(result.details?.platform, 'youtube');
    assert.equal(result.details?.credentialSource, 'config-global-browser-cookies');
    assert.equal(result.details?.enteredRealDownloadLayer, true);
    assert.equal(result.details?.errorCode, 'runtime-error');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('platform credential probe rejects cookies files without platform cookies before running yt-dlp', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-runtime-'));
  const cookiesPath = path.join(tempDir, 'cookies.txt');

  try {
    writeFileSync(
      cookiesPath,
      [
        '# Netscape HTTP Cookie File',
        '.youtube.com\tTRUE\t/\tTRUE\t1893456000\tLOGIN_INFO\tabc'
      ].join('\n')
    );

    const result = await probePlatformCredentialConnectivity({
      platform: 'douyin',
      cookiesFilePath: cookiesPath,
      ytDlpBinary: '/path/to/missing-yt-dlp'
    });

    assert.equal(result.ok, false);
    assert.equal(result.details?.platform, 'douyin');
    assert.equal(result.details?.errorCode, 'credential-domain-mismatch');
    assert.equal(result.details?.enteredMetadataProbeLayer, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('platform credential probe does not accept sibling cookie domains', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-runtime-'));
  const cookiesPath = path.join(tempDir, 'cookies.txt');

  try {
    writeFileSync(
      cookiesPath,
      [
        '# Netscape HTTP Cookie File',
        '.notdouyin.com\tTRUE\t/\tTRUE\t1893456000\tttwid\tabc'
      ].join('\n')
    );

    const result = await probePlatformCredentialConnectivity({
      platform: 'douyin',
      cookiesFilePath: cookiesPath,
      sampleUrl: 'https://www.douyin.com/jingxuan?modal_id=7636717753054891300',
      ytDlpBinary: '/path/to/missing-yt-dlp'
    });

    assert.equal(result.ok, false);
    assert.equal(result.details?.platform, 'douyin');
    assert.equal(result.details?.errorCode, 'credential-domain-mismatch');
    assert.equal(result.details?.enteredMetadataProbeLayer, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('platform credential probe requires an explicit douyin sample url', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-runtime-'));
  const cookiesPath = path.join(tempDir, 'douyin.cookies.txt');

  try {
    writeFileSync(
      cookiesPath,
      [
        '# Netscape HTTP Cookie File',
        '.douyin.com\tTRUE\t/\tTRUE\t1893456000\tttwid\tabc',
        '.douyin.com\tTRUE\t/\tTRUE\t1893456000\tsessionid\tdef'
      ].join('\n')
    );

    const result = await probePlatformCredentialConnectivity({
      platform: 'douyin',
      cookiesFilePath: cookiesPath,
      ytDlpBinary: '/path/to/missing-yt-dlp'
    });

    assert.equal(result.ok, false);
    assert.equal(result.details?.platform, 'douyin');
    assert.equal(result.details?.errorCode, 'sample-url-required');
    assert.equal(result.details?.enteredMetadataProbeLayer, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('platform credential probe uses douyin ssr probe and reports success', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-runtime-'));
  const cookiesPath = path.join(tempDir, 'douyin.cookies.txt');

  try {
    writeFileSync(
      cookiesPath,
      [
        '# Netscape HTTP Cookie File',
        '.douyin.com\tTRUE\t/\tTRUE\t1893456000\tttwid\tabc',
        '.douyin.com\tTRUE\t/\tTRUE\t1893456000\tsessionid\tdef'
      ].join('\n')
    );

    const result = await probePlatformCredentialConnectivity({
      platform: 'douyin',
      cookiesFilePath: cookiesPath,
      sampleUrl: 'https://www.douyin.com/jingxuan?modal_id=7636717753054891300',
      ytDlpBinary: '/path/to/missing-yt-dlp',
      fetch: async () => createRuntimeTextResponse(renderRuntimeSsrHtml({
        awemeId: '7636717753054891300',
        desc: 'probe',
        video: {
          duration: 1000,
          bitRateList: [
            {
              width: 1920,
              height: 1080,
              isH265: 0,
              playAddr: [
                {
                  src: 'https://v.example.com/probe.mp4'
                }
              ]
            }
          ]
        }
      }))
    });

    assert.equal(result.ok, true);
    assert.equal(result.details?.platform, 'douyin');
    assert.equal(result.details?.enteredMetadataProbeLayer, true);
    assert.equal(result.details?.reason, 'douyin-ssr');
    assert.equal(result.details?.title, 'probe');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function renderRuntimeSsrHtml(videoDetail: Record<string, unknown>): string {
  return `<script id="RENDER_DATA" type="application/json">${encodeURIComponent(
    JSON.stringify({
      app: {
        videoDetail
      }
    })
  )}</script>`;
}

function createRuntimeTextResponse(body: string) {
  return {
    ok: true,
    status: 200,
    async text() {
      return body;
    },
    async arrayBuffer() {
      return Buffer.from(body).buffer;
    }
  };
}

function writeTinyVideo(filePath: string): void {
  const result = spawnSync(
    'ffmpeg',
    [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1280x720:rate=1:duration=1',
      '-pix_fmt',
      'yuv420p',
      filePath
    ],
    {
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0, result.stderr);
}

function chmodExecutable(filePath: string): void {
  spawnSync('chmod', ['755', filePath], { encoding: 'utf8' });
}

test('download probe rejects unsupported urls before entering real download layer', async () => {
  const result = await probePlatformDownload({
    url: 'https://example.com/video',
    outputDirectory: '/tmp'
  });

  assert.equal(result.ok, false);
  assert.equal(result.details?.platform, null);
  assert.equal(result.details?.enteredRealDownloadLayer, false);
});
