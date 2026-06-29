import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { projectPath } from './project-paths.ts';
import {
  DEFAULT_CONTINUITY_THRESHOLDS,
  type ContinuityThresholds
} from '../../packages/features/segmentation/domain/index.ts';

export type SegmentationDetector = 'adaptive' | 'content';

export interface SegmentationProfileDefinition {
  readonly id: string;
  readonly label: string;
  readonly detector: SegmentationDetector;
  readonly minimumSeconds: number;
  readonly preferredMinimumSeconds: number;
  readonly preferredMaximumSeconds: number;
  readonly maximumSeconds: number;
  readonly continuityThresholds: ContinuityThresholds;
  readonly source: 'builtin' | 'repository';
  readonly manifestPath?: string | undefined;
}

export type SegmentationProfileRules = Pick<
  SegmentationProfileDefinition,
  | 'detector'
  | 'minimumSeconds'
  | 'preferredMinimumSeconds'
  | 'preferredMaximumSeconds'
  | 'maximumSeconds'
  | 'continuityThresholds'
>;

export const DEFAULT_SEGMENTATION_DURATION_POLICY = Object.freeze({
  minimumSeconds: 5,
  preferredMinimumSeconds: 5,
  preferredMaximumSeconds: 30,
  maximumSeconds: 60
});

export const SEGMENTATION_PROFILE_REPOSITORY_DIR = projectPath(
  'config/repositories/segmentation-profiles'
);

