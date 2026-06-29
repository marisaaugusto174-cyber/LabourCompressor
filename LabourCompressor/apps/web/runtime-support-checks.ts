import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { inspectYtDlpBinary } from '../../packages/adapters/downloaders/ytdlp-downloader.ts';
import { validateFfmpegBinary } from '../../packages/adapters/media/ffmpeg-merge-operator.ts';
import { readSpreadsheetTaskSheet } from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { detectSupportedPlatformUrl } from '../../packages/features/download/domain/platform-detection.ts';
import { parseTaxonomyMarkdown } from '../../packages/features/taxonomy/domain/index.ts';
import {
  resolveTaxonomyInput,
  resolveTaxonomyPresetDefinition
} from '../cli/taxonomy-presets.ts';
import { type RunLocalPipelineOptions } from '../cli/local-pipeline-command.ts';
import { checkProvider } from './runtime-support-provider.ts';
import {
  checkDirectoryWritable,
  checkFileReadable,
  checkOptionalFileReadable
} from './runtime-support-local.ts';
import { type RuntimeCheckResult } from './runtime-support-types.ts';

export async function runPipelinePreflight(
  options: RunLocalPipelineOptions,
  preflightOptions: { readonly userSheetWorkspace?: boolean } = {}
): Promise<readonly RuntimeCheckResult[]> {
  const taxonomyPreset = options.taxonomyPreset?.trim();
  const taxonomyParseMode = taxonomyPreset === undefined || taxonomyPreset.length === 0
    ? 'bullet-root'
    : resolveTaxonomyPresetDefinition(taxonomyPreset).taxonomyParseMode;
  const baseChecks = [
    checkFileReadable('spreadsheet', options.spreadsheet),
    checkTaxonomyReadableAndParsable(resolveTaxonomyInput({
      taxonomyPath: options.taxonomy,
      taxonomyPreset: undefined
    }), taxonomyParseMode),
    checkFileReadable('prompt-library', options.promptLibrary),
    preflightOptions.userSheetWorkspace === true
      ? checkDirectoryWritable('user-sheet-directory', path.dirname(options.spreadsheet))
      : checkDirectoryWritable('download-dir', options.downloadDir),
    checkDirectoryWritable('archive-root', options.archiveRoot),
    checkYtDlp(options),
    checkFfmpeg(),
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

export async function checkTaxonomyReadableAndParsable(
  taxonomyPath: string,
  rootMode: 'heading' | 'bullet-root'
): Promise<RuntimeCheckResult> {
  try {
    const markdown = await readFile(taxonomyPath, 'utf8');
    const taxonomyTree = parseTaxonomyMarkdown(markdown, { rootMode });
    if (taxonomyTree.rootNodeIds.length === 0) {
      throw new Error('No parseable taxonomy roots found.');
    }
    return Object.freeze({
      key: 'taxonomy',
      ok: true,
      message: 'Taxonomy file is readable and parseable.'
    });
  } catch (error) {
    return buildFailedCheck('taxonomy', 'Taxonomy file validation failed.', error);
  }
}

async function checkYtDlp(options: RunLocalPipelineOptions): Promise<RuntimeCheckResult> {
  if (options.downloaderMode === 'simulated') {
    return Object.freeze({ key: 'yt-dlp', ok: true, message: 'Simulated downloader selected.' });
  }

  try {
    const inspection = await inspectYtDlpBinary(options.ytDlpBinary);
    const staleYtDlpIsNonBlocking = inspection.isStale === true && isDouyinOnlySpreadsheet(options);
    const ok = inspection.available && (inspection.isStale !== true || staleYtDlpIsNonBlocking);
    return Object.freeze({
      key: 'yt-dlp',
      ok,
      message: buildYtDlpPreflightMessage(inspection, { staleYtDlpIsNonBlocking }),
      details: {
        version: inspection.version ?? null,
        isStale: inspection.isStale ?? null,
        staleYtDlpIsNonBlocking
      }
    });
  } catch (error) {
    return buildFailedCheck('yt-dlp', 'yt-dlp validation failed.', error);
  }
}

function buildYtDlpPreflightMessage(input: {
  readonly available: boolean;
  readonly version?: string | undefined;
  readonly isStale?: boolean | undefined;
}, options: {
  readonly staleYtDlpIsNonBlocking?: boolean | undefined;
} = {}): string {
  if (!input.available) {
    return 'yt-dlp validation failed.';
  }

  if (input.isStale === true) {
    if (options.staleYtDlpIsNonBlocking === true) {
      return `yt-dlp ${input.version ?? ''} is older than 90 days; Douyin SSR download will run first, but update yt-dlp for fallback reliability.`;
    }

    return `yt-dlp ${input.version ?? ''} is older than 90 days; update yt-dlp before downloading Douyin videos.`;
  }

  return input.version === undefined || input.version.length === 0
    ? 'yt-dlp is available.'
    : `yt-dlp ${input.version} is available.`;
}

function isDouyinOnlySpreadsheet(options: RunLocalPipelineOptions): boolean {
  try {
    const sheet = readSpreadsheetTaskSheet({
      filePath: options.spreadsheet,
      urlColumnIndex: 0
    });
    const urlRows = sheet.rows.filter((row) => row.sourceKind === 'url');

    return urlRows.length > 0 && urlRows.every((row) => {
      try {
        return detectSupportedPlatformUrl(row.url).platform === 'douyin';
      } catch {
        return false;
      }
    });
  } catch {
    return false;
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
