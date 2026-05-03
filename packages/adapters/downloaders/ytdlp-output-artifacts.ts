import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

import { type DownloadArtifact } from '../../features/download/domain/index.ts';

export async function collectDownloadedArtifacts(input: {
  readonly outputDirectory: string;
  readonly outputFileStem: string;
  readonly beforeFiles: ReadonlySet<string>;
  readonly reportedFilePaths: readonly string[];
}): Promise<readonly DownloadArtifact[]> {
  const afterFiles = await safeReadDir(input.outputDirectory);
  const matchingFiles = afterFiles.filter(
    (fileName) =>
      fileName.startsWith(`${input.outputFileStem}.`) &&
      !isTransientDownloadFile(fileName)
  );
  const prioritizedFiles = [
    ...matchingFiles.filter((fileName) => !input.beforeFiles.has(fileName)),
    ...matchingFiles.filter((fileName) => input.beforeFiles.has(fileName))
  ];
  const candidates = [
    ...input.reportedFilePaths.map((filePath) =>
      Object.freeze({
        filePath,
        fileName: path.basename(filePath),
        isReportedFinalOutput: true
      })
    ),
    ...prioritizedFiles.map((fileName) =>
      Object.freeze({
        filePath: path.join(input.outputDirectory, fileName),
        fileName,
        isReportedFinalOutput: false
      })
    )
  ];
  const seenPaths = new Set<string>();
  const artifacts: DownloadArtifact[] = [];

  for (const candidate of candidates) {
    const normalizedPath = path.resolve(candidate.filePath);

    if (seenPaths.has(normalizedPath)) {
      continue;
    }
    seenPaths.add(normalizedPath);

    if (!(await fileExists(normalizedPath)) || isTransientDownloadFile(candidate.fileName)) {
      continue;
    }

    artifacts.push(
      classifyArtifact({
        fileName: candidate.fileName,
        filePath: normalizedPath,
        outputFileStem: input.outputFileStem,
        isReportedFinalOutput: candidate.isReportedFinalOutput
      })
    );
  }

  return Object.freeze(artifacts);
}

export function extractReportedFilePaths(stdout: string): readonly string[] {
  return Object.freeze(
    stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('LCFILE:'))
      .map((line) => line.slice('LCFILE:'.length).trim())
      .filter((value) => value.length > 0)
  );
}

function classifyArtifact(input: {
  readonly fileName: string;
  readonly filePath: string;
  readonly outputFileStem: string;
  readonly isReportedFinalOutput: boolean;
}): DownloadArtifact {
  const extension = path.extname(input.fileName).slice(1).toLowerCase();
  const baseName = path.basename(input.fileName, path.extname(input.fileName));
  let kind: DownloadArtifact['kind'] = 'video-only';

  if (isAudioExtension(extension)) {
    kind = 'audio-only';
  } else if (input.isReportedFinalOutput || baseName === input.outputFileStem) {
    kind = 'muxed-video';
  }

  return Object.freeze({
    kind,
    filePath: input.filePath,
    fileName: input.fileName,
    container: extension
  });
}

function isAudioExtension(extension: string): boolean {
  return ['m4a', 'aac', 'mp3', 'wav', 'opus'].includes(extension);
}

function isTransientDownloadFile(fileName: string): boolean {
  return fileName.endsWith('.part') || fileName.endsWith('.ytdl');
}

async function safeReadDir(directoryPath: string): Promise<readonly string[]> {
  try {
    return Object.freeze(await readdir(directoryPath));
  } catch {
    return Object.freeze([]);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
