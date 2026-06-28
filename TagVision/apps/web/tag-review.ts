import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export const TAG_REVIEW_STATE_FILE_NAME = '_tag-review-state.json';
export const TAGVISION_TAXONOMY_FILE_NAME = '_tagvision-taxonomy.json';
export const TAGVISION_THUMBNAIL_DIRECTORY_NAME = '_tagvision-thumbnails';

const execFileAsync = promisify(execFile);

const VIDEO_FILE_NAME_PATTERN = /\.(mp4|mov|m4v|mkv|avi|webm)$/iu;
const JSON_FILE_NAME_PATTERN = /\.json$/iu;
const REVIEW_STATUSES = new Set(['通过', '需修改', '跳过']);
const ACCEPTED_REVIEW_STATUS = '通过' as const;

export interface TagReviewScanResult {
  readonly directoryPath: string;
  readonly pairedItems: readonly TagReviewItem[];
  readonly unpairedVideos: readonly TagReviewFileEntry[];
  readonly orphanJsonFiles: readonly TagReviewFileEntry[];
  readonly invalidJsonFiles: readonly TagReviewInvalidJsonFile[];
  readonly state: TagReviewStateFile | null;
  readonly taxonomySnapshot: TagVisionTaxonomySnapshot | null;
}

export interface TagReviewItem {
  readonly reviewItemId: string;
  readonly stem: string;
  readonly relativeDirectory: string;
  readonly videoFileName: string;
  readonly jsonFileName: string;
  readonly videoRelativePath: string;
  readonly jsonRelativePath: string;
  readonly tagging: TagReviewTaggingSummary;
  readonly reviewStatus?: string;
  readonly reviewNote?: string;
  readonly labelStudioTaskId?: string | number;
  readonly acceptedResult?: AcceptedTagReviewResult;
}

export interface TagReviewFileEntry {
  readonly fileName: string;
  readonly relativePath: string;
  readonly relativeDirectory: string;
}

export interface TagReviewInvalidJsonFile extends TagReviewFileEntry {
  readonly errorMessage: string;
}

export interface TagReviewTaggingSummary {
  readonly taxonomyVersion: string;
  readonly segmentId: string;
  readonly reviewRequired: boolean;
  readonly reviewReason: string;
  readonly tags: readonly TagReviewTagSummary[];
}

export interface TagReviewTagSummary {
  readonly dimension: string;
  readonly labelPath: readonly string[];
  readonly selectedLevel: string;
  readonly tagRole: string;
  readonly entityId: string;
  readonly targetEntityId: string;
  readonly evidenceType: string;
  readonly confidenceScore?: number;
  readonly evidenceNote: string;
}

export interface TagVisionTaxonomySnapshot {
  readonly version: 1;
  readonly taxonomyVersion: string;
  readonly taxonomyChecksum: string;
  readonly paths: readonly string[];
}

export interface AcceptedTagReviewResult {
  readonly version: 1;
  readonly reviewItemId: string;
  readonly videoRelativePath: string;
  readonly sourceJsonRelativePath: string;
  readonly taxonomyVersion: string;
  readonly taxonomyChecksum: string;
  readonly status: '通过';
  readonly acceptedPaths: readonly string[];
  readonly source: 'manual';
  readonly reviewedAt: string;
}

export interface WriteAcceptedTagReviewResultInput {
  readonly directoryPath: string;
  readonly reviewItemId: string;
  readonly acceptedPaths: readonly string[];
  readonly reviewedAt?: string;
}

export interface LabelStudioImportPackage {
  readonly labelConfig: string;
  readonly tasks: readonly LabelStudioImportTask[];
  readonly taskCount: number;
}

export interface LabelStudioImportTask {
  readonly data: Readonly<Record<string, unknown>>;
}

export interface TagReviewStateFile {
  readonly version: 1;
  readonly source: 'label-studio';
  readonly syncedAt: string;
  readonly items: Readonly<Record<string, TagReviewStateItem>>;
}

export interface TagReviewStateItem {
  readonly reviewItemId: string;
  readonly videoRelativePath: string;
  readonly jsonRelativePath: string;
  readonly labelStudioTaskId?: string | number;
  readonly status: string;
  readonly note: string;
  readonly syncedAt: string;
}

export interface WriteTagReviewStateInput {
  readonly directoryPath: string;
  readonly syncedAt: string;
  readonly items: readonly TagReviewStateItem[];
}

