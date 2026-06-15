import path from 'node:path';
import { access } from 'node:fs/promises';

import { readSpreadsheetTaskSheet } from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { buildContentTopicArchiveRoot } from '../../packages/features/tagging/domain/index.ts';
import { type SpreadsheetAppendRow } from '../../packages/features/spreadsheet-tasks/domain/index.ts';
import { type RunLocalPipelineOptions, type LocalPipelineStage } from './pipeline/options.ts';
import { type PipelineControl, waitForPipelineCheckpoint } from './pipeline-control.ts';
import {
  createStageEmitter,
  requireValue,
  type PipelineRowState
} from './local-pipeline-helpers.ts';
import { finalizePipelineResult } from './local-pipeline-after-edit.ts';
import { type AutoSegmentationDependencies } from './local-pipeline-segmentation.ts';
import { ORDERED_STAGES } from './pipeline/stage-order.ts';
import { type RunLocalPipelineFailure, type RunLocalPipelineResult } from './pipeline-result.ts';
import { type CliStageEvent } from './status-reporter.ts';
import { runArchiveStage } from './pipeline/stages/archive.ts';
import { runCompressStage } from './pipeline/stages/compress.ts';
import { runDownloadStage } from './pipeline/stages/download.ts';
import { runSegmentStage } from './pipeline/stages/segment.ts';
import { runTagStage } from './pipeline/stages/tag.ts';
import { writeStageResults } from './pipeline/writeback.ts';

export type { LocalPipelineStage } from './pipeline/options.ts';

export async function runLocalPipelineStageCommand(input: {
  readonly options: RunLocalPipelineOptions;
  readonly report: (event: CliStageEvent) => void;
  readonly segmentationDependencies?: AutoSegmentationDependencies;
  readonly control?: PipelineControl;
}): Promise<RunLocalPipelineResult> {
  const pipelineStage = input.options.pipelineStage ?? 'all';

  if (pipelineStage === 'all') {
    let result: RunLocalPipelineResult | undefined;
    let stageOptions: RunLocalPipelineOptions = input.options;

    for (const stage of ORDERED_STAGES) {
      result = await runSingleStage({
        ...input,
        options: { ...stageOptions, pipelineStage: stage }
      });

      if (stage === 'segment') {
        const postEditSpreadsheet = path.join(
          stageOptions.downloadDir,
          stageOptions.afterEditDirectoryName ?? 'AfterEdit',
          'AfterEdit_归档记录表.xlsx'
        );

        try {
          await access(postEditSpreadsheet);
          stageOptions = { ...stageOptions, spreadsheet: postEditSpreadsheet };
        } catch {
          // Continue with the original spreadsheet when segmentation produced no AfterEdit sheet.
        }
      }
    }
    return requireValue(result, 'V0.4 staged pipeline did not run any stage.');
  }

  return runSingleStage(input as {
    readonly options: RunLocalPipelineOptions & { readonly pipelineStage: LocalPipelineStage };
    readonly report: (event: CliStageEvent) => void;
    readonly segmentationDependencies?: AutoSegmentationDependencies;
    readonly control?: PipelineControl;
  });
}

async function runSingleStage(input: {
  readonly options: RunLocalPipelineOptions & { readonly pipelineStage: LocalPipelineStage };
  readonly report: (event: CliStageEvent) => void;
  readonly segmentationDependencies?: AutoSegmentationDependencies;
  readonly control?: PipelineControl;
}): Promise<RunLocalPipelineResult> {
  const startedAt = input.options.timestamp ?? new Date().toISOString();
  const workflowSessionId =
    input.options.workflowSessionId ?? `workflow:${Date.now()}`;
  const emit = createStageEmitter(input.report);
  const resultsByRow = new Map<number, PipelineRowState>();
  const failures: RunLocalPipelineFailure[] = [];
  const appendRows: SpreadsheetAppendRow[] = [];

  await waitForPipelineCheckpoint(input.control);
  emit('spreadsheet', 'running', `Reading spreadsheet ${input.options.spreadsheet}`);
  const sheet = readSpreadsheetTaskSheet({
    filePath: input.options.spreadsheet,
    urlColumnIndex: 0
  });
  emit('spreadsheet', 'succeeded', `Loaded ${sheet.rows.length} task rows`);

  switch (input.options.pipelineStage) {
    case 'download':
      await runDownloadStage({ input, sheet, emit, startedAt, workflowSessionId, resultsByRow, failures });
      break;
    case 'segment':
      await runSegmentStage({
        input,
        sheet,
        emit,
        startedAt,
        resultsByRow,
        failures,
        appendRows,
        segmentationDependencies: input.segmentationDependencies
      });
      break;
    case 'compress':
      await runCompressStage({ input, sheet, emit, startedAt, resultsByRow, failures });
      break;
    case 'tag':
      await runTagStage({ input, sheet, emit, startedAt, resultsByRow, failures });
      break;
    case 'archive':
      await runArchiveStage({ input, sheet, emit, startedAt, resultsByRow, failures });
      break;
  }

  emit('writeback', 'running', 'Writing stage results back to spreadsheets');
  await waitForPipelineCheckpoint(input.control);
  await writeStageResults({
    options: input.options,
    results: [...resultsByRow.values()],
    appendRows,
    startedAt,
    archiveLibraryRoot: buildContentTopicArchiveRoot(input.options.archiveRoot)
  });
  emit('writeback', 'succeeded', 'Spreadsheet writeback completed');

  return finalizePipelineResult({
    workflowSessionId,
    startedAt,
    totalRows: sheet.rows.length,
    failures,
    resultsByRow
  });
}
