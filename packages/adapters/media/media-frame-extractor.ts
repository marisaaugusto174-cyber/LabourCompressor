import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  resolveFfmpegBinaryPath,
  resolveFfprobeBinaryPath
} from './local-media-binaries.ts';

export interface ExtractRepresentativeFramesInput {
  readonly mediaFilePath: string;
  readonly outputDirectory: string;
  readonly maxFrames?: number;
}

export interface ExtractRepresentativeFramesResult {
  readonly framePaths: readonly string[];
}

export interface VideoTaggingCacheProfile {
  readonly profileId: string;
  readonly targetHeight: number;
  readonly videoBitrateKbps: number;
  readonly audioBitrateKbps: number;
  readonly maxDataUriBytes: number;
  readonly outputFileName: string;
}

export interface VideoTaggingCacheResult {
  readonly sourcePath: string;
  readonly cachePath: string;
  readonly sourceSizeBytes: number;
  readonly cacheSizeBytes: number;
  readonly sourceDurationSec: number;
  readonly sourceFps: number;
  readonly cacheFps: number;
  readonly cacheHit: boolean;
  readonly profileId: string;
}

interface VideoMetadata {
  readonly durationSec: number;
  readonly fps: number;
}

interface VideoTaggingCacheMetadata extends VideoTaggingCacheResult {
  readonly sourceHash: string;
}

const DATA_URI_OVERHEAD_BYTES = 64;

export const DEFAULT_VIDEO_TAGGING_CACHE_PROFILE: VideoTaggingCacheProfile =
  Object.freeze({
    profileId: 'video-tagging-360p-v650-a64',
    targetHeight: 360,
    videoBitrateKbps: 650,
    audioBitrateKbps: 64,
    maxDataUriBytes: 20 * 1024 * 1024,
    outputFileName: 'tagging-360p-a64.mp4'
  });

export async function extractRepresentativeFrames(
  input: ExtractRepresentativeFramesInput
): Promise<ExtractRepresentativeFramesResult> {
  const maxFrames = input.maxFrames ?? 3;

  if (maxFrames <= 0) {
    throw new Error('Representative frame extraction requires maxFrames > 0.');
  }

  await mkdir(input.outputDirectory, { recursive: true });

  const outputPattern = path.join(input.outputDirectory, 'frame-%02d.jpg');
  const args = [
    '-y',
    '-i',
    input.mediaFilePath,
    '-vf',
    'fps=1/5',
    '-frames:v',
    String(maxFrames),
    outputPattern
  ];

  await spawnAndWait(resolveFfmpegBinaryPath(), args);

  const framePaths = [];

  for (let index = 1; index <= maxFrames; index += 1) {
    const candidatePath = path.join(
      input.outputDirectory,
      `frame-${String(index).padStart(2, '0')}.jpg`
    );

    try {
      await readFile(candidatePath);
      framePaths.push(candidatePath);
    } catch {
      break;
    }
  }

  if (framePaths.length === 0) {
    throw new Error(
      `No representative frames were extracted from "${input.mediaFilePath}".`
    );
  }

  return Object.freeze({
    framePaths: Object.freeze(framePaths)
  });
}

