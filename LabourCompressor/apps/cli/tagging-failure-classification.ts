import {
  ArchivePrimaryTagError,
  type ArchivePrimaryTagErrorCode
} from '../../packages/features/tagging/domain/index.ts';
import { ModelFallbackFailedError } from '../../packages/features/tagging/domain/index.ts';
import { ModelProviderRequestError } from '../../packages/adapters/models/model-provider-error.ts';

const ARCHIVE_PRIMARY_REVIEW_STATES: Readonly<Record<ArchivePrimaryTagErrorCode, string>> = Object.freeze({
  'archive-primary-tag-missing': '待复核：核心动作主动作缺失',
  'archive-primary-tag-conflict': '待复核：存在多个核心动作主动作',
  'archive-primary-tag-role-invalid': '待复核：核心动作角色不合法',
  'archive-primary-tag-path-invalid': '待复核：核心动作路径不合法',
  'archive-primary-tag-review-required': '待复核：核心动作无法确定'
});

export interface TaggingFailurePresentation {
  readonly errorCode: string;
  readonly archiveState: string;
}

export function resolveTaggingFailurePresentation(error: unknown): TaggingFailurePresentation {
  const errorCode = classifyTaggingError(error);
  const archiveState = error instanceof ArchivePrimaryTagError
    ? ARCHIVE_PRIMARY_REVIEW_STATES[error.code]
    : errorCode === 'missing-content-topic'
      ? '打标失败：缺少内容题材'
      : '打标失败';
  return Object.freeze({ errorCode, archiveState });
}

export function classifyTaggingError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Tagging failed.';
  if (error instanceof ArchivePrimaryTagError) {
    return error.code;
  }
  if (error instanceof ModelFallbackFailedError) return 'model-fallback-failed';
  if (error instanceof ModelProviderRequestError && error.category === 'content-rejected') {
    return 'model-content-rejected';
  }
  return /缺少内容题材/iu.test(message)
    ? 'missing-content-topic'
    : 'tagging-failed';
}

export function isVideoTooShortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /video file is too short|video modality input does not meet the requirements/iu.test(message);
}
