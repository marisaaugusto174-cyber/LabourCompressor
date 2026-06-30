import {
  type LocalProviderConfig
} from '../../features/tagging/domain/provider-local-config.ts';
import { ModelProviderRequestError } from './model-provider-error.ts';

export interface QwenProbeInput {
  readonly prompt: string;
}

export interface QwenTextContentPart {
  readonly type: 'text';
  readonly text: string;
}

export interface QwenImageContentPart {
  readonly type: 'image_url';
  readonly image_url: {
    readonly url: string;
  };
}

export interface QwenVideoFileContentPart {
  readonly video: string;
  readonly fps?: number | undefined;
}

export type QwenMessageContentPart =
  | QwenTextContentPart
  | QwenImageContentPart;

export interface QwenProbeResult {
  readonly model: string;
  readonly text: string;
  readonly requestId?: string | undefined;
  readonly usage?: {
    readonly promptTokens?: number | undefined;
    readonly completionTokens?: number | undefined;
    readonly totalTokens?: number | undefined;
  };
}

export interface QwenVideoCompletionInput {
  readonly prompt: string;
  readonly videoDataUrl: string;
  readonly fps?: number | undefined;
}

const QWEN_TEXT_TIMEOUT_MS = 120_000;
const QWEN_VIDEO_TIMEOUT_MS = 600_000;

export function createQwenCompatibleClient(config: LocalProviderConfig) {
  if (config.provider !== 'qwen') {
    throw new Error('Qwen compatible client requires provider "qwen".');
  }

  if (config.authMode !== 'api-key') {
    throw new Error('Qwen compatible client currently supports only api-key mode.');
  }

  if (config.apiKey.trim().length === 0) {
    throw new Error('Qwen apiKey must not be empty.');
  }

  return Object.freeze({
    async probe(input: QwenProbeInput): Promise<QwenProbeResult> {
      return this.completeUserContent([
        {
          type: 'text',
          text: input.prompt.trim()
        }
      ]);
    },
    async completeVideoFile(
      input: QwenVideoCompletionInput
    ): Promise<QwenProbeResult> {
      const signal = AbortSignal.timeout(QWEN_VIDEO_TIMEOUT_MS);
      let response: Response;

      try {
        response = await fetch(
          'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
          {
            method: 'POST',
            signal,
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: config.modelName,
              input: {
                messages: [
                  {
                    role: 'user',
                    content: [
                      buildNativeVideoPart(input.videoDataUrl, input.fps),
                      {
                        text: input.prompt.trim()
                      }
                    ]
                  }
                ]
              }
            })
          }
        );
      } catch (error) {
        if (isAbortTimeoutError(error)) {
          throw new Error(
            `Qwen native video request timed out after ${QWEN_VIDEO_TIMEOUT_MS / 1000} seconds.`
          );
        }

        throw error;
      }

      const body = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        throw buildQwenRequestError(body, response.status);
      }

      const output = readPlainObject(body.output, 'Qwen native video response output');
      const text = extractAssistantText(output);

      return Object.freeze({
        model: readOptionalString(body.model) || readOptionalString(output.model),
        text,
        requestId: readOptionalString(body.request_id) || readOptionalString(body.requestId),
        usage: Object.freeze({
          promptTokens: readOptionalNumber((output.usage as Record<string, unknown> | undefined)?.input_tokens),
          completionTokens: readOptionalNumber((output.usage as Record<string, unknown> | undefined)?.output_tokens),
          totalTokens: readOptionalNumber((output.usage as Record<string, unknown> | undefined)?.total_tokens)
        })
      });
    },
    async completeUserContent(
      content: readonly QwenMessageContentPart[]
    ): Promise<QwenProbeResult> {
      const signal = AbortSignal.timeout(QWEN_TEXT_TIMEOUT_MS);
      let response: Response;

      try {
        response = await fetch(
          'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
          {
            method: 'POST',
            signal,
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: config.modelName,
              messages: [
                {
                  role: 'user',
                  content
                }
              ]
            })
          }
        );
      } catch (error) {
        if (isAbortTimeoutError(error)) {
          throw new Error(
            `Qwen text request timed out after ${QWEN_TEXT_TIMEOUT_MS / 1000} seconds.`
          );
        }

        throw error;
      }

      const body = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        throw buildQwenRequestError(body, response.status);
      }

      const text = extractAssistantText(body);

      return Object.freeze({
        model: readOptionalString(body.model),
        text,
        requestId: readOptionalString(body.id),
        usage: Object.freeze({
          promptTokens: readOptionalNumber((body.usage as Record<string, unknown> | undefined)?.prompt_tokens),
          completionTokens: readOptionalNumber((body.usage as Record<string, unknown> | undefined)?.completion_tokens),
          totalTokens: readOptionalNumber((body.usage as Record<string, unknown> | undefined)?.total_tokens)
        })
      });
    }
  });
}

function buildNativeVideoPart(
  videoDataUrl: string,
  fps?: number
): QwenVideoFileContentPart {
  return Object.freeze(
    fps === undefined
      ? {
          video: videoDataUrl
        }
      : {
          video: videoDataUrl,
          fps
        }
  );
}

function isAbortTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

export function extractAssistantText(body: Record<string, unknown>): string {
  const choices = body.choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('Qwen response does not contain choices.');
  }

  const firstChoice = choices[0];

  if (!isPlainObject(firstChoice)) {
    throw new Error('Qwen response first choice is invalid.');
  }

  const message = firstChoice.message;

  if (!isPlainObject(message)) {
    throw new Error('Qwen response message is missing.');
  }

  const content = message.content;

  if (typeof content === 'string' && content.trim().length > 0) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .filter(isPlainObject)
      .map((item) => readOptionalString(item.text))
      .filter(Boolean)
      .join('\n')
      .trim();

    if (text.length > 0) {
      return text;
    }
  }

  throw new Error('Qwen response assistant content is empty.');
}

function buildQwenErrorMessage(
  body: Record<string, unknown>,
  statusCode: number
): string {
  const topLevelCode = readOptionalString(body.code);
  const topLevelMessage = readOptionalString(body.message);

  if (topLevelCode.length > 0 || topLevelMessage.length > 0) {
    return `Qwen API error (${statusCode}${topLevelCode.length > 0 ? `/${topLevelCode}` : ''}): ${topLevelMessage || 'unknown error'}`;
  }

  const error = body.error;

  if (isPlainObject(error)) {
    const message = readOptionalString(error.message);
    const code = readOptionalString(error.code);
    return `Qwen API error (${statusCode}${code.length > 0 ? `/${code}` : ''}): ${message || 'unknown error'}`;
  }

  return `Qwen API request failed with status ${statusCode}.`;
}

function buildQwenRequestError(
  body: Record<string, unknown>,
  statusCode: number
): ModelProviderRequestError {
  const topLevelCode = readOptionalString(body.code);
  const nestedError = isPlainObject(body.error) ? body.error : {};
  const providerCode = topLevelCode || readOptionalString(nestedError.code);
  return new ModelProviderRequestError({
    provider: 'qwen',
    statusCode,
    providerCode,
    message: buildQwenErrorMessage(body, statusCode)
  });
}

function readOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPlainObject(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} is missing.`);
  }

  return value;
}
