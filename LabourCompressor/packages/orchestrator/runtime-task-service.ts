import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export type RuntimeTaskStatus =
  | 'queued'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'succeeded'
  | 'failed';

export interface RuntimeTaskControl {
  readonly signal: AbortSignal;
  createAbortError(): Error;
  throwIfAborted(): void;
  waitIfPaused(): Promise<void>;
}

export interface RuntimeTaskSnapshot<TOptions, TResult, TEvent> {
  readonly id: string;
  readonly status: RuntimeTaskStatus;
  readonly createdAt: string;
  readonly startedAt?: string | undefined;
  readonly completedAt?: string | undefined;
  readonly options: TOptions;
  readonly latestEvent?: TEvent | undefined;
  readonly result?: TResult | undefined;
  readonly error?: string | undefined;
}

export interface PersistedRuntimeTask<TOptions, TResult, TEvent>
  extends RuntimeTaskSnapshot<TOptions, TResult, TEvent> {
  readonly events: readonly TEvent[];
}

export interface RuntimeTaskPersistence<TOptions, TResult, TEvent> {
  load(): readonly PersistedRuntimeTask<TOptions, TResult, TEvent>[];
  save(tasks: readonly PersistedRuntimeTask<TOptions, TResult, TEvent>[]): void;
}

export type RuntimeTaskRunner<TOptions, TResult, TEvent> = (input: {
  readonly options: TOptions;
  readonly report: (event: TEvent) => void;
  readonly control: RuntimeTaskControl;
}) => Promise<TResult>;

export interface RuntimeLifecycleEventInput {
  readonly kind: 'paused' | 'resumed' | 'stopping' | 'succeeded' | 'failed' | 'cancelled';
  readonly taskId: string;
  readonly message: string;
  readonly timestamp: string;
}

interface RuntimeTaskState<TOptions, TResult, TEvent> {
  id: string;
  status: RuntimeTaskStatus;
  createdAt: string;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  options: TOptions;
  latestEvent?: TEvent | undefined;
  result?: TResult | undefined;
  error?: string | undefined;
  events: TEvent[];
  emitter: EventEmitter;
  abortController: AbortController;
  pauseRequested: boolean;
  pauseWaiters: Array<() => void>;
}

export function createRuntimeTaskService<TOptions, TResult, TEvent>(input: {
  readonly runner: RuntimeTaskRunner<TOptions, TResult, TEvent>;
  readonly normalizeEvent: (event: TEvent) => TEvent;
  readonly createLifecycleEvent: (input: RuntimeLifecycleEventInput) => TEvent;
  readonly createAbortError: () => Error;
  readonly isCancelledError: (error: unknown) => boolean;
  readonly persistence?: RuntimeTaskPersistence<TOptions, TResult, TEvent> | undefined;
  readonly maxPersistedTasks?: number | undefined;
  readonly createId?: (() => string) | undefined;
  readonly now?: (() => string) | undefined;
}) {
  const engine = new RuntimeTaskEngine(input);
  return Object.freeze({
    startTask: (options: TOptions) => engine.startTask(options),
    getTask: (taskId: string) => engine.getTask(taskId),
    listTasks: () => engine.listTasks(),
    pauseTask: (taskId: string) => engine.pauseTask(taskId),
    resumeTask: (taskId: string) => engine.resumeTask(taskId),
    stopTask: (taskId: string) => engine.stopTask(taskId),
    getTaskEvents: (taskId: string) => engine.getTaskEvents(taskId),
    subscribe: (taskId: string, listener: (event: TEvent) => void) =>
      engine.subscribe(taskId, listener)
  });
}

class RuntimeTaskEngine<TOptions, TResult, TEvent> {
  readonly #dependencies: Parameters<typeof createRuntimeTaskService<TOptions, TResult, TEvent>>[0];
  readonly #tasks: Map<string, RuntimeTaskState<TOptions, TResult, TEvent>>;
  readonly #maxPersistedTasks: number;
  readonly #createId: () => string;
  readonly #now: () => string;

