import path from 'node:path';

import { type SegmentationProfileId } from '../../../packages/features/segmentation/domain/index.ts';
import {
  DEFAULT_TAXONOMY_PRESET_ID,
  listTaxonomyPresets,
  resolveTaxonomyInput,
  resolveTaxonomyPresetDefinition
} from '../taxonomy-presets.ts';
import { getVideoModelProfile } from '../../../packages/features/tagging/domain/index.ts';
import {
  DEFAULT_MASTER_SPREADSHEET_PATH,
  DEFAULT_PROVIDER_CONFIG_PATH,
  PROJECT_ROOT,
  projectPath
} from '../project-paths.ts';

export type LocalPipelineStage = 'download' | 'segment' | 'compress' | 'tag' | 'archive';
export type PipelineStage = LocalPipelineStage | 'all' | 'resume-cache';

export interface RunLocalPipelineOptions {
  readonly spreadsheet: string;
  readonly downloadDir: string;
  readonly taxonomy: string;
  readonly taxonomyPreset?: string;
  readonly promptLibrary: string;
  readonly archiveRoot: string;
  readonly downloadFixtures?: string;
  readonly candidateFixtures?: string;
  readonly workflowSessionId?: string;
  readonly acceptedTagsColumnName?: string;
  readonly timestamp?: string;
  readonly downloaderMode?: 'simulated' | 'yt-dlp';
  readonly mergeMode?: 'local' | 'ffmpeg';
  readonly taggingMode?: 'simulated' | 'qwen';
  readonly providerConfigPath?: string;
  readonly ytDlpBinary?: string;
  readonly cookiesFilePath?: string;
  readonly cookiesFromBrowser?: string;
  readonly platformCredentialConfigPath?: string;
  readonly writebackTarget?: 'user' | 'master' | 'both';
  readonly masterSpreadsheetPath?: string;
  readonly manualEditGate?: boolean;
  readonly afterEditDirectoryName?: string;
  readonly selectedModelProfileId?: string;
  readonly taggingConcurrency?: number;
  readonly autoSegmentation?: boolean;
  readonly segmentationProfileId?: SegmentationProfileId;
  readonly problemClipsDirectoryName?: string;
  readonly pipelineStage?: PipelineStage;
}

export interface WebPipelineDefaults {
  readonly taxonomyPreset: string;
  readonly promptLibrary: string;
  readonly promptLibraryByPreset: Readonly<Record<string, string>>;
  readonly providerConfigPath: string;
  readonly platformCredentialConfigPath: string;
  readonly masterSpreadsheetPath: string;
  readonly writebackTarget: 'both';
  readonly downloaderMode: 'yt-dlp';
  readonly mergeMode: 'ffmpeg';
  readonly taggingMode: 'qwen';
  readonly downloadDir: string;
  readonly archiveRoot: string;
  readonly afterEditDirectoryName: string;
  readonly problemClipsDirectoryName: string;
  readonly manualEditGate: boolean;
  readonly autoSegmentation: boolean;
  readonly segmentationProfileId: SegmentationProfileId;
  readonly selectedModelProfileId: string;
  readonly taggingConcurrency: number;
}

export const DEFAULT_PLATFORM_CREDENTIAL_CONFIG_PATH = projectPath(
  'config/download-platform-credentials.local.json'
);

export const DEFAULT_PROVIDER_TEMPLATE_PATH = projectPath(
  'config/model-providers/providers.template.json'
);

export const DEFAULT_PLATFORM_CREDENTIAL_TEMPLATE_PATH = projectPath(
  'config/download-platform-credentials.template.json'
);

