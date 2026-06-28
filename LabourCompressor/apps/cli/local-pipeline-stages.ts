import path from 'node:path';
import { access } from 'node:fs/promises';

import { readSpreadsheetTaskSheet } from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { buildContentTopicArchiveRoot } from '../../packages/features/tagging/domain/index.ts';
import { type SpreadsheetAppendRow } from '../../packages/features/spreadsheet-tasks/domain/index.ts';
import {
  executePipelinePlan,
  type PipelineExecutionPlan,
  type PipelineStagePort
} from '../../packages/orchestrator/index.ts';
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
  readonly segmentationDependencies?: AutoSegmentationDependencies | undefined;
  readonly control?: PipelineControl | undefined;
}): Promise<RunLocalPipelineResult> {
  const pipelineStage = input.options.pipelineStage ?? 'all';
  const execution = await executePipelinePlan({
    plan: toExecutionPlan(pipelineStage),
    stages: createStagePorts(input),
    context: { options: input.options },
    checkpoint: () => waitForPipelineCheckpoint(input.control),
    transition: updateStageContext
  });
  return requireValue(
    execution.stageResults.at(-1)?.result,
    'Pipeline execution plan did not run any stage.'
  );
}

interface CliStageContext {
  readonly options: RunLocalPipelineOptions;
}

function createStagePorts(input: {
  readonly options: RunLocalPipelineOptions;
  readonly report: (event: CliStageEvent) => void;
  readonly segmentationDependencies?: AutoSegmentationDependencies | undefined;
  readonly control?: PipelineControl | undefined;
}): readonly PipelineStagePort<CliStageContext, RunLocalPipelineResult>[] {
  return ORDERED_STAGES.map((stage) => ({
    id: stage,
    execute: (context) => runSingleStage({
      ...input,
      options: { ...context.options, pipelineStage: stage }
    })
  }));
}

function toExecutionPlan(stage: RunLocalPipelineOptions['pipelineStage']): PipelineExecutionPlan {
  if (stage === undefined || stage === 'all') return { mode: 'all' };
  if (stage === 'resume-cache') return { mode: 'resume-cache' };
  return { mode: 'single', stageId: stage };
}

async function updateStageContext(
  context: CliStageContext,
  completed: { readonly stageId: LocalPipelineStage }
): Promise<CliStageContext> {
  if (completed.stageId !== 'segment') return context;
  const postEditSpreadsheet = path.join(
    context.options.downloadDir,
    context.options.afterEditDirectoryName ?? 'AfterEdit',
    'AfterEdit_归档记录表.xlsx'
  );
  try {
    await access(postEditSpreadsheet);
    return { options: { ...context.options, spreadsheet: postEditSpreadsheet } };
  } catch {
    return context;
  }
}

async function runSingleStage(input: {
  readonly options: RunLocalPipelineOptions & { readonly pipelineStage: LocalPipelineStage };
  readonly report: (event: CliStageEvent) => void;
  readonly segmentationDependencies?: AutoSegmentationDependencies | undefined;
  readonly control?: PipelineControl | undefined;
}): Promise<RunLocalPipelineResult> {
  const startedAt = input.options.timestamp ?? new Date().toISOString();
  const workflowSessionId =
    input.options.workflowSessionId ?? `workflow:${Date.now()}`;
  const emit = createStageEmitter(input.report);
  const resultsByRow = new Map<number, PipelineRowState>();
  const failures: RunLocalPipelineFailure[] = [];
  const appendRows: SpreadsheetAppendRow[] = [];

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
