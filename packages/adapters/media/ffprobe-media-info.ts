import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface MediaInfoProbeResult {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}

export interface FfprobeMediaInfoOptions {
  readonly binaryPath?: string;
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
    'stream=width,height:format=duration',
    '-of',
    'json',
    filePath
  ]);
}

export function parseFfprobeMediaInfo(raw: string): MediaInfoProbeResult {
  const parsed = JSON.parse(raw) as {
    readonly format?: { readonly duration?: string };
    readonly streams?: readonly {
      readonly width?: number;
      readonly height?: number;
    }[];
  };
  const durationSeconds = Number(parsed.format?.duration ?? Number.NaN);
  const width = parsed.streams?.[0]?.width ?? Number.NaN;
  const height = parsed.streams?.[0]?.height ?? Number.NaN;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Unable to determine media duration.');
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Unable to determine media dimensions.');
  }

  return Object.freeze({
    durationSeconds,
    width,
    height
  });
}
