import {
  validateTaxonomyPath,
  type ParsedTaxonomyTree
} from '../../taxonomy/domain/index.ts';
import {
  type StructuredTagCandidate,
  type StructuredTaggingResponse
} from './structured-tag-response.ts';

export interface ArchivePathPolicy {
  readonly dimension: string;
  readonly primaryRole: string;
  readonly requiredCount: 1;
  readonly onInvalid: 'retry-once-then-review';
}

export type ArchivePrimaryTagErrorCode =
  | 'archive-primary-tag-missing'
  | 'archive-primary-tag-conflict'
  | 'archive-primary-tag-role-invalid'
  | 'archive-primary-tag-path-invalid'
  | 'archive-primary-tag-review-required';

export class ArchivePrimaryTagError extends Error {
  readonly code: ArchivePrimaryTagErrorCode;

  constructor(code: ArchivePrimaryTagErrorCode) {
    super(code);
    this.name = 'ArchivePrimaryTagError';
    this.code = code;
  }
}

export interface SelectArchivePathFromStructuredTagsInput {
  readonly structuredResponse: StructuredTaggingResponse;
  readonly policy: ArchivePathPolicy;
  readonly taxonomyTree: ParsedTaxonomyTree;
}

export function selectArchivePathFromStructuredTags(
  input: SelectArchivePathFromStructuredTagsInput
): string {
  const { structuredResponse, policy } = input;

  if (
    structuredResponse.reviewRequired &&
    reviewConcernsPrimaryTag(structuredResponse.reviewReason, policy)
  ) {
    fail('archive-primary-tag-review-required');
  }

  const dimensionCandidates = structuredResponse.tags.filter(
    (tag) => tag.dimension === policy.dimension || tag.labelPath[0] === policy.dimension
  );
  if (dimensionCandidates.length === 0) {
    fail('archive-primary-tag-missing');
  }

  const primaryCandidates = dimensionCandidates.filter(
    (tag) => tag.tagRole === policy.primaryRole
  );
  if (primaryCandidates.length === 0) {
    fail('archive-primary-tag-role-invalid');
  }
  if (primaryCandidates.length !== policy.requiredCount) {
    fail('archive-primary-tag-conflict');
  }

  const selected = primaryCandidates[0]!;
  const path = selected.labelPath.join(' > ');
  if (!isLegalPrimaryPath(selected, path, input)) {
    fail('archive-primary-tag-path-invalid');
  }
  return path;
}

function reviewConcernsPrimaryTag(
  reason: string,
  policy: ArchivePathPolicy
): boolean {
  return reason.includes(policy.dimension) || reason.includes(policy.primaryRole);
}

function isLegalPrimaryPath(
  tag: StructuredTagCandidate,
  path: string,
  input: SelectArchivePathFromStructuredTagsInput
): boolean {
  return tag.dimension === input.policy.dimension &&
    tag.labelPath[0] === input.policy.dimension &&
    tag.selectedLevel === `l${tag.labelPath.length}` &&
    validateTaxonomyPath(input.taxonomyTree, path).isLegal;
}

function fail(code: ArchivePrimaryTagErrorCode): never {
  throw new ArchivePrimaryTagError(code);
}
