import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { projectPath } from './project-paths.ts';
import { type TaxonomyPresetDefinition } from './taxonomy-presets.ts';

export interface PromptPresetDefinition {
  readonly id: string;
  readonly label: string;
  readonly filePath: string;
  readonly source: 'taxonomy' | 'repository';
  readonly manifestPath?: string;
}

export const PROMPT_REPOSITORY_DIR = projectPath('config/repositories/prompts');

export function listPromptPresets(input: {
  readonly taxonomyPresets: readonly TaxonomyPresetDefinition[];
  readonly repositoryDirectory?: string;
}): readonly PromptPresetDefinition[] {
  const byFilePath = new Map<string, PromptPresetDefinition>();

  for (const preset of input.taxonomyPresets) {
    if (preset.promptLibraryPath === undefined) {
      continue;
    }
    byFilePath.set(preset.promptLibraryPath, Object.freeze({
      id: preset.id,
      label: preset.label,
      filePath: preset.promptLibraryPath,
      source: 'taxonomy'
    }));
  }

  for (const preset of loadPromptPresetRepository(input.repositoryDirectory ?? PROMPT_REPOSITORY_DIR)) {
    byFilePath.set(preset.filePath, preset);
  }

  return Object.freeze([...byFilePath.values()]);
}

export function loadPromptPresetRepository(repositoryDirectory: string): readonly PromptPresetDefinition[] {
  let entries;

  try {
    entries = readdirSync(repositoryDirectory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return Object.freeze([]);
    }
    throw error;
  }

  const presets: PromptPresetDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const manifestPath = path.join(repositoryDirectory, entry.name);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    presets.push(readPromptPresetManifest(manifest, manifestPath));
  }

  return Object.freeze(
    presets.sort((left, right) => left.id.localeCompare(right.id, 'en-US'))
  );
}

function readPromptPresetManifest(value: unknown, manifestPath: string): PromptPresetDefinition {
  if (!isRecord(value)) {
    throw new Error(`Invalid prompt preset manifest: ${manifestPath}`);
  }

  return Object.freeze({
    id: readRequiredString(value.id, 'id', manifestPath),
    label: readRequiredString(value.label, 'label', manifestPath),
    filePath: resolveRepositoryFilePath(readRequiredString(value.filePath, 'filePath', manifestPath), manifestPath),
    source: 'repository',
    manifestPath
  });
}

function resolveRepositoryFilePath(filePath: string, manifestPath: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(path.dirname(manifestPath), filePath);
}

function readRequiredString(value: unknown, key: string, manifestPath: string): string {
  const text = typeof value === 'string' ? value.trim() : '';

  if (text.length === 0) {
    throw new Error(`Missing ${key} in prompt preset manifest: ${manifestPath}`);
  }

  return text;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