export function getWebPipelineDefaults(): WebPipelineDefaults {
  const defaultPreset = resolveTaxonomyPresetDefinition(DEFAULT_TAXONOMY_PRESET_ID);
  const legacyPromptLibrary = projectPath('config/prompts/video-data-collection-v0-prompt-library.md');
  const promptLibraryByPreset = Object.fromEntries(
    listTaxonomyPresets().map((preset) => [
      preset.id,
      preset.promptLibraryPath ?? legacyPromptLibrary
    ])
  );

  return Object.freeze({
    taxonomyPreset: DEFAULT_TAXONOMY_PRESET_ID,
    promptLibrary: defaultPreset.promptLibraryPath ?? legacyPromptLibrary,
    promptLibraryByPreset: Object.freeze(promptLibraryByPreset),
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_PATH,
    platformCredentialConfigPath: DEFAULT_PLATFORM_CREDENTIAL_CONFIG_PATH,
    masterSpreadsheetPath: DEFAULT_MASTER_SPREADSHEET_PATH,
    writebackTarget: 'both',
    downloaderMode: 'yt-dlp',
    mergeMode: 'ffmpeg',
    taggingMode: 'qwen',
    downloadDir: path.join(PROJECT_ROOT, '视频数据下载缓存'),
    archiveRoot: path.dirname(PROJECT_ROOT),
    afterEditDirectoryName: 'AfterEdit',
    problemClipsDirectoryName: 'ProblemClips',
    manualEditGate: false,
    autoSegmentation: true,
    segmentationProfileId: 'standard_ad',
    selectedModelProfileId: 'qwen-3.7-plus',
    taggingConcurrency: getVideoModelProfile('qwen-3.7-plus').defaultTaggingConcurrency
  });
}

export function buildCliPipelineOptions(args: Record<string, string>): RunLocalPipelineOptions {
  const taxonomyPreset =
    args['taxonomy-preset'] ?? (args.taxonomy === undefined ? DEFAULT_TAXONOMY_PRESET_ID : undefined);

  return Object.freeze({
    spreadsheet: getRequiredCliArg(args, 'spreadsheet'),
    downloadDir: getRequiredCliArg(args, 'download-dir'),
    taxonomy: resolveTaxonomyInput({
      taxonomyPath: args.taxonomy,
      taxonomyPreset
    }),
    taxonomyPreset,
    promptLibrary:
      args['prompt-library'] ??
      (taxonomyPreset === undefined
        ? getRequiredCliArg(args, 'prompt-library')
        : resolveTaxonomyPresetDefinition(taxonomyPreset).promptLibraryPath ??
          getRequiredCliArg(args, 'prompt-library')),
    archiveRoot: getRequiredCliArg(args, 'archive-root'),
    downloadFixtures: readOptionalCliArg(args, 'download-fixtures'),
    candidateFixtures: readOptionalCliArg(args, 'candidate-fixtures'),
    workflowSessionId: args['workflow-session-id'],
    acceptedTagsColumnName: args['accepted-tags-column-name'],
    timestamp: args.timestamp,
    downloaderMode: (args['downloader-mode'] as 'simulated' | 'yt-dlp' | undefined) ?? 'simulated',
    mergeMode: (args['merge-mode'] as 'local' | 'ffmpeg' | undefined) ?? 'local',
    taggingMode: (args['tagging-mode'] as 'simulated' | 'qwen' | undefined) ?? 'simulated',
    providerConfigPath: args['provider-config'],
    selectedModelProfileId: args['selected-model-profile-id'],
    taggingConcurrency: parseOptionalClampedInteger(args['tagging-concurrency'], 'tagging-concurrency'),
    ytDlpBinary: args['yt-dlp-binary'],
    cookiesFilePath: args['cookies-file'],
    cookiesFromBrowser: args['cookies-from-browser'],
    platformCredentialConfigPath: args['platform-credential-config'],
    writebackTarget: (args['writeback-target'] as 'user' | 'master' | 'both' | undefined) ?? 'user',
    masterSpreadsheetPath: args['master-spreadsheet'],
    manualEditGate: parseOptionalBoolean(args['manual-edit-gate']),
    afterEditDirectoryName: readOptionalCliArg(args, 'after-edit-directory-name'),
    autoSegmentation: parseOptionalBoolean(args['auto-segmentation']),
    segmentationProfileId: args['segmentation-profile'] as RunLocalPipelineOptions['segmentationProfileId'],
    problemClipsDirectoryName: readOptionalCliArg(args, 'problem-clips-directory-name'),
    pipelineStage: args['pipeline-stage'] as RunLocalPipelineOptions['pipelineStage']
  });
}

