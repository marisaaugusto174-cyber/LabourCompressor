import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExportSegmentInput {
  readonly inputFilePath: string;
  readonly outputFilePath: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly mode?: 'precise-reencode' | 'stream-copy' | undefined;
  readonly endGuardSeconds?: number | undefined;
}

export interface ExportSegmentResult {
  readonly outputFilePath: string;
}

export interface FfmpegSegmentExporterOptions {
  readonly binaryPath?: string | undefined;
}

export function createFfmpegSegmentExporter(
  options: FfmpegSegmentExporterOptions = {}
): {
  exportSegment(input: ExportSegmentInput): Promise<ExportSegmentResult>;
} {
  const binaryPath = options.binaryPath ?? 'ffmpeg';

  return Object.freeze({
    async exportSegment(input: ExportSegmentInput): Promise<ExportSegmentResult> {
      await mkdir(path.dirname(input.outputFilePath), { recursive: true });
      await execFileAsync(binaryPath, buildFfmpegSegmentArgs(input));

      return Object.freeze({
        outputFilePath: input.outputFilePath
      });
    }
  });
}

export function buildFfmpegSegmentArgs(
  input: ExportSegmentInput
): readonly string[] {
  validateSegmentRange(input.startSeconds, input.endSeconds);
  validateEndGuard(input);

  if (input.mode === 'stream-copy') return buildStreamCopyArgs(input);
  return buildPreciseReencodeArgs(input);
}

function buildStreamCopyArgs(input: ExportSegmentInput): readonly string[] {
  return Object.freeze([
    '-y',
    '-ss', formatSeconds(input.startSeconds),
    '-to',
    formatSeconds(input.endSeconds),
    '-i',
    input.inputFilePath,
    '-map',
    '0',
    '-c',
    'copy',
    input.outputFilePath
  ]);
}

function buildPreciseReencodeArgs(input: ExportSegmentInput): readonly string[] {
  return Object.freeze([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    formatSeconds(input.startSeconds),
    '-i',
    input.inputFilePath,
    '-t',
    formatSeconds(readEncodeDuration(input)),
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    input.outputFilePath
  ]);
}

function validateSegmentRange(startSeconds: number, endSeconds: number): void {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    throw new Error('Segment export time range must be finite.');
  }

  if (startSeconds < 0 || endSeconds <= startSeconds) {
    throw new Error('Segment export time range must be positive.');
  }
}

function validateEndGuard(input: ExportSegmentInput): void {
  const guard = input.endGuardSeconds ?? 0;
  if (!Number.isFinite(guard) || guard < 0) {
    throw new Error('Segment export end guard must be non-negative.');
  }
  if (guard >= input.endSeconds - input.startSeconds) {
    throw new Error('Segment export end guard must be shorter than the segment.');
  }
}

function readEncodeDuration(input: ExportSegmentInput): number {
  return input.endSeconds - input.startSeconds - (input.endGuardSeconds ?? 0);
}

function formatSeconds(value: number): string {
  return String(Number(value.toFixed(6)));
}
