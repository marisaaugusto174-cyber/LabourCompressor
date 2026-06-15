export interface PipelineControl {
  readonly signal: AbortSignal;
  readonly waitIfPaused: () => Promise<void>;
  readonly throwIfAborted: () => void;
  readonly createAbortError: () => Error;
}

export class PipelineCancelledError extends Error {
  constructor(message = 'Task cancelled.') {
    super(message);
    this.name = 'PipelineCancelledError';
  }
}

export function createPipelineCancelledError(message?: string): PipelineCancelledError {
  return new PipelineCancelledError(message);
}

export function isPipelineCancelledError(error: unknown): boolean {
  return error instanceof PipelineCancelledError ||
    (error instanceof Error && error.name === 'PipelineCancelledError');
}

export async function waitForPipelineCheckpoint(
  control: PipelineControl | undefined
): Promise<void> {
  control?.throwIfAborted();
  await control?.waitIfPaused();
  control?.throwIfAborted();
}
