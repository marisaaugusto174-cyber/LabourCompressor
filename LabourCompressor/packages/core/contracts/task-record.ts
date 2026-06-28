export type TaskId = string;
export type WorkflowSessionId = string;

export type TaskKind =
  | 'spreadsheet-ingestion'
  | 'single-url-download'
  | 'download-and-merge'
  | 'tagging-and-archive'
  | 'retrieval-and-report'
  | 'taxonomy-migration';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'partially_succeeded'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface TaskCheckpoint {
  readonly stage: string;
  readonly status: 'pending' | 'verified';
  readonly recordedAt: string;
}

export interface TaskResumeState {
  readonly token: string;
  readonly fromCheckpoint: string;
  readonly createdAt: string;
}

export interface TaskRecord {
  readonly id: TaskId;
  readonly kind: TaskKind;
  readonly status: TaskStatus;
  readonly workflowSessionId: WorkflowSessionId;
  readonly attempt: number;
  readonly checkpoint?: TaskCheckpoint | undefined;
  readonly lastVerifiedStep?: string | undefined;
  readonly resumeState?: TaskResumeState | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string | undefined;
  readonly finishedAt?: string | undefined;
  readonly parentTaskId?: TaskId | undefined;
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
}

export interface CreateTaskRecordInput {
  readonly id: TaskId;
  readonly kind: TaskKind;
  readonly workflowSessionId: WorkflowSessionId;
  readonly createdAt: string;
  readonly parentTaskId?: TaskId | undefined;
}

export interface TaskFailureInput {
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly failedAt: string;
  readonly checkpoint?: TaskCheckpoint | undefined;
}

export function createTaskRecord(input: CreateTaskRecordInput): TaskRecord {
  assertNonEmptyValue(input.id, 'Task id');
  assertNonEmptyValue(input.workflowSessionId, 'Task workflowSessionId');
  assertNonEmptyValue(input.createdAt, 'Task createdAt');

  return Object.freeze({
    id: input.id.trim(),
    kind: input.kind,
    status: 'queued',
    workflowSessionId: input.workflowSessionId.trim(),
    attempt: 0,
    createdAt: input.createdAt.trim(),
    updatedAt: input.createdAt.trim(),
    parentTaskId: normalizeOptionalValue(input.parentTaskId)
  });
}

export function createTaskCheckpoint(input: {
  readonly stage: string;
  readonly status: 'pending' | 'verified';
  readonly recordedAt: string;
}): TaskCheckpoint {
  assertNonEmptyValue(input.stage, 'Task checkpoint stage');
  assertNonEmptyValue(input.recordedAt, 'Task checkpoint recordedAt');

  return Object.freeze({
    stage: input.stage.trim(),
    status: input.status,
    recordedAt: input.recordedAt.trim()
  });
}

export function createTaskResumeState(input: {
  readonly token: string;
  readonly fromCheckpoint: string;
  readonly createdAt: string;
}): TaskResumeState {
  assertNonEmptyValue(input.token, 'Task resume token');
  assertNonEmptyValue(
    input.fromCheckpoint,
    'Task resume fromCheckpoint'
  );
  assertNonEmptyValue(input.createdAt, 'Task resume createdAt');

  return Object.freeze({
    token: input.token.trim(),
    fromCheckpoint: input.fromCheckpoint.trim(),
    createdAt: input.createdAt.trim()
  });
}

export function startTaskRecord(
  task: TaskRecord,
  input: {
    readonly startedAt: string;
    readonly attempt?: number | undefined;
  }
): TaskRecord {
  assertNonEmptyValue(input.startedAt, 'Task startedAt');

  return Object.freeze({
    ...task,
    status: 'running',
    attempt: input.attempt ?? task.attempt + 1,
    startedAt: input.startedAt.trim(),
    updatedAt: input.startedAt.trim()
  });
}

export function attachTaskCheckpoint(
  task: TaskRecord,
  checkpoint: TaskCheckpoint
): TaskRecord {
  return Object.freeze({
    ...task,
    checkpoint,
    updatedAt: checkpoint.recordedAt,
    lastVerifiedStep:
      checkpoint.status === 'verified'
        ? checkpoint.stage
        : task.lastVerifiedStep
  });
}

export function attachTaskResumeState(
  task: TaskRecord,
  resumeState: TaskResumeState
): TaskRecord {
  return Object.freeze({
    ...task,
    resumeState,
    updatedAt: resumeState.createdAt
  });
}

export function failTaskRecord(
  task: TaskRecord,
  input: TaskFailureInput
): TaskRecord {
  assertNonEmptyValue(input.errorCode, 'Task errorCode');
  assertNonEmptyValue(input.errorMessage, 'Task errorMessage');
  assertNonEmptyValue(input.failedAt, 'Task failedAt');

  return Object.freeze({
    ...task,
    status: 'failed',
    checkpoint: input.checkpoint ?? task.checkpoint,
    updatedAt: input.failedAt.trim(),
    finishedAt: input.failedAt.trim(),
    errorCode: input.errorCode.trim(),
    errorMessage: input.errorMessage.trim()
  });
}

export function completeTaskRecord(
  task: TaskRecord,
  input: {
    readonly finishedAt: string;
    readonly checkpoint?: TaskCheckpoint | undefined;
  }
): TaskRecord {
  assertNonEmptyValue(input.finishedAt, 'Task finishedAt');

  const checkpoint = input.checkpoint ?? task.checkpoint;

  if (checkpoint?.status !== 'verified') {
    throw new Error(
      'Task must have a verified checkpoint before completion.'
    );
  }

  return Object.freeze({
    ...task,
    status: 'succeeded',
    checkpoint,
    updatedAt: input.finishedAt.trim(),
    finishedAt: input.finishedAt.trim(),
    lastVerifiedStep: checkpoint.stage,
    errorCode: undefined,
    errorMessage: undefined
  });
}

export function canResumeTask(task: TaskRecord): boolean {
  return task.status === 'failed' && task.resumeState !== undefined;
}

function assertNonEmptyValue(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }
}

function normalizeOptionalValue(value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}
