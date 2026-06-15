import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { type DownloadedMediaAsset } from '../../../../packages/features/download/domain/index.ts';
import {
  getEnabledProviderConfig,
  getVideoModelProfile,
  loadLocalProviderConfigFile,
  parsePromptLibraryMarkdown
} from '../../../../packages/features/tagging/domain/index.ts';
import { parseTaxonomyMarkdown } from '../../../../packages/features/taxonomy/domain/index.ts';
import { loadTaxonomyRuntime } from '../../local-pipeline-command.ts';
import {
  loadCandidateFixtures,
  requireValue
} from '../../local-pipeline-helpers.ts';
import { runTaggingBatch } from '../../local-pipeline-tagging.ts';
import { waitForPipelineCheckpoint } from '../../pipeline-control.ts';
import { DEFAULT_PROVIDER_CONFIG_PATH } from '../../project-paths.ts';
import {
  createAssetFromRow,
  createSkippedRowState,
  resolveRowFilePath,
  resolveSourceFilePath,
  shouldProcessMediaRow
} from '../row-state.ts';
import { type StageContext } from './stage-context.ts';

export async function runTagStage(input: StageContext): Promise<void> {
  await waitForPipelineCheckpoint(input.input.control);
  const rows = input.sheet.rows.filter((row) => shouldProcessMediaRow(row));
  const spreadsheetDirectory = path.dirname(input.input.options.spreadsheet);
  const assets = rows
    .map((row) => {
      const filePath = resolveRowFilePath(row, spreadsheetDirectory);
      return filePath === undefined ? undefined : createAssetFromRow({ row, filePath, startedAt: input.startedAt });
    })
    .filter((asset): asset is DownloadedMediaAsset => asset !== undefined);

  for (const row of rows) {
    if (resolveRowFilePath(row, spreadsheetDirectory) === undefined) {
      input.resultsByRow.set(row.rowNumber, createSkippedRowState({
        row,
        archiveState: '等待下载',
        errorMessage: '缺少当前文件路径'
      }));
    }
  }
  if (assets.length === 0) {
    input.emit('tagging', 'succeeded', 'No rows are ready for tagging');
    return;
  }

  input.emit('taxonomy', 'running', 'Parsing taxonomy and prompt library');
  const taxonomyRuntime = await loadTaxonomyRuntime(input.input.options);
  const taxonomyTree = parseTaxonomyMarkdown(
    taxonomyRuntime.taxonomyMarkdown,
    { rootMode: taxonomyRuntime.preset.taxonomyParseMode }
  );
  const promptLibrary = parsePromptLibraryMarkdown(await readFile(input.input.options.promptLibrary, 'utf8'));
  const candidateFixtures = await loadCandidateFixtures(input.input.options);
  const selectedVideoModelProfile =
    input.input.options.taggingMode === 'qwen'
      ? getVideoModelProfile(input.input.options.selectedModelProfileId)
      : undefined;
  const realModelProviderConfig =
    input.input.options.taggingMode === 'qwen'
      ? getEnabledProviderConfig(
          await loadLocalProviderConfigFile(
            input.input.options.providerConfigPath ??
              DEFAULT_PROVIDER_CONFIG_PATH
          ),
          requireValue(selectedVideoModelProfile, 'Selected video model profile is required.').provider
        )
      : undefined;
  input.emit('taxonomy', 'succeeded', 'Taxonomy and prompt library loaded');

  await runTaggingBatch({
    assets,
    rowByTaskId: new Map(input.sheet.rows.map((row) => [row.taskId, row] as const)),
    resultsByRow: input.resultsByRow,
    failures: input.failures,
    startedAt: input.startedAt,
    taggingMode: input.input.options.taggingMode,
    selectedModelProfileId: input.input.options.selectedModelProfileId,
    selectedVideoModelProfile,
    realModelProviderConfig,
    candidateFixtures,
    taxonomyTree,
    promptLibrary,
    taxonomyBaseMarkdown: taxonomyRuntime.taxonomyMarkdown,
    taxonomyVersionId: taxonomyRuntime.preset.taxonomyVersionId,
    archiveDimension: taxonomyRuntime.preset.archiveDimension,
    modelResponseShape: taxonomyRuntime.preset.modelResponseShape,
    emit: input.emit
  });

  for (const row of rows) {
    const state = input.resultsByRow.get(row.rowNumber);
    const currentFilePath = resolveRowFilePath(row, spreadsheetDirectory);
    if (state !== undefined) {
      input.resultsByRow.set(row.rowNumber, {
        ...state,
        sourceFilePath: resolveSourceFilePath(row, spreadsheetDirectory) ?? currentFilePath,
        currentFilePath,
        compressedCachePath: row.values['压缩缓存路径']?.trim() || undefined
      });
    }
  }
  input.emit('tagging', 'succeeded', 'Tagging stage completed');
}