export async function encodeFileAsDataUrl(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = getMimeTypeForExtension(extension);

  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

export async function prepareVideoTaggingCache(input: {
  readonly mediaFilePath: string;
  readonly cacheRootDirectory: string;
  readonly profile?: VideoTaggingCacheProfile;
}): Promise<VideoTaggingCacheResult> {
  const profile = input.profile ?? DEFAULT_VIDEO_TAGGING_CACHE_PROFILE;
  const sourceHash = await hashFile(input.mediaFilePath);
  const sourceStats = await stat(input.mediaFilePath);
  const sourceMetadata = await readVideoMetadata(input.mediaFilePath);
  const cacheDirectory = path.join(input.cacheRootDirectory, sourceHash);
  const cachePath = path.join(cacheDirectory, profile.outputFileName);
  const metadataPath = path.join(cacheDirectory, 'metadata.json');
  const safeFileBytes = computeSafeFileByteLimit(profile.maxDataUriBytes);

  await mkdir(cacheDirectory, { recursive: true });

  const cachedMetadata = await readVideoTaggingCacheMetadata(metadataPath);

  if (
    cachedMetadata !== undefined &&
    cachedMetadata.sourceHash === sourceHash &&
    cachedMetadata.profileId === profile.profileId &&
    cachedMetadata.cacheSizeBytes <= safeFileBytes
  ) {
    try {
      await stat(cachePath);
      return Object.freeze({
        ...cachedMetadata,
        cacheHit: true
      });
    } catch {
      // fall through and rebuild cache
    }
  }

  await spawnAndWait(resolveFfmpegBinaryPath(), buildVideoTaggingCacheArgs({
    inputFilePath: input.mediaFilePath,
    outputFilePath: cachePath,
    profile
  }));

  const cacheStats = await stat(cachePath);

  if (cacheStats.size > safeFileBytes) {
    throw new Error(
      `Prepared video still exceeds safe upload limit: ${cacheStats.size} bytes > ${safeFileBytes} bytes.`
    );
  }

  const cacheMetadata = await readVideoMetadata(cachePath);
  const cacheResult: VideoTaggingCacheMetadata = {
    sourceHash,
    sourcePath: input.mediaFilePath,
    cachePath,
    sourceSizeBytes: sourceStats.size,
    cacheSizeBytes: cacheStats.size,
    sourceDurationSec: sourceMetadata.durationSec,
    sourceFps: sourceMetadata.fps,
    cacheFps: cacheMetadata.fps,
    cacheHit: false,
    profileId: profile.profileId
  };

  await writeFile(metadataPath, `${JSON.stringify(cacheResult, null, 2)}\n`, 'utf8');

  return Object.freeze(cacheResult);
}

export function buildVideoTaggingCacheArgs(input: {
  readonly inputFilePath: string;
  readonly outputFilePath: string;
  readonly profile?: VideoTaggingCacheProfile;
}): readonly string[] {
  const profile = input.profile ?? DEFAULT_VIDEO_TAGGING_CACHE_PROFILE;
  const maxrateKbps = profile.videoBitrateKbps;
  const bufsizeKbps = Math.max(profile.videoBitrateKbps * 2, 256);

  return Object.freeze([
    '-y',
    '-i',
    input.inputFilePath,
    '-vf',
    buildScaleFilter(profile.targetHeight),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-b:v',
    `${profile.videoBitrateKbps}k`,
    '-maxrate',
    `${maxrateKbps}k`,
    '-bufsize',
    `${bufsizeKbps}k`,
    '-c:a',
    'aac',
    '-b:a',
    `${profile.audioBitrateKbps}k`,
    '-movflags',
    '+faststart',
    input.outputFilePath
  ]);
}

function buildScaleFilter(targetHeight: number): string {
  return `scale='trunc(iw*min(1,${targetHeight}/ih)/2)*2:trunc(ih*min(1,${targetHeight}/ih)/2)*2'`;
}

function computeSafeFileByteLimit(maxDataUriBytes: number): number {
  return Math.floor(((maxDataUriBytes - DATA_URI_OVERHEAD_BYTES) * 3) / 4);
}

async function readVideoTaggingCacheMetadata(
  metadataPath: string
): Promise<VideoTaggingCacheMetadata | undefined> {
  try {
    const raw = await readFile(metadataPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return Object.freeze({
      sourceHash: readRequiredString(parsed.sourceHash, 'sourceHash'),
      sourcePath: readRequiredString(parsed.sourcePath, 'sourcePath'),
      cachePath: readRequiredString(parsed.cachePath, 'cachePath'),
      sourceSizeBytes: readRequiredNumber(parsed.sourceSizeBytes, 'sourceSizeBytes'),
      cacheSizeBytes: readRequiredNumber(parsed.cacheSizeBytes, 'cacheSizeBytes'),
      sourceDurationSec: readRequiredNumber(parsed.sourceDurationSec, 'sourceDurationSec'),
      sourceFps: readRequiredNumber(parsed.sourceFps, 'sourceFps'),
      cacheFps: readRequiredNumber(parsed.cacheFps, 'cacheFps'),
      cacheHit: false,
      profileId: readRequiredString(parsed.profileId, 'profileId')
    });
  } catch {
    return undefined;
  }
}

function getMimeTypeForExtension(extension: string): string {
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.m4v':
      return 'video/x-m4v';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    default:
      throw new Error(`Unsupported media extension for data url: "${extension}".`);
  }
}

async function readVideoMetadata(filePath: string): Promise<VideoMetadata> {
  const output = await spawnAndCollect(resolveFfprobeBinaryPath(), [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=avg_frame_rate,r_frame_rate:format=duration',
    '-of',
    'json',
    filePath
  ]);
  const parsed = JSON.parse(output) as {
    format?: { duration?: string };
    streams?: Array<{ avg_frame_rate?: string; r_frame_rate?: string }>;
  };
  const durationSec = Number(parsed.format?.duration ?? '0');
  const fps = parseFps(
    parsed.streams?.[0]?.avg_frame_rate ?? parsed.streams?.[0]?.r_frame_rate ?? ''
  );

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`Unable to determine video duration for "${filePath}".`);
  }

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`Unable to determine video fps for "${filePath}".`);
  }

  return Object.freeze({
    durationSec,
    fps
  });
}

function parseFps(value: string): number {
  if (!value.includes('/')) {
    return Number(value);
  }

  const [numeratorText, denominatorText] = value.split('/');
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return Number.NaN;
  }

  return numerator / denominator;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });

  return hash.digest('hex');
}

async function spawnAndWait(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'ignore'
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

async function spawnAndCollect(
  command: string,
  args: readonly string[]
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid cache metadata field: ${label}`);
  }

  return value.trim();
}

function readRequiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid cache metadata field: ${label}`);
  }

  return value;
}
