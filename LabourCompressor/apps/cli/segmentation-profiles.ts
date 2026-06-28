import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { projectPath } from './project-paths.ts';

export type SegmentationDetector = 'adaptive' | 'content';

export interface SegmentationProfileDefinition {
  readonly id: string;
  readonly label: string;
  readonly detector: SegmentationDetector;
  readonly minimumSeconds: number;
  readonly preferredMinimumSeconds: number;
  readonly maximumSeconds: number;
  readonly source: 'builtin' | 'repository';
  readonly manifestPath?: string | undefined;
}

export type SegmentationProfileRules = Pick<
  SegmentationProfileDefinition,
  'detector' | 'minimumSeconds' | 'preferredMinimumSeconds' | 'maximumSeconds'
>;

export const SEGMENTATION_PROFILE_REPOSITORY_DIR = projectPath(
  'config/repositories/segmentation-profiles'
);

export const BUILTIN_SEGMENTATION_PROFILE_DEFINITIONS: readonly SegmentationProfileDefinition[] = Object.freeze([
  Object.freeze({
    id: 'standard_ad',
    label: 'standard_ad',
    detector: 'adaptive',
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30,
    source: 'builtin'
  }),
  Object.freeze({
    id: 'fast_cut',
    label: 'fast_cut',
    detector: 'content',
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30,
    source: 'builtin'
  }),
  Object.freeze({
    id: 'conservative',
    label: 'conservative',
    detector: 'adaptive',
    minimumSeconds: 3,
    preferredMinimumSeconds: 8,
    maximumSeconds: 30,
    source: 'builtin'
  })
]);

export async function listSegmentationProfileDefinitions(input: {
  readonly repositoryDirectory?: string | undefined;
} = {}): Promise<readonly SegmentationProfileDefinition[]> {
  const repositoryProfiles = await loadSegmentationProfileRepository(
    input.repositoryDirectory ?? SEGMENTATION_PROFILE_REPOSITORY_DIR
  );
  const byId = new Map<string, SegmentationProfileDefinition>();

  for (const profile of BUILTIN_SEGMENTATION_PROFILE_DEFINITIONS) {
    byId.set(profile.id, profile);
  }
  for (const profile of repositoryProfiles) {
    byId.set(profile.id, profile);
  }

  return Object.freeze([...byId.values()]);
}

export async function resolveSegmentationProfileRules(profileId: string): Promise<SegmentationProfileRules> {
  const profile = (await listSegmentationProfileDefinitions()).find((item) => item.id === profileId);

  if (profile === undefined) {
    throw new Error(`Unknown segmentation profile: ${profileId}`);
  }

  return Object.freeze({
    detector: profile.detector,
    minimumSeconds: profile.minimumSeconds,
    preferredMinimumSeconds: profile.preferredMinimumSeconds,
    maximumSeconds: profile.maximumSeconds
  });
}

export async function loadSegmentationProfileRepository(
  repositoryDirectory: string
): Promise<readonly SegmentationProfileDefinition[]> {
  let entries;

  try {
    entries = await readdir(repositoryDirectory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return Object.freeze([]);
    }
    throw error;
  }

  const profiles: SegmentationProfileDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const manifestPath = path.join(repositoryDirectory, entry.name);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
    profiles.push(readSegmentationProfileManifest(manifest, manifestPath));
  }

  return Object.freeze(
    profiles.sort((left, right) => left.id.localeCompare(right.id, 'en-US'))
  );
}

function readSegmentationProfileManifest(
  value: unknown,
  manifestPath: string
): SegmentationProfileDefinition {
  if (!isRecord(value)) {
    throw new Error(`Invalid segmentation profile manifest: ${manifestPath}`);
  }

  const id = readRequiredString(value.id, 'id', manifestPath);
  const detector = readRequiredString(value.detector, 'detector', manifestPath);
  const minimumSeconds = readRequiredPositiveNumber(value.minimumSeconds, 'minimumSeconds', manifestPath);
  const preferredMinimumSeconds = readRequiredPositiveNumber(
    value.preferredMinimumSeconds,
    'preferredMinimumSeconds',
    manifestPath
  );
  const maximumSeconds = readRequiredPositiveNumber(value.maximumSeconds, 'maximumSeconds', manifestPath);

  if (detector !== 'adaptive' && detector !== 'content') {
    throw new Error(`Invalid detector in segmentation profile manifest: ${manifestPath}`);
  }
  if (minimumSeconds > preferredMinimumSeconds || preferredMinimumSeconds > maximumSeconds) {
    throw new Error(`Invalid duration order in segmentation profile manifest: ${manifestPath}`);
  }

  return Object.freeze({
    id,
    label: readString(value.label) || id,
    detector,
    minimumSeconds,
    preferredMinimumSeconds,
    maximumSeconds,
    source: 'repository',
    manifestPath
  });
}

function readRequiredString(value: unknown, key: string, manifestPath: string): string {
  const text = readString(value);

  if (text.length === 0) {
    throw new Error(`Missing ${key} in segmentation profile manifest: ${manifestPath}`);
  }

  return text;
}

function readRequiredPositiveNumber(value: unknown, key: string, manifestPath: string): number {
  const parsed = typeof value === 'number' ? value : Number(readString(value));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key} in segmentation profile manifest: ${manifestPath}`);
  }

  return parsed;
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
