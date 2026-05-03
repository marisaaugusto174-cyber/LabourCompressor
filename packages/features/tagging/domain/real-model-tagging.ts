import path from 'node:path';

import {
  type ParsedTaxonomyTree
} from '../../taxonomy/domain/index.ts';
import {
  buildPromptLibraryInstruction,
  type PromptLibraryDocument
} from './prompt-library.ts';
import {
  type LocalProviderConfig
} from './provider-local-config.ts';
import {
  createQwenCompatibleClient,
  type QwenMessageContentPart
} from '../../../adapters/models/qwen-compatible-client.ts';
import {
  createGeminiCompatibleClient
} from '../../../adapters/models/gemini-compatible-client.ts';
import {
  encodeFileAsDataUrl,
  prepareVideoTaggingCache,
  type VideoTaggingCacheResult
} from '../../../adapters/media/media-frame-extractor.ts';
import {
  getVideoModelProfile
} from './video-model-profiles.ts';

export interface GenerateModelCandidatePathsInput {
  readonly mediaFilePath: string;
  readonly mediaAssetId: string;
  readonly taxonomyTree: ParsedTaxonomyTree;
  readonly promptLibrary: PromptLibraryDocument;
  readonly providerConfig: LocalProviderConfig;
  readonly videoCacheDirectory: string;
  readonly selectedModelProfileId?: string;
}

export interface GenerateModelCandidatePathsResult {
  readonly candidatePaths: readonly string[];
  readonly rawText: string;
  readonly promptInstruction: string;
  readonly videoTaggingCache?: VideoTaggingCacheResult;
}

export const MIN_MODEL_VIDEO_DURATION_SECONDS = 2;

export async function generateModelCandidatePaths(
  input: GenerateModelCandidatePathsInput
): Promise<GenerateModelCandidatePathsResult> {
  const promptInstruction = buildPromptLibraryInstruction(input.promptLibrary);
  const allowedPaths = listLeafTaxonomyPaths(input.taxonomyTree);
  const selectedProfile = getVideoModelProfile(input.selectedModelProfileId);
  const resolvedProviderConfig = Object.freeze({
    ...input.providerConfig,
    provider: selectedProfile.provider,
    modelName: selectedProfile.modelName
  });
  const content = await buildModelContentParts({
    mediaFilePath: input.mediaFilePath,
    promptInstruction,
    allowedPaths
  });
  const videoTaggingCache = isVideoMediaFile(input.mediaFilePath)
    ? await prepareVideoTaggingCache({
        mediaFilePath: input.mediaFilePath,
        cacheRootDirectory: input.videoCacheDirectory
      })
    : undefined;

  if (
    videoTaggingCache !== undefined &&
    videoTaggingCache.sourceDurationSec < MIN_MODEL_VIDEO_DURATION_SECONDS
  ) {
    throw new Error(
      `Video file is too short for model tagging: ${videoTaggingCache.sourceDurationSec.toFixed(2)}s. Minimum is ${MIN_MODEL_VIDEO_DURATION_SECONDS}s.`
    );
  }

  const response =
    resolvedProviderConfig.provider === 'qwen'
      ? await completeWithQwen({
          providerConfig: resolvedProviderConfig,
          mediaFilePath: input.mediaFilePath,
          promptInstruction,
          allowedPaths,
          content,
          videoTaggingCache
        })
      : resolvedProviderConfig.provider === 'google'
        ? await completeWithGemini({
            providerConfig: resolvedProviderConfig,
            mediaFilePath: input.mediaFilePath,
            promptInstruction,
            allowedPaths,
            videoTaggingCache,
            selectedProfileThinkingLevel: selectedProfile.thinkingLevel
          })
        : throwUnsupportedProvider(resolvedProviderConfig.provider);
  const candidatePaths = parseCandidatePathsFromModelText(response.text);

  return Object.freeze({
    candidatePaths,
    rawText: response.text,
    promptInstruction,
    videoTaggingCache
  });
}

async function completeWithQwen(input: {
  readonly providerConfig: LocalProviderConfig;
  readonly mediaFilePath: string;
  readonly promptInstruction: string;
  readonly allowedPaths: readonly string[];
  readonly content: readonly QwenMessageContentPart[];
  readonly videoTaggingCache?: VideoTaggingCacheResult;
}) {
  const client = createQwenCompatibleClient(input.providerConfig);
  return isVideoMediaFile(input.mediaFilePath)
    ? client.completeVideoFile({
        prompt: buildModelInstructionText(
          input.promptInstruction,
          input.allowedPaths
        ),
        videoDataUrl: await encodeFileAsDataUrl(
          requireVideoCache(input.videoTaggingCache).cachePath
        ),
        fps: Math.min(requireVideoCache(input.videoTaggingCache).cacheFps, 10)
      })
    : client.completeUserContent(input.content);
}

