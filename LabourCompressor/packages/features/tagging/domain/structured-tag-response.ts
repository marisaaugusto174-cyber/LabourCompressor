export interface StructuredTagCandidate {
  readonly dimension: string;
  readonly labelPath: readonly string[];
  readonly selectedLevel: string;
  readonly tagRole: string;
  readonly entityId: string;
  readonly targetEntityId: string;
  readonly confidenceScore?: number | undefined;
}

export interface StructuredTaggingResponse {
  readonly reviewRequired: boolean;
  readonly reviewReason: string;
  readonly tags: readonly StructuredTagCandidate[];
}

export function parseStructuredTaggingResponse(
  value: Readonly<Record<string, unknown>>
): StructuredTaggingResponse {
  const tagArrays = [
    value.tags,
    value.fact_tags,
    value.metadata_tags,
    value.production_tags
  ].filter(Array.isArray) as readonly unknown[][];
  const tags = tagArrays.flatMap((tagArray) =>
    tagArray.filter(isRecord).map(parseStructuredTagCandidate)
  );

  return Object.freeze({
    reviewRequired: value.review_required === true,
    reviewReason: readString(value.review_reason),
    tags: Object.freeze(tags)
  });
}

function parseStructuredTagCandidate(
  value: Readonly<Record<string, unknown>>
): StructuredTagCandidate {
  return Object.freeze({
    dimension: readValidatedString(value, 'dimension'),
    labelPath: readLabelPath(value),
    selectedLevel: readValidatedString(value, 'selected_level'),
    tagRole: readValidatedString(value, 'tag_role'),
    entityId: readString(value.entity_id),
    targetEntityId: readString(value.target_entity_id),
    confidenceScore: typeof value.confidence_score === 'number'
      ? value.confidence_score
      : undefined
  });
}

function readValidatedString(
  value: Readonly<Record<string, unknown>>,
  key: string
): string {
  if (!(key in value)) {
    return '';
  }

  const fieldValue = value[key];
  if (typeof fieldValue !== 'string') {
    throw new Error(`Structured tag field ${key} must be a string.`);
  }

  return fieldValue.trim();
}

function readLabelPath(
  value: Readonly<Record<string, unknown>>
): readonly string[] {
  if (!('label_path' in value)) {
    return Object.freeze([]);
  }

  if (
    !Array.isArray(value.label_path) ||
    !value.label_path.every((segment) => typeof segment === 'string')
  ) {
    throw new Error('Structured tag field label_path must be an array of strings.');
  }

  return Object.freeze(
    value.label_path.map((segment) => segment.trim()).filter(Boolean)
  );
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
