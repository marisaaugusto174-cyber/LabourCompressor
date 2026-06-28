import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

import { projectPath } from './project-paths.ts';

export interface TaxonomyPresetDefinition {
  readonly id: TaxonomyPresetId;
  readonly label: string;
  readonly filePath: string;
  readonly description: string;
  readonly source: 'internal' | 'external';
  readonly baseKind: 'structured' | 'legacy';
  readonly taxonomyVersionId: string;
  readonly archiveDimension: string;
  readonly modelResponseShape: 'structured-json' | 'paths-json-array';
  readonly taxonomyParseMode: 'heading' | 'bullet-root';
  readonly promptLibraryPath?: string | undefined;
}

export type TaxonomyPresetId =
  | string;

export const DEFAULT_TAXONOMY_PRESET_ID: TaxonomyPresetId = 'core-v0.3-drama';

const CORE_PROMPT_BASE_V01_FILE = projectPath(
  'VideoGroup_Standard/核心视频标签体系_基座提示词规则_V0.1.md'
);
const FULL_PROMPT_BASE_FILE = projectPath(
  'VideoGroup_Standard/完整视频标签体系_基座提示词规则_V0.2.md'
);
const LEGACY_TAXONOMY_FILE = projectPath(
  'config/taxonomies/video-data-collection-taxonomy-v0-260415.md'
);
const LEGACY_PROMPT_LIBRARY_FILE = projectPath(
  'config/prompts/video-data-collection-v0-prompt-library.md'
);
const TAXONOMY_REPOSITORY_DIR = projectPath('config/repositories/taxonomies');

const INTERNAL_TAXONOMY_PRESETS: readonly TaxonomyPresetDefinition[] = Object.freeze([
  Object.freeze({
    id: 'core-v0.1',
    label: '核心视频标签体系基座 V0.1',
    filePath: CORE_PROMPT_BASE_V01_FILE,
    description: '核心版结构化视频标签基座 V0.1，保留兼容入口。',
    source: 'internal',
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
    source: 'internal',
    baseKind: 'structured',
    taxonomyVersionId: 'Full_Prompt_V0.2',
    archiveDimension: '内容领域',
    modelResponseShape: 'structured-json',
    taxonomyParseMode: 'bullet-root',
    promptLibraryPath: FULL_PROMPT_BASE_FILE
  }),
]);

export function listTaxonomyPresets(): readonly TaxonomyPresetDefinition[] {
  return mergeTaxonomyPresets(INTERNAL_TAXONOMY_PRESETS, loadTaxonomyPresetRepository(TAXONOMY_REPOSITORY_DIR));
}

export function resolveTaxonomyInput(input: {
  readonly taxonomyPath?: string | undefined;
  readonly taxonomyPreset?: string | undefined;
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
  const presets = listTaxonomyPresets();
  const preset = presets.find((item) => item.id === taxonomyPreset.trim());

  if (preset === undefined) {
    throw new Error(
      `Unknown taxonomy preset: "${taxonomyPreset}". Supported presets: ${presets.map((item) => item.id).join(', ')}`
    );
  }

  return preset;
}

export function getDefaultTaxonomyPreset(): TaxonomyPresetDefinition {
  return resolveTaxonomyPresetDefinition(DEFAULT_TAXONOMY_PRESET_ID);
}

export function getLegacyTaxonomyRuntimePreset(): TaxonomyPresetDefinition {
  return Object.freeze({
    id: 'legacy-v0-runtime',
    label: '旧版 V0 运行时兼容',
    filePath: LEGACY_TAXONOMY_FILE,
    description: '隐藏的旧版 taxonomy 运行时配置，用于兼容显式传入旧表或自定义 taxonomy 的历史任务。',
    source: 'internal',
    baseKind: 'legacy',
    taxonomyVersionId: 'taxonomy-v1',
    archiveDimension: '内容题材',
    modelResponseShape: 'paths-json-array',
    taxonomyParseMode: 'heading',
    promptLibraryPath: LEGACY_PROMPT_LIBRARY_FILE
  });
}

export function loadTaxonomyPresetRepository(repositoryDirectory: string): readonly TaxonomyPresetDefinition[] {
  let entries;

  try {
    entries = readdirSync(repositoryDirectory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return Object.freeze([]);
    }
    throw error;
  }

  const presets: TaxonomyPresetDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const manifestPath = path.join(repositoryDirectory, entry.name);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    presets.push(readTaxonomyPresetManifest(manifest, manifestPath));
  }

  return Object.freeze(
    presets.sort((left, right) => left.id.localeCompare(right.id, 'en-US'))
  );
}

