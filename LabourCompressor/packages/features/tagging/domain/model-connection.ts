export type ModelProvider =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'qwen'
  | 'zhipu'
  | 'deepseek'
  | 'moonshot'
  | 'baidu'
  | 'tencent-hunyuan'
  | 'minimax';

export type ModelAuthMode =
  | 'api-key'
  | 'oauth';

export interface ApiKeyAuthConfig {
  readonly apiKey: string;
}

export interface OAuthAuthConfig {
  readonly clientId: string;
  readonly redirectUri: string;
}

export interface ModelConnectionConfig {
  readonly provider: ModelProvider;
  readonly authMode: ModelAuthMode;
  readonly modelName: string;
  readonly apiKeyConfig?: ApiKeyAuthConfig | undefined;
  readonly oauthConfig?: OAuthAuthConfig | undefined;
}

export interface ModelConnectionValidationResult {
  readonly isValid: boolean;
  readonly issues: readonly string[];
}

export interface ModelOnboardingStep {
  readonly order: number;
  readonly title: string;
  readonly description: string;
}

export function createModelConnectionConfig(
  input: ModelConnectionConfig
): ModelConnectionConfig {
  assertNonEmptyValue(input.modelName, 'Model name');

  if (input.authMode === 'api-key') {
    assertNonEmptyValue(input.apiKeyConfig?.apiKey ?? '', 'API key');
  }

  if (input.authMode === 'oauth') {
    assertNonEmptyValue(input.oauthConfig?.clientId ?? '', 'OAuth clientId');
    assertNonEmptyValue(
      input.oauthConfig?.redirectUri ?? '',
      'OAuth redirectUri'
    );
  }

  return Object.freeze({
    provider: input.provider,
    authMode: input.authMode,
    modelName: input.modelName.trim(),
    apiKeyConfig:
      input.apiKeyConfig === undefined
        ? undefined
        : Object.freeze({
            apiKey: input.apiKeyConfig.apiKey.trim()
          }),
    oauthConfig:
      input.oauthConfig === undefined
        ? undefined
        : Object.freeze({
            clientId: input.oauthConfig.clientId.trim(),
            redirectUri: input.oauthConfig.redirectUri.trim()
          })
  });
}

export function validateModelConnectionConfig(
  config: Partial<ModelConnectionConfig>
): ModelConnectionValidationResult {
  const issues: string[] = [];

  if (config.provider === undefined) {
    issues.push('Model provider is required.');
  }

  if (config.authMode === undefined) {
    issues.push('Model auth mode is required.');
  }

  if (config.modelName === undefined || config.modelName.trim().length === 0) {
    issues.push('Model name is required.');
  }

  if (config.authMode === 'api-key') {
    if ((config.apiKeyConfig?.apiKey?.trim().length ?? 0) === 0) {
      issues.push('API key auth requires a non-empty apiKey.');
    }
  }

  if (config.authMode === 'oauth') {
    if ((config.oauthConfig?.clientId?.trim().length ?? 0) === 0) {
      issues.push('OAuth auth requires a non-empty clientId.');
    }
    if ((config.oauthConfig?.redirectUri?.trim().length ?? 0) === 0) {
      issues.push('OAuth auth requires a non-empty redirectUri.');
    }
  }

  return Object.freeze({
    isValid: issues.length === 0,
    issues: Object.freeze(issues)
  });
}

export function createModelOnboardingGuide(
  provider: ModelProvider,
  authMode: ModelAuthMode
): readonly ModelOnboardingStep[] {
  const providerLabel = provider.toUpperCase();

  return Object.freeze([
    {
      order: 1,
      title: 'Choose provider',
      description: `Select ${providerLabel} as the multimodal tagging provider.`
    },
    {
      order: 2,
      title: 'Configure authentication',
      description:
        authMode === 'api-key'
          ? 'Paste the API key and run connection validation.'
          : 'Open OAuth authorization and finish the redirect handshake.'
    },
    {
      order: 3,
      title: 'Choose model',
      description: 'Pick a multimodal model that supports image and video inputs.'
    },
    {
      order: 4,
      title: 'Save local configuration',
      description: 'Persist the validated connection in the local profile.'
    }
  ]);
}

function assertNonEmptyValue(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }
}