export interface ParsedRange {
  readonly start: number;
  readonly end: number;
  readonly statusCode: 200 | 206;
  readonly contentLength: number;
  readonly contentRange?: string | undefined;
}

interface ScannedVideoFile extends TagReviewFileEntry {
  readonly filePath: string;
  readonly stem: string;
  readonly matchKey: string;
}

interface ScannedJsonFile extends TagReviewFileEntry {
  readonly filePath: string;
  readonly stem: string;
  readonly matchKey: string;
  readonly parsed: unknown;
}

interface ScannedAcceptedFile extends TagReviewFileEntry {
  readonly filePath: string;
  readonly stem: string;
  readonly matchKey: string;
  readonly parsed: unknown;
}

export async function scanTagReviewDirectory(input: {
  readonly directoryPath: string;
}): Promise<TagReviewScanResult> {
  const directoryPath = path.resolve(input.directoryPath);
  const videos: ScannedVideoFile[] = [];
  const jsonFiles: ScannedJsonFile[] = [];
  const acceptedFiles: ScannedAcceptedFile[] = [];
  const invalidJsonFiles: TagReviewInvalidJsonFile[] = [];

  await scanDirectory(directoryPath, directoryPath);
  const state = await readTagReviewState(directoryPath);
  const taxonomySnapshot = await readTagVisionTaxonomySnapshot(directoryPath);
  const jsonByKey = new Map(jsonFiles.map((file) => [file.matchKey, file]));
  const acceptedByKey = new Map(acceptedFiles.map((file) => [file.matchKey, file]));
  const videoByKey = new Map(videos.map((file) => [file.matchKey, file]));
  const pairedItems: TagReviewItem[] = [];
  const unpairedVideos: TagReviewFileEntry[] = [];
  const pairedJsonKeys = new Set<string>();

  for (const video of sortByRelativePath(videos)) {
    const json = jsonByKey.get(video.matchKey);

    if (json === undefined) {
      unpairedVideos.push(toFileEntry(video));
      continue;
    }

    const reviewItemId = createReviewItemId(video.relativePath, json.relativePath);
    const stateItem = state?.items[reviewItemId];
    const acceptedResult = normalizeAcceptedTagReviewResultForItem({
      value: acceptedByKey.get(video.matchKey)?.parsed,
      reviewItemId,
      videoRelativePath: video.relativePath,
      sourceJsonRelativePath: json.relativePath,
      taxonomySnapshot
    });
    const reviewStatus = acceptedResult?.status ?? stateItem?.status;

    pairedJsonKeys.add(json.matchKey);
    pairedItems.push({
      reviewItemId,
      stem: video.stem,
      relativeDirectory: video.relativeDirectory,
      videoFileName: video.fileName,
      jsonFileName: json.fileName,
      videoRelativePath: video.relativePath,
      jsonRelativePath: json.relativePath,
      tagging: normalizeTaggingJson(json.parsed),
      ...(reviewStatus === undefined ? {} : { reviewStatus }),
      ...(stateItem?.note === undefined ? {} : { reviewNote: stateItem.note }),
      ...(stateItem?.labelStudioTaskId === undefined ? {} : { labelStudioTaskId: stateItem.labelStudioTaskId }),
      ...(acceptedResult === undefined ? {} : { acceptedResult })
    });
  }

  const orphanJsonFiles = sortByRelativePath(jsonFiles)
    .filter((file) => !pairedJsonKeys.has(file.matchKey) && !videoByKey.has(file.matchKey))
    .map(toFileEntry);

  return Object.freeze({
    directoryPath,
    pairedItems: Object.freeze(pairedItems),
    unpairedVideos: Object.freeze(unpairedVideos),
    orphanJsonFiles: Object.freeze(orphanJsonFiles),
    invalidJsonFiles: Object.freeze(sortByRelativePath(invalidJsonFiles)),
    state,
    taxonomySnapshot
  });

  async function scanDirectory(rootDirectory: string, currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const filePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await scanDirectory(rootDirectory, filePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = toPortableRelativePath(rootDirectory, filePath);
      const relativeDirectory = toPortableRelativePath(rootDirectory, path.dirname(filePath));
      const stem = path.basename(entry.name, path.extname(entry.name));
      const matchKey = buildMatchKey(relativeDirectory, stem);

      if (VIDEO_FILE_NAME_PATTERN.test(entry.name)) {
        videos.push({
          filePath,
          fileName: entry.name,
          relativePath,
          relativeDirectory,
          stem,
          matchKey
        });
        continue;
      }

      if (!JSON_FILE_NAME_PATTERN.test(entry.name) || entry.name === TAG_REVIEW_STATE_FILE_NAME) {
        continue;
      }

      try {
        const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;

        if (entry.name.endsWith('.accepted.json')) {
          const sourceStem = stem.slice(0, -'.accepted'.length);
          acceptedFiles.push({
            filePath,
            fileName: entry.name,
            relativePath,
            relativeDirectory,
            stem: sourceStem,
            matchKey: buildMatchKey(relativeDirectory, sourceStem),
            parsed
          });
          continue;
        }

        if (entry.name === TAGVISION_TAXONOMY_FILE_NAME) {
          continue;
        }

        jsonFiles.push({
          filePath,
          fileName: entry.name,
          relativePath,
          relativeDirectory,
          stem,
          matchKey,
          parsed
        });
      } catch (error) {
        invalidJsonFiles.push({
          fileName: entry.name,
          relativePath,
          relativeDirectory,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}

export async function writeAcceptedTagReviewResult(
  input: WriteAcceptedTagReviewResultInput
): Promise<AcceptedTagReviewResult> {
  const directoryPath = path.resolve(input.directoryPath);
  const scan = await scanTagReviewDirectory({ directoryPath });
  const taxonomySnapshot = scan.taxonomySnapshot;

  if (taxonomySnapshot === null) {
    throw new Error(`Missing taxonomy snapshot: ${TAGVISION_TAXONOMY_FILE_NAME}`);
  }

  const item = scan.pairedItems.find((candidate) => candidate.reviewItemId === input.reviewItemId);

  if (item === undefined) {
    throw new Error(`Unknown review item: ${input.reviewItemId}`);
  }

  const acceptedPaths = normalizeAcceptedPaths(input.acceptedPaths);

  if (acceptedPaths.length === 0) {
    throw new Error('Accepted paths must not be empty.');
  }

  for (const acceptedPath of acceptedPaths) {
    if (!taxonomySnapshot.paths.includes(acceptedPath)) {
      throw new Error(`Illegal accepted taxonomy path: ${acceptedPath}`);
    }
  }

  const acceptedResult: AcceptedTagReviewResult = Object.freeze({
    version: 1,
    reviewItemId: item.reviewItemId,
    videoRelativePath: item.videoRelativePath,
    sourceJsonRelativePath: item.jsonRelativePath,
    taxonomyVersion: taxonomySnapshot.taxonomyVersion,
    taxonomyChecksum: taxonomySnapshot.taxonomyChecksum,
    status: ACCEPTED_REVIEW_STATUS,
    acceptedPaths,
    source: 'manual',
    reviewedAt: input.reviewedAt ?? new Date().toISOString()
  });
  const targetPath = path.join(
    directoryPath,
    item.relativeDirectory,
    `${path.basename(item.videoFileName, path.extname(item.videoFileName))}.accepted.json`
  );
  const temporaryPath = `${targetPath}.tmp`;

  await writeFile(temporaryPath, `${JSON.stringify(acceptedResult, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, targetPath);
  return acceptedResult;
}

export function buildLabelStudioImportPackage(input: {
  readonly directoryPath: string;
  readonly mediaBaseUrl: string;
  readonly items: readonly TagReviewItem[];
}): LabelStudioImportPackage {
  const directoryPath = path.resolve(input.directoryPath);
  const tasks = input.items.map((item) => Object.freeze({
    data: Object.freeze({
      review_item_id: item.reviewItemId,
      file_name: item.videoFileName,
      video: buildMediaUrl({
        mediaBaseUrl: input.mediaBaseUrl,
        directoryPath,
        relativePath: item.videoRelativePath
      }),
      tag_markdown: renderTagMarkdown(item),
      video_relative_path: item.videoRelativePath,
      json_relative_path: item.jsonRelativePath,
      json_file_name: item.jsonFileName
    })
  }));

  return Object.freeze({
    labelConfig: LABEL_STUDIO_LABEL_CONFIG,
    tasks: Object.freeze(tasks),
    taskCount: tasks.length
  });
}

export function parseLabelStudioReviewExport(
  payload: unknown,
  syncedAt: string
): readonly TagReviewStateItem[] {
  if (!Array.isArray(payload)) {
    return Object.freeze([]);
  }

  const items: TagReviewStateItem[] = [];

  for (const task of payload) {
    if (!isRecord(task) || !isRecord(task.data)) {
      continue;
    }

    const reviewItemId = readString(task.data.review_item_id);
    const videoRelativePath = readString(task.data.video_relative_path);
    const jsonRelativePath = readString(task.data.json_relative_path);

    if (reviewItemId.length === 0 || videoRelativePath.length === 0 || jsonRelativePath.length === 0) {
      continue;
    }

    const annotation = Array.isArray(task.annotations)
      ? findLastAnnotationWithResults(task.annotations)
      : undefined;

    if (!isRecord(annotation) || !Array.isArray(annotation.result)) {
      continue;
    }

    const status = readReviewStatus(annotation.result);

    if (status.length === 0) {
      continue;
    }

    const labelStudioTaskId = typeof task.id === 'number' || typeof task.id === 'string' ? task.id : undefined;
    items.push(Object.freeze({
      reviewItemId,
      videoRelativePath,
      jsonRelativePath,
      ...(labelStudioTaskId === undefined ? {} : { labelStudioTaskId }),
      status,
      note: readReviewNote(annotation.result),
      syncedAt
    }));
  }

  return Object.freeze(items);
}

export async function writeTagReviewState(input: WriteTagReviewStateInput): Promise<TagReviewStateFile> {
  const directoryPath = path.resolve(input.directoryPath);
  const items = Object.fromEntries(input.items.map((item) => [item.reviewItemId, item]));
  const state: TagReviewStateFile = Object.freeze({
    version: 1,
    source: 'label-studio',
    syncedAt: input.syncedAt,
    items: Object.freeze(items)
  });
  const targetPath = path.join(directoryPath, TAG_REVIEW_STATE_FILE_NAME);
  const temporaryPath = path.join(directoryPath, `${TAG_REVIEW_STATE_FILE_NAME}.tmp`);

  await mkdir(directoryPath, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, targetPath);
  return state;
}

export function parseRangeHeader(rangeHeader: string | undefined, fileSize: number): ParsedRange {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
    throw new Error(`Invalid file size: ${fileSize}`);
  }

  if (rangeHeader === undefined || rangeHeader.trim().length === 0) {
    return Object.freeze({
      start: 0,
      end: Math.max(0, fileSize - 1),
      statusCode: 200,
      contentLength: fileSize,
      contentRange: undefined
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader.trim());

  if (match === null) {
    throw new Error(`Invalid range header: ${rangeHeader}`);
  }

  const startText = match[1] ?? '';
  const endText = match[2] ?? '';

  if (startText.length === 0 && endText.length === 0) {
    throw new Error(`Invalid range header: ${rangeHeader}`);
  }

  let start: number;
  let end: number;

  if (startText.length === 0) {
    const suffixLength = Number(endText);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new Error(`Invalid range header: ${rangeHeader}`);
    }

    start = Math.max(fileSize - suffixLength, 0);
    end = Math.max(fileSize - 1, 0);
  } else {
    start = Number(startText);
    end = endText.length > 0 ? Number(endText) : fileSize - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    throw new Error(`Invalid range header: ${rangeHeader}`);
  }

  end = Math.min(end, fileSize - 1);

  return Object.freeze({
    start,
    end,
    statusCode: 206,
    contentLength: end - start + 1,
    contentRange: `bytes ${start}-${end}/${fileSize}`
  });
}

export async function resolveTagReviewMediaPath(input: {
  readonly directoryPath: string;
  readonly relativePath: string;
}): Promise<{
  readonly filePath: string;
  readonly fileSize: number;
  readonly contentType: string;
}> {
  if (path.isAbsolute(input.relativePath)) {
    throw new Error('Media relativePath must not be absolute.');
  }

  if (!VIDEO_FILE_NAME_PATTERN.test(input.relativePath)) {
    throw new Error('Media relativePath must point to a supported video file.');
  }

  const directoryPath = path.resolve(input.directoryPath);
  const filePath = path.resolve(directoryPath, input.relativePath);

  if (!isInsideDirectory(directoryPath, filePath)) {
    throw new Error('Media relativePath escapes the selected directory.');
  }

  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    throw new Error('Media path is not a file.');
  }

  return Object.freeze({
    filePath,
    fileSize: fileStat.size,
    contentType: contentTypeForVideo(filePath)
  });
}

export async function resolveTagReviewThumbnail(input: {
  readonly directoryPath: string;
  readonly relativePath: string;
  readonly generateIfMissing?: boolean;
}): Promise<{
  readonly thumbnailPath: string;
  readonly fileSize: number;
  readonly contentType: 'image/jpeg';
}> {
  const media = await resolveTagReviewMediaPath(input);
  const directoryPath = path.resolve(input.directoryPath);
  const thumbnailDirectory = path.join(directoryPath, TAGVISION_THUMBNAIL_DIRECTORY_NAME);
  const thumbnailPath = path.join(thumbnailDirectory, `${createThumbnailKey(input.relativePath)}.jpg`);

  if (await pathExists(thumbnailPath)) {
    const thumbnailStat = await stat(thumbnailPath);
    return Object.freeze({
      thumbnailPath,
      fileSize: thumbnailStat.size,
      contentType: 'image/jpeg'
    });
  }

  if (input.generateIfMissing === false) {
    return Object.freeze({
      thumbnailPath,
      fileSize: 0,
      contentType: 'image/jpeg'
    });
  }

  await mkdir(thumbnailDirectory, { recursive: true });
  const temporaryPath = `${thumbnailPath}.tmp.jpg`;
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    '0',
    '-i',
    media.filePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=480:-1',
    '-pix_fmt',
    'yuvj420p',
    '-q:v',
    '4',
    temporaryPath
  ]);
  if (!(await pathExists(temporaryPath))) {
    throw new Error(`Thumbnail generation produced no output for ${input.relativePath}`);
  }
  await rename(temporaryPath, thumbnailPath);
  const thumbnailStat = await stat(thumbnailPath);

  return Object.freeze({
    thumbnailPath,
    fileSize: thumbnailStat.size,
    contentType: 'image/jpeg'
  });
}

function normalizeTaggingJson(value: unknown): TagReviewTaggingSummary {
  const record = isRecord(value) ? value : {};
  const tags = Array.isArray(record.tags)
    ? record.tags
      .filter(isRecord)
      .map((tag) => {
        const confidenceScore = typeof tag.confidence_score === 'number' ? tag.confidence_score : undefined;
        return Object.freeze({
        dimension: readString(tag.dimension),
        labelPath: Object.freeze(Array.isArray(tag.label_path)
          ? tag.label_path.map(readString).filter((item) => item.length > 0)
          : []),
        selectedLevel: readString(tag.selected_level),
        tagRole: readString(tag.tag_role),
        entityId: readString(tag.entity_id),
        targetEntityId: readString(tag.target_entity_id),
        evidenceType: readString(tag.evidence_type),
        ...(confidenceScore === undefined ? {} : { confidenceScore }),
        evidenceNote: readString(tag.evidence_note)
      });
      })
    : [];

  return Object.freeze({
    taxonomyVersion: readString(record.taxonomy_version),
    segmentId: readString(record.segment_id),
    reviewRequired: record.review_required === true,
    reviewReason: readString(record.review_reason),
    tags: Object.freeze(tags)
  });
}

function renderTagMarkdown(item: TagReviewItem): string {
  const lines = [
    `## ${item.videoFileName}`,
    '',
    `- Review ID: \`${item.reviewItemId}\``,
    `- JSON: \`${item.jsonRelativePath}\``,
    `- Taxonomy: ${item.tagging.taxonomyVersion || 'unknown'}`,
    `- Model review required: ${item.tagging.reviewRequired ? 'yes' : 'no'}`,
    item.tagging.reviewReason.length > 0 ? `- Model review reason: ${item.tagging.reviewReason}` : '',
    '',
    '### Tags'
  ].filter((line) => line.length > 0);

  if (item.tagging.tags.length === 0) {
    lines.push('', 'No tags found in JSON.');
    return lines.join('\n');
  }

  for (const [index, tag] of item.tagging.tags.entries()) {
    lines.push(
      '',
      `${index + 1}. **${tag.dimension || '未命名维度'}**`,
      `   - Path: ${tag.labelPath.join(' > ') || '—'}`,
      `   - Role: ${tag.tagRole || '—'} / Level: ${tag.selectedLevel || '—'}`,
      `   - Evidence: ${tag.evidenceType || '—'} / Confidence: ${formatConfidence(tag.confidenceScore)}`,
      `   - Note: ${tag.evidenceNote || '—'}`
    );
  }

  return lines.join('\n');
}

function buildMediaUrl(input: {
  readonly mediaBaseUrl: string;
  readonly directoryPath: string;
  readonly relativePath: string;
}): string {
  const url = new URL(input.mediaBaseUrl);
  url.searchParams.set('directoryPath', input.directoryPath);
  url.searchParams.set('relativePath', input.relativePath);
  return url.toString();
}

function readReviewStatus(results: readonly unknown[]): string {
  for (const result of results) {
    if (!isRecord(result) || readString(result.from_name) !== 'review_status' || !isRecord(result.value)) {
      continue;
    }

    const choices = Array.isArray(result.value.choices) ? result.value.choices : [];
    const status = readString(choices[0]);

    if (REVIEW_STATUSES.has(status)) {
      return status;
    }
  }

  return '';
}

function findLastAnnotationWithResults(annotations: readonly unknown[]): unknown {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];

    if (isRecord(annotation) && Array.isArray(annotation.result)) {
      return annotation;
    }
  }

  return undefined;
}

function readReviewNote(results: readonly unknown[]): string {
  for (const result of results) {
    if (!isRecord(result) || readString(result.from_name) !== 'review_note' || !isRecord(result.value)) {
      continue;
    }

    if (Array.isArray(result.value.text)) {
      return result.value.text.map(readString).filter((item) => item.length > 0).join('\n');
    }

    return readString(result.value.text);
  }

  return '';
}

async function readTagReviewState(directoryPath: string): Promise<TagReviewStateFile | null> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(directoryPath, TAG_REVIEW_STATE_FILE_NAME), 'utf8')
    ) as unknown;

    if (!isRecord(parsed) || parsed.version !== 1 || parsed.source !== 'label-studio' || !isRecord(parsed.items)) {
      return null;
    }

    const items: Record<string, TagReviewStateItem> = {};

    for (const [key, value] of Object.entries(parsed.items)) {
      if (!isRecord(value)) {
        continue;
      }

      const reviewItemId = readString(value.reviewItemId);
      const status = readString(value.status);

      if (reviewItemId.length === 0 || !REVIEW_STATUSES.has(status)) {
        continue;
      }

      const labelStudioTaskId = typeof value.labelStudioTaskId === 'number' || typeof value.labelStudioTaskId === 'string'
        ? value.labelStudioTaskId
        : undefined;

      items[key] = Object.freeze({
        reviewItemId,
        videoRelativePath: readString(value.videoRelativePath),
        jsonRelativePath: readString(value.jsonRelativePath),
        ...(labelStudioTaskId === undefined ? {} : { labelStudioTaskId }),
        status,
        note: readString(value.note),
        syncedAt: readString(value.syncedAt)
      });
    }

    return Object.freeze({
      version: 1,
      source: 'label-studio',
      syncedAt: readString(parsed.syncedAt),
      items: Object.freeze(items)
    });
  } catch {
    return null;
  }
}

