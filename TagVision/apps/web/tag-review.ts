import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export const TAGVISION_TAXONOMY_FILE_NAME = '_tagvision-taxonomy.json';
export const TAGVISION_THUMBNAIL_DIRECTORY_NAME = '_tagvision-thumbnails';

const execFileAsync = promisify(execFile);

const VIDEO_FILE_NAME_PATTERN = /\.(mp4|mov|m4v|mkv|avi|webm)$/iu;
const JSON_FILE_NAME_PATTERN = /\.json$/iu;
const ACCEPTED_REVIEW_STATUS = '通过' as const;

export interface TagReviewScanResult {
  readonly directoryPath: string;
  readonly pairedItems: readonly TagReviewItem[];
  readonly unpairedVideos: readonly TagReviewFileEntry[];
  readonly orphanJsonFiles: readonly TagReviewFileEntry[];
  readonly invalidJsonFiles: readonly TagReviewInvalidJsonFile[];
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
  const taxonomySnapshot = await readTagVisionTaxonomySnapshot(directoryPath);
  const jsonByKey = new Map(jsonFiles.map((file) => [file.matchKey, file]));
  const acceptedByKey = new Map(acceptedFiles.map((file) => [file.matchKey, file]));
  const videoByKey = new Map(videos.map((file) => [file.matchKey, file]));
  const pairedItems: TagReviewItem[] = [];
  const unpairedVideos: TagReviewFileEntry[] = [];
  const pairedJsonKeys = new Set<string>();

  for (const video of sortReviewVideos(videos)) {
    const json = jsonByKey.get(video.matchKey);

    if (json === undefined) {
      unpairedVideos.push(toFileEntry(video));
      continue;
    }

    const reviewItemId = createReviewItemId(video.relativePath, json.relativePath);
    const acceptedResult = normalizeAcceptedTagReviewResultForItem({
      value: acceptedByKey.get(video.matchKey)?.parsed,
      reviewItemId,
      videoRelativePath: video.relativePath,
      sourceJsonRelativePath: json.relativePath,
      taxonomySnapshot
    });
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

      if (!JSON_FILE_NAME_PATTERN.test(entry.name) || entry.name === '_tag-review-state.json') {
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

function sortReviewVideos(items: readonly ScannedVideoFile[]): readonly ScannedVideoFile[] {
  return [...items].sort((left, right) => {
    const fileNameOrder = left.fileName.localeCompare(right.fileName, 'zh-Hans-CN');
    return fileNameOrder === 0
      ? left.relativePath.localeCompare(right.relativePath, 'zh-Hans-CN')
      : fileNameOrder;
  });
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
