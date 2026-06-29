import {
  ArchivePrimaryTagError,
  selectArchivePathFromStructuredTags,
  selectUniqueArchivePath,
  type ArchivePathPolicy,
  type StructuredTagCandidate,
  type StructuredTaggingResponse
} from '../../packages/features/tagging/domain/index.ts';
import {
  validateTaxonomyPath,
  type ParsedTaxonomyTree
} from '../../packages/features/taxonomy/domain/index.ts';

export interface RequiredContentTopicResolution {
  readonly acceptedPaths: readonly string[];
  readonly selectedContentTopicPath: string;
  readonly fallbackApplied: boolean;
}

export interface RequiredArchivePathResolution {
  readonly acceptedPaths: readonly string[];
  readonly structuredResponse?: StructuredTaggingResponse | undefined;
  readonly mergedModelJson?: unknown | undefined;
  readonly selectedArchivePath: string;
  readonly repairApplied: boolean;
}

interface ArchiveRepairResult {
  readonly structuredResponse?: StructuredTaggingResponse | undefined;
  readonly modelJson?: unknown | undefined;
}

export async function resolveRequiredContentTopic(input: {
  readonly acceptedPaths: readonly string[];
  readonly archiveDimension?: string | undefined;
  readonly requestFallbackPaths: () => Promise<readonly string[]>;
}): Promise<RequiredContentTopicResolution> {
  const archiveDimension = input.archiveDimension ?? '内容题材';
  const firstDecision = selectUniqueArchivePath({
    acceptedPaths: input.acceptedPaths,
    archiveDimension
  });
  if (firstDecision.selectedPath !== undefined) {
    return Object.freeze({
      acceptedPaths: Object.freeze([...input.acceptedPaths]),
      selectedContentTopicPath: firstDecision.selectedPath,
      fallbackApplied: false
    });
  }

  const fallbackPaths = await input.requestFallbackPaths();
  const mergedPaths = Object.freeze(
    [...new Set([...input.acceptedPaths, ...fallbackPaths].map((value) => value.trim()).filter(Boolean))]
  );
  const fallbackDecision = selectUniqueArchivePath({
    acceptedPaths: mergedPaths,
    archiveDimension
  });
  if (fallbackDecision.selectedPath === undefined) {
    throw new Error(`打标失败：缺少${archiveDimension}`);
  }
  return Object.freeze({
    acceptedPaths: mergedPaths,
    selectedContentTopicPath: fallbackDecision.selectedPath,
    fallbackApplied: true
  });
}

export async function resolveRequiredArchivePath(input: {
  readonly acceptedPaths: readonly string[];
  readonly structuredResponse?: StructuredTaggingResponse | undefined;
  readonly modelJson?: unknown | undefined;
  readonly policy: ArchivePathPolicy;
  readonly taxonomyTree: ParsedTaxonomyTree;
  readonly allowPathSynthesis?: boolean | undefined;
  readonly requestRepair: () => Promise<ArchiveRepairResult>;
}): Promise<RequiredArchivePathResolution> {
  const initialResponse = input.structuredResponse ?? (
    input.allowPathSynthesis === true
      ? synthesizeFixtureResponse(input)
      : emptyStructuredResponse()
  );

  try {
    return buildArchiveResolution({ ...input, structuredResponse: initialResponse });
  } catch (error) {
    if (!(error instanceof ArchivePrimaryTagError)) {
      throw error;
    }
  }

  const repair = await input.requestRepair();
  const repairedResponse = mergeStructuredResponses(
    initialResponse,
    requireRepairResponse(repair.structuredResponse),
    input.policy
  );
  const acceptedPaths = mergeAcceptedPaths(
    input.acceptedPaths,
    initialResponse,
    repairedResponse,
    input.policy,
    input.taxonomyTree
  );
  const resolution = buildArchiveResolution({
    ...input,
    acceptedPaths,
    structuredResponse: repairedResponse,
    repairApplied: true
  });

  return Object.freeze({
    ...resolution,
    mergedModelJson: mergeModelJson(input.modelJson, repair.modelJson, input.policy)
  });
}

function emptyStructuredResponse(): StructuredTaggingResponse {
  return Object.freeze({
    reviewRequired: false,
    reviewReason: '',
    tags: Object.freeze([])
  });
}

function buildArchiveResolution(input: {
  readonly acceptedPaths: readonly string[];
  readonly structuredResponse: StructuredTaggingResponse;
  readonly policy: ArchivePathPolicy;
  readonly taxonomyTree: ParsedTaxonomyTree;
  readonly repairApplied?: boolean | undefined;
}): RequiredArchivePathResolution {
  return Object.freeze({
    acceptedPaths: Object.freeze([...input.acceptedPaths]),
    structuredResponse: input.structuredResponse,
    selectedArchivePath: selectArchivePathFromStructuredTags(input),
    repairApplied: input.repairApplied ?? false
  });
}

