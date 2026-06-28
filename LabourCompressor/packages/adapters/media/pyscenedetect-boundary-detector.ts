import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { type CandidateShot } from '../../features/segmentation/domain/index.ts';

const execFileAsync = promisify(execFile);

export type PySceneDetectDetector = 'adaptive' | 'content';

export interface PySceneDetectInput {
  readonly inputFilePath: string;
  readonly outputDirectoryPath: string;
  readonly detector: PySceneDetectDetector;
}

export interface PySceneDetectBoundaryDetectorOptions {
  readonly binaryPath?: string | undefined;
}

export function createPySceneDetectBoundaryDetector(
  options: PySceneDetectBoundaryDetectorOptions = {}
): {
  detectShots(input: PySceneDetectInput): Promise<readonly CandidateShot[]>;
} {
  const binaryPath = options.binaryPath ?? 'scenedetect';

  return Object.freeze({
    async detectShots(input: PySceneDetectInput): Promise<readonly CandidateShot[]> {
      await mkdir(input.outputDirectoryPath, { recursive: true });
      await execFileAsync(binaryPath, buildPySceneDetectArgs(input));
      const csvPath = path.join(input.outputDirectoryPath, 'scenes.csv');
      return parseSceneDetectCsv(await readFile(csvPath, 'utf8'));
    }
  });
}

export function buildPySceneDetectArgs(
  input: PySceneDetectInput
): readonly string[] {
  return Object.freeze([
    '-i',
    input.inputFilePath,
    input.detector === 'adaptive' ? 'detect-adaptive' : 'detect-content',
    'list-scenes',
    '-o',
    input.outputDirectoryPath,
    '-f',
    'scenes.csv'
  ]);
}

export function parseSceneDetectCsv(raw: string): readonly CandidateShot[] {
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim().length > 0);

  if (lines.length <= 1) {
    return Object.freeze([]);
  }

  const headerLineIndex = lines.findIndex((line) => {
    const headers = splitCsvLine(line);
    return headers.includes('Start Timecode') && headers.includes('End Timecode');
  });

  if (headerLineIndex === -1) {
    throw new Error('SceneDetect CSV must include Start Timecode and End Timecode.');
  }

  const headers = splitCsvLine(lines[headerLineIndex]!);
  const startIndex = headers.indexOf('Start Timecode');
  const endIndex = headers.indexOf('End Timecode');

  return Object.freeze(
    lines.slice(headerLineIndex + 1).map((line) => {
      const cells = splitCsvLine(line);
      return Object.freeze({
        startSeconds: parseTimecode(cells[startIndex] ?? ''),
        endSeconds: parseTimecode(cells[endIndex] ?? '')
      });
    })
  );
}

function splitCsvLine(line: string): readonly string[] {
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/gu, ''));
}

function parseTimecode(value: string): number {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/u.exec(value);

  if (match === null) {
    throw new Error(`Invalid scene timecode: ${value}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  if (!Number.isFinite(totalSeconds)) {
    throw new Error(`Invalid scene timecode: ${value}`);
  }

  return Math.round(totalSeconds * 1000) / 1000;
}
