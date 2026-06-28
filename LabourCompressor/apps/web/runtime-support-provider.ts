import { readFile, writeFile } from 'node:fs/promises';

import { createGeminiCompatibleClient } from '../../packages/adapters/models/gemini-compatible-client.ts';
import { createQwenCompatibleClient } from '../../packages/adapters/models/qwen-compatible-client.ts';
import {
  getEnabledProviderConfig,
  getVideoModelProfile,
  listVideoModelProfiles,
  loadLocalProviderConfigFile,
  sanitizeLocalProviderConfig
} from '../../packages/features/tagging/domain/index.ts';
import { type RunLocalPipelineOptions } from '../cli/local-pipeline-command.ts';
import { type RuntimeCheckResult } from './runtime-support-types.ts';
import { DEFAULT_PROVIDER_CONFIG_PATH } from '../cli/project-paths.ts';

export async function probeSelectedProvider(input: {
  readonly providerConfigPath: string;
  readonly selectedModelProfileId: string;
}): Promise<RuntimeCheckResult> {
  const profile = getVideoModelProfile(input.selectedModelProfileId);
  const configMap = await loadLocalProviderConfigFile(input.providerConfigPath);
  const providerConfig = getEnabledProviderConfig(configMap, profile.provider);
  const resolvedConfig = Object.freeze({
    ...providerConfig,
    provider: profile.provider,
    modelName: profile.modelName
  });

  if (profile.provider === 'qwen') {
    const result = await createQwenCompatibleClient(resolvedConfig).probe({
      prompt: '请只回复字符串 OK，不要包含额外解释。'
    });

    return Object.freeze({
      key: 'provider-probe',
      ok: true,
      message: `${profile.label} connectivity probe succeeded.`,
      details: {
        provider: profile.provider,
        model: result.model,
        requestId: result.requestId ?? null,
        responseText: result.text
      }
    });
  }

  if (profile.provider === 'google') {
    const result = await createGeminiCompatibleClient(resolvedConfig).completeText({
      prompt: 'Please reply with the exact string OK and nothing else.',
      thinkingLevel: profile.thinkingLevel
    });

    return Object.freeze({
      key: 'provider-probe',
      ok: true,
      message: `${profile.label} connectivity probe succeeded.`,
      details: {
        provider: profile.provider,
        model: result.model,
        responseText: result.text
      }
    });
  }

  throw new Error(`Provider probe is not implemented for "${profile.provider}".`);
}

export async function loadProviderConfigSummary(
  providerConfigPath: string
): Promise<Readonly<Record<string, unknown>>> {
  const configMap = await loadLocalProviderConfigFile(providerConfigPath);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(configMap).map(([provider, config]) => [
        provider,
        sanitizeLocalProviderConfig(config)
      ])
    )
  );
}

export async function loadVideoModelProviderSummaries(input: {
  readonly providerConfigPath: string;
}): Promise<Readonly<{
  readonly models: readonly Readonly<{
    readonly profileId: string;
    readonly modelName: string;
    readonly provider: string;
    readonly modelId: string;
    readonly providerEnabled: boolean;
    readonly apiKeyPresent: boolean;
    readonly lastProbe: null;
  }>[];
}>> {
  const configMap = await loadLocalProviderConfigFile(input.providerConfigPath);

  return Object.freeze({
    models: Object.freeze(
      listVideoModelProfiles().map((profile) => {
        const providerConfig = configMap[profile.provider];

        return Object.freeze({
          profileId: profile.id,
          modelName: profile.label,
          provider: profile.provider,
          modelId: profile.modelName,
          providerEnabled: providerConfig?.enabled === true,
          apiKeyPresent: (providerConfig?.apiKey.trim().length ?? 0) > 0,
          lastProbe: null
        });
      })
    )
  });
}

export async function getSelectedProviderConfigSummary(input: {
  readonly providerConfigPath: string;
  readonly selectedModelProfileId: string;
}): Promise<Readonly<Record<string, unknown>>> {
  const profile = getVideoModelProfile(input.selectedModelProfileId);
  const configMap = await loadLocalProviderConfigFile(input.providerConfigPath);
  const providerConfig = configMap[profile.provider];

  if (providerConfig === undefined) {
    throw new Error(`Provider "${profile.provider}" is not present in local config.`);
  }

  return Object.freeze({
    profile,
    summary: sanitizeLocalProviderConfig(
      Object.freeze({
        ...providerConfig,
        provider: profile.provider,
        modelName: profile.modelName
      })
    )
  });
}