export function buildWebPipelineOptions(body: Record<string, unknown>): RunLocalPipelineOptions {
  const defaults = getWebPipelineDefaults();
  const taxonomyPreset = readString(body.taxonomyPreset) || DEFAULT_TAXONOMY_PRESET_ID;
  const taxonomyPath = readString(body.taxonomyPath);
  const resolvedTaxonomyPath = resolveTaxonomyInput({
    taxonomyPath: taxonomyPath.length === 0 ? undefined : taxonomyPath,
    taxonomyPreset
  });
  const promptLibraryPath =
    readString(body.promptLibrary) || (taxonomyPath.length > 0 ? resolvedTaxonomyPath : '');

  return Object.freeze({
    spreadsheet: requireBodyString(body, 'spreadsheet'),
    downloadDir: requireBodyString(body, 'downloadDir'),
    taxonomy: resolvedTaxonomyPath,
    taxonomyPreset,
    promptLibrary: promptLibraryPath || requireBodyString(body, 'promptLibrary'),
    archiveRoot: requireBodyString(body, 'archiveRoot'),
    downloadFixtures: readString(body.downloadFixtures) || undefined,
    candidateFixtures: readString(body.candidateFixtures) || undefined,
    workflowSessionId: readString(body.workflowSessionId) || undefined,
    acceptedTagsColumnName: readString(body.acceptedTagsColumnName) || undefined,
    timestamp: readString(body.timestamp) || undefined,
    downloaderMode: (readString(body.downloaderMode) as 'simulated' | 'yt-dlp') || defaults.downloaderMode,
    mergeMode: (readString(body.mergeMode) as 'local' | 'ffmpeg') || defaults.mergeMode,
    taggingMode: (readString(body.taggingMode) as 'simulated' | 'qwen') || defaults.taggingMode,
    providerConfigPath: readString(body.providerConfigPath) || defaults.providerConfigPath,
    platformCredentialConfigPath:
      readString(body.platformCredentialConfigPath) || defaults.platformCredentialConfigPath,
    ytDlpBinary: readString(body.ytDlpBinary) || undefined,
    cookiesFilePath: readString(body.cookiesFilePath) || undefined,
    cookiesFromBrowser: readString(body.cookiesFromBrowser) || undefined,
    writebackTarget: (readString(body.writebackTarget) as 'user' | 'master' | 'both') || defaults.writebackTarget,
    masterSpreadsheetPath: readString(body.masterSpreadsheetPath) || defaults.masterSpreadsheetPath,
    manualEditGate: readBoolean(body.manualEditGate, true),
    afterEditDirectoryName: readString(body.afterEditDirectoryName) || defaults.afterEditDirectoryName,
    autoSegmentation: readBoolean(body.autoSegmentation, false),
    segmentationProfileId:
      (readString(body.segmentationProfileId) as RunLocalPipelineOptions['segmentationProfileId']) ||
      defaults.segmentationProfileId,
    problemClipsDirectoryName: readString(body.problemClipsDirectoryName) || defaults.problemClipsDirectoryName,
    selectedModelProfileId: readString(body.selectedModelProfileId) || defaults.selectedModelProfileId,
    taggingConcurrency:
      readClampedInteger(body.taggingConcurrency) ??
      getVideoModelProfile(readString(body.selectedModelProfileId) || defaults.selectedModelProfileId)
        .defaultTaggingConcurrency,
    pipelineStage:
      (readString(body.pipelineStage) as RunLocalPipelineOptions['pipelineStage']) ||
      undefined
  });
}

function parseOptionalClampedInteger(
  value: string | undefined,
  key: string
): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer CLI argument: --${key}="${value}"`);
  }

  return clampTaggingConcurrency(parsed);
}

function getRequiredCliArg(args: Record<string, string>, key: string): string {
  const value = args[key];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required CLI argument: --${key}`);
  }

  return value.trim();
}

function readOptionalCliArg(
  args: Record<string, string>,
  key: string
): string | undefined {
  const value = args[key];
  return value === undefined || value.trim().length === 0
    ? undefined
    : value.trim();
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`Invalid boolean CLI argument: "${value}"`);
}

function requireBodyString(body: Record<string, unknown>, key: string): string {
  const value = readString(body[key]);

  if (value.length === 0) {
    throw new Error(`Missing required request field: ${key}`);
  }

  return value;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readClampedInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampTaggingConcurrency(value);
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : clampTaggingConcurrency(parsed);
}

function clampTaggingConcurrency(value: number): number {
  return Math.min(64, Math.max(1, Math.trunc(value)));
}