export const BUILTIN_SEGMENTATION_PROFILE_DEFINITIONS: readonly SegmentationProfileDefinition[] = Object.freeze([
  Object.freeze({
    id: 'standard_ad',
    label: 'standard_ad',
    detector: 'adaptive',
    ...DEFAULT_SEGMENTATION_DURATION_POLICY,
    continuityThresholds: DEFAULT_CONTINUITY_THRESHOLDS,
    source: 'builtin'
  }),
  Object.freeze({
    id: 'fast_cut',
    label: 'fast_cut',
    detector: 'content',
    ...DEFAULT_SEGMENTATION_DURATION_POLICY,
    continuityThresholds: DEFAULT_CONTINUITY_THRESHOLDS,
    source: 'builtin'
  }),
  Object.freeze({
    id: 'conservative',
    label: 'conservative',
    detector: 'adaptive',
    ...DEFAULT_SEGMENTATION_DURATION_POLICY,
    continuityThresholds: DEFAULT_CONTINUITY_THRESHOLDS,
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
    preferredMaximumSeconds: profile.preferredMaximumSeconds,
    maximumSeconds: profile.maximumSeconds,
    continuityThresholds: profile.continuityThresholds
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
  const preferredMaximumSeconds = readRequiredPositiveNumber(
    value.preferredMaximumSeconds,
    'preferredMaximumSeconds',
    manifestPath
  );
  const maximumSeconds = readRequiredPositiveNumber(value.maximumSeconds, 'maximumSeconds', manifestPath);

  if (detector !== 'adaptive' && detector !== 'content') {
    throw new Error(`Invalid detector in segmentation profile manifest: ${manifestPath}`);
  }
  if (!matchesUnifiedDurationPolicy({
    minimumSeconds,
    preferredMinimumSeconds,
    preferredMaximumSeconds,
    maximumSeconds
  })) {
    throw new Error(`Segmentation profiles must use the unified 5-30-60 duration policy: ${manifestPath}`);
  }

  return Object.freeze({
    id,
    label: readString(value.label) || id,
    detector,
    minimumSeconds,
    preferredMinimumSeconds,
    preferredMaximumSeconds,
    maximumSeconds,
    continuityThresholds: readContinuityThresholds(value.continuityThresholds, manifestPath),
    source: 'repository',
    manifestPath
  });
}

function readContinuityThresholds(
  value: unknown,
  manifestPath: string
): ContinuityThresholds {
  if (value === undefined) return DEFAULT_CONTINUITY_THRESHOLDS;
  const record = requireOptionalGroup(value, 'continuityThresholds', manifestPath);
  return Object.freeze({
    visual: readVisualThresholds(record.visual, manifestPath),
    motion: readMotionThresholds(record.motion, manifestPath),
    audio: readAudioThresholds(record.audio, manifestPath),
    sampling: readSamplingThresholds(record.sampling, manifestPath)
  });
}

function readVisualThresholds(value: unknown, manifestPath: string): ContinuityThresholds['visual'] {
  const group = optionalGroup(value, 'visual', manifestPath);
  const defaults = DEFAULT_CONTINUITY_THRESHOLDS.visual;
  return Object.freeze({
    histogramContinuousMinimum: optionalNumber(group.histogramContinuousMinimum, defaults.histogramContinuousMinimum, manifestPath),
    histogramBreakMaximum: optionalNumber(group.histogramBreakMaximum, defaults.histogramBreakMaximum, manifestPath),
    frameDifferenceContinuousMaximum: optionalNumber(group.frameDifferenceContinuousMaximum, defaults.frameDifferenceContinuousMaximum, manifestPath),
    frameDifferenceBreakMinimum: optionalNumber(group.frameDifferenceBreakMinimum, defaults.frameDifferenceBreakMinimum, manifestPath)
  });
}

function readMotionThresholds(value: unknown, manifestPath: string): ContinuityThresholds['motion'] {
  const group = optionalGroup(value, 'motion', manifestPath);
  const defaults = DEFAULT_CONTINUITY_THRESHOLDS.motion;
  return Object.freeze({
    stillMagnitudeMaximum: optionalNumber(group.stillMagnitudeMaximum, defaults.stillMagnitudeMaximum, manifestPath),
    directionContinuousMinimum: optionalNumber(group.directionContinuousMinimum, defaults.directionContinuousMinimum, manifestPath),
    directionBreakMaximum: optionalNumber(group.directionBreakMaximum, defaults.directionBreakMaximum, manifestPath),
    magnitudeRatioContinuousMaximum: optionalNumber(group.magnitudeRatioContinuousMaximum, defaults.magnitudeRatioContinuousMaximum, manifestPath),
    magnitudeRatioBreakMinimum: optionalNumber(group.magnitudeRatioBreakMinimum, defaults.magnitudeRatioBreakMinimum, manifestPath)
  });
}

function readAudioThresholds(value: unknown, manifestPath: string): ContinuityThresholds['audio'] {
  const group = optionalGroup(value, 'audio', manifestPath);
  const defaults = DEFAULT_CONTINUITY_THRESHOLDS.audio;
  return Object.freeze({
    silenceDbMaximum: optionalNumber(group.silenceDbMaximum, defaults.silenceDbMaximum, manifestPath),
    rmsDeltaContinuousMaximum: optionalNumber(group.rmsDeltaContinuousMaximum, defaults.rmsDeltaContinuousMaximum, manifestPath),
    rmsDeltaBreakMinimum: optionalNumber(group.rmsDeltaBreakMinimum, defaults.rmsDeltaBreakMinimum, manifestPath),
    spectrumContinuousMinimum: optionalNumber(group.spectrumContinuousMinimum, defaults.spectrumContinuousMinimum, manifestPath),
    spectrumBreakMaximum: optionalNumber(group.spectrumBreakMaximum, defaults.spectrumBreakMaximum, manifestPath)
  });
}

function readSamplingThresholds(value: unknown, manifestPath: string): ContinuityThresholds['sampling'] {
  const group = optionalGroup(value, 'sampling', manifestPath);
  const defaults = DEFAULT_CONTINUITY_THRESHOLDS.sampling;
  return Object.freeze({
    frameWidth: optionalPositiveInteger(group.frameWidth, defaults.frameWidth, manifestPath),
    frameHeight: optionalPositiveInteger(group.frameHeight, defaults.frameHeight, manifestPath),
    windowSeconds: optionalPositiveNumber(group.windowSeconds, defaults.windowSeconds, manifestPath),
    audioSampleRate: optionalPositiveInteger(group.audioSampleRate, defaults.audioSampleRate, manifestPath)
  });
}

function optionalGroup(
  value: unknown,
  fieldName: string,
  manifestPath: string
): Readonly<Record<string, unknown>> {
  return value === undefined ? {} : requireOptionalGroup(value, fieldName, manifestPath);
}

function requireOptionalGroup(
  value: unknown,
  fieldName: string,
  manifestPath: string
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`Invalid ${fieldName} in segmentation profile manifest: ${manifestPath}`);
  return value;
}

function optionalNumber(value: unknown, fallback: number, manifestPath: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid continuity threshold in segmentation profile manifest: ${manifestPath}`);
  }
  return value;
}

function optionalPositiveNumber(value: unknown, fallback: number, manifestPath: string): number {
  const result = optionalNumber(value, fallback, manifestPath);
  if (result <= 0) throw new Error(`Invalid continuity threshold in segmentation profile manifest: ${manifestPath}`);
  return result;
}

function optionalPositiveInteger(value: unknown, fallback: number, manifestPath: string): number {
  const result = optionalPositiveNumber(value, fallback, manifestPath);
  if (!Number.isInteger(result)) throw new Error(`Invalid continuity threshold in segmentation profile manifest: ${manifestPath}`);
  return result;
}

function matchesUnifiedDurationPolicy(
  value: {
    readonly minimumSeconds: number;
    readonly preferredMinimumSeconds: number;
    readonly preferredMaximumSeconds: number;
    readonly maximumSeconds: number;
  }
): boolean {
  return value.minimumSeconds === DEFAULT_SEGMENTATION_DURATION_POLICY.minimumSeconds &&
    value.preferredMinimumSeconds === DEFAULT_SEGMENTATION_DURATION_POLICY.preferredMinimumSeconds &&
    value.preferredMaximumSeconds === DEFAULT_SEGMENTATION_DURATION_POLICY.preferredMaximumSeconds &&
    value.maximumSeconds === DEFAULT_SEGMENTATION_DURATION_POLICY.maximumSeconds;
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
