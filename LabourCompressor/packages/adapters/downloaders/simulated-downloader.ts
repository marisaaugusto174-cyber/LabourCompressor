import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type DownloadArtifact,
  type DownloadExecutionResult,
  type DownloadRequest
} from '../../features/download/domain/index.ts';

export type SimulatedDownloadFixture =
  | {
      readonly mode: 'muxed';
      readonly extension: string;
      readonly content: string;
      readonly title?: string | undefined;
      readonly resolutionLabel?: string | undefined;
      readonly durationSeconds?: number | undefined;
    }
  | {
      readonly mode: 'separated';
      readonly videoExtension: string;
      readonly audioExtension: string;
      readonly videoContent: string;
      readonly audioContent: string;
      readonly title?: string | undefined;
      readonly resolutionLabel?: string | undefined;
      readonly durationSeconds?: number | undefined;
    };

export function createSimulatedDownloaderAdapter(input: {
  readonly fixtures: Readonly<Record<string, SimulatedDownloadFixture>>;
  readonly downloadedAt: string;
}): {
  download(request: DownloadRequest): Promise<DownloadExecutionResult>;
} {
  return Object.freeze({
    async download(request: DownloadRequest): Promise<DownloadExecutionResult> {
      const fixture = input.fixtures[request.normalizedUrl];

      if (fixture === undefined) {
        throw new Error(`No simulated download fixture for URL: "${request.normalizedUrl}"`);
      }

      await mkdir(request.outputDirectory, { recursive: true });

      if (fixture.mode === 'muxed') {
        const fileName = `${request.outputFileStem}.${fixture.extension}`;
        const filePath = path.join(request.outputDirectory, fileName);
        await writeFile(filePath, fixture.content, 'utf8');

        return Object.freeze({
          request,
          artifacts: Object.freeze([
            createArtifact({
              kind: 'muxed-video',
              filePath,
              fileName,
              container: fixture.extension
            })
          ]),
          downloadedAt: input.downloadedAt,
          mediaMetadata: Object.freeze({
            sourceTitle: fixture.title ?? request.fallbackTitle,
            resolutionLabel: fixture.resolutionLabel,
            durationSeconds: fixture.durationSeconds
          })
        });
      }

      const videoFileName = `${request.outputFileStem}.video.${fixture.videoExtension}`;
      const audioFileName = `${request.outputFileStem}.audio.${fixture.audioExtension}`;
      const videoFilePath = path.join(request.outputDirectory, videoFileName);
      const audioFilePath = path.join(request.outputDirectory, audioFileName);

      await writeFile(videoFilePath, fixture.videoContent, 'utf8');
      await writeFile(audioFilePath, fixture.audioContent, 'utf8');

      return Object.freeze({
        request,
        artifacts: Object.freeze([
          createArtifact({
            kind: 'video-only',
            filePath: videoFilePath,
            fileName: videoFileName,
            container: fixture.videoExtension
          }),
          createArtifact({
            kind: 'audio-only',
            filePath: audioFilePath,
            fileName: audioFileName,
            container: fixture.audioExtension
          })
        ]),
        downloadedAt: input.downloadedAt,
        mediaMetadata: Object.freeze({
          sourceTitle: fixture.title ?? request.fallbackTitle,
          resolutionLabel: fixture.resolutionLabel,
          durationSeconds: fixture.durationSeconds
        })
      });
    }
  });
}

function createArtifact(input: {
  readonly kind: DownloadArtifact['kind'];
  readonly filePath: string;
  readonly fileName: string;
  readonly container: string;
}): DownloadArtifact {
  return Object.freeze({
    kind: input.kind,
    filePath: input.filePath,
    fileName: input.fileName,
    container: input.container
  });
}
