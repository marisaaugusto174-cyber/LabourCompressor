import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
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

export type RuntimeTaskStatus =
  | 'queued'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'succeeded'
  | 'failed';

export type RuntimePipelineRunner = (input: {
  readonly options: RunLocalPipelineOptions;
  readonly report: (event: CliStageEvent) => void;
  readonly control: PipelineControl;
}) => Promise<RunLocalPipelineResult>;

export interface RuntimeTaskSnapshot {
  readonly id: string;
  readonly status: RuntimeTaskStatus;
  readonly createdAt: string;
  readonly startedAt?: string | undefined;
  readonly completedAt?: string | undefined;
  readonly options: RunLocalPipelineOptions;
  readonly latestEvent?: CliStageEvent | undefined;
  readonly result?: RunLocalPipelineResult | undefined;
  readonly error?: string | undefined;
}

interface RuntimeTaskState {
  id: string;
  status: RuntimeTaskStatus;
  createdAt: string;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  options: RunLocalPipelineOptions;
  latestEvent?: CliStageEvent | undefined;
  result?: RunLocalPipelineResult | undefined;
  error?: string | undefined;
  events: CliStageEvent[];
  emitter: EventEmitter;
  abortController: AbortController;
  pauseRequested: boolean;
  pauseWaiters: Array<() => void>;
}

type PersistedRuntimeTask = Omit<
  RuntimeTaskState,
  'emitter' | 'abortController' | 'pauseRequested' | 'pauseWaiters'
>;

export function createRuntimeTaskService(options: {
  readonly stateFilePath?: string | undefined;
  readonly maxPersistedTasks?: number | undefined;
  readonly pipelineRunner?: RuntimePipelineRunner | undefined;
} = {}) {
  const maxPersistedTasks = options.maxPersistedTasks ?? 50;
  const pipelineRunner = options.pipelineRunner ?? runLocalPipelineCommand;
  const tasks = new Map<string, RuntimeTaskState>(
    loadPersistedTasks(options.stateFilePath).map((task) => [task.id, task] as const)
  );

  return Object.freeze({
    async startTask(options: RunLocalPipelineOptions): Promise<RuntimeTaskSnapshot> {
      const id = randomUUID();
      const state: RuntimeTaskState = {
        id,
        status: 'queued',
        createdAt: new Date().toISOString(),
        options,
        events: [],
        emitter: new EventEmitter(),
        abortController: new AbortController(),
        pauseRequested: false,
        pauseWaiters: []
      };
      tasks.set(id, state);
      persistTasks();
      queueMicrotask(() => void runTask(state));
      return toSnapshot(state);
    },
    getTask(taskId: string): RuntimeTaskSnapshot | undefined {
      const task = tasks.get(taskId);
      return task === undefined ? undefined : toSnapshot(task);
    },
    listTasks(): readonly RuntimeTaskSnapshot[] {
      return Object.freeze(
        [...tasks.values()]
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .map(toSnapshot)
      );
    },
    pauseTask(taskId: string): RuntimeTaskSnapshot | undefined {
      const task = tasks.get(taskId);
      if (task === undefined || isTerminalTaskStatus(task.status)) {
        return task === undefined ? undefined : toSnapshot(task);
      }
      task.pauseRequested = true;
      if (task.status === 'queued' || task.status === 'running') {
        task.status = 'pausing';
      }
      emitTaskEvent(task, {
        stage: 'task',
        phase: 'task',
        status: 'running',
        message: '任务暂停请求已收到，当前处理项完成后暂停。'
      });
      persistTasks();
      return toSnapshot(task);
    },
    resumeTask(taskId: string): RuntimeTaskSnapshot | undefined {
      const task = tasks.get(taskId);
      if (task === undefined || isTerminalTaskStatus(task.status)) {
        return task === undefined ? undefined : toSnapshot(task);
      }
      task.pauseRequested = false;
      if (task.status === 'paused' || task.status === 'pausing') {
        task.status = 'running';
      }
      const waiters = task.pauseWaiters.splice(0);
      for (const resolve of waiters) {
        resolve();
      }
      emitTaskEvent(task, {
        stage: 'task',
        phase: 'task',
        status: 'running',
        message: '任务已恢复。'
      });
      persistTasks();
      return toSnapshot(task);
    },
    stopTask(taskId: string): RuntimeTaskSnapshot | undefined {
      const task = tasks.get(taskId);
      if (task === undefined || isTerminalTaskStatus(task.status)) {
        return task === undefined ? undefined : toSnapshot(task);
      }
      task.status = 'cancelling';
      task.error = '任务已取消（用户强制停止）。';
      task.abortController.abort();
      const waiters = task.pauseWaiters.splice(0);
      for (const resolve of waiters) {
        resolve();
      }
      emitTaskEvent(task, {
        stage: 'task',
        phase: 'task',
        status: 'running',
        message: '任务强制停止请求已收到，正在取消当前操作。'
      });
      persistTasks();
      return toSnapshot(task);
    },
    getTaskEvents(taskId: string): readonly CliStageEvent[] {
      const task = tasks.get(taskId);
      return Object.freeze([...(task?.events ?? [])]);
    },
    subscribe(
      taskId: string,
      listener: (event: CliStageEvent) => void
    ): (() => void) | undefined {
      const task = tasks.get(taskId);

      if (task === undefined) {
        return undefined;
      }

      task.emitter.on('event', listener);
      return () => task.emitter.off('event', listener);
    }
  });

  async function runTask(state: RuntimeTaskState): Promise<void> {
    state.status = state.pauseRequested ? 'pausing' : 'running';
    state.startedAt = new Date().toISOString();
    persistTasks();

    try {
      const control = createTaskControl(state);
      control.throwIfAborted();
      const result = await pipelineRunner({
        options: state.options,
        report: (event) => emitTaskEvent(state, event),
        control
      });
      control.throwIfAborted();
      state.status = 'succeeded';
      state.completedAt = new Date().toISOString();
      state.result = result;
      emitTaskEvent(state, {
        stage: 'task',
        phase: 'task',
        status: 'succeeded',
        message: `Task ${state.id} completed.`,
        timestamp: state.completedAt
      });
      persistTasks();
    } catch (error) {
      const cancelled = state.abortController.signal.aborted || isPipelineCancelledError(error);
      state.status = cancelled ? 'cancelled' : 'failed';
      state.completedAt = new Date().toISOString();
      state.error = cancelled
        ? (state.error ?? '任务已取消。')
        : error instanceof Error ? error.message : String(error);
      emitTaskEvent(state, {
        stage: 'task',
        phase: 'task',
        status: cancelled ? 'running' : 'failed',
        message: state.error,
        timestamp: state.completedAt
      });
      persistTasks();
    }
  }

  function createTaskControl(state: RuntimeTaskState): PipelineControl {
    return Object.freeze({
      signal: state.abortController.signal,
      createAbortError: () => createPipelineCancelledError('任务已取消。'),
      throwIfAborted: () => {
        if (state.abortController.signal.aborted) {
          throw createPipelineCancelledError('任务已取消。');
        }
      },
      waitIfPaused: async () => {
        if (!state.pauseRequested) {
          return;
        }

        state.status = 'paused';
        emitTaskEvent(state, {
          stage: 'task',
          phase: 'task',
          status: 'running',
          message: '任务已暂停。'
        });
        persistTasks();

        await new Promise<void>((resolve) => {
          state.pauseWaiters.push(resolve);
        });

        if (state.abortController.signal.aborted) {
          throw createPipelineCancelledError('任务已取消。');
        }
      }
    });
  }

  function emitTaskEvent(state: RuntimeTaskState, event: CliStageEvent): void {
    const normalized = normalizeCliStageEvent(event);
    state.latestEvent = normalized;
    state.events.push(normalized);
    state.emitter.emit('event', normalized);
    persistTasks();
  }

  function persistTasks(): void {
    if (options.stateFilePath === undefined) {
      return;
    }

    const persistedTasks = [...tasks.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, maxPersistedTasks)
      .map(toPersistedTask);
    mkdirSync(path.dirname(options.stateFilePath), { recursive: true });
    writeFileSync(
      options.stateFilePath,
      `${JSON.stringify({ tasks: persistedTasks }, null, 2)}\n`,
      'utf8'
    );
  }
}

