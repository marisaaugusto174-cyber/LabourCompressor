import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runLocalPipelineCommand, type RunLocalPipelineOptions } from '../cli/local-pipeline-command.ts';
import { type RunLocalPipelineResult } from '../cli/pipeline-result.ts';
import { normalizeCliStageEvent, type CliStageEvent } from '../cli/status-reporter.ts';

export interface RuntimeTaskSnapshot {
  readonly id: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed';
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly options: RunLocalPipelineOptions;
  readonly latestEvent?: CliStageEvent;
  readonly result?: RunLocalPipelineResult;
  readonly error?: string;
}

interface RuntimeTaskState {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  options: RunLocalPipelineOptions;
  latestEvent?: CliStageEvent;
  result?: RunLocalPipelineResult;
  error?: string;
  events: CliStageEvent[];
  emitter: EventEmitter;
}

export function createRuntimeTaskService(options: {
  readonly stateFilePath?: string;
  readonly maxPersistedTasks?: number;
} = {}) {
  const maxPersistedTasks = options.maxPersistedTasks ?? 50;
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
        emitter: new EventEmitter()
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
    state.status = 'running';
    state.startedAt = new Date().toISOString();
    persistTasks();

    try {
      const result = await runLocalPipelineCommand({
        options: state.options,
        report: (event) => {
          const normalized = normalizeCliStageEvent(event);
          state.latestEvent = normalized;
          state.events.push(normalized);
          state.emitter.emit('event', normalized);
          persistTasks();
        }
      });
      state.status = 'succeeded';
      state.completedAt = new Date().toISOString();
      state.result = result;
      const successEvent = normalizeCliStageEvent({
        stage: 'task',
        phase: 'task',
        status: 'succeeded',
        message: `Task ${state.id} completed.`,
        timestamp: state.completedAt
      });
      state.latestEvent = successEvent;
      state.events.push(successEvent);
      state.emitter.emit('event', successEvent);
      persistTasks();
    } catch (error) {
      state.status = 'failed';
      state.completedAt = new Date().toISOString();
      state.error = error instanceof Error ? error.message : String(error);
      const failureEvent = normalizeCliStageEvent({
        stage: 'task',
        phase: 'task',
        status: 'failed',
        message: state.error,
        timestamp: state.completedAt
      });
      state.latestEvent = failureEvent;
      state.events.push(failureEvent);
      state.emitter.emit('event', failureEvent);
      persistTasks();
    }
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

function toPersistedTask(state: RuntimeTaskState): Omit<RuntimeTaskState, 'emitter'> {
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
      readonly tasks?: readonly Omit<RuntimeTaskState, 'emitter'>[];
    };

    return (parsed.tasks ?? []).map((task) => normalizeRestoredTask(task));
  } catch {
    return [];
  }
}

function normalizeRestoredTask(
  task: Omit<RuntimeTaskState, 'emitter'>
): RuntimeTaskState {
  if (task.status !== 'running' && task.status !== 'queued') {
    return {
      ...task,
      events: [...task.events],
      emitter: new EventEmitter()
    };
  }

  const completedAt = new Date().toISOString();
  const failureEvent = normalizeCliStageEvent({
    stage: 'task',
    phase: 'task',
    status: 'failed',
    message: 'Web 服务重启后无法恢复运行中的任务，请重新启动任务。',
    timestamp: completedAt
  });

  return {
    ...task,
    status: 'failed',
    completedAt,
    latestEvent: failureEvent,
    error: failureEvent.message,
    events: [...task.events, failureEvent],
    emitter: new EventEmitter()
  };
}
