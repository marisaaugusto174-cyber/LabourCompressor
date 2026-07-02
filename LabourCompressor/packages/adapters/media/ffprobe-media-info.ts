import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface MediaInfoProbeResult {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly nominalFrameRate?: number | undefined;
  readonly averageFrameRate?: number | undefined;
  readonly frameCount?: number | undefined;
  readonly frameRateSource?: 'frame-count' | 'average' | 'nominal' | undefined;
  readonly variableFrameRate?: boolean | undefined;
}

export interface FfprobeMediaInfoOptions {
  readonly binaryPath?: string | undefined;
}

export function createFfprobeMediaInfoReader(
  options: FfprobeMediaInfoOptions = {}
): {
  readMediaInfo(filePath: string): Promise<MediaInfoProbeResult>;
} {
  const binaryPath = options.binaryPath ?? 'ffprobe';

  return Object.freeze({
    async readMediaInfo(filePath: string): Promise<MediaInfoProbeResult> {
      const result = await execFileAsync(binaryPath, buildFfprobeMediaInfoArgs(filePath));
      return parseFfprobeMediaInfo(result.stdout);
    }
  });
}

export function buildFfprobeMediaInfoArgs(filePath: string): readonly string[] {
  return Object.freeze([
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate,avg_frame_rate,nb_frames:format=duration',
    '-of',
    'json',
    filePath
  ]);
}

export function parseFfprobeMediaInfo(raw: string): MediaInfoProbeResult {
  const parsed = JSON.parse(raw) as {
    readonly format?: { readonly duration?: string } | undefined;
    readonly streams?: readonly {
      readonly width?: number | undefined;
      readonly height?: number | undefined;
      readonly r_frame_rate?: string | undefined;
      readonly avg_frame_rate?: string | undefined;
      readonly nb_frames?: string | undefined;
    }[];
  };
  const durationSeconds = Number(parsed.format?.duration ?? Number.NaN);
  const stream = parsed.streams?.[0];
  const width = stream?.width ?? Number.NaN;
  const height = stream?.height ?? Number.NaN;
  const nominalFrameRate = parseFrameRate(stream?.r_frame_rate);
  const averageFrameRate = parseFrameRate(stream?.avg_frame_rate);
  const frameCount = parseFrameCount(stream?.nb_frames);
  const frameCountRate = frameCount === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0
    ? undefined
    : frameCount / durationSeconds;
  const frameRateSelection = selectFrameRate({
    frameCountRate,
    averageFrameRate,
    nominalFrameRate
  });
  const frameRate = frameRateSelection?.value ?? Number.NaN;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Unable to determine media duration.');
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Unable to determine media dimensions.');
  }

  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new Error('Unable to determine media frame rate.');
  }

  return Object.freeze({
    durationSeconds,
    width,
    height,
    frameRate,
    ...(nominalFrameRate === undefined ? {} : { nominalFrameRate }),
    ...(averageFrameRate === undefined ? {} : { averageFrameRate }),
    ...(frameCount === undefined ? {} : { frameCount }),
    ...(frameRateSelection === undefined ? {} : { frameRateSource: frameRateSelection.source }),
    variableFrameRate: isVariableFrameRate(nominalFrameRate, frameRate)
  });
}

function selectFrameRate(input: {
  readonly frameCountRate?: number | undefined;
  readonly averageFrameRate?: number | undefined;
  readonly nominalFrameRate?: number | undefined;
}): { readonly value: number; readonly source: 'frame-count' | 'average' | 'nominal' } | undefined {
  if (isPositiveFinite(input.frameCountRate)) {
    return Object.freeze({ value: input.frameCountRate, source: 'frame-count' as const });
  }
  if (isPositiveFinite(input.averageFrameRate)) {
    return Object.freeze({ value: input.averageFrameRate, source: 'average' as const });
  }
  if (isPositiveFinite(input.nominalFrameRate)) {
    return Object.freeze({ value: input.nominalFrameRate, source: 'nominal' as const });
  }
  return undefined;
}

function isVariableFrameRate(nominalFrameRate: number | undefined, effectiveFrameRate: number): boolean {
  if (!isPositiveFinite(nominalFrameRate) || !isPositiveFinite(effectiveFrameRate)) return false;
  return Math.abs(nominalFrameRate - effectiveFrameRate) / nominalFrameRate > 0.01;
}

function parseFrameRate(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const ratioMatch = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/u.exec(value.trim());
  if (ratioMatch !== null) {
    const numerator = Number(ratioMatch[1]);
    const denominator = Number(ratioMatch[2]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
      return undefined;
    }
    const result = numerator / denominator;
    return result > 0 ? result : undefined;
  }
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function parseFrameCount(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0 || value.trim() === 'N/A') return undefined;
  const frameCount = Number(value);
  return Number.isInteger(frameCount) && frameCount > 0 ? frameCount : undefined;
}

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
