import { type LocalPipelineStage } from './options.ts';

export const ORDERED_STAGES: readonly LocalPipelineStage[] = Object.freeze([
  'download',
  'segment',
  'compress',
  'tag',
  'archive'
]);
