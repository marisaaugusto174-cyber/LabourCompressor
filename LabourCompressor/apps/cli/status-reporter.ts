export type CliStageStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface CliStageProgress {
  readonly current: number;
  readonly total: number;
}

export interface CliStageEvent {
  readonly stage: string;
  readonly status: CliStageStatus;
  readonly message: string;
  readonly phase?: string;
  readonly timestamp?: string;
  readonly currentItem?: string;
  readonly progress?: CliStageProgress;
  readonly durationMs?: number;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export function formatCliStageEvent(event: CliStageEvent): string {
  const phase = event.phase ?? event.stage;
  const progress =
    event.progress === undefined
      ? ''
      : ` (${event.progress.current}/${event.progress.total})`;

  return `[${event.status.toUpperCase()}] ${phase}${progress}: ${event.message}`;
}

export function normalizeCliStageEvent(event: CliStageEvent): CliStageEvent {
  return Object.freeze({
    ...event,
    phase: event.phase ?? event.stage,
    timestamp: event.timestamp ?? new Date().toISOString()
  });
}

export function createCliStatusReporter(output: {
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}): {
  report: (event: CliStageEvent) => void;
  reportError: (stage: string, error: unknown) => void;
} {
  return Object.freeze({
    report(event: CliStageEvent): void {
      const normalizedEvent = normalizeCliStageEvent(event);
      const line = formatCliStageEvent(normalizedEvent);

      if (normalizedEvent.status === 'failed') {
        output.error(line);
        return;
      }

      output.log(line);
    },
    reportError(stage: string, error: unknown): void {
      const message =
        error instanceof Error ? error.message : 'Unknown CLI failure';

      output.error(
        formatCliStageEvent(normalizeCliStageEvent({
          stage,
          status: 'failed',
          message
        }))
      );
    }
  });
}
