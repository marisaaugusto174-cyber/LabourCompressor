import {
  type DecisionFingerprintId,
  type TaskId,
  type TaxonomyVersionId
} from '../../../core/contracts/index.ts';
import {
  validateTaxonomyPaths,
  type ParsedTaxonomyTree
} from '../../taxonomy/domain/index.ts';
import {
  buildPromptLibraryInstruction,
  type PromptLibraryDocument
} from './prompt-library.ts';
import {
  createTagAssignmentFromCandidateSet,
  createTagCandidateSet,
  type TagAssignment,
  type TagCandidateSet
} from './tagging-records.ts';

export interface AutomaticTaggingInput {
  readonly taskId: TaskId;
  readonly mediaAssetId: string;
  readonly taxonomyVersionId: TaxonomyVersionId;
  readonly fingerprintId: DecisionFingerprintId;
  readonly candidateSetId: string;
  readonly assignmentId: string;
  readonly generatedAt: string;
  readonly assignedAt: string;
  readonly candidatePaths: readonly string[];
  readonly taxonomyTree: ParsedTaxonomyTree;
  readonly promptLibrary: PromptLibraryDocument;
}

export interface AutomaticTaggingResult {
  readonly promptInstruction: string;
  readonly candidateSet?: TagCandidateSet;
  readonly assignment?: TagAssignment;
  readonly acceptedPaths: readonly string[];
  readonly rejectedPaths: readonly string[];
}

export function runAutomaticTagging(
  input: AutomaticTaggingInput
): AutomaticTaggingResult {
  const promptInstruction = buildPromptLibraryInstruction(input.promptLibrary);

  if (input.candidatePaths.length === 0) {
    return Object.freeze({
      promptInstruction,
      acceptedPaths: Object.freeze([]),
      rejectedPaths: Object.freeze([])
    });
  }

  const normalizedCandidatePaths = normalizeCandidatePathsAgainstTaxonomy(
    input.candidatePaths,
    input.taxonomyTree
  );
  const validations = validateTaxonomyPaths(
    input.taxonomyTree,
    normalizedCandidatePaths
  );
  const acceptedPaths = Object.freeze(
    validations
      .filter((validation) => validation.isLegal)
      .map((validation) => validation.normalizedPath)
  );
  const rejectedPaths = Object.freeze(
    validations
      .filter((validation) => !validation.isLegal)
      .map((validation) => validation.normalizedPath || validation.input.trim())
  );

  const candidateSet = createTagCandidateSet({
    id: input.candidateSetId,
    taskId: input.taskId,
    mediaAssetId: input.mediaAssetId,
    taxonomyVersionId: input.taxonomyVersionId,
      fingerprintId: input.fingerprintId,
      candidatePaths: normalizedCandidatePaths,
      rejectedSummary: {
      rejectedCount: rejectedPaths.length,
      rejectionReasons: validations
        .filter((validation) => !validation.isLegal)
        .map((validation) => validation.reason ?? 'unknown-path')
    },
    generatedAt: input.generatedAt
  });

  if (acceptedPaths.length === 0) {
    return Object.freeze({
      promptInstruction,
      candidateSet,
      acceptedPaths,
      rejectedPaths
    });
  }

  const assignment = createTagAssignmentFromCandidateSet({
    id: input.assignmentId,
    candidateSet,
    acceptedPaths,
    assignedAt: input.assignedAt,
    source: 'model'
  });

  return Object.freeze({
    promptInstruction,
    candidateSet,
    assignment,
    acceptedPaths,
    rejectedPaths
  });
}

function normalizeCandidatePathsAgainstTaxonomy(
  candidatePaths: readonly string[],
  taxonomyTree: ParsedTaxonomyTree
): readonly string[] {
  const legalPaths = Object.keys(taxonomyTree.nodeIdsByPath);

  return Object.freeze(
    candidatePaths.map((candidatePath) => {
      const trimmed = candidatePath.trim();

      if (trimmed.length === 0) {
        return trimmed;
      }

      if (legalPaths.includes(trimmed)) {
        return trimmed;
      }

      const suffixMatches = legalPaths.filter(
        (legalPath) => legalPath === trimmed || legalPath.endsWith(` > ${trimmed}`)
      );

      if (suffixMatches.length === 1) {
        return suffixMatches[0]!;
      }

      return trimmed;
    })
  );
}
