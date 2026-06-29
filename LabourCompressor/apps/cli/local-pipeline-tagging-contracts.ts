import { type DownloadedMediaAsset } from '../../packages/features/download/domain/index.ts';
import {
  type ArchivePathPolicy,
  type LocalProviderConfig,
  type PromptLibraryDocument,
  type VideoModelProfile
} from '../../packages/features/tagging/domain/index.ts';
import { type ParsedTaxonomyTree } from '../../packages/features/taxonomy/domain/index.ts';
import { type SpreadsheetTaskRow } from '../../packages/features/spreadsheet-tasks/domain/index.ts';
import { type PipelineRowState } from './local-pipeline-helpers.ts';
import { type RunLocalPipelineFailure } from './pipeline-result.ts';
import { type CliStageEvent } from './status-reporter.ts';

export interface PipelineItemTimings {
  readonly preprocessMs: number;
  readonly modelRequestMs: number;
  readonly tagNormalizeMs: number;
  readonly archiveMs: number;
  readonly totalMs: number;
}

export interface RunTaggingBatchInput {
  readonly assets: readonly DownloadedMediaAsset[];
  readonly rowByTaskId: ReadonlyMap<string, SpreadsheetTaskRow>;
  readonly resultsByRow: Map<number, PipelineRowState>;
  readonly failures: RunLocalPipelineFailure[];
  readonly startedAt: string;
  readonly taggingMode?: 'simulated' | 'qwen' | undefined;
  readonly selectedModelProfileId?: string | undefined;
  readonly taggingConcurrency?: number | undefined;
  readonly selectedVideoModelProfile?: VideoModelProfile | undefined;
  readonly realModelProviderConfig?: LocalProviderConfig | undefined;
  readonly candidateFixtures?: Record<string, readonly string[]> | undefined;
  readonly taxonomyTree: ParsedTaxonomyTree;
  readonly promptLibrary: PromptLibraryDocument;
  readonly taxonomyBaseMarkdown?: string | undefined;
  readonly taxonomyVersionId?: string | undefined;
  readonly archiveDimension?: string | undefined;
  readonly archivePathPolicy?: ArchivePathPolicy | undefined;
  readonly modelResponseShape?: 'paths-json-array' | 'structured-json' | undefined;
  readonly emit: (
    stage: string,
    status: CliStageEvent['status'],
    message: string,
    extras?: Omit<CliStageEvent, 'stage' | 'status' | 'message' | 'timestamp'>
  ) => void;
}