async function readTagVisionTaxonomySnapshot(directoryPath: string): Promise<TagVisionTaxonomySnapshot | null> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(directoryPath, TAGVISION_TAXONOMY_FILE_NAME), 'utf8')
    ) as unknown;

    if (!isRecord(parsed) || parsed.version !== 1) {
      return null;
    }

    const taxonomyVersion = readString(parsed.taxonomyVersion);
    const taxonomyChecksum = readString(parsed.taxonomyChecksum);
    const paths = Array.isArray(parsed.paths)
      ? normalizeAcceptedPaths(parsed.paths.map(readString))
      : [];

    if (taxonomyVersion.length === 0 || taxonomyChecksum.length === 0 || paths.length === 0) {
      return null;
    }

    return Object.freeze({
      version: 1,
      taxonomyVersion,
      taxonomyChecksum,
      paths
    });
  } catch {
    return null;
  }
}

function normalizeAcceptedTagReviewResult(value: unknown): AcceptedTagReviewResult | undefined {
  if (!isRecord(value) || value.version !== 1 || readString(value.status) !== ACCEPTED_REVIEW_STATUS) {
    return undefined;
  }

  const reviewItemId = readString(value.reviewItemId);
  const videoRelativePath = readString(value.videoRelativePath);
  const sourceJsonRelativePath = readString(value.sourceJsonRelativePath);
  const taxonomyVersion = readString(value.taxonomyVersion);
  const taxonomyChecksum = readString(value.taxonomyChecksum);
  const acceptedPaths = Array.isArray(value.acceptedPaths)
    ? normalizeAcceptedPaths(value.acceptedPaths.map(readString))
    : [];
  const reviewedAt = readString(value.reviewedAt);

  if (
    reviewItemId.length === 0 ||
    videoRelativePath.length === 0 ||
    sourceJsonRelativePath.length === 0 ||
    taxonomyVersion.length === 0 ||
    taxonomyChecksum.length === 0 ||
    acceptedPaths.length === 0 ||
    reviewedAt.length === 0
  ) {
    return undefined;
  }

  return Object.freeze({
    version: 1,
    reviewItemId,
    videoRelativePath,
    sourceJsonRelativePath,
    taxonomyVersion,
    taxonomyChecksum,
    status: ACCEPTED_REVIEW_STATUS,
    acceptedPaths,
    source: 'manual',
    reviewedAt
  });
}