function synthesizeFixtureResponse(input: {
  readonly acceptedPaths: readonly string[];
  readonly policy: ArchivePathPolicy;
  readonly taxonomyTree: ParsedTaxonomyTree;
}): StructuredTaggingResponse {
  const candidates = input.acceptedPaths.filter((pathValue) =>
    pathValue.startsWith(`${input.policy.dimension} > `) &&
    validateTaxonomyPath(input.taxonomyTree, pathValue).isLegal
  );
  if (candidates.length !== input.policy.requiredCount) {
    throw new ArchivePrimaryTagError(
      candidates.length === 0
        ? 'archive-primary-tag-missing'
        : 'archive-primary-tag-conflict'
    );
  }
  const labelPath = Object.freeze(candidates[0]!.split(' > '));
  const tag: StructuredTagCandidate = Object.freeze({
    dimension: input.policy.dimension,
    labelPath,
    selectedLevel: `l${labelPath.length}`,
    tagRole: input.policy.primaryRole,
    entityId: '',
    targetEntityId: '',
    confidenceScore: undefined
  });
  return Object.freeze({
    reviewRequired: false,
    reviewReason: '',
    tags: Object.freeze([tag])
  });
}

function requireRepairResponse(
  response: StructuredTaggingResponse | undefined
): StructuredTaggingResponse {
  if (response === undefined) {
    throw new ArchivePrimaryTagError('archive-primary-tag-missing');
  }
  return response;
}

function mergeStructuredResponses(
  original: StructuredTaggingResponse,
  repair: StructuredTaggingResponse,
  policy: ArchivePathPolicy
): StructuredTaggingResponse {
  const preserved = original.tags.filter(
    (tag) => !isPrimaryPolicyTag(tag, policy)
  );
  const repaired = repair.tags.filter((tag) => tag.dimension === policy.dimension);
  return Object.freeze({
    reviewRequired: repair.reviewRequired,
    reviewReason: repair.reviewReason,
    tags: Object.freeze(appendUniqueStructuredTags(preserved, repaired))
  });
}

function mergeAcceptedPaths(
  acceptedPaths: readonly string[],
  originalResponse: StructuredTaggingResponse,
  repairedResponse: StructuredTaggingResponse,
  policy: ArchivePathPolicy,
  taxonomyTree: ParsedTaxonomyTree
): readonly string[] {
  const originalPrimaryPaths = new Set(
    originalResponse.tags
      .filter((tag) => isPrimaryPolicyTag(tag, policy))
      .map((tag) => tag.labelPath.join(' > '))
  );
  const preserved = acceptedPaths.filter(
    (pathValue) => !originalPrimaryPaths.has(pathValue)
  );
  const repaired = repairedResponse.tags
    .filter((tag) => tag.dimension === policy.dimension)
    .map((tag) => tag.labelPath.join(' > '));
  return Object.freeze([...new Set([...preserved, ...repaired])].filter(
    (pathValue) => validateTaxonomyPath(taxonomyTree, pathValue).isLegal
  ));
}

function mergeModelJson(
  original: unknown,
  repair: unknown,
  policy: ArchivePathPolicy
): unknown {
  if (!isRecord(original) || !Array.isArray(original.tags)) {
    return original;
  }
  const repairedTags = isRecord(repair) && Array.isArray(repair.tags)
    ? repair.tags.filter((tag) => isRecord(tag) && tag.dimension === policy.dimension)
    : [];
  const cloned = structuredClone(original);
  if (!isRecord(cloned) || !Array.isArray(cloned.tags)) {
    return cloned;
  }
  const preservedTags = cloned.tags.filter(
    (tag) => !isRecord(tag) || !isPrimaryRawPolicyTag(tag, policy)
  );
  cloned.tags = appendUniqueRawTags(
    preservedTags,
    structuredClone(repairedTags)
  );
  return cloned;
}

function isPrimaryPolicyTag(
  tag: StructuredTagCandidate,
  policy: ArchivePathPolicy
): boolean {
  return tag.dimension === policy.dimension && tag.tagRole === policy.primaryRole;
}

function appendUniqueStructuredTags(
  preserved: readonly StructuredTagCandidate[],
  additions: readonly StructuredTagCandidate[]
): readonly StructuredTagCandidate[] {
  const seen = new Set(preserved.map(structuredTagKey));
  const appended = additions.filter((tag) => {
    const key = structuredTagKey(tag);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return [...preserved, ...appended];
}

function structuredTagKey(tag: StructuredTagCandidate): string {
  return [
    tag.dimension,
    tag.tagRole,
    tag.labelPath.join('\u0000'),
    tag.entityId,
    tag.targetEntityId
  ].join('\u0001');
}

function isPrimaryRawPolicyTag(
  tag: Record<string, unknown>,
  policy: ArchivePathPolicy
): boolean {
  return tag.dimension === policy.dimension && tag.tag_role === policy.primaryRole;
}

function appendUniqueRawTags(
  preserved: readonly unknown[],
  additions: readonly unknown[]
): unknown[] {
  const seen = new Set(preserved.map(rawTagKey));
  const appended = additions.filter((tag) => {
    const key = rawTagKey(tag);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return [...preserved, ...appended];
}

function rawTagKey(tag: unknown): string {
  if (!isRecord(tag)) {
    return `primitive:${JSON.stringify(tag)}`;
  }
  return JSON.stringify([
    tag.dimension,
    tag.tag_role,
    tag.label_path,
    tag.entity_id,
    tag.target_entity_id
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
