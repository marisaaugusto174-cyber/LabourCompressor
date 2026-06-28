import { type ModelProvider } from './model-connection.ts';

export type VideoModelProfileId =
  | 'qwen-3.7-plus'
  | 'qwen-3.6-flash'
  | 'gemini-3.5-flash';

export interface VideoModelProfile {
  readonly id: VideoModelProfileId;
  readonly label: string;
  readonly provider: ModelProvider;
  readonly modelName: string;
  readonly videoSupported: true;
  readonly thinkingLevel?: 'high' | undefined;
  readonly defaultTaggingConcurrency: number;
}

const VIDEO_MODEL_PROFILES: readonly VideoModelProfile[] = Object.freeze([
  Object.freeze({
    id: 'qwen-3.7-plus',
    label: 'Qwen3.7Plus',
    provider: 'qwen',
    modelName: 'qwen3.7-plus',
    videoSupported: true,
    defaultTaggingConcurrency: 16
  }),
  Object.freeze({
    id: 'qwen-3.6-flash',
    label: 'Qwen3.6Flash',
    provider: 'qwen',
    modelName: 'qwen3.6-flash',
    videoSupported: true,
    defaultTaggingConcurrency: 24
  }),
  Object.freeze({
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    provider: 'google',
    modelName: 'gemini-3.5-flash',
    videoSupported: true,
    defaultTaggingConcurrency: 4
  })
]);

export function listVideoModelProfiles(): readonly VideoModelProfile[] {
  return VIDEO_MODEL_PROFILES;
}

export function getVideoModelProfile(
  id: string | undefined
): VideoModelProfile {
  const normalizedId = (id ?? 'qwen-3.7-plus').trim();
  const profile = VIDEO_MODEL_PROFILES.find((item) => item.id === normalizedId);

  if (profile === undefined) {
    throw new Error(
      `Unsupported video model profile: "${normalizedId}".`
    );
  }

  return profile;
}