function normalizeAcceptedTagReviewResultForItem(input: {
  readonly value: unknown;
  readonly reviewItemId: string;
  readonly videoRelativePath: string;
  readonly sourceJsonRelativePath: string;
  readonly taxonomySnapshot: TagVisionTaxonomySnapshot | null;
}): AcceptedTagReviewResult | undefined {
  const acceptedResult = normalizeAcceptedTagReviewResult(input.value);
  const taxonomySnapshot = input.taxonomySnapshot;

  if (
    acceptedResult === undefined ||
    taxonomySnapshot === null ||
    acceptedResult.reviewItemId !== input.reviewItemId ||
    acceptedResult.videoRelativePath !== input.videoRelativePath ||
    acceptedResult.sourceJsonRelativePath !== input.sourceJsonRelativePath ||
    acceptedResult.taxonomyVersion !== taxonomySnapshot.taxonomyVersion ||
    acceptedResult.taxonomyChecksum !== taxonomySnapshot.taxonomyChecksum ||
    acceptedResult.acceptedPaths.some((acceptedPath) => !taxonomySnapshot.paths.includes(acceptedPath))
  ) {
    return undefined;
  }

  return acceptedResult;
}

function normalizeAcceptedPaths(paths: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(paths.map((item) => item.trim()).filter((item) => item.length > 0))]);
}

