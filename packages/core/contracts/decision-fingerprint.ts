export type DecisionFingerprintId = string;
export type TaskId = string;
export type TaxonomyVersionId = string;

export type DecisionEntityType =
  | 'download'
  | 'merge-job'
  | 'tag-candidate-set'
  | 'tag-assignment'
  | 'archive-record'
  | 'retrieval-report'
  | 'delivery-request'
  | 'taxonomy-migration';

export interface DecisionFingerprint {
  readonly id: DecisionFingerprintId;
  readonly taskId: TaskId;
  readonly entityId: string;
  readonly entityType: DecisionEntityType;
  readonly taxonomyVersionId?: TaxonomyVersionId;
  readonly integrationVersion?: string;
  readonly modelAdapterVersion?: string;
  readonly decisionClass: string;
  readonly timestamp: string;
}

export interface CreateDecisionFingerprintInput {
  readonly id: DecisionFingerprintId;
  readonly taskId: TaskId;
  readonly entityId: string;
  readonly entityType: DecisionEntityType;
  readonly taxonomyVersionId?: TaxonomyVersionId;
  readonly integrationVersion?: string;
  readonly modelAdapterVersion?: string;
  readonly decisionClass: string;
  readonly timestamp: string;
}

export function createDecisionFingerprint(
  input: CreateDecisionFingerprintInput
): DecisionFingerprint {
  assertNonEmptyValue(input.id, 'Decision fingerprint id');
  assertNonEmptyValue(input.taskId, 'Decision fingerprint taskId');
  assertNonEmptyValue(input.entityId, 'Decision fingerprint entityId');
  assertNonEmptyValue(
    input.decisionClass,
    'Decision fingerprint decisionClass'
  );
  assertNonEmptyValue(input.timestamp, 'Decision fingerprint timestamp');

  const taxonomyVersionId = normalizeOptionalValue(input.taxonomyVersionId);
  const integrationVersion = normalizeOptionalValue(input.integrationVersion);
  const modelAdapterVersion = normalizeOptionalValue(input.modelAdapterVersion);

  if (
    taxonomyVersionId === undefined &&
    integrationVersion === undefined &&
    modelAdapterVersion === undefined
  ) {
    throw new Error(
      'Decision fingerprint must include at least one source marker.'
    );
  }

  return Object.freeze({
    id: input.id.trim(),
    taskId: input.taskId.trim(),
    entityId: input.entityId.trim(),
    entityType: input.entityType,
    taxonomyVersionId,
    integrationVersion,
    modelAdapterVersion,
    decisionClass: input.decisionClass.trim(),
    timestamp: input.timestamp.trim()
  });
}

export function hasTaxonomyBinding(
  fingerprint: DecisionFingerprint
): boolean {
  return fingerprint.taxonomyVersionId !== undefined;
}

export function getDecisionSourceMarkers(
  fingerprint: DecisionFingerprint
): readonly string[] {
  return Object.freeze(
    [
      fingerprint.taxonomyVersionId,
      fingerprint.integrationVersion,
      fingerprint.modelAdapterVersion
    ].filter((value): value is string => value !== undefined)
  );
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
