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
  readonly selectedModelProfileId?: string | undefined;
  readonly taxonomyBaseMarkdown?: string | undefined;
  readonly taxonomyVersionId?: string | undefined;
  readonly archiveDimension?: string | undefined;
  readonly modelResponseShape?: 'paths-json-array' | 'structured-json' | undefined;
}

export interface GenerateModelCandidatePathsResult {
  readonly candidatePaths: readonly string[];
  readonly rawText: string;
  readonly promptInstruction: string;
  readonly parsedJson?: unknown | undefined;
  readonly videoTaggingCache?: VideoTaggingCacheResult | undefined;
}

export const MIN_MODEL_VIDEO_DURATION_SECONDS = 2;

export async function generateModelCandidatePaths(
  input: GenerateModelCandidatePathsInput
): Promise<GenerateModelCandidatePathsResult> {
  return generateModelCandidatePathsWithAllowedPaths({
    ...input,
    allowedPaths: listLeafTaxonomyPaths(input.taxonomyTree),
    selectionMode: 'multi-branch'
  });
}

export async function generateContentTopicCandidatePaths(
  input: GenerateModelCandidatePathsInput
): Promise<GenerateModelCandidatePathsResult> {
  return generateModelCandidatePathsWithAllowedPaths({
    ...input,
    allowedPaths: listDimensionLeafTaxonomyPaths(
      input.taxonomyTree,
      input.archiveDimension ?? '内容题材'
    ),
    selectionMode: 'content-topic-only'
  });
}

async function generateModelCandidatePathsWithAllowedPaths(
  input: GenerateModelCandidatePathsInput & {
    readonly allowedPaths: readonly string[];
    readonly selectionMode: 'multi-branch' | 'content-topic-only';
  }
): Promise<GenerateModelCandidatePathsResult> {
  const promptInstruction =
    input.modelResponseShape === 'structured-json'
      ? input.taxonomyBaseMarkdown ?? buildPromptLibraryInstruction(input.promptLibrary)
      : buildPromptLibraryInstruction(input.promptLibrary);
  const selectedProfile = getVideoModelProfile(input.selectedModelProfileId);
  const resolvedProviderConfig = Object.freeze({
    ...input.providerConfig,
    provider: selectedProfile.provider,
    modelName: selectedProfile.modelName
  });
  const content = await buildModelContentParts({
    mediaFilePath: input.mediaFilePath,
    promptInstruction,
    allowedPaths: input.allowedPaths,
    selectionMode: input.selectionMode,
    modelResponseShape: input.modelResponseShape,
    archiveDimension: input.archiveDimension
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
          allowedPaths: input.allowedPaths,
          content,
          videoTaggingCache,
          selectionMode: input.selectionMode,
          modelResponseShape: input.modelResponseShape,
          archiveDimension: input.archiveDimension
        })
      : resolvedProviderConfig.provider === 'google'
        ? await completeWithGemini({
            providerConfig: resolvedProviderConfig,
            mediaFilePath: input.mediaFilePath,
            promptInstruction,
            allowedPaths: input.allowedPaths,
            videoTaggingCache,
            selectedProfileThinkingLevel: selectedProfile.thinkingLevel,
            selectionMode: input.selectionMode,
            modelResponseShape: input.modelResponseShape,
            archiveDimension: input.archiveDimension
          })
        : throwUnsupportedProvider(resolvedProviderConfig.provider);
  const parsedResponse = parseModelTaggingResponse(response.text);

  return Object.freeze({
    candidatePaths: parsedResponse.candidatePaths,
    rawText: response.text,
    promptInstruction,
    parsedJson: parsedResponse.parsedJson,
    videoTaggingCache
  });
}

