import { type readSpreadsheetTaskSheet } from '../../../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { type PipelineRowState, type createStageEmitter } from '../../local-pipeline-helpers.ts';
import { type PipelineControl } from '../../pipeline-control.ts';
import { type RunLocalPipelineFailure } from '../../pipeline-result.ts';
import { type RunLocalPipelineOptions } from '../options.ts';

export interface StageContext {
  readonly input: {
    readonly options: RunLocalPipelineOptions;
    readonly control?: PipelineControl | undefined;
  };
  readonly sheet: ReturnType<typeof readSpreadsheetTaskSheet>;
  readonly emit: ReturnType<typeof createStageEmitter>;
  readonly startedAt: string;
  readonly resultsByRow: Map<number, PipelineRowState>;
  readonly failures: RunLocalPipelineFailure[];
}
