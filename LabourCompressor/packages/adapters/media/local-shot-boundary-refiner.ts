import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  applyShotBoundaryRefinements,
  type CandidateShot,
  type ShotBoundaryRefinementDecision,
  type ShotBoundaryRefinementResult,
  type ShotBoundaryRefinerPort,
  type ShotBoundaryQuality,
  type ShotBoundaryPseudoCutCategory
} from '../../features/segmentation/domain/index.ts';

const execFileAsync = promisify(execFile);

export interface LocalShotBoundaryRefinerOptions {
  readonly pythonPath: string;
  readonly scriptPath: string;
  readonly environment?: Readonly<Record<string, string>> | undefined;
}

export function createLocalShotBoundaryRefiner(
  options: LocalShotBoundaryRefinerOptions
): ShotBoundaryRefinerPort {
  return Object.freeze({
    async refineShots(input: Parameters<ShotBoundaryRefinerPort['refineShots']>[0]) {
      if (input.shots.length < 2) {
        return applyShotBoundaryRefinements({
          algorithmVersion: 'atomic-boundary-refinement-v1',
          shots: input.shots,
          durationSeconds: input.durationSeconds,
          frameRate: input.frameRate,
          boundaries: []
        });
      }
      const directory = await mkdtemp(path.join(tmpdir(), 'labour-shot-refine-'));
      try {
        const requestPath = path.join(directory, 'request.json');
        const outputPath = path.join(directory, 'output.json');
        await writeFile(requestPath, JSON.stringify({
          inputFilePath: input.filePath,
          boundaries: input.shots.slice(0, -1).map(createBoundaryRequest),
          durationSeconds: input.durationSeconds,
          frameRate: input.frameRate
        }), 'utf8');
        await execFileAsync(options.pythonPath, [
          options.scriptPath, '--request', requestPath, '--output', outputPath
        ], {
          env: { ...process.env, ...options.environment },
          ...(input.signal === undefined ? {} : { signal: input.signal })
        });
        return parseShotBoundaryRefinementOutput(await readFile(outputPath, 'utf8'), input);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
}

function createBoundaryRequest(shot: CandidateShot): {
  readonly originalSeconds: number;
  readonly originalFrame?: number | undefined;
} {
  return Object.freeze({
    originalSeconds: shot.endSeconds,
    ...(shot.endFrame === undefined ? {} : { originalFrame: shot.endFrame })
  });
}

export function parseShotBoundaryRefinementOutput(
  raw: string,
  context: {
    readonly shots: readonly CandidateShot[];
    readonly durationSeconds: number;
    readonly frameRate: number;
  }
): ShotBoundaryRefinementResult {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.boundaries)) {
    throw new Error('Shot boundary refinement output must include boundaries.');
  }
  return applyShotBoundaryRefinements({
    algorithmVersion: readString(parsed.algorithmVersion, 'atomic-boundary-refinement-v1'),
    shots: context.shots,
    durationSeconds: context.durationSeconds,
    frameRate: context.frameRate,
    boundaries: parsed.boundaries.map(readBoundary)
  });
}

function readBoundary(value: unknown): ShotBoundaryRefinementDecision {
  if (!isRecord(value)) throw new Error('Shot boundary refinement must be an object.');
  return Object.freeze({
    originalSeconds: readFinite(value.originalSeconds, 'originalSeconds'),
    refinedSeconds: readFinite(value.refinedSeconds, 'refinedSeconds'),
    ...(value.refinedFrame === undefined ? {} : { refinedFrame: readInteger(value.refinedFrame, 'refinedFrame') }),
    accepted: readBoolean(value.accepted, 'accepted'),
    reason: readString(value.reason, 'unknown'),
    ...(value.quality === undefined ? {} : { quality: readQuality(value.quality) }),
    ...(value.pseudoCutCategory === undefined ? {} : {
      pseudoCutCategory: readPseudoCutCategory(value.pseudoCutCategory)
    }),
    metrics: Object.freeze(readMetrics(value.metrics))
  });
}

function readMetrics(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function readFinite(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Shot boundary ${fieldName} must be finite.`);
  }
  return value;
}

function readInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Shot boundary ${fieldName} must be an integer.`);
  }
  return value;
}

function readBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Shot boundary ${fieldName} must be boolean.`);
  }
  return value;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readQuality(value: unknown): ShotBoundaryQuality {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  throw new Error('Shot boundary quality must be high, medium or low.');
}

function readPseudoCutCategory(value: unknown): ShotBoundaryPseudoCutCategory {
  if (value === 'effect-flash-internal' || value === 'motion-blur-internal') return value;
  throw new Error('Shot boundary pseudo cut category is invalid.');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
