export interface RuntimeTaskStore<TTask> {
  load(): readonly TTask[];
  save(tasks: readonly TTask[]): void;
}

export class RuntimeTaskStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeTaskStoreError';
    this.code = code;
  }
}
