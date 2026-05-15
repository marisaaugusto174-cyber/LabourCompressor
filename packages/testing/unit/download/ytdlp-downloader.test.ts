import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildYtDlpArgs,
  classifyYtDlpErrorMessage,
  createYtDlpDownloaderAdapter,
  extractStructuredDownloadError,
  resolveYtDlpBinaryPath,
  resolveYtDlpCredential,
  validateYtDlpBinary
} from '../../../adapters/downloaders/ytdlp-downloader.ts';
import { createDownloadRequest } from '../../../features/download/domain/index.ts';

test('builds yt-dlp args for merged mp4 download', () => {
  const args = buildYtDlpArgs(
    createDownloadRequest({
      taskId: 'task-1',
      workflowSessionId: 'workflow-1',
      rowNumber: 2,
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
      outputDirectory: '/tmp/downloads',
      outputFileStem: '2-sample'
    })
  );

  assert.equal(args.includes('--merge-output-format'), true);
  assert.equal(args.includes('bv*+ba/b'), true);
  assert.equal(args.includes('before_dl:LCMETA:%(title)s\t%(height)s\t%(duration)s'), true);
});

test('builds yt-dlp args with browser cookies support', () => {
  const args = buildYtDlpArgs(
    createDownloadRequest({
      taskId: 'task-1',
      workflowSessionId: 'workflow-1',
      rowNumber: 2,
      sourceUrl: 'https://www.douyin.com/shipin/7262945903315568677',
      outputDirectory: '/tmp/downloads',
      outputFileStem: '2-sample'
    }),
    {
      cookiesFromBrowser: 'chrome'
    }
  );

  assert.equal(args.includes('--cookies-from-browser'), true);
  assert.equal(args.includes('chrome'), true);
  assert.equal(args.at(-1), 'https://www.douyin.com/video/7262945903315568677');
});

test('builds yt-dlp args with platform credential config override', () => {
  const request = createDownloadRequest({
    taskId: 'task-1',
    workflowSessionId: 'workflow-1',
    rowNumber: 2,
    sourceUrl: 'https://www.youtube.com/watch?v=abc',
    outputDirectory: '/tmp/downloads',
    outputFileStem: '2-sample'
  });
  const args = buildYtDlpArgs(request, {
    platformCredentialConfig: {
      youtube: {
        cookiesFilePath: '/tmp/youtube-cookies.txt'
      }
    },
    cookiesFilePath: '/tmp/global-cookies.txt'
  });

  const cookiesIndex = args.indexOf('--cookies');
  assert.notEqual(cookiesIndex, -1);
  assert.equal(args[cookiesIndex + 1], '/tmp/youtube-cookies.txt');
});

test('falls back to config global cookies after platform and request-level credentials are absent', () => {
  const resolved = resolveYtDlpCredential(
    createDownloadRequest({
      taskId: 'task-1',
      workflowSessionId: 'workflow-1',
      rowNumber: 2,
      sourceUrl: 'https://www.tiktok.com/@sample/video/123',
      outputDirectory: '/tmp/downloads',
      outputFileStem: '2-sample'
    }),
    {
      platformCredentialConfig: {
        global: {
          cookiesFromBrowser: 'safari'
        }
      }
    }
  );

  assert.equal(resolved.source, 'config-global-browser-cookies');
  assert.equal(resolved.cookiesFromBrowser, 'safari');
});

test('validates that yt-dlp binary is available', async () => {
  assert.equal(await validateYtDlpBinary(), true);
});

