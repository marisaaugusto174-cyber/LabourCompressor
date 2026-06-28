import { stat } from 'node:fs/promises';
import path from 'node:path';
import { type ParsedRange } from './tag-review-types.ts';

const VIDEO_FILE_NAME_PATTERN = /\.(mp4|mov|m4v|mkv|avi|webm)$/iu;

export function parseRangeHeader(rangeHeader: string | undefined, fileSize: number): ParsedRange {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) throw new Error(`Invalid file size: ${fileSize}`);
  if (rangeHeader === undefined || rangeHeader.trim().length === 0) {
    return Object.freeze({ start: 0, end: Math.max(0, fileSize - 1), statusCode: 200, contentLength: fileSize, contentRange: undefined });
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader.trim());
  if (match === null) throw new Error(`Invalid range header: ${rangeHeader}`);
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (startText.length === 0 && endText.length === 0) throw new Error(`Invalid range header: ${rangeHeader}`);
  let start: number;
  let end: number;
  if (startText.length === 0) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new Error(`Invalid range header: ${rangeHeader}`);
    start = Math.max(fileSize - suffixLength, 0);
    end = Math.max(fileSize - 1, 0);
  } else {
    start = Number(startText);
    end = endText.length > 0 ? Number(endText) : fileSize - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= fileSize) {
    throw new Error(`Invalid range header: ${rangeHeader}`);
  }
  end = Math.min(end, fileSize - 1);
  return Object.freeze({ start, end, statusCode: 206, contentLength: end - start + 1, contentRange: `bytes ${start}-${end}/${fileSize}` });
}

export async function resolveTagReviewMediaPath(input: { readonly directoryPath: string; readonly relativePath: string }) {
  if (path.isAbsolute(input.relativePath)) throw new Error('Media relativePath must not be absolute.');
  if (!VIDEO_FILE_NAME_PATTERN.test(input.relativePath)) throw new Error('Media relativePath must point to a supported video file.');
  const directoryPath = path.resolve(input.directoryPath);
  const filePath = path.resolve(directoryPath, input.relativePath);
  if (!isInsideDirectory(directoryPath, filePath)) throw new Error('Media relativePath escapes the selected directory.');
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error('Media path is not a file.');
  return Object.freeze({ filePath, fileSize: fileStat.size, contentType: contentTypeForVideo(filePath) });
}

function isInsideDirectory(rootDirectory: string, filePath: string): boolean {
  const relativePath = path.relative(rootDirectory, filePath);
  return relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function contentTypeForVideo(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mov': return 'video/quicktime';
    case '.webm': return 'video/webm';
    case '.mkv': return 'video/x-matroska';
    case '.avi': return 'video/x-msvideo';
    default: return 'video/mp4';
  }
}
