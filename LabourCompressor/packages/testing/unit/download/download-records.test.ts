import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDownloadRequest,
  createDownloadTaskRecord,
  getMuxedArtifact,
  getSeparatedArtifacts,
  markDownloadTaskCompleted,
  markDownloadTaskFailed,
  markDownloadTaskStarted
} from '../../../features/download/domain/index.ts';

test('creates a download request with detected platform', () => {
  const request = createDownloadRequest({
    taskId: 'task-1',
    workflowSessionId: 'workflow-1',
    rowNumber: 2,
    sourceUrl: 'https://www.youtube.com/watch?v=abc',
    outputDirectory: '/tmp/downloads',
    outputFileStem: '2-sample'
  });

  assert.equal(request.platform, 'youtube');
  assert.equal(request.rowNumber, 2);
});

test('completes a started download task with verified checkpoint', () => {
  const created = createDownloadTaskRecord({
    taskId: 'task-1',
    workflowSessionId: 'workflow-1',
    createdAt: '2026-04-24T18:00:00.000Z'
  });
  const started = markDownloadTaskStarted(created, '2026-04-24T18:01:00.000Z');
  const completed = markDownloadTaskCompleted({
    task: started,
    stage: 'merged',
    finishedAt: '2026-04-24T18:02:00.000Z'
  });

  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.lastVerifiedStep, 'merged');
});

test('marks failed download task as resumable', () => {
  const request = createDownloadRequest({
    taskId: 'task-1',
    workflowSessionId: 'workflow-1',
    rowNumber: 2,
    sourceUrl: 'https://www.tiktok.com/@u/video/1',
    outputDirectory: '/tmp/downloads',
    outputFileStem: '2-sample'
  });
  const created = createDownloadTaskRecord({
    taskId: 'task-1',
    workflowSessionId: 'workflow-1',
    createdAt: '2026-04-24T18:00:00.000Z'
  });
  const failed = markDownloadTaskFailed({
    task: created,
    request,
    failedAt: '2026-04-24T18:03:00.000Z',
    errorCode: 'download-failed',
    errorMessage: 'network timeout'
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.resumeState?.token, request.normalizedUrl);
});

test('detects muxed and separated artifacts', () => {
  const muxed = getMuxedArtifact({
    request: createDownloadRequest({
      taskId: 'task-1',
      workflowSessionId: 'workflow-1',
      rowNumber: 2,
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
      outputDirectory: '/tmp/downloads',
      outputFileStem: '2-sample'
    }),
    artifacts: [
      {
        kind: 'muxed-video',
        filePath: '/tmp/downloads/2-sample.mp4',
        fileName: '2-sample.mp4',
        container: 'mp4'
      }
    ],
    downloadedAt: '2026-04-24T18:04:00.000Z'
  });
  const separated = getSeparatedArtifacts({
    request: createDownloadRequest({
      taskId: 'task-2',
      workflowSessionId: 'workflow-1',
      rowNumber: 3,
      sourceUrl: 'https://www.douyin.com/video/1',
      outputDirectory: '/tmp/downloads',
      outputFileStem: '3-sample'
    }),
    artifacts: [
      {
        kind: 'video-only',
        filePath: '/tmp/downloads/3-sample.video.m4v',
        fileName: '3-sample.video.m4v',
        container: 'm4v'
      },
      {
        kind: 'audio-only',
        filePath: '/tmp/downloads/3-sample.audio.m4a',
        fileName: '3-sample.audio.m4a',
        container: 'm4a'
      }
    ],
    downloadedAt: '2026-04-24T18:05:00.000Z'
  });

  assert.equal(muxed?.kind, 'muxed-video');
  assert.equal(separated.videoArtifact?.kind, 'video-only');
  assert.equal(separated.audioArtifact?.kind, 'audio-only');
});
