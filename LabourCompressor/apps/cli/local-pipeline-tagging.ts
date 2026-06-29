import { processTaggingItem } from './local-pipeline-tagging-item.ts';
import {
  type PipelineItemTimings,
  type RunTaggingBatchInput
} from './local-pipeline-tagging-contracts.ts';

export {
  resolveRequiredArchivePath,
  resolveRequiredContentTopic,
  type RequiredArchivePathResolution,
  type RequiredContentTopicResolution
} from './archive-path-resolution.ts';
export { isRateLimitError, withRateLimitRetry } from './tagging-rate-limit.ts';
export { type PipelineItemTimings, type RunTaggingBatchInput };

export async function runTaggingBatch(input: RunTaggingBatchInput): Promise<void> {
  let completedCount = 0;
  const concurrency = input.taggingMode === 'qwen'
    ? resolveTaggingConcurrency({
        explicitConcurrency: input.taggingConcurrency,
        profileDefaultConcurrency: input.selectedVideoModelProfile?.defaultTaggingConcurrency
      })
    : 1;

  await runConcurrentInOrder(input.assets, concurrency, async (asset, index) => {
    await processTaggingItem({
      batch: input,
      asset,
      index,
      completedCount: () => {
        completedCount += 1;
        return completedCount;
      }
    });
  });
}

export function resolveTaggingConcurrency(input: {
  readonly explicitConcurrency?: number | undefined;
  readonly profileDefaultConcurrency?: number | undefined;
  readonly itemCount?: number | undefined;
}): number {
  const rawConcurrency = input.explicitConcurrency ?? input.profileDefaultConcurrency ?? 1;
  const clamped = Math.min(64, Math.max(1, Math.trunc(rawConcurrency)));
  return input.itemCount === undefined
    ? clamped
    : Math.min(clamped, Math.max(1, input.itemCount));
}

export async function runConcurrentInOrder<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<readonly R[]> {
  const safeConcurrency = Math.max(1, Math.min(Math.floor(concurrency), items.length || 1));
  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;

  await Promise.all(Array.from({ length: safeConcurrency }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  }));
  return Object.freeze(results);
}

export function zeroTimings(): PipelineItemTimings {
  return Object.freeze({
    preprocessMs: 0,
    modelRequestMs: 0,
    tagNormalizeMs: 0,
    archiveMs: 0,
    totalMs: 0
  });
}
