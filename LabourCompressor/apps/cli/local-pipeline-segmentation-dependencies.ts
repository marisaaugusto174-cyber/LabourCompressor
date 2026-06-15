import { createFfmpegSegmentExporter } from '../../packages/adapters/media/ffmpeg-segment-exporter.ts';
import { createFfprobeMediaInfoReader } from '../../packages/adapters/media/ffprobe-media-info.ts';
import { createPySceneDetectBoundaryDetector } from '../../packages/adapters/media/pyscenedetect-boundary-detector.ts';
import { type AutoSegmentationDependencies } from './local-pipeline-segmentation.ts';
import { resolveSceneDetectBinaryPath } from './local-pipeline-segmentation-binaries.ts';
import { PROJECT_ROOT } from './project-paths.ts';

export function resolveSegmentationDependencies(
  dependencies: AutoSegmentationDependencies | undefined
): Required<AutoSegmentationDependencies> {
  return Object.freeze({
    mediaInfoReader: dependencies?.mediaInfoReader ?? createFfprobeMediaInfoReader(),
    boundaryDetector:
      dependencies?.boundaryDetector ??
      createPySceneDetectBoundaryDetector({
        binaryPath: resolveSceneDetectBinaryPath(PROJECT_ROOT)
      }),
    segmentExporter: dependencies?.segmentExporter ?? createFfmpegSegmentExporter()
  });
}
