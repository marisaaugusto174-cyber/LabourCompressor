import path from 'node:path';

import { type SpreadsheetTaskRow } from '../../../packages/features/spreadsheet-tasks/domain/index.ts';
import {
  buildFailure,
  createFailureRowState,
  type PipelineRowState
} from '../local-pipeline-helpers.ts';
import { type RunLocalPipelineFailure } from '../pipeline-result.ts';
import { type RunLocalPipelineOptions } from './options.ts';
import { resolveRowFilePath, resolveSourceFilePath } from './row-state.ts';

export function pushStageFailure(input: {
  readonly context: {
    readonly options: RunLocalPipelineOptions;
    readonly startedAt: string;
    readonly failures: RunLocalPipelineFailure[];
    readonly resultsByRow: Map<number, PipelineRowState>;
  };
  readonly row: SpreadsheetTaskRow;
  readonly phase: string;
  readonly archiveState: string;
  readonly errorCode: string;
  readonly error: unknown;
}): void {
  const failure = buildFailure({
    row: input.row,
    phase: input.phase,
    errorCode: input.errorCode,
    errorMessage: input.error instanceof Error ? input.error.message : `${input.phase} failed.`,
    timestamp: input.context.startedAt
  });
  const spreadsheetDirectory = path.dirname(input.context.options.spreadsheet);

  input.context.failures.push(failure);
  input.context.resultsByRow.set(input.row.rowNumber, {
    ...createFailureRowState({
      row: input.row,
      archiveState: input.archiveState,
      failure
    }),
    sourceFilePath: resolveSourceFilePath(input.row, spreadsheetDirectory),
    currentFilePath: resolveRowFilePath(input.row, spreadsheetDirectory),
    compressedCachePath: input.row.values['压缩缓存路径']?.trim() || undefined,
    errorMessage: failure.errorMessage
  });
}
