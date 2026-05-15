import { validateYtDlpBinary } from '../../packages/adapters/downloaders/ytdlp-downloader.ts';
import { validateFfmpegBinary } from '../../packages/adapters/media/ffmpeg-merge-operator.ts';
import {
  resolveFfprobeBinaryPath,
  validateLocalBinary
} from '../../packages/adapters/media/local-media-binaries.ts';
import { resolveTaxonomyInput } from '../cli/taxonomy-presets.ts';
import { type RunLocalPipelineOptions } from '../cli/local-pipeline-command.ts';
import { resolveSceneDetectBinaryPath } from '../cli/local-pipeline-segmentation-binaries.ts';
import { checkProvider } from './runtime-support-provider.ts';
import {
  checkDirectoryWritable,
  checkFileReadable,
  checkOptionalFileReadable
} from './runtime-support-local.ts';
import { type RuntimeCheckResult } from './runtime-support-types.ts';

export async function runPipelinePreflight(
  options: RunLocalPipelineOptions
): Promise<readonly RuntimeCheckResult[]> {
  const baseChecks = [
    checkFileReadable('spreadsheet', options.spreadsheet),
    checkFileReadable('taxonomy', resolveTaxonomyInput({
      taxonomyPath: options.taxonomy,
      taxonomyPreset: undefined
    })),
    checkFileReadable('prompt-library', options.promptLibrary),
    checkDirectoryWritable('download-dir', options.downloadDir),
    checkDirectoryWritable('archive-root', options.archiveRoot),
    checkYtDlp(options),
    checkFfmpeg(),
    checkFfprobe(),
    checkSceneDetect(),
    checkProvider(options)
  ];

  return Object.freeze(
    await Promise.all(
      options.platformCredentialConfigPath === undefined
        ? baseChecks
        : [
            ...baseChecks,
            checkOptionalFileReadable(
              'platform-credentials',
              options.platformCredentialConfigPath
            )
          ]
    )
  );
}

async function checkYtDlp(options: RunLocalPipelineOptions): Promise<RuntimeCheckResult> {
  if (options.downloaderMode === 'simulated') {
    return Object.freeze({ key: 'yt-dlp', ok: true, message: 'Simulated downloader selected.' });
  }

  try {
    const ok = await validateYtDlpBinary(options.ytDlpBinary);
    return Object.freeze({
      key: 'yt-dlp',
      ok,
      message: ok ? 'yt-dlp is available.' : 'yt-dlp validation failed.'
    });
  } catch (error) {
    return buildFailedCheck('yt-dlp', 'yt-dlp validation failed.', error);
  }
}

async function checkFfmpeg(): Promise<RuntimeCheckResult> {
  try {
    const ok = await validateFfmpegBinary();
    return Object.freeze({
      key: 'ffmpeg',
      ok,
      message: ok ? 'ffmpeg is available.' : 'ffmpeg validation failed.'
    });
  } catch (error) {
    return buildFailedCheck('ffmpeg', 'ffmpeg validation failed.', error);
  }
}

async function checkFfprobe(): Promise<RuntimeCheckResult> {
  try {
    const binaryPath = resolveFfprobeBinaryPath();
    const ok = await validateLocalBinary(binaryPath, ['-version']);
    return Object.freeze({
      key: 'ffprobe',
      ok,
      message: ok ? 'ffprobe is available.' : 'ffprobe validation failed.',
      details: { binaryPath }
    });
  } catch (error) {
    return buildFailedCheck('ffprobe', 'ffprobe validation failed.', error);
  }
}

async function checkSceneDetect(): Promise<RuntimeCheckResult> {
  try {
    const binaryPath = resolveSceneDetectBinaryPath(process.cwd());
    const ok = await validateLocalBinary(binaryPath, ['--version']);
    return Object.freeze({
      key: 'scenedetect',
      ok,
      message: ok ? 'PySceneDetect is available.' : 'PySceneDetect validation failed.',
      details: { binaryPath }
    });
  } catch (error) {
    return buildFailedCheck('scenedetect', 'PySceneDetect validation failed.', error);
  }
}

function buildFailedCheck(
  key: string,
  message: string,
  error: unknown
): RuntimeCheckResult {
  return Object.freeze({
    key,
    ok: false,
    message,
    details: {
      error: error instanceof Error ? error.message : String(error)
    }
  });
}
