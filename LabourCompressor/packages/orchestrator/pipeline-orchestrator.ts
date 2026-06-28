export type PipelineStageId =
  | 'download'
  | 'segment'
  | 'compress'
  | 'tag'
  | 'archive';

export type PipelineExecutionPlan =
  | Readonly<{ readonly mode: 'all' }>
  | Readonly<{ readonly mode: 'resume-cache' }>
  | Readonly<{ readonly mode: 'single'; readonly stageId: PipelineStageId }>;

export interface PipelineStagePort<TContext, TResult = unknown> {
  readonly id: PipelineStageId;
  execute(context: TContext): Promise<TResult>;
}

export interface CompletedPipelineStage<TResult> {
  readonly stageId: PipelineStageId;
  readonly result: TResult;
}

export interface PipelineExecutionResult<TContext, TResult> {
  readonly context: TContext;
  readonly completedStageIds: readonly PipelineStageId[];
  readonly stageResults: readonly CompletedPipelineStage<TResult>[];
}

const ALL_STAGES: readonly PipelineStageId[] = Object.freeze([
  'download', 'segment', 'compress', 'tag', 'archive'
]);
const RESUME_CACHE_STAGES: readonly PipelineStageId[] = Object.freeze([
  'compress', 'tag', 'archive'
]);

export function resolvePipelineStageIds(
  plan: PipelineExecutionPlan
): readonly PipelineStageId[] {
  if (plan.mode === 'all') return ALL_STAGES;
  if (plan.mode === 'resume-cache') return RESUME_CACHE_STAGES;
  return Object.freeze([plan.stageId]);
}

export async function executePipelinePlan<TContext, TResult>(input: {
  readonly plan: PipelineExecutionPlan;
  readonly stages: readonly PipelineStagePort<TContext, TResult>[];
  readonly context: TContext;
  readonly checkpoint?: ((stageId: PipelineStageId, context: TContext) => void | Promise<void>) | undefined;
  readonly transition?: ((
    context: TContext,
    completed: CompletedPipelineStage<TResult>
  ) => TContext | Promise<TContext>) | undefined;
}): Promise<PipelineExecutionResult<TContext, TResult>> {
  const ports = indexStagePorts(input.stages);
  const results: CompletedPipelineStage<TResult>[] = [];
  let context = input.context;

  for (const stageId of resolvePipelineStageIds(input.plan)) {
    const port = ports.get(stageId);
    if (port === undefined) throw new Error(`Missing pipeline stage port: ${stageId}`);
    await input.checkpoint?.(stageId, context);
    const completed = Object.freeze({ stageId, result: await port.execute(context) });
    results.push(completed);
    context = await input.transition?.(context, completed) ?? context;
  }

  return Object.freeze({
    context,
    completedStageIds: Object.freeze(results.map(({ stageId }) => stageId)),
    stageResults: Object.freeze(results)
  });
}

function indexStagePorts<TContext, TResult>(
  stages: readonly PipelineStagePort<TContext, TResult>[]
): ReadonlyMap<PipelineStageId, PipelineStagePort<TContext, TResult>> {
  const ports = new Map<PipelineStageId, PipelineStagePort<TContext, TResult>>();
  for (const stage of stages) {
    if (ports.has(stage.id)) throw new Error(`Duplicate pipeline stage port: ${stage.id}`);
    ports.set(stage.id, stage);
  }
  return ports;
}
