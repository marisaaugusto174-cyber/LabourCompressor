import { type ModelProvider } from './model-connection.ts';

export type VideoModelProfileId =
  | 'gemini-3-flash-thinking'
  | 'gemini-3-pro'
  | 'qwen-3.5-plus'
  | 'qwen-3.6-plus'
  | 'qwen-3.6-flash';

export interface VideoModelProfile {
  readonly id: VideoModelProfileId;
  readonly label: string;
  readonly provider: ModelProvider;
  readonly modelName: string;
  readonly videoSupported: true;
  readonly thinkingLevel?: 'high';
  readonly defaultTaggingConcurrency: number;
}

const VIDEO_MODEL_PROFILES: readonly VideoModelProfile[] = Object.freeze([
  Object.freeze({
    id: 'qwen-3.6-flash',
    label: 'Qwen 3.6 Flash',
    provider: 'qwen',
    modelName: 'qwen3.6-flash',
    videoSupported: true,
    defaultTaggingConcurrency: 10
  }),
  Object.freeze({
    id: 'qwen-3.5-plus',
    label: 'Qwen 3.5 Plus',
    provider: 'qwen',
    modelName: 'qwen3.5-plus',
    videoSupported: true,
    defaultTaggingConcurrency: 10
  }),
  Object.freeze({
    id: 'qwen-3.6-plus',
    label: 'Qwen 3.6 Plus',
    provider: 'qwen',
    modelName: 'qwen3.6-plus',
    videoSupported: true,
    defaultTaggingConcurrency: 10
  }),
  Object.freeze({
    id: 'gemini-3-flash-thinking',
    label: 'Gemini 3 Flash Thinking',
    provider: 'google',
    modelName: 'gemini-3-flash-preview',
    videoSupported: true,
    thinkingLevel: 'high',
    defaultTaggingConcurrency: 2
  }),
  Object.freeze({
    id: 'gemini-3-pro',
    label: 'Gemini 3.1 Pro',
    provider: 'google',
    modelName: 'gemini-3.1-pro-preview',
    videoSupported: true,
    defaultTaggingConcurrency: 2
  })
]);

export function listVideoModelProfiles(): readonly VideoModelProfile[] {
  return VIDEO_MODEL_PROFILES;
}

export function getVideoModelProfile(
  id: string | undefined
): VideoModelProfile {
  const normalizedId = (id ?? 'qwen-3.6-flash').trim();
  const profile = VIDEO_MODEL_PROFILES.find((item) => item.id === normalizedId);

  if (profile === undefined) {
    throw new Error(
      `Unsupported video model profile: "${normalizedId}".`
    );
  }

  return profile;
}
