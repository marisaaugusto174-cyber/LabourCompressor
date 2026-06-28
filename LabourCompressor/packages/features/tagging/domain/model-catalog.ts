export type ProviderTier =
  | 'tier-1'
  | 'tier-2';

export type ExtendedModelProvider =
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

export interface ModelOption {
  readonly id: string;
  readonly label: string;
}

export interface ProviderCatalogEntry {
  readonly provider: ExtendedModelProvider;
  readonly label: string;
  readonly tier: ProviderTier;
  readonly models: readonly ModelOption[];
  readonly supportedAuthModes: readonly ('api-key' | 'oauth-link')[];
}

const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = Object.freeze([
  createEntry('openai', 'OpenAI', 'tier-1', ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano']),
  createEntry('google', 'Google Gemini', 'tier-1', ['gemini-3.5-flash']),
  createEntry('anthropic', 'Anthropic', 'tier-1', ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-latest']),
  createEntry('qwen', 'Alibaba Qwen', 'tier-1', ['qwen3.7-plus', 'qwen3.6-flash']),
  createEntry('zhipu', 'Zhipu GLM', 'tier-1', ['glm-4.5', 'glm-4.5-air', 'glm-z1-air']),
  createEntry('deepseek', 'DeepSeek', 'tier-2', ['deepseek-chat', 'deepseek-reasoner']),
  createEntry('moonshot', 'Moonshot Kimi', 'tier-2', ['kimi-k2.5', 'kimi-k2-thinking']),
  createEntry('baidu', 'Baidu ERNIE', 'tier-2', ['ernie-4.5-turbo', 'ernie-x1-turbo']),
  createEntry('tencent-hunyuan', 'Tencent Hunyuan', 'tier-2', ['hunyuan-turbo', 'hunyuan-t1']),
  createEntry('minimax', 'MiniMax', 'tier-2', ['minimax-m1', 'minimax-text-01'])
]);

export function listProviderCatalog(): readonly ProviderCatalogEntry[] {
  return PROVIDER_CATALOG;
}

export function getProviderCatalogEntry(
  provider: ExtendedModelProvider
): ProviderCatalogEntry {
  const entry = PROVIDER_CATALOG.find((item) => item.provider === provider);

  if (entry === undefined) {
    throw new Error(`Unsupported model provider: "${provider}"`);
  }

  return entry;
}

export function validateProviderModelSelection(input: {
  readonly provider: ExtendedModelProvider;
  readonly modelId: string;
  readonly authMode: 'api-key' | 'oauth-link';
}): void {
  const entry = getProviderCatalogEntry(input.provider);

  if (!entry.models.some((model) => model.id === input.modelId.trim())) {
    throw new Error(
      `Model "${input.modelId}" is not available under provider "${input.provider}".`
    );
  }

  if (!entry.supportedAuthModes.includes(input.authMode)) {
    throw new Error(
      `Auth mode "${input.authMode}" is not supported for provider "${input.provider}".`
    );
  }
}

function createEntry(
  provider: ExtendedModelProvider,
  label: string,
  tier: ProviderTier,
  modelIds: readonly string[]
): ProviderCatalogEntry {
  return Object.freeze({
    provider,
    label,
    tier,
    models: Object.freeze(
      modelIds.map((modelId) =>
        Object.freeze({
          id: modelId,
          label: modelId
        })
      )
    ),
    supportedAuthModes: Object.freeze(['api-key', 'oauth-link'] as const)
  });
}
