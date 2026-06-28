import test from 'node:test';
import assert from 'node:assert/strict';

import {
  executePipelinePlan,
  resolvePipelineStageIds,
  type PipelineStagePort
} from '../../../orchestrator/index.ts';

test('resolves all, resume-cache, and single-stage plans', () => {
  assert.deepEqual(resolvePipelineStageIds({ mode: 'all' }), [
    'download', 'segment', 'compress', 'tag', 'archive'
  ]);
  assert.deepEqual(resolvePipelineStageIds({ mode: 'resume-cache' }), [
    'compress', 'tag', 'archive'
  ]);
  assert.deepEqual(resolvePipelineStageIds({ mode: 'single', stageId: 'segment' }), ['segment']);
});

test('executes checkpoints, stages, and transition hooks in order', async () => {
  const trace: string[] = [];
  const stages: readonly PipelineStagePort<{ sheet: string }, string>[] = [
    createStage('download', trace),
    createStage('segment', trace),
    createStage('compress', trace),
    createStage('tag', trace),
    createStage('archive', trace)
  ];

  const execution = await executePipelinePlan({
    plan: { mode: 'all' },
    stages,
    context: { sheet: 'source.xlsx' },
    checkpoint: (stageId) => { trace.push(`checkpoint:${stageId}`); },
    transition: (context, completed) => {
      trace.push(`transition:${completed.stageId}`);
      return completed.stageId === 'segment'
        ? { sheet: 'AfterEdit.xlsx' }
        : context;
    }
  });

  assert.equal(execution.context.sheet, 'AfterEdit.xlsx');
  assert.deepEqual(execution.completedStageIds, [
    'download', 'segment', 'compress', 'tag', 'archive'
  ]);
  assert.deepEqual(trace.slice(0, 3), [
    'checkpoint:download', 'stage:download:source.xlsx', 'transition:download'
  ]);
  assert.equal(trace.includes('stage:compress:AfterEdit.xlsx'), true);
});

test('stops immediately when a stage fails', async () => {
  const executed: string[] = [];
  const stages: readonly PipelineStagePort<Record<string, never>, string>[] = [
    { id: 'download', execute: async () => { executed.push('download'); return 'ok'; } },
    { id: 'segment', execute: async () => { executed.push('segment'); throw new Error('failed'); } },
    { id: 'compress', execute: async () => { executed.push('compress'); return 'unexpected'; } }
  ];

  await assert.rejects(
    executePipelinePlan({ plan: { mode: 'all' }, stages, context: {} }),
    /failed/u
  );
  assert.deepEqual(executed, ['download', 'segment']);
});

function createStage(
  id: PipelineStagePort<{ sheet: string }, string>['id'],
  trace: string[]
): PipelineStagePort<{ sheet: string }, string> {
  return {
    id,
    async execute(context) {
      trace.push(`stage:${id}:${context.sheet}`);
      return id;
    }
  };
}