  constructor(dependencies: Parameters<typeof createRuntimeTaskService<TOptions, TResult, TEvent>>[0]) {
    this.#dependencies = dependencies;
    this.#maxPersistedTasks = dependencies.maxPersistedTasks ?? 50;
    this.#createId = dependencies.createId ?? randomUUID;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#tasks = new Map(
      (dependencies.persistence?.load() ?? []).map((task) => {
        const state = this.#restoreTask(task);
        return [state.id, state] as const;
      })
    );
  }

  async startTask(options: TOptions): Promise<RuntimeTaskSnapshot<TOptions, TResult, TEvent>> {
    const state = this.#withRuntimeControls({
      id: this.#createId(), status: 'queued', createdAt: this.#now(), options, events: []
    });
    this.#tasks.set(state.id, state);
    this.#persist();
    queueMicrotask(() => void this.#runTask(state));
    return this.#snapshot(state);
  }

  getTask(taskId: string): RuntimeTaskSnapshot<TOptions, TResult, TEvent> | undefined {
    const task = this.#tasks.get(taskId);
    return task === undefined ? undefined : this.#snapshot(task);
  }

  listTasks(): readonly RuntimeTaskSnapshot<TOptions, TResult, TEvent>[] {
    return Object.freeze([...this.#tasks.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((task) => this.#snapshot(task)));
  }

  pauseTask(taskId: string): RuntimeTaskSnapshot<TOptions, TResult, TEvent> | undefined {
    const task = this.#tasks.get(taskId);
    if (task === undefined || isTerminalTaskStatus(task.status)) return this.getTask(taskId);
    task.pauseRequested = true;
    if (task.status === 'queued' || task.status === 'running') task.status = 'pausing';
    this.#emitLifecycle(task, 'paused', '任务暂停请求已收到，当前处理项完成后暂停。');
    return this.#snapshot(task);
  }

  resumeTask(taskId: string): RuntimeTaskSnapshot<TOptions, TResult, TEvent> | undefined {
    const task = this.#tasks.get(taskId);
    if (task === undefined || isTerminalTaskStatus(task.status)) return this.getTask(taskId);
    task.pauseRequested = false;
    if (task.status === 'paused' || task.status === 'pausing') task.status = 'running';
    for (const resolve of task.pauseWaiters.splice(0)) resolve();
    this.#emitLifecycle(task, 'resumed', '任务已恢复。');
    return this.#snapshot(task);
  }

  stopTask(taskId: string): RuntimeTaskSnapshot<TOptions, TResult, TEvent> | undefined {
    const task = this.#tasks.get(taskId);
    if (task === undefined || isTerminalTaskStatus(task.status)) return this.getTask(taskId);
    task.status = 'cancelling';
    task.error = '任务已取消（用户强制停止）。';
    task.abortController.abort();
    for (const resolve of task.pauseWaiters.splice(0)) resolve();
    this.#emitLifecycle(task, 'stopping', '任务强制停止请求已收到，正在取消当前操作。');
    return this.#snapshot(task);
  }

  getTaskEvents(taskId: string): readonly TEvent[] {
    return Object.freeze([...(this.#tasks.get(taskId)?.events ?? [])]);
  }

  subscribe(taskId: string, listener: (event: TEvent) => void): (() => void) | undefined {
    const task = this.#tasks.get(taskId);
    if (task === undefined) return undefined;
    task.emitter.on('event', listener);
    return () => task.emitter.off('event', listener);
  }

  async #runTask(state: RuntimeTaskState<TOptions, TResult, TEvent>): Promise<void> {
    state.status = state.pauseRequested ? 'pausing' : 'running';
    state.startedAt = this.#now();
    this.#persist();
    try {
      const control = this.#createControl(state);
      control.throwIfAborted();
      state.result = await this.#dependencies.runner({
        options: state.options,
        report: (event) => this.#emit(state, event),
        control
      });
      control.throwIfAborted();
      state.status = 'succeeded';
      state.completedAt = this.#now();
      this.#emitLifecycle(state, 'succeeded', `Task ${state.id} completed.`);
    } catch (error) {
      this.#failTask(state, error);
    }
  }

  #failTask(state: RuntimeTaskState<TOptions, TResult, TEvent>, error: unknown): void {
    const cancelled = state.abortController.signal.aborted || this.#dependencies.isCancelledError(error);
    state.status = cancelled ? 'cancelled' : 'failed';
    state.completedAt = this.#now();
    state.error = cancelled
      ? (state.error ?? '任务已取消。')
      : error instanceof Error ? error.message : String(error);
    this.#emitLifecycle(state, cancelled ? 'cancelled' : 'failed', state.error);
  }

  #createControl(state: RuntimeTaskState<TOptions, TResult, TEvent>): RuntimeTaskControl {
    return Object.freeze({
      signal: state.abortController.signal,
      createAbortError: this.#dependencies.createAbortError,
      throwIfAborted: () => {
        if (state.abortController.signal.aborted) throw this.#dependencies.createAbortError();
      },
      waitIfPaused: () => this.#waitIfPaused(state)
    });
  }

  async #waitIfPaused(state: RuntimeTaskState<TOptions, TResult, TEvent>): Promise<void> {
    if (!state.pauseRequested) return;
    state.status = 'paused';
    this.#emitLifecycle(state, 'paused', '任务已暂停。');
    await new Promise<void>((resolve) => state.pauseWaiters.push(resolve));
    if (state.abortController.signal.aborted) throw this.#dependencies.createAbortError();
  }

  #emitLifecycle(
    state: RuntimeTaskState<TOptions, TResult, TEvent>,
    kind: RuntimeLifecycleEventInput['kind'],
    message: string
  ): void {
    this.#emit(state, this.#dependencies.createLifecycleEvent({
      kind, taskId: state.id, message, timestamp: state.completedAt ?? this.#now()
    }));
  }

  #emit(state: RuntimeTaskState<TOptions, TResult, TEvent>, event: TEvent): void {
    const normalized = this.#dependencies.normalizeEvent(event);
    state.latestEvent = normalized;
    state.events.push(normalized);
    state.emitter.emit('event', normalized);
    this.#persist();
  }

  #persist(): void {
    const tasks = [...this.#tasks.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, this.#maxPersistedTasks)
      .map((task) => this.#persisted(task));
    this.#dependencies.persistence?.save(Object.freeze(tasks));
  }

  #restoreTask(task: PersistedRuntimeTask<TOptions, TResult, TEvent>): RuntimeTaskState<TOptions, TResult, TEvent> {
    if (!isEphemeralTaskStatus(task.status)) return this.#withRuntimeControls(task);
    const completedAt = this.#now();
    const error = 'Web 服务重启后无法恢复运行中的任务，请重新启动任务。';
    const event = this.#dependencies.createLifecycleEvent({
      kind: 'failed', taskId: task.id, message: error, timestamp: completedAt
    });
    return this.#withRuntimeControls({
      ...task, status: 'failed', completedAt, latestEvent: event, error,
      events: [...task.events, event]
    });
  }

  #withRuntimeControls(task: PersistedRuntimeTask<TOptions, TResult, TEvent>): RuntimeTaskState<TOptions, TResult, TEvent> {
    return {
      ...task, events: [...task.events], emitter: new EventEmitter(),
      abortController: new AbortController(), pauseRequested: false, pauseWaiters: []
    };
  }

  #snapshot(state: RuntimeTaskState<TOptions, TResult, TEvent>): RuntimeTaskSnapshot<TOptions, TResult, TEvent> {
    return Object.freeze({
      id: state.id, status: state.status, createdAt: state.createdAt,
      startedAt: state.startedAt, completedAt: state.completedAt, options: state.options,
      latestEvent: state.latestEvent, result: state.result, error: state.error
    });
  }

  #persisted(state: RuntimeTaskState<TOptions, TResult, TEvent>): PersistedRuntimeTask<TOptions, TResult, TEvent> {
    return { ...this.#snapshot(state), events: [...state.events] };
  }
}

function isTerminalTaskStatus(status: RuntimeTaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function isEphemeralTaskStatus(status: RuntimeTaskStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'pausing' ||
    status === 'paused' || status === 'cancelling';
}
