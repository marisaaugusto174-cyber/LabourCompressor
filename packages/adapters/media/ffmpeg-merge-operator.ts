import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  type MergeStreamsInput,
  type MergeStreamsResult
} from '../../features/download/domain/index.ts';

const execFileAsync = promisify(execFile);

export interface FfmpegMergeOptions {
  readonly binaryPath?: string;
}

export function createFfmpegMergeOperator(
  options: FfmpegMergeOptions = {}
): {
  mergeStreams(input: MergeStreamsInput): Promise<MergeStreamsResult>;
} {
  const binaryPath = options.binaryPath ?? 'ffmpeg';

  return Object.freeze({
    async mergeStreams(input: MergeStreamsInput): Promise<MergeStreamsResult> {
      const outputFileName = `${input.outputFileStem}.mp4`;
      const outputFilePath = path.join(input.outputDirectory, outputFileName);

      await execFileAsync(binaryPath, buildFfmpegMergeArgs({
        videoFilePath: input.videoArtifact.filePath,
        audioFilePath: input.audioArtifact.filePath,
        outputFilePath
      }));

      if (input.cleanupSourceArtifacts) {
        await rm(input.videoArtifact.filePath, { force: true });
        await rm(input.audioArtifact.filePath, { force: true });
      }

      return Object.freeze({
        mergedFilePath: outputFilePath,
        mergedFileName: outputFileName
      });
    }
  });
}

export function buildFfmpegMergeArgs(input: {
  readonly videoFilePath: string;
  readonly audioFilePath: string;
  readonly outputFilePath: string;
}): readonly string[] {
  return Object.freeze([
    '-y',
    '-i',
    input.videoFilePath,
    '-i',
    input.audioFilePath,
    '-c',
    'copy',
    input.outputFilePath
  ]);
}

export async function validateFfmpegBinary(
  binaryPath = 'ffmpeg'
): Promise<boolean> {
  try {
    await execFileAsync(binaryPath, ['-version']);
    return true;
  } catch {
    return false;
  }
}