test('creates output directory before invoking downloader binary', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'labour-compressor-ytdlp-'));
  const outputDirectory = path.join(tempDir, 'missing', 'downloads');
  const adapter = createYtDlpDownloaderAdapter({ binaryPath: '/bin/echo' });

  try {
    await assert.rejects(
      adapter.download(
        createDownloadRequest({
          taskId: 'task-1',
          workflowSessionId: 'workflow-1',
          rowNumber: 2,
          sourceUrl: 'https://www.youtube.com/watch?v=abc',
          outputDirectory,
          outputFileStem: '2-sample'
        })
      ),
      /未产出可识别的视频文件|without producing detectable output files/u
    );
    assert.equal(existsSync(outputDirectory), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('detects existing final output file reported by yt-dlp after_move print', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'labour-compressor-ytdlp-'));
  const outputDirectory = path.join(tempDir, 'downloads');
  const expectedFilePath = path.join(
    outputDirectory,
    'Sample_A_720P_260424_000027.mp4'
  );
  const fakeBinaryPath = path.join(tempDir, 'fake-yt-dlp.sh');

  try {
    await rm(outputDirectory, { recursive: true, force: true });
    writeFileSync(path.join(tempDir, '.keep'), '', 'utf8');
    await mkdir(outputDirectory, { recursive: true });
    writeFileSync(expectedFilePath, 'existing-content', 'utf8');
    writeFileSync(
      fakeBinaryPath,
      `#!/bin/sh
echo 'LCMETA:Sample A\t720\t27'
echo 'LCFILE:${expectedFilePath}'
`,
      'utf8'
    );
    chmodSync(fakeBinaryPath, 0o755);

    const adapter = createYtDlpDownloaderAdapter({ binaryPath: fakeBinaryPath });
    const result = await adapter.download(
      createDownloadRequest({
        taskId: 'task-1',
        workflowSessionId: 'workflow-1',
        rowNumber: 2,
        sourceUrl: 'https://www.youtube.com/watch?v=abc',
        outputDirectory,
        outputFileStem: '2-sample'
      })
    );

    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]?.kind, 'muxed-video');
    assert.equal(result.artifacts[0]?.filePath, expectedFilePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('resolves configured yt-dlp binary or Homebrew fallback path', () => {
  assert.equal(resolveYtDlpBinaryPath('/custom/yt-dlp'), '/custom/yt-dlp');

  if (existsSync('/opt/homebrew/bin/yt-dlp')) {
    assert.equal(resolveYtDlpBinaryPath(), '/opt/homebrew/bin/yt-dlp');
  } else if (existsSync('/usr/local/bin/yt-dlp')) {
    assert.equal(resolveYtDlpBinaryPath(), '/usr/local/bin/yt-dlp');
  } else {
    assert.equal(resolveYtDlpBinaryPath(), 'yt-dlp');
  }
});

test('resolves project-local Windows yt-dlp executable before PATH fallback', () => {
  const existingPaths = new Set([
    path.join('C:\\labour', '.tools', 'bin', 'yt-dlp.exe')
  ]);

  assert.equal(
    resolveYtDlpBinaryPath(undefined, {
      platform: 'win32',
      projectRoot: 'C:\\labour',
      exists: (candidatePath) => existingPaths.has(candidatePath)
    }),
    path.join('C:\\labour', '.tools', 'bin', 'yt-dlp.exe')
  );

  assert.equal(
    resolveYtDlpBinaryPath(undefined, {
      platform: 'win32',
      projectRoot: 'C:\\missing',
      exists: () => false
    }),
    'yt-dlp'
  );
});

test('classifies fresh cookies and bilibili 412 errors', () => {
  assert.equal(
    classifyYtDlpErrorMessage('ERROR: Fresh cookies (not necessarily logged in) are needed').status,
    'needs-fresh-cookies'
  );
  assert.equal(
    classifyYtDlpErrorMessage('ERROR: HTTP Error 412: Precondition Failed').status,
    'blocked-by-bilibili-412'
  );
  assert.equal(
    classifyYtDlpErrorMessage('spawn yt-dlp ENOENT').status,
    'runtime-error'
  );
});

test('extracts structured short download error without leaking yt-dlp long logs', () => {
  const structured = extractStructuredDownloadError(
    new Error('ERROR: Sign in to confirm your age\nTraceback: very long internal log\nline 2')
  );

  assert.equal(structured.errorCode, 'missing-credentials');
  assert.equal(structured.errorMessage, '下载失败：当前平台需要可用的登录态或 Cookies。');
  assert.equal(structured.errorDetail, 'ERROR: Sign in to confirm your age');
});