async function completeWithQwen(input: {
  readonly providerConfig: LocalProviderConfig;
  readonly mediaFilePath: string;
  readonly promptInstruction: string;
  readonly allowedPaths: readonly string[];
  readonly content: readonly QwenMessageContentPart[];
  readonly videoTaggingCache?: VideoTaggingCacheResult | undefined;
  readonly selectionMode: 'multi-branch' | 'content-topic-only';
  readonly modelResponseShape?: 'paths-json-array' | 'structured-json' | undefined;
  readonly archiveDimension?: string | undefined;
}) {
  const client = createQwenCompatibleClient(input.providerConfig);
  return isVideoMediaFile(input.mediaFilePath)
    ? client.completeVideoFile({
        prompt: buildModelInstructionText(
          input.promptInstruction,
          input.allowedPaths,
          input.selectionMode,
          input.modelResponseShape,
          input.archiveDimension
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
  readonly videoTaggingCache?: VideoTaggingCacheResult | undefined;
  readonly selectedProfileThinkingLevel?: 'high' | undefined;
  readonly selectionMode: 'multi-branch' | 'content-topic-only';
  readonly modelResponseShape?: 'paths-json-array' | 'structured-json' | undefined;
  readonly archiveDimension?: string | undefined;
}) {
  const client = createGeminiCompatibleClient(input.providerConfig);

  if (!isVideoMediaFile(input.mediaFilePath)) {
    return client.completeText({
      prompt: buildModelInstructionText(
        input.promptInstruction,
        input.allowedPaths,
        input.selectionMode,
        input.modelResponseShape,
        input.archiveDimension
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
      input.allowedPaths,
      input.selectionMode,
      input.modelResponseShape,
      input.archiveDimension
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

export function listContentTopicLeafTaxonomyPaths(
  taxonomyTree: ParsedTaxonomyTree
): readonly string[] {
  return listDimensionLeafTaxonomyPaths(taxonomyTree, '内容题材');
}

export function listDimensionLeafTaxonomyPaths(
  taxonomyTree: ParsedTaxonomyTree,
  dimension: string
): readonly string[] {
  return Object.freeze(
    listLeafTaxonomyPaths(taxonomyTree).filter((pathValue) =>
      pathValue.startsWith(`${dimension} > `)
    )
  );
}

export function parseCandidatePathsFromModelText(
  modelText: string
): readonly string[] {
  return parseModelTaggingResponse(modelText).candidatePaths;
}

export function parseModelTaggingResponse(modelText: string): Readonly<{
  readonly candidatePaths: readonly string[];
  readonly parsedJson: unknown;
}> {
  const parsed = JSON.parse(stripMarkdownCodeFence(modelText)) as unknown;

  if (Array.isArray(parsed)) {
    if (!parsed.every((item) => typeof item === 'string')) {
      throw new Error('Model tagging response JSON array must contain only strings.');
    }

    return Object.freeze({
      candidatePaths: uniquePaths(parsed),
      parsedJson: parsed
    });
  }

  if (isRecord(parsed)) {
    return Object.freeze({
      candidatePaths: extractStructuredCandidatePaths(parsed),
      parsedJson: parsed
    });
  }

  throw new Error('Model tagging response must be a JSON array of strings or a structured JSON object.');
}

function extractStructuredCandidatePaths(parsed: Readonly<Record<string, unknown>>): readonly string[] {
  const tagArrays = [
    parsed.tags,
    parsed.fact_tags,
    parsed.metadata_tags,
    parsed.production_tags
  ].filter(Array.isArray) as readonly unknown[][];
  const paths: string[] = [];

  for (const tagArray of tagArrays) {
    for (const tag of tagArray) {
      if (!isRecord(tag) || !Array.isArray(tag.label_path)) {
        continue;
      }

      const pathSegments = tag.label_path
        .map((segment) => String(segment).trim())
        .filter(Boolean);

      if (pathSegments.length > 0) {
        paths.push(pathSegments.join(' > '));
      }
    }
  }

  if (paths.length === 0) {
    throw new Error('Structured model tagging response does not contain any label_path values.');
  }

  return uniquePaths(paths);
}

function uniquePaths(paths: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(paths.map((item) => item.trim()).filter(Boolean))]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  readonly selectionMode: 'multi-branch' | 'content-topic-only';
  readonly modelResponseShape?: 'paths-json-array' | 'structured-json' | undefined;
  readonly archiveDimension?: string | undefined;
}): Promise<readonly QwenMessageContentPart[]> {
  const extension = path.extname(input.mediaFilePath).toLowerCase();
  const content: QwenMessageContentPart[] = [
    {
      type: 'text',
      text: buildModelInstructionText(
        input.promptInstruction,
        input.allowedPaths,
        input.selectionMode,
        input.modelResponseShape,
        input.archiveDimension
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
  allowedPaths: readonly string[],
  selectionMode: 'multi-branch' | 'content-topic-only',
  modelResponseShape: 'paths-json-array' | 'structured-json' = 'paths-json-array',
  archiveDimension = '内容题材'
): string {
  if (modelResponseShape === 'structured-json') {
    const selectionRules =
      selectionMode === 'content-topic-only'
        ? [
            `The response must include exactly one tag whose dimension is "${archiveDimension}".`,
            `That "${archiveDimension}" tag must be supported by direct evidence.`
          ]
        : [
            `The response must include exactly one primary "${archiveDimension}" tag when evidence allows.`,
            'Keep the JSON schema defined by the prompt base.'
          ];

    return [
      'You are a strict multimodal tagger.',
      'Return only one valid JSON object. Do not wrap it in Markdown.',
      ...selectionRules,
      '',
      'Use this complete tagging prompt base as the only taxonomy and output schema:',
      '',
      promptInstruction
    ].join('\n');
  }

  const selectionRules =
    selectionMode === 'content-topic-only'
      ? [
          'Return exactly one path as a JSON array with one string.',
          'The returned path must start with 内容题材 > .',
          'Do not return an empty array.'
        ]
      : [
          'Return a JSON array containing all applicable paths.',
          'The array must include exactly one path starting with 内容题材 > .',
          'Do not return an empty array for production video tagging.'
        ];
  return [
    'You are a strict multimodal tagger.',
    'Use only the exact taxonomy paths provided below.',
    'Return only a JSON array of strings.',
    ...selectionRules,
    '',
    promptInstruction,
    '',
    'Allowed taxonomy paths:',
    ...allowedPaths.map((value) => `- ${value}`)
  ].join('\n');
}
