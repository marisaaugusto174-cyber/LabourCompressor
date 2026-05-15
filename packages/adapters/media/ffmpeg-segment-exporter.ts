import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveFfmpegBinaryPath } from './local-media-binaries.ts';

const execFileAsync = promisify(execFile);

export interface ExportSegmentInput {
  readonly inputFilePath: string;
  readonly outputFilePath: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface ExportSegmentResult {
  readonly outputFilePath: string;
}

export interface FfmpegSegmentExporterOptions {
  readonly binaryPath?: string;
}

export function createFfmpegSegmentExporter(
  options: FfmpegSegmentExporterOptions = {}
): {
  exportSegment(input: ExportSegmentInput): Promise<ExportSegmentResult>;
} {
  const binaryPath = resolveFfmpegBinaryPath(options.binaryPath);

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

  return Object.freeze([
    '-y',
    '-ss',
    String(input.startSeconds),
    '-to',
    String(input.endSeconds),
    '-i',
    input.inputFilePath,
    '-map',
    '0',
    '-c',
    'copy',
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
