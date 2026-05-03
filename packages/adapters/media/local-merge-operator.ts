import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type MergeStreamsInput,
  type MergeStreamsResult
} from '../../features/download/domain/index.ts';

export async function mergeDownloadedStreams(
  input: MergeStreamsInput
): Promise<MergeStreamsResult> {
  const outputFileName = `${input.outputFileStem}.mp4`;
  const outputFilePath = path.join(input.outputDirectory, outputFileName);
  const videoContent = await readFile(input.videoArtifact.filePath, 'utf8');
  const audioContent = await readFile(input.audioArtifact.filePath, 'utf8');

  await writeFile(
    outputFilePath,
    `video:${videoContent}\naudio:${audioContent}\n`,
    'utf8'
  );

  if (input.cleanupSourceArtifacts) {
    await rm(input.videoArtifact.filePath, { force: true });
    await rm(input.audioArtifact.filePath, { force: true });
  }

  return Object.freeze({
    mergedFilePath: outputFilePath,
    mergedFileName: outputFileName
  });
}
