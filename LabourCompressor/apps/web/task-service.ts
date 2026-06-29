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
  type RuntimeTaskOptionsPreparer,
  type RuntimeTaskStore,
  type RuntimeTaskSnapshot as OrchestratorRuntimeTaskSnapshot,
  type RuntimeTaskStatus
} from '../../packages/orchestrator/index.ts';
import { createJsonRuntimeTaskStore } from '../../packages/adapters/storage/runtime-task/json-runtime-task-store.ts';

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

export type PersistedCliTask = PersistedRuntimeTask<
  RunLocalPipelineOptions,
  RunLocalPipelineResult,
  CliStageEvent
>;

export function createRuntimeTaskService(options: {
  readonly stateFilePath?: string | undefined;
  readonly taskStore?: RuntimeTaskStore<PersistedCliTask> | undefined;
  readonly maxPersistedTasks?: number | undefined;
  readonly pipelineRunner?: RuntimePipelineRunner | undefined;
  readonly prepareOptions?: RuntimeTaskOptionsPreparer<RunLocalPipelineOptions> | undefined;
  readonly createId?: (() => string) | undefined;
  readonly now?: (() => string) | undefined;
} = {}) {
  return createOrchestratorRuntimeTaskService({
    runner: options.pipelineRunner ?? runLocalPipelineCommand,
    normalizeEvent: normalizeCliStageEvent,
    createLifecycleEvent,
    createAbortError: () => createPipelineCancelledError('任务已取消。'),
    isCancelledError: isPipelineCancelledError,
    persistence: options.taskStore ?? createJsonPersistence(options.stateFilePath),
    maxPersistedTasks: options.maxPersistedTasks,
    prepareOptions: options.prepareOptions,
    createId: options.createId,
    now: options.now
  });
}

export async function createConfiguredRuntimeTaskService(input: {
  readonly defaultJsonPath: string;
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
}) {
  const environment = input.environment ?? process.env;
  const storeKind = environment.LABOUR_COMPRESSOR_TASK_STORE ?? 'json';
  if (storeKind === 'json') {
    return createRuntimeTaskService({
      taskStore: createJsonRuntimeTaskStore({ filePath: input.defaultJsonPath })
    });
  }
  if (storeKind !== 'sqlite') {
    throw new Error('LABOUR_COMPRESSOR_TASK_STORE must be "json" or "sqlite".');
  }
  const databasePath = environment.LABOUR_COMPRESSOR_TASK_DB_PATH ??
    path.join(path.dirname(input.defaultJsonPath), 'tasks.sqlite');
  let createSqliteRuntimeTaskStore: typeof import(
    '../../packages/adapters/storage/runtime-task/sqlite-runtime-task-store.ts'
  )['createSqliteRuntimeTaskStore'];
  try {
    ({ createSqliteRuntimeTaskStore } = await import(
      '../../packages/adapters/storage/runtime-task/sqlite-runtime-task-store.ts'
    ));
  } catch (error) {
    throw new Error(
      'SQLite task storage requires a Node.js runtime with node:sqlite support.',
      { cause: error }
    );
  }
  return createRuntimeTaskService({
    taskStore: createSqliteRuntimeTaskStore<PersistedCliTask>({ databasePath })
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

function createJsonPersistence(
  stateFilePath: string | undefined
): RuntimeTaskPersistence<RunLocalPipelineOptions, RunLocalPipelineResult, CliStageEvent> | undefined {
  if (stateFilePath === undefined) return undefined;
  return createJsonRuntimeTaskStore({ filePath: stateFilePath });
}
