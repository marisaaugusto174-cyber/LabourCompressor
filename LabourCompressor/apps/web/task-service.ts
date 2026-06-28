import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runLocalPipelineCommand, type RunLocalPipelineOptions } from '../cli/local-pipeline-command.ts';
import {
  createPipelineCancelledError,
  isPipelineCancelledError,
  type PipelineControl
} from '../cli/pipeline-control.ts';
import { type RunLocalPipelineResult } from '../cli/pipeline-result.ts';
import { normalizeCliStageEvent, type CliStageEvent } from '../cli/status-reporter.ts';
import {
  createRuntimeTaskService as createOrchestratorRuntimeTaskService,
  type PersistedRuntimeTask,
  type RuntimeLifecycleEventInput,
  type RuntimeTaskPersistence,
  type RuntimeTaskSnapshot as OrchestratorRuntimeTaskSnapshot,
  type RuntimeTaskStatus
} from '../../packages/orchestrator/index.ts';

export type { RuntimeTaskStatus } from '../../packages/orchestrator/index.ts';

export type RuntimePipelineRunner = (input: {
  readonly options: RunLocalPipelineOptions;
  readonly report: (event: CliStageEvent) => void;
  readonly control: PipelineControl;
}) => Promise<RunLocalPipelineResult>;

export type RuntimeTaskSnapshot = OrchestratorRuntimeTaskSnapshot<
  RunLocalPipelineOptions,
  RunLocalPipelineResult,
  CliStageEvent
>;

type PersistedCliTask = PersistedRuntimeTask<
  RunLocalPipelineOptions,
  RunLocalPipelineResult,
  CliStageEvent
>;

export function createRuntimeTaskService(options: {
  readonly stateFilePath?: string | undefined;
  readonly maxPersistedTasks?: number | undefined;
  readonly pipelineRunner?: RuntimePipelineRunner | undefined;
} = {}) {
  return createOrchestratorRuntimeTaskService({
    runner: options.pipelineRunner ?? runLocalPipelineCommand,
    normalizeEvent: normalizeCliStageEvent,
    createLifecycleEvent,
    createAbortError: () => createPipelineCancelledError('任务已取消。'),
    isCancelledError: isPipelineCancelledError,
    persistence: createLegacyJsonPersistence(options.stateFilePath),
    maxPersistedTasks: options.maxPersistedTasks
  });
}

function createLifecycleEvent(input: RuntimeLifecycleEventInput): CliStageEvent {
  return {
    stage: 'task',
    phase: 'task',
    status: lifecycleStatus(input.kind),
    message: input.message,
    timestamp: input.timestamp
  };
}

function lifecycleStatus(
  kind: RuntimeLifecycleEventInput['kind']
): CliStageEvent['status'] {
  if (kind === 'succeeded') return 'succeeded';
  if (kind === 'failed') return 'failed';
  return 'running';
}

function createLegacyJsonPersistence(
  stateFilePath: string | undefined
): RuntimeTaskPersistence<RunLocalPipelineOptions, RunLocalPipelineResult, CliStageEvent> | undefined {
  if (stateFilePath === undefined) return undefined;
  return {
    load: () => loadPersistedTasks(stateFilePath),
    save: (tasks) => savePersistedTasks(stateFilePath, tasks)
  };
}

function loadPersistedTasks(stateFilePath: string): readonly PersistedCliTask[] {
  try {
    const parsed = JSON.parse(readFileSync(stateFilePath, 'utf8')) as {
      readonly tasks?: readonly PersistedCliTask[] | undefined;
    };
    return parsed.tasks ?? [];
  } catch {
    return [];
  }
}

function savePersistedTasks(
  stateFilePath: string,
  tasks: readonly PersistedCliTask[]
): void {
  mkdirSync(path.dirname(stateFilePath), { recursive: true });
  writeFileSync(stateFilePath, `${JSON.stringify({ tasks }, null, 2)}\n`, 'utf8');
}
