export type ModelFailureCategory =
  | 'content-rejected'
  | 'rate-limited'
  | 'authentication'
  | 'transient'
  | 'unknown';

export class ModelProviderRequestError extends Error {
  readonly provider: 'qwen' | 'google';
  readonly statusCode: number;
  readonly providerCode: string;
  readonly category: ModelFailureCategory;

  constructor(input: {
    readonly provider: 'qwen' | 'google';
    readonly statusCode: number;
    readonly providerCode?: string | undefined;
    readonly message: string;
  }) {
    super(input.message);
    this.name = 'ModelProviderRequestError';
    this.provider = input.provider;
    this.statusCode = input.statusCode;
    this.providerCode = input.providerCode ?? '';
    this.category = classifyModelFailure(input);
  }
}

function classifyModelFailure(input: {
  readonly statusCode: number;
  readonly providerCode?: string | undefined;
  readonly message: string;
}): ModelFailureCategory {
  const text = `${input.providerCode ?? ''} ${input.message}`;
  if (/DataInspectionFailed|SAFETY|PROHIBITED_CONTENT|inappropriate content|blocked.*safety/iu.test(text)) {
    return 'content-rejected';
  }
  if (input.statusCode === 429 || /RESOURCE_EXHAUSTED|rate.?limit/iu.test(text)) return 'rate-limited';
  if ([401, 403].includes(input.statusCode) || /UNAUTHENTICATED|PERMISSION_DENIED/iu.test(text)) {
    return 'authentication';
  }
  if (input.statusCode >= 500 || input.statusCode === 408) return 'transient';
  return 'unknown';
}
