import { ModelProviderRequestError } from '../../../adapters/models/model-provider-error.ts';

export interface ModelFallbackTrace {
  readonly primaryProfileId: string;
  readonly primaryErrorCode: string;
  readonly primaryErrorMessage: string;
  readonly fallbackProfileId?: string | undefined;
  readonly fallbackStatus: 'not-required' | 'not-configured' | 'succeeded' | 'rejected' | 'failed';
  readonly fallbackErrorCode?: string | undefined;
  readonly fallbackErrorMessage?: string | undefined;
}

export class ManualReviewRequiredError extends Error {
  readonly trace: ModelFallbackTrace;
  constructor(trace: ModelFallbackTrace) {
    super('模型内容审核拒绝，需要人工复查。');
    this.name = 'ManualReviewRequiredError';
    this.trace = trace;
  }
}

export class ModelFallbackFailedError extends Error {
  readonly trace: ModelFallbackTrace;
  constructor(trace: ModelFallbackTrace, cause: unknown) {
    super('Gemini 备用模型调用失败。', { cause });
    this.name = 'ModelFallbackFailedError';
    this.trace = trace;
  }
}

export async function runModelRequestWithFallback<T>(input: {
  readonly primaryProfileId: string;
  readonly primary: () => Promise<T>;
  readonly fallbackProfileId?: string | undefined;
  readonly fallback?: (() => Promise<T>) | undefined;
}): Promise<{ readonly value: T; readonly trace?: ModelFallbackTrace | undefined }> {
  try {
    return { value: await input.primary() };
  } catch (error) {
    if (!isContentRejected(error)) throw error;
    const base = primaryTrace(input.primaryProfileId, error, input.fallbackProfileId);
    if (input.fallback === undefined || input.fallbackProfileId === undefined) {
      throw new ManualReviewRequiredError({ ...base, fallbackStatus: 'not-configured' });
    }
    try {
      return {
        value: await input.fallback(),
        trace: { ...base, fallbackStatus: 'succeeded' }
      };
    } catch (fallbackError) {
      const trace = withFallbackError(base, fallbackError);
      if (isContentRejected(fallbackError)) {
        throw new ManualReviewRequiredError({ ...trace, fallbackStatus: 'rejected' });
      }
      throw new ModelFallbackFailedError({ ...trace, fallbackStatus: 'failed' }, fallbackError);
    }
  }
}

function isContentRejected(error: unknown): error is ModelProviderRequestError {
  return error instanceof ModelProviderRequestError && error.category === 'content-rejected';
}

function primaryTrace(
  profileId: string,
  error: ModelProviderRequestError,
  fallbackProfileId: string | undefined
): Omit<ModelFallbackTrace, 'fallbackStatus'> {
  return {
    primaryProfileId: profileId,
    primaryErrorCode: error.providerCode || 'model-content-rejected',
    primaryErrorMessage: error.message,
    ...(fallbackProfileId === undefined ? {} : { fallbackProfileId })
  };
}

function withFallbackError(
  trace: Omit<ModelFallbackTrace, 'fallbackStatus'>,
  error: unknown
): Omit<ModelFallbackTrace, 'fallbackStatus'> {
  return {
    ...trace,
    fallbackErrorCode: error instanceof ModelProviderRequestError
      ? error.providerCode || error.category
      : 'unknown',
    fallbackErrorMessage: error instanceof Error ? error.message : String(error)
  };
}
