import { projectPath } from './project-paths.ts';

export interface TaxonomyPresetDefinition {
  readonly id: TaxonomyPresetId;
  readonly label: string;
  readonly filePath: string;
  readonly description: string;
  readonly baseKind: 'structured' | 'legacy';
  readonly taxonomyVersionId: string;
  readonly archiveDimension: string;
  readonly modelResponseShape: 'structured-json' | 'paths-json-array';
  readonly taxonomyParseMode: 'heading' | 'bullet-root';
  readonly promptLibraryPath?: string;
}

export type TaxonomyPresetId = 'core-v0.2' | 'core-v0.1' | 'full-v0.2' | 'business' | 'v0';

export const DEFAULT_TAXONOMY_PRESET_ID: TaxonomyPresetId = 'core-v0.2';

const STANDARD_PROMPT_BASE_DIR = projectPath('VideoGroup_Standard');
const LEGACY_TAXONOMY_FILE = projectPath(
  'config/taxonomies/video-data-collection-taxonomy-v0-260415.md'
);
const LEGACY_PROMPT_LIBRARY_FILE = projectPath(
  'config/prompts/video-data-collection-v0-prompt-library.md'
);
const CORE_PROMPT_BASE_V01_FILE = projectPath(
  'VideoGroup_Standard/核心视频标签体系_基座提示词规则_V0.1.md'
);
const CORE_PROMPT_BASE_V02_FILE = projectPath(
  'VideoGroup_Standard/核心视频标签体系_基座提示词规则_V0.2.md'
);
const FULL_PROMPT_BASE_FILE = projectPath(
  'VideoGroup_Standard/完整视频标签体系_基座提示词规则_V0.2.md'
);

const TAXONOMY_PRESETS: readonly TaxonomyPresetDefinition[] = Object.freeze([
  Object.freeze({
    id: 'core-v0.2',
    label: '核心视频标签体系基座 V0.2',
    filePath: CORE_PROMPT_BASE_V02_FILE,
    description: '核心版结构化视频标签基座 V0.2，默认用于新任务。',
    baseKind: 'structured',
    taxonomyVersionId: 'Core_Prompt_V0.2',
    archiveDimension: '内容领域',
    modelResponseShape: 'structured-json',
    taxonomyParseMode: 'bullet-root',
    promptLibraryPath: CORE_PROMPT_BASE_V02_FILE
  }),
  Object.freeze({
    id: 'core-v0.1',
    label: '核心视频标签体系基座 V0.1',
    filePath: CORE_PROMPT_BASE_V01_FILE,
    description: '核心版结构化视频标签基座 V0.1，保留兼容入口。',
    baseKind: 'structured',
    taxonomyVersionId: 'Core_Prompt_V0.1',
    archiveDimension: '内容领域',
    modelResponseShape: 'structured-json',
    taxonomyParseMode: 'bullet-root',
    promptLibraryPath: CORE_PROMPT_BASE_V01_FILE
  }),
  Object.freeze({
    id: 'full-v0.2',
    label: '完整视频标签体系基座 V0.2',
    filePath: FULL_PROMPT_BASE_FILE,
    description: '进阶版结构化视频标签基座，包含事实、元数据和生产管理标签。',
    baseKind: 'structured',
    taxonomyVersionId: 'Full_Prompt_V0.2',
    archiveDimension: '内容领域',
    modelResponseShape: 'structured-json',
    taxonomyParseMode: 'bullet-root',
    promptLibraryPath: FULL_PROMPT_BASE_FILE
  }),
  Object.freeze({
    id: 'business',
    label: '业务标签库（V0）',
    filePath: LEGACY_TAXONOMY_FILE,
    description: '旧版 V0 视频数据采集分层标签库，保留兼容入口。',
    baseKind: 'legacy',
    taxonomyVersionId: 'taxonomy-v1',
    archiveDimension: '内容题材',
    modelResponseShape: 'paths-json-array',
    taxonomyParseMode: 'heading',
    promptLibraryPath: LEGACY_PROMPT_LIBRARY_FILE
  }),
  Object.freeze({
    id: 'v0',
    label: '视频数据采集标签框架（260415）V0',
    filePath: LEGACY_TAXONOMY_FILE,
    description: '由 PDF 固化到项目内的 V0 标准标签库。',
    baseKind: 'legacy',
    taxonomyVersionId: 'taxonomy-v1',
    archiveDimension: '内容题材',
    modelResponseShape: 'paths-json-array',
    taxonomyParseMode: 'heading',
    promptLibraryPath: LEGACY_PROMPT_LIBRARY_FILE
  })
]);

export function listTaxonomyPresets(): readonly TaxonomyPresetDefinition[] {
  return TAXONOMY_PRESETS;
}

export function resolveTaxonomyInput(input: {
  readonly taxonomyPath?: string;
  readonly taxonomyPreset?: string;
}): string {
  if (input.taxonomyPath !== undefined && input.taxonomyPath.trim().length > 0) {
    return input.taxonomyPath.trim();
  }

  const taxonomyPreset =
    input.taxonomyPreset === undefined || input.taxonomyPreset.trim().length === 0
      ? DEFAULT_TAXONOMY_PRESET_ID
      : input.taxonomyPreset.trim();

  const preset = resolveTaxonomyPresetDefinition(taxonomyPreset);

  return preset.filePath;
}

export function resolveTaxonomyPresetDefinition(
  taxonomyPreset: string
): TaxonomyPresetDefinition {
  const preset = TAXONOMY_PRESETS.find((item) => item.id === taxonomyPreset.trim());

  if (preset === undefined) {
    throw new Error(
      `Unknown taxonomy preset: "${taxonomyPreset}". Supported presets: ${TAXONOMY_PRESETS.map((item) => item.id).join(', ')}`
    );
  }

  return preset;
}

export function getDefaultTaxonomyPreset(): TaxonomyPresetDefinition {
  return resolveTaxonomyPresetDefinition(DEFAULT_TAXONOMY_PRESET_ID);
}
