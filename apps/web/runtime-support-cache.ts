import path from 'node:path';
import { readdir, readFile, rm, stat } from 'node:fs/promises';

import { type VideoCacheEntry, type VideoCacheStats } from './runtime-support-types.ts';

const DEFAULT_CACHE_EXPIRY_DAYS = 7;

export async function getVideoCacheStats(
  cacheRootDirectory: string
): Promise<VideoCacheStats> {
  try {
    const buckets = await readdir(cacheRootDirectory, { withFileTypes: true });
    let fileCount = 0;
    let totalBytes = 0;

    for (const bucket of buckets.filter((item) => item.isDirectory())) {
      const bucketEntries = await readdir(path.join(cacheRootDirectory, bucket.name), {
        withFileTypes: true
      });

      for (const entry of bucketEntries.filter((item) => item.isFile())) {
        fileCount += 1;
        totalBytes += (await stat(path.join(cacheRootDirectory, bucket.name, entry.name))).size;
      }
    }

    return Object.freeze({
      rootDirectory: cacheRootDirectory,
      exists: true,
      bucketCount: buckets.filter((item) => item.isDirectory()).length,
      fileCount,
      totalBytes,
      entries: Object.freeze(await readVideoCacheEntries(cacheRootDirectory, buckets))
    });
  } catch {
    return Object.freeze({
      rootDirectory: cacheRootDirectory,
      exists: false,
      bucketCount: 0,
      fileCount: 0,
      totalBytes: 0,
      entries: Object.freeze([])
    });
  }
}

export async function clearVideoCache(input: {
  readonly cacheRootDirectory: string;
  readonly mode: 'all' | 'expired';
  readonly expiryDays?: number;
}): Promise<VideoCacheStats> {
  if (input.mode === 'all') {
    await rm(input.cacheRootDirectory, { recursive: true, force: true });
    return getVideoCacheStats(input.cacheRootDirectory);
  }

  const expiryMs = (input.expiryDays ?? DEFAULT_CACHE_EXPIRY_DAYS) * 24 * 60 * 60 * 1000;
  const now = Date.now();

  try {
    const buckets = await readdir(input.cacheRootDirectory, { withFileTypes: true });

    for (const bucket of buckets.filter((item) => item.isDirectory())) {
      const bucketPath = path.join(input.cacheRootDirectory, bucket.name);
      const metadataPath = path.join(bucketPath, 'metadata.json');

      try {
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { cachePath?: string };
        const targetPath =
          typeof metadata.cachePath === 'string' && metadata.cachePath.length > 0
            ? metadata.cachePath
            : metadataPath;
        const targetStat = await stat(targetPath);

        if (now - targetStat.mtimeMs >= expiryMs) {
          await rm(bucketPath, { recursive: true, force: true });
        }
      } catch {
        await rm(bucketPath, { recursive: true, force: true });
      }
    }
  } catch {
    // ignore missing cache directory
  }

  return getVideoCacheStats(input.cacheRootDirectory);
}

async function readVideoCacheEntries(
  cacheRootDirectory: string,
  buckets: readonly import('node:fs').Dirent[]
): Promise<readonly VideoCacheEntry[]> {
  const entries: VideoCacheEntry[] = [];

  for (const bucket of buckets.filter((item) => item.isDirectory())) {
    try {
      const metadataPath = path.join(cacheRootDirectory, bucket.name, 'metadata.json');
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>;
      entries.push(
        Object.freeze({
          bucketId: bucket.name,
          cachePath: String(metadata.cachePath ?? ''),
          profileId: String(metadata.profileId ?? ''),
          sourceDurationSec: Number(metadata.sourceDurationSec ?? 0),
          sourceFps: Number(metadata.sourceFps ?? 0),
          cacheSizeBytes: Number(metadata.cacheSizeBytes ?? 0)
        })
      );
    } catch {
      // ignore broken metadata entries here; clear-expired handles them
    }
  }

  return Object.freeze(entries);
}
