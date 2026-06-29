import { ArchivePrimaryTagError } from '../../packages/features/tagging/domain/index.ts';

export function classifyTaggingError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Tagging failed.';
  if (error instanceof ArchivePrimaryTagError) {
    return error.code;
  }
  return /缺少内容题材/iu.test(message)
    ? 'missing-content-topic'
    : 'tagging-failed';
}

export function isVideoTooShortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /video file is too short|video modality input does not meet the requirements/iu.test(message);
}