function toSnapshot(state: RuntimeTaskState): RuntimeTaskSnapshot {
  return Object.freeze({
    id: state.id,
    status: state.status,
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    options: state.options,
    latestEvent: state.latestEvent,
    result: state.result,
    error: state.error
  });
}

function toPersistedTask(state: RuntimeTaskState): PersistedRuntimeTask {
  return {
    id: state.id,
    status: state.status,
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    options: state.options,
    latestEvent: state.latestEvent,
    result: state.result,
    error: state.error,
    events: state.events
  };
}

function loadPersistedTasks(stateFilePath: string | undefined): RuntimeTaskState[] {
  if (stateFilePath === undefined) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(stateFilePath, 'utf8')) as {
      readonly tasks?: readonly PersistedRuntimeTask[] | undefined;
    };

    return (parsed.tasks ?? []).map((task) => normalizeRestoredTask(task));
  } catch {
    return [];
  }
}

function normalizeRestoredTask(task: PersistedRuntimeTask): RuntimeTaskState {
  if (!isEphemeralTaskStatus(task.status)) {
    return withRuntimeControls(task);
  }

  const completedAt = new Date().toISOString();
  const failureEvent = normalizeCliStageEvent({
    stage: 'task',
    phase: 'task',
    status: 'failed',
    message: 'Web 服务重启后无法恢复运行中的任务，请重新启动任务。',
    timestamp: completedAt
  });

  return withRuntimeControls({
    ...task,
    status: 'failed',
    completedAt,
    latestEvent: failureEvent,
    error: failureEvent.message,
    events: [...task.events, failureEvent]
  });
}

function withRuntimeControls(task: PersistedRuntimeTask): RuntimeTaskState {
  return {
    ...task,
    events: [...task.events],
    emitter: new EventEmitter(),
    abortController: new AbortController(),
    pauseRequested: false,
    pauseWaiters: []
  };
}

function isTerminalTaskStatus(status: RuntimeTaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function isEphemeralTaskStatus(status: RuntimeTaskStatus): boolean {
  return status === 'queued' ||
    status === 'running' ||
    status === 'pausing' ||
    status === 'paused' ||
    status === 'cancelling';
}
