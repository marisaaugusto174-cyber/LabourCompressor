import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachTaskCheckpoint,
  attachTaskResumeState,
  canResumeTask,
  completeTaskRecord,
  createTaskCheckpoint,
  createTaskRecord,
  createTaskResumeState,
  failTaskRecord,
  startTaskRecord
} from '../../../core/contracts/index.ts';

test('creates and starts a queued task record', () => {
  const task = createTaskRecord({
    id: 'task-1',
    kind: 'tagging-and-archive',
    workflowSessionId: 'workflow-1',
    createdAt: '2026-04-24T14:00:00.000Z'
  });
  const startedTask = startTaskRecord(task, {
    startedAt: '2026-04-24T14:01:00.000Z'
  });

  assert.equal(task.status, 'queued');
  assert.equal(startedTask.status, 'running');
  assert.equal(startedTask.attempt, 1);
});

test('attaches a verified checkpoint and completes the task', () => {
  const task = startTaskRecord(
    createTaskRecord({
      id: 'task-2',
      kind: 'download-and-merge',
      workflowSessionId: 'workflow-2',
      createdAt: '2026-04-24T14:00:00.000Z'
    }),
    {
      startedAt: '2026-04-24T14:01:00.000Z'
    }
  );
  const checkpoint = createTaskCheckpoint({
    stage: 'merge-output-verified',
    status: 'verified',
    recordedAt: '2026-04-24T14:02:00.000Z'
  });
  const taskWithCheckpoint = attachTaskCheckpoint(task, checkpoint);
  const completedTask = completeTaskRecord(taskWithCheckpoint, {
    finishedAt: '2026-04-24T14:03:00.000Z'
  });

  assert.equal(completedTask.status, 'succeeded');
  assert.equal(completedTask.lastVerifiedStep, 'merge-output-verified');
});

test('rejects completion without a verified checkpoint', () => {
  const task = startTaskRecord(
    createTaskRecord({
      id: 'task-3',
      kind: 'single-url-download',
      workflowSessionId: 'workflow-3',
      createdAt: '2026-04-24T14:00:00.000Z'
    }),
    {
      startedAt: '2026-04-24T14:01:00.000Z'
    }
  );

  assert.throws(() => {
    completeTaskRecord(task, {
      finishedAt: '2026-04-24T14:03:00.000Z'
    });
  }, /must have a verified checkpoint before completion/);
});

test('marks a failed task as resumable when resume state exists', () => {
  const runningTask = startTaskRecord(
    createTaskRecord({
      id: 'task-4',
      kind: 'tagging-and-archive',
      workflowSessionId: 'workflow-4',
      createdAt: '2026-04-24T14:00:00.000Z'
    }),
    {
      startedAt: '2026-04-24T14:01:00.000Z'
    }
  );
  const failedTask = failTaskRecord(runningTask, {
    errorCode: 'MODEL_TIMEOUT',
    errorMessage: 'Model request timed out.',
    failedAt: '2026-04-24T14:02:00.000Z'
  });
  const resumableTask = attachTaskResumeState(
    failedTask,
    createTaskResumeState({
      token: 'resume-1',
      fromCheckpoint: 'candidate-generated',
      createdAt: '2026-04-24T14:03:00.000Z'
    })
  );

  assert.equal(failedTask.status, 'failed');
  assert.equal(canResumeTask(failedTask), false);
  assert.equal(canResumeTask(resumableTask), true);
});