function createReviewItemId(videoRelativePath: string, jsonRelativePath: string): string {
  return `review-${createHash('sha1')
    .update(videoRelativePath)
    .update('\0')
    .update(jsonRelativePath)
    .digest('hex')
    .slice(0, 16)}`;
}

function createThumbnailKey(relativePath: string): string {
  return createHash('sha1')
    .update(relativePath)
    .digest('hex')
    .slice(0, 24);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildMatchKey(relativeDirectory: string, stem: string): string {
  return `${relativeDirectory}\0${stem}`;
}

function toFileEntry(file: TagReviewFileEntry): TagReviewFileEntry {
  return Object.freeze({
    fileName: file.fileName,
    relativePath: file.relativePath,
    relativeDirectory: file.relativeDirectory
  });
}

function sortByRelativePath<T extends { readonly relativePath: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, 'zh-Hans-CN')
  );
}

function toPortableRelativePath(rootDirectory: string, filePath: string): string {
  const relativePath = path.relative(rootDirectory, filePath);
  return relativePath.length === 0 ? '' : relativePath.split(path.sep).join('/');
}

function isInsideDirectory(rootDirectory: string, filePath: string): boolean {
  const relativePath = path.relative(rootDirectory, filePath);
  return relativePath.length === 0 ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function contentTypeForVideo(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const mapping: Readonly<Record<string, string>> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo'
  };

  return mapping[extension] ?? 'application/octet-stream';
}

function formatConfidence(value: number | undefined): string {
  return value === undefined ? '—' : String(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const LABEL_STUDIO_LABEL_CONFIG = `<View>
  <View style="display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(360px, 0.75fr); gap: 20px; align-items: start;">
    <View>
      <Header value="$file_name" />
      <Video name="video" value="$video" height="520" />
    </View>
    <View>
      <Markdown value="$tag_markdown" />
    </View>
  </View>
  <Choices name="review_status" toName="video" choice="single-radio" showInline="true" required="true" requiredMessage="请选择质检结论">
    <Choice value="通过" />
    <Choice value="需修改" />
    <Choice value="跳过" />
  </Choices>
  <TextArea name="review_note" toName="video" placeholder="质检备注或修正建议" rows="4" />
</View>`;
