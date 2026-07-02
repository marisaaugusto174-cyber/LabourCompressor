import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface MediaInfoProbeResult {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
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
    'stream=width,height,r_frame_rate,avg_frame_rate:format=duration',
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
    }[];
  };
  const durationSeconds = Number(parsed.format?.duration ?? Number.NaN);
  const stream = parsed.streams?.[0];
  const width = stream?.width ?? Number.NaN;
  const height = stream?.height ?? Number.NaN;
  const frameRate = parseFrameRate(stream?.r_frame_rate) ??
    parseFrameRate(stream?.avg_frame_rate) ??
    Number.NaN;

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
    frameRate
  });
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
