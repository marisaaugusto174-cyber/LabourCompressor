import path from 'node:path';

import { createFfmpegSegmentExporter } from '../../packages/adapters/media/ffmpeg-segment-exporter.ts';
import { createFfprobeMediaInfoReader } from '../../packages/adapters/media/ffprobe-media-info.ts';
import { createPySceneDetectBoundaryDetector } from '../../packages/adapters/media/pyscenedetect-boundary-detector.ts';
import { createLocalContinuityAnalyzer } from '../../packages/adapters/media/local-continuity-analyzer.ts';
import { type AutoSegmentationDependencies } from './local-pipeline-segmentation.ts';
import {
  resolveContinuityPythonPath,
  resolveSceneDetectBinaryPath
} from './local-pipeline-segmentation-binaries.ts';
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
    continuityAnalyzer: dependencies?.continuityAnalyzer ?? createLocalContinuityAnalyzer({
      pythonPath: resolveContinuityPythonPath(PROJECT_ROOT),
      scriptPath: path.join(PROJECT_ROOT, 'scripts', 'analyze-boundary-continuity.py')
    }),
    segmentExporter: dependencies?.segmentExporter ?? createFfmpegSegmentExporter()
  });
}
