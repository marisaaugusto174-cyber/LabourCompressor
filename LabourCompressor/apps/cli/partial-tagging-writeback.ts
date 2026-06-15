import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  readSpreadsheetTaskSheet
} from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import {
  buildContentTopicArchiveRoot,
  buildStructuredLevelValues,
  parsePromptLibraryMarkdown,
  parseModelTaggingResponse,
  runAutomaticTagging,
  selectUniqueArchivePath
} from '../../packages/features/tagging/domain/index.ts';
import {
  parseTaxonomyMarkdown
} from '../../packages/features/taxonomy/domain/index.ts';
import {
  type SpreadsheetTaskRow
} from '../../packages/features/spreadsheet-tasks/domain/index.ts';
import {
  type RunLocalPipelineOptions,
  loadTaxonomyRuntime
} from './local-pipeline-command.ts';
import {
  type PipelineRowState,
  writePipelineResults
} from './local-pipeline-helpers.ts';

export interface PartialTaggingWritebackResult {
  readonly spreadsheet: string;
  readonly totalRows: number;
  readonly matchedJsonFiles: number;
  readonly updatedRows: number;
  readonly skippedRows: number;
  readonly failedRows: number;
  readonly failures: readonly {
    readonly rowNumber: number;
    readonly fileName: string;
    readonly reason: string;
  }[];
}

export async function writePartialTaggingResultsFromSidecars(input: {
  readonly options: RunLocalPipelineOptions;
  readonly selectedContentTopicByFileName?: Readonly<Record<string, string>>;
  readonly startedAt?: string;
}): Promise<PartialTaggingWritebackResult> {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const sheet = readSpreadsheetTaskSheet({
    filePath: input.options.spreadsheet,
    urlColumnIndex: 0
  });
  const taxonomyRuntime = await loadTaxonomyRuntime(input.options);
  const taxonomyTree = parseTaxonomyMarkdown(
    taxonomyRuntime.taxonomyMarkdown,
    { rootMode: taxonomyRuntime.preset.taxonomyParseMode }
  );
  const promptLibrary = parsePromptLibraryMarkdown(
    await readFile(input.options.promptLibrary, 'utf8')
  );
  const archiveDimension = taxonomyRuntime.preset.archiveDimension;
  const spreadsheetDirectory = path.dirname(input.options.spreadsheet);
  const results: PipelineRowState[] = [];
  const failures: Array<{ rowNumber: number; fileName: string; reason: string }> = [];
  let matchedJsonFiles = 0;

  for (const row of sheet.rows) {
    const mediaFilePath = resolveRowFilePath(row, spreadsheetDirectory);
    const fileName = path.basename(mediaFilePath ?? row.values['文件名'] ?? row.url);

    if (mediaFilePath === undefined) {
      continue;
    }

    const jsonPath = replaceExtension(mediaFilePath, '.json');

    try {
      await access(jsonPath);
    } catch {
      continue;
    }

    matchedJsonFiles += 1;

    try {
      const payload = JSON.parse(await readFile(jsonPath, 'utf8')) as unknown;
      const candidatePaths = mergeFallbackContentTopicPath({
        candidatePaths: extractCandidatePathsFromSidecar(payload),
        selectedContentTopicPath: input.selectedContentTopicByFileName?.[fileName]
      });
      const taggingResult = runAutomaticTagging({
        taskId: row.taskId,
        mediaAssetId: `${row.taskId}::asset`,
        taxonomyVersionId: taxonomyRuntime.preset.taxonomyVersionId,
        fingerprintId: `fingerprint:${row.taskId}`,
        candidateSetId: `candidate:partial:${row.rowNumber}`,
        assignmentId: `assignment:partial:${row.rowNumber}`,
        generatedAt: startedAt,
        assignedAt: startedAt,
        candidatePaths,
        taxonomyTree,
        promptLibrary
      });
      const archiveDecision = selectUniqueArchivePath({
        acceptedPaths: taggingResult.acceptedPaths,
        archiveDimension
      });

      if (archiveDecision.selectedPath === undefined) {
        failures.push({
          rowNumber: row.rowNumber,
          fileName,
          reason: `缺少${archiveDimension}`
        });
        continue;
      }

      const archivePath = [
        '视频数据归档库',
        ...archiveDecision.selectedPath.split(' > ')
      ].join('/');

      results.push({
        rowNumber: row.rowNumber,
        url: row.url,
        collector: row.values['采集人'] ?? '',
        archiveState: '待归档',
        sourceFilePath: resolveSourceFilePath(row, spreadsheetDirectory) ?? mediaFilePath,
        currentFilePath: mediaFilePath,
        compressedCachePath: row.values['压缩缓存路径']?.trim() || undefined,
        sourceRowNumber: parseOptionalNumber(row.values['源行号']),
        segmentIndex: parseOptionalNumber(row.values['片段序号']),
        levelValues: buildStructuredLevelValues(taggingResult.acceptedPaths, archiveDimension),
        archivePath,
        archiveFileName: '',
        taggingJsonFileName: path.basename(jsonPath),
        taggingJsonArchivePath: '',
        taggingJsonPayload: payload,
        acceptedPaths: taggingResult.acceptedPaths,
        selectedContentTopicPath: archiveDecision.selectedPath
      });
    } catch (error) {
      failures.push({
        rowNumber: row.rowNumber,
        fileName,
        reason: error instanceof Error ? error.message : 'JSON 回表解析失败'
      });
    }
  }

  if (results.length > 0) {
    await writePipelineResults({
      options: input.options,
      headers: sheet.headers,
      archiveLibraryRoot: buildContentTopicArchiveRoot(input.options.archiveRoot),
      results,
      startedAt,
      userWritebackRowNumbers: sheet.rows.map((row) => row.rowNumber)
    });
  }

  return Object.freeze({
    spreadsheet: input.options.spreadsheet,
    totalRows: sheet.rows.length,
    matchedJsonFiles,
    updatedRows: results.length,
    skippedRows: sheet.rows.length - matchedJsonFiles,
    failedRows: failures.length,
    failures: Object.freeze(failures)
  });
}

