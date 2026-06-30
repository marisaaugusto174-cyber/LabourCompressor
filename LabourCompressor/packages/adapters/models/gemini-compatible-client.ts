import {
  type LocalProviderConfig
} from '../../features/tagging/domain/provider-local-config.ts';
import { ModelProviderRequestError } from './model-provider-error.ts';

export interface GeminiProbeInput {
  readonly prompt: string;
}

export interface GeminiProbeResult {
  readonly model: string;
  readonly text: string;
}

export interface GeminiVideoCompletionInput {
  readonly prompt: string;
  readonly videoBase64: string;
  readonly mimeType: string;
  readonly thinkingLevel?: 'high' | undefined;
}

const GEMINI_TIMEOUT_MS = 600_000;

export function createGeminiCompatibleClient(config: LocalProviderConfig) {
  if (config.provider !== 'google') {
    throw new Error('Gemini compatible client requires provider "google".');
  }

  if (config.authMode !== 'api-key') {
    throw new Error('Gemini compatible client currently supports only api-key mode.');
  }

  if (config.apiKey.trim().length === 0) {
    throw new Error('Gemini apiKey must not be empty.');
  }

  return Object.freeze({
    async probe(input: GeminiProbeInput): Promise<GeminiProbeResult> {
      return this.completeText({
        prompt: input.prompt.trim()
      });
    },
    async completeText(input: {
      readonly prompt: string;
      readonly thinkingLevel?: 'high' | undefined;
    }): Promise<GeminiProbeResult> {
      return requestGemini({
        config,
        body: {
          contents: [
            {
              parts: [
                {
                  text: input.prompt.trim()
                }
              ]
            }
          ],
          generationConfig: buildGenerationConfig(input.thinkingLevel)
        }
      });
    },
    async completeVideoFile(
      input: GeminiVideoCompletionInput
    ): Promise<GeminiProbeResult> {
      return requestGemini({
        config,
        body: {
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: input.mimeType,
                    data: input.videoBase64
                  }
                },
                {
                  text: input.prompt.trim()
                }
              ]
            }
          ],
          generationConfig: buildGenerationConfig(input.thinkingLevel)
        }
      });
    }
  });
}

async function requestGemini(input: {
  readonly config: LocalProviderConfig;
  readonly body: Record<string, unknown>;
}): Promise<GeminiProbeResult> {
  const signal = AbortSignal.timeout(GEMINI_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.config.modelName)}:generateContent?key=${encodeURIComponent(input.config.apiKey)}`,
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input.body)
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `Gemini request timed out after ${GEMINI_TIMEOUT_MS / 1000} seconds.`
      );
    }

    throw error;
  }

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw buildGeminiRequestError(body, response.status);
  }

  return Object.freeze({
    model: readOptionalString(body.modelVersion) || input.config.modelName,
    text: extractGeminiText(body)
  });
}

function buildGenerationConfig(thinkingLevel: 'high' | undefined): Record<string, unknown> | undefined {
  if (thinkingLevel === undefined) {
    return undefined;
  }

  return Object.freeze({
    thinkingConfig: {
      thinkingLevel
    }
  });
}

function extractGeminiText(body: Record<string, unknown>): string {
  const candidates = body.candidates;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    const promptFeedback = isPlainObject(body.promptFeedback) ? body.promptFeedback : {};
    const blockReason = readOptionalString(promptFeedback.blockReason);
    if (blockReason.length > 0) {
      throw new ModelProviderRequestError({
        provider: 'google', statusCode: 200, providerCode: blockReason,
        message: `Gemini response blocked (${blockReason}).`
      });
    }
    throw new Error('Gemini response does not contain candidates.');
  }

  const firstCandidate = candidates[0];

  if (!isPlainObject(firstCandidate)) {
    throw new Error('Gemini response first candidate is invalid.');
  }

  const content = firstCandidate.content;

  if (!isPlainObject(content)) {
    throw new Error('Gemini response content is missing.');
  }

  const parts = content.parts;

  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('Gemini response content parts are empty.');
  }

  const text = parts
    .filter(isPlainObject)
    .map((part) => readOptionalString(part.text))
    .filter(Boolean)
    .join('\n')
    .trim();

  if (text.length === 0) {
    throw new Error('Gemini response text is empty.');
  }

  return text;
}

function buildGeminiErrorMessage(
  body: Record<string, unknown>,
  statusCode: number
): string {
  const error = body.error;

  if (isPlainObject(error)) {
    const message = readOptionalString(error.message);
    const status = readOptionalString(error.status);
    return `Gemini API error (${statusCode}${status.length > 0 ? `/${status}` : ''}): ${message || 'unknown error'}`;
  }

  return `Gemini API request failed with status ${statusCode}.`;
}

function buildGeminiRequestError(
  body: Record<string, unknown>,
  statusCode: number
): ModelProviderRequestError {
  const error = isPlainObject(body.error) ? body.error : {};
  return new ModelProviderRequestError({
    provider: 'google', statusCode,
    providerCode: readOptionalString(error.status),
    message: buildGeminiErrorMessage(body, statusCode)
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