export async function importExternalTaxonomyPreset(input: {
  readonly sourceFilePath: string;
  readonly repositoryDirectory?: string | undefined;
  readonly label?: string | undefined;
}): Promise<TaxonomyPresetDefinition> {
  const sourceFilePath = input.sourceFilePath.trim();
  if (sourceFilePath.length === 0) {
    throw new Error('Missing taxonomy source file path.');
  }

  const repositoryDirectory = input.repositoryDirectory ?? TAXONOMY_REPOSITORY_DIR;
  await mkdir(repositoryDirectory, { recursive: true });

  const parsedSource = path.parse(sourceFilePath);
  const sourceBaseName = parsedSource.name.trim() || 'custom-taxonomy';
  const label = input.label?.trim() || sourceBaseName;
  const fileName = buildUniqueFileName(repositoryDirectory, parsedSource.base || `${sourceBaseName}.md`);
  const targetFilePath = path.join(repositoryDirectory, fileName);
  const id = buildUniquePresetId(repositoryDirectory, `custom-taxonomy-${slugify(label)}`);
  const manifestFileName = `${id}.json`;
  const manifestPath = path.join(repositoryDirectory, manifestFileName);

  await copyFile(sourceFilePath, targetFilePath);

  const manifest = {
    id,
    label,
    filePath: fileName,
    description: `用户导入的外部标签库：${label}`,
    baseKind: 'structured',
    taxonomyVersionId: id,
    archiveDimension: '内容领域',
    modelResponseShape: 'structured-json',
    taxonomyParseMode: 'bullet-root',
    promptLibraryPath: fileName
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return readTaxonomyPresetManifest(manifest, manifestPath);
}

function mergeTaxonomyPresets(
  builtinPresets: readonly TaxonomyPresetDefinition[],
  repositoryPresets: readonly TaxonomyPresetDefinition[]
): readonly TaxonomyPresetDefinition[] {
  const byId = new Map<string, TaxonomyPresetDefinition>();

  for (const preset of builtinPresets) {
    byId.set(preset.id, preset);
  }
  for (const preset of repositoryPresets) {
    byId.set(preset.id, preset);
  }

  return Object.freeze([...byId.values()]);
}

function readTaxonomyPresetManifest(
  value: unknown,
  manifestPath: string
): TaxonomyPresetDefinition {
  if (!isRecord(value)) {
    throw new Error(`Invalid taxonomy preset manifest: ${manifestPath}`);
  }

  const id = readRequiredString(value.id, 'id', manifestPath);
  const baseKind = readRequiredString(value.baseKind, 'baseKind', manifestPath);
  const modelResponseShape = readRequiredString(value.modelResponseShape, 'modelResponseShape', manifestPath);
  const taxonomyParseMode = readRequiredString(value.taxonomyParseMode, 'taxonomyParseMode', manifestPath);

  if (baseKind !== 'structured' && baseKind !== 'legacy') {
    throw new Error(`Invalid baseKind in taxonomy preset manifest: ${manifestPath}`);
  }
  if (modelResponseShape !== 'structured-json' && modelResponseShape !== 'paths-json-array') {
    throw new Error(`Invalid modelResponseShape in taxonomy preset manifest: ${manifestPath}`);
  }
  if (taxonomyParseMode !== 'heading' && taxonomyParseMode !== 'bullet-root') {
    throw new Error(`Invalid taxonomyParseMode in taxonomy preset manifest: ${manifestPath}`);
  }

  return Object.freeze({
    id,
    label: readRequiredString(value.label, 'label', manifestPath),
    filePath: resolveRepositoryFilePath(readRequiredString(value.filePath, 'filePath', manifestPath), manifestPath),
    description: readString(value.description),
    source: 'external',
    baseKind,
    taxonomyVersionId: readRequiredString(value.taxonomyVersionId, 'taxonomyVersionId', manifestPath),
    archiveDimension: readRequiredString(value.archiveDimension, 'archiveDimension', manifestPath),
    modelResponseShape,
    taxonomyParseMode,
    promptLibraryPath: readString(value.promptLibraryPath).length === 0
      ? undefined
      : resolveRepositoryFilePath(readString(value.promptLibraryPath), manifestPath)
  });
}

function resolveRepositoryFilePath(filePath: string, manifestPath: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(path.dirname(manifestPath), filePath);
}

function buildUniqueFileName(directory: string, requestedFileName: string): string {
  const parsed = path.parse(requestedFileName);
  const baseName = sanitizeFileStem(parsed.name) || 'custom-taxonomy';
  const extension = parsed.ext || '.md';
  let candidate = `${baseName}${extension}`;
  let index = 2;

  while (existsSync(path.join(directory, candidate))) {
    candidate = `${baseName}-${index}${extension}`;
    index += 1;
  }

  return candidate;
}

function buildUniquePresetId(repositoryDirectory: string, requestedId: string): string {
  const baseId = requestedId.replace(/-+/gu, '-').replace(/^-|-$/gu, '') || 'custom-taxonomy';
  let candidate = baseId;
  let index = 2;

  while (existsSync(path.join(repositoryDirectory, `${candidate}.json`))) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }

  return candidate;
}

function slugify(value: string): string {
  const asciiSlug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');

  if (asciiSlug.length > 0) {
    return asciiSlug;
  }

  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
}

function sanitizeFileStem(value: string): string {
  return value.replace(/[/:*?"<>|]+/gu, '_').replace(/^_+|_+$/gu, '') || 'custom-taxonomy';
}

function readRequiredString(value: unknown, key: string, manifestPath: string): string {
  const text = readString(value);

  if (text.length === 0) {
    throw new Error(`Missing ${key} in taxonomy preset manifest: ${manifestPath}`);
  }

  return text;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