export async function saveSelectedProviderApiKey(input: {
  readonly providerConfigPath: string;
  readonly selectedModelProfileId: string;
  readonly apiKey: string;
  readonly probe?: typeof probeSelectedProvider;
}): Promise<Readonly<Record<string, unknown>>> {
  const profile = getVideoModelProfile(input.selectedModelProfileId);
  const raw = JSON.parse(await readFile(input.providerConfigPath, 'utf8')) as Record<
    string,
    Record<string, unknown>
  >;
  const current = raw[profile.provider];

  if (current === undefined || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`Provider "${profile.provider}" is not present in local config.`);
  }

  raw[profile.provider] = {
    ...current,
    enabled: true,
    provider: profile.provider,
    authMode: 'api-key',
    modelName: profile.modelName,
    apiKey: input.apiKey
  };

  await writeFile(input.providerConfigPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');

  const profileSummary = Object.freeze({
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    modelName: profile.modelName
  });

  try {
    return Object.freeze({
      saved: true,
      profile: profileSummary,
      probe: await (input.probe ?? probeSelectedProvider)({
        providerConfigPath: input.providerConfigPath,
        selectedModelProfileId: input.selectedModelProfileId
      })
    });
  } catch (error) {
    return Object.freeze({
      saved: true,
      profile: profileSummary,
      probe: Object.freeze({
        key: 'provider-probe',
        ok: false,
        message: sanitizeSavedProviderProbeErrorMessage(error, input.apiKey),
        details: {
          provider: profile.provider,
          model: profile.modelName,
          reason: 'provider-probe-failed'
        }
      })
    });
  }
}

function sanitizeSavedProviderProbeErrorMessage(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeProviderErrorMessage(message.replaceAll(apiKey, '[REDACTED]'));
}

export async function checkProvider(
  options: RunLocalPipelineOptions
): Promise<RuntimeCheckResult> {
  if (options.taggingMode !== 'qwen') {
    return Object.freeze({ key: 'provider', ok: true, message: 'Simulated tagging selected.' });
  }

  const selectedProfile = getVideoModelProfile(options.selectedModelProfileId);

  if (selectedProfile.videoSupported !== true) {
    return Object.freeze({
      key: 'provider',
      ok: false,
      message: `${selectedProfile.label} does not support video input in this pipeline.`,
      details: {
        reason: 'model-no-video',
        provider: selectedProfile.provider,
        model: selectedProfile.modelName
      }
    });
  }

  try {
    const providerConfigPath =
      options.providerConfigPath ??
      DEFAULT_PROVIDER_CONFIG_PATH;
    const configMap = await loadLocalProviderConfigFile(providerConfigPath);
    const providerConfig = getEnabledProviderConfig(configMap, selectedProfile.provider);
    const resolvedConfig = Object.freeze({
      ...providerConfig,
      provider: selectedProfile.provider,
      modelName: selectedProfile.modelName
    });
    const probeResult =
      selectedProfile.provider === 'qwen'
        ? await createQwenCompatibleClient(resolvedConfig).probe({
            prompt: '请只回复字符串 OK，不要包含额外解释。'
          })
        : await createGeminiCompatibleClient(resolvedConfig).completeText({
            prompt: 'Please reply with the exact string OK and nothing else.',
            thinkingLevel: selectedProfile.thinkingLevel
          });

    return Object.freeze({
      key: 'provider',
      ok: true,
      message: `${selectedProfile.label} provider is enabled and reachable.`,
      details: {
        provider: selectedProfile.provider,
        model: resolvedConfig.modelName,
        requestId:
          'requestId' in probeResult
            ? (probeResult as { requestId?: string }).requestId ?? null
            : null
      }
    });
  } catch (error) {
    return buildProviderCheckFailure(error, selectedProfile);
  }
}

export function buildProviderCheckFailure(
  error: unknown,
  profile: Readonly<{
    readonly provider: string;
    readonly modelName: string;
    readonly label: string;
  }>
): RuntimeCheckResult {
  const sanitizedError = sanitizeProviderErrorMessage(
    error instanceof Error ? error.message : String(error)
  );
  const classifiedReason = classifyProviderFailureReason(sanitizedError);

  return Object.freeze({
    key: 'provider',
    ok: false,
    message: buildProviderFailureMessage(classifiedReason, profile.label),
    details: {
      reason: classifiedReason,
      provider: profile.provider,
      model: profile.modelName,
      error: sanitizedError
    }
  });
}

function classifyProviderFailureReason(message: string): 'provider-not-enabled' | 'provider-auth-or-quota' | 'model-no-video' | 'provider-connectivity' {
  if (message.includes('disabled in local config')) {
    return 'provider-not-enabled';
  }

  if (
    /api key|apikey|quota|insufficient|429|401|403|permission|unauthorized|invalid/i.test(message)
  ) {
    return 'provider-auth-or-quota';
  }

  if (/video.+support|support.+video|multimodal.+support/i.test(message)) {
    return 'model-no-video';
  }

  return 'provider-connectivity';
}

function buildProviderFailureMessage(
  reason: 'provider-not-enabled' | 'provider-auth-or-quota' | 'model-no-video' | 'provider-connectivity',
  label: string
): string {
  switch (reason) {
    case 'provider-not-enabled':
      return `${label} is not enabled in local provider config.`;
    case 'provider-auth-or-quota':
      return `${label} failed provider preflight because the API key is missing, invalid, or has quota/billing issues.`;
    case 'model-no-video':
      return `${label} does not support video input in this pipeline.`;
    case 'provider-connectivity':
      return `${label} provider preflight could not reach the remote service.`;
    default:
      return `${label} provider preflight failed.`;
  }
}

function sanitizeProviderErrorMessage(message: string): string {
  return message
    .replace(/key=[^&\s]+/giu, 'key=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|rk|ak)-[A-Za-z0-9._-]+\b/gu, '[REDACTED]');
}