async function completeWithGemini(input: {
  readonly providerConfig: LocalProviderConfig;
  readonly mediaFilePath: string;
  readonly promptInstruction: string;
  readonly allowedPaths: readonly string[];
  readonly videoTaggingCache?: VideoTaggingCacheResult;
  readonly selectedProfileThinkingLevel?: 'high';
}) {
  const client = createGeminiCompatibleClient(input.providerConfig);

  if (!isVideoMediaFile(input.mediaFilePath)) {
    return client.completeText({
      prompt: buildModelInstructionText(
        input.promptInstruction,
        input.allowedPaths
      ),
      thinkingLevel: input.selectedProfileThinkingLevel
    });
  }

  const videoDataUrl = await encodeFileAsDataUrl(
    requireVideoCache(input.videoTaggingCache).cachePath
  );
  const inlineData = parseDataUrl(videoDataUrl);

  return client.completeVideoFile({
    prompt: buildModelInstructionText(
      input.promptInstruction,
      input.allowedPaths
    ),
    videoBase64: inlineData.base64Data,
    mimeType: inlineData.mimeType,
    thinkingLevel: input.selectedProfileThinkingLevel
  });
}

function throwUnsupportedProvider(provider: string): never {
  throw new Error(
    `Real model tagging is not implemented for provider "${provider}".`
  );
}

function requireVideoCache(
  cache: VideoTaggingCacheResult | undefined
): VideoTaggingCacheResult {
  if (cache === undefined) {
    throw new Error('Video tagging cache is required for video inference.');
  }

  return cache;
}

function parseDataUrl(value: string): Readonly<{
  readonly mimeType: string;
  readonly base64Data: string;
}> {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(value);

  if (match === null) {
    throw new Error('Invalid data URL for Gemini inline video input.');
  }

  return Object.freeze({
    mimeType: (match[1] ?? '').trim(),
    base64Data: (match[2] ?? '').trim()
  });
}

export function listLeafTaxonomyPaths(
  taxonomyTree: ParsedTaxonomyTree
): readonly string[] {
  return Object.freeze(
    taxonomyTree.nodes
      .filter((node) => node.childIds.length === 0)
      .map((node) => node.path.value)
      .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  );
}

export function parseCandidatePathsFromModelText(
  modelText: string
): readonly string[] {
  const parsed = JSON.parse(stripMarkdownCodeFence(modelText)) as unknown;

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('Model tagging response must be a JSON array of strings.');
  }

  const uniquePaths = [...new Set(parsed.map((item) => item.trim()).filter(Boolean))];

  return Object.freeze(uniquePaths);
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);

  if (fenceMatch === null) {
    return trimmed;
  }

  return (fenceMatch[1] ?? '').trim();
}

async function buildModelContentParts(input: {
  readonly mediaFilePath: string;
  readonly promptInstruction: string;
  readonly allowedPaths: readonly string[];
}): Promise<readonly QwenMessageContentPart[]> {
  const extension = path.extname(input.mediaFilePath).toLowerCase();
  const content: QwenMessageContentPart[] = [
    {
      type: 'text',
      text: buildModelInstructionText(
        input.promptInstruction,
        input.allowedPaths
      )
    }
  ];

  if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    content.push({
      type: 'image_url',
      image_url: {
        url: await encodeFileAsDataUrl(input.mediaFilePath)
      }
    });

    return Object.freeze(content);
  }

  if (isVideoMediaFile(input.mediaFilePath)) {
    return Object.freeze(content);
  }

  throw new Error(`Unsupported media type for real model tagging: "${extension}".`);
}

function isVideoMediaFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(extension);
}

function buildModelInstructionText(
  promptInstruction: string,
  allowedPaths: readonly string[]
): string {
  return [
    'You are a strict multimodal tagger.',
    'Use only the exact taxonomy paths provided below.',
    'Return only a JSON array of strings.',
    'If nothing is confidently applicable, return [].',
    '',
    promptInstruction,
    '',
    'Allowed taxonomy paths:',
    ...allowedPaths.map((value) => `- ${value}`)
  ].join('\n');
}