function extractCandidatePathsFromSidecar(payload: unknown): readonly string[] {
  if (isRecord(payload) && Array.isArray(payload.accepted_paths)) {
    return Object.freeze(
      payload.accepted_paths
        .map((value) => String(value).trim())
        .filter(Boolean)
    );
  }

  return parseModelTaggingResponse(JSON.stringify(payload)).candidatePaths;
}

function mergeFallbackContentTopicPath(input: {
  readonly candidatePaths: readonly string[];
  readonly selectedContentTopicPath?: string;
}): readonly string[] {
  const normalizedFallback = input.selectedContentTopicPath?.trim() ?? '';

  if (normalizedFallback.length === 0 || input.candidatePaths.includes(normalizedFallback)) {
    return input.candidatePaths;
  }

  return Object.freeze([...input.candidatePaths, normalizedFallback]);
}

function resolveRowFilePath(
  row: SpreadsheetTaskRow,
  baseDirectory: string
): string | undefined {
  const currentFilePath = row.values['当前文件路径']?.trim();
  if (currentFilePath !== undefined && currentFilePath.length > 0) {
    return currentFilePath;
  }

  const sourceFilePath = row.values['源文件路径']?.trim();
  if (sourceFilePath !== undefined && sourceFilePath.length > 0 && path.isAbsolute(sourceFilePath)) {
    return sourceFilePath;
  }

  if (row.sourceKind === 'local-file' && row.sourceFileName !== undefined && path.isAbsolute(row.sourceFileName)) {
    return row.sourceFileName;
  }

  const relativePath =
    row.sourceFileRelativePath ??
    normalizeOptionalPath(row.values['相对路径']) ??
    (row.sourceKind === 'local-file' ? normalizeOptionalPath(row.sourceFileName) : undefined) ??
    normalizeOptionalPath(row.values['文件名']);

  return relativePath === undefined
    ? undefined
    : path.resolve(baseDirectory, relativePath);
}

function resolveSourceFilePath(
  row: SpreadsheetTaskRow,
  baseDirectory: string
): string | undefined {
  const sourceFilePath = row.values['源文件路径']?.trim();
  if (sourceFilePath !== undefined && sourceFilePath.length > 0) {
    return sourceFilePath;
  }

  return resolveRowFilePath(row, baseDirectory);
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? undefined : normalized;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
