export interface ArchivePathPolicy {
  readonly dimension: string;
  readonly primaryRole: string;
  readonly requiredCount: 1;
  readonly onInvalid: 'retry-once-then-review';
}
