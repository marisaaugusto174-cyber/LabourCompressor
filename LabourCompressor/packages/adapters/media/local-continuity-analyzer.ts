import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  classifyAudioContinuity,
  classifyMotionContinuity,
  classifyVisualContinuity,
  fuseContinuitySignals,
  type AudioContinuityMetrics,
  type BoundaryContinuityDecision,
  type ContinuityAnalyzerPort,
  type ContinuityThresholds,
  type MotionContinuityMetrics,
  type VisualContinuityMetrics
} from '../../features/segmentation/domain/index.ts';

const execFileAsync = promisify(execFile);

export interface LocalContinuityAnalyzerOptions {
  readonly pythonPath: string;
  readonly scriptPath: string;
  readonly ffmpegPath?: string | undefined;
  readonly environment?: Readonly<Record<string, string>> | undefined;
}

export function createLocalContinuityAnalyzer(
  options: LocalContinuityAnalyzerOptions
): ContinuityAnalyzerPort {
  return Object.freeze({
    async analyzeBoundaries(
      input: Parameters<ContinuityAnalyzerPort['analyzeBoundaries']>[0]
    ) {
      if (input.shots.length < 2) return Object.freeze([]);
      const directory = await mkdtemp(path.join(tmpdir(), 'labour-continuity-'));
      try {
        const requestPath = path.join(directory, 'request.json');
        const outputPath = path.join(directory, 'output.json');
        await writeFile(requestPath, JSON.stringify({
          inputFilePath: input.filePath,
          boundarySeconds: input.shots.slice(0, -1).map((shot) => shot.endSeconds),
          sampling: input.thresholds.sampling,
          ffmpegPath: options.ffmpegPath ?? 'ffmpeg'
        }), 'utf8');
        await execFileAsync(options.pythonPath, [
          options.scriptPath, '--request', requestPath, '--output', outputPath
        ], { env: { ...process.env, ...options.environment } });
        const decisions = parseContinuityMetricsOutput(
          await readFile(outputPath, 'utf8'),
          input.thresholds
        );
        validateBoundaryCount(decisions, input.shots.length - 1);
        return decisions;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
}

export function parseContinuityMetricsOutput(
  raw: string,
  thresholds: ContinuityThresholds
): readonly BoundaryContinuityDecision[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.boundaries)) {
    throw new Error('Continuity analyzer output must include boundaries.');
  }
  return Object.freeze(parsed.boundaries.map((value) =>
    createBoundaryDecision(value, thresholds)
  ));
}

function createBoundaryDecision(
  value: unknown,
  thresholds: ContinuityThresholds
): BoundaryContinuityDecision {
  if (!isRecord(value)) throw new Error('Continuity boundary must be an object.');
  const visual = readVisualMetrics(value.visual);
  const motion = readMotionMetrics(value.motion);
  const audio = readAudioMetrics(value.audio);
  const verdicts = [
    classifyVisualContinuity(visual, thresholds),
    classifyMotionContinuity(motion, thresholds),
    classifyAudioContinuity(audio, thresholds)
  ] as const;
  return Object.freeze({
    boundarySeconds: readFinite(value.boundarySeconds, 'boundarySeconds'),
    visual: Object.freeze({ verdict: verdicts[0], metrics: Object.freeze(visual) }),
    motion: Object.freeze({ verdict: verdicts[1], metrics: Object.freeze(motion) }),
    audio: Object.freeze({ verdict: verdicts[2], metrics: Object.freeze(audio) }),
    classification: fuseContinuitySignals(verdicts)
  });
}

function readVisualMetrics(value: unknown): VisualContinuityMetrics {
  const record = requireRecord(value, 'visual');
  return {
    histogramSimilarity: readFinite(record.histogramSimilarity, 'histogramSimilarity'),
    normalizedFrameDifference: readFinite(
      record.normalizedFrameDifference,
      'normalizedFrameDifference'
    )
  };
}

function readMotionMetrics(value: unknown): MotionContinuityMetrics {
  const record = requireRecord(value, 'motion');
  return {
    beforeMagnitude: readFinite(record.beforeMagnitude, 'beforeMagnitude'),
    afterMagnitude: readFinite(record.afterMagnitude, 'afterMagnitude'),
    directionCosine: readFinite(record.directionCosine, 'directionCosine'),
    magnitudeRatio: readFinite(record.magnitudeRatio, 'magnitudeRatio')
  };
}

function readAudioMetrics(value: unknown): AudioContinuityMetrics {
  const record = requireRecord(value, 'audio');
  if (record.available === false) return { available: false };
  if (record.available !== true) throw new Error('Audio availability must be boolean.');
  return {
    available: true,
    beforeRmsDb: readFinite(record.beforeRmsDb, 'beforeRmsDb'),
    afterRmsDb: readFinite(record.afterRmsDb, 'afterRmsDb'),
    rmsDeltaDb: readFinite(record.rmsDeltaDb, 'rmsDeltaDb'),
    spectrumCosine: readFinite(record.spectrumCosine, 'spectrumCosine')
  };
}

function validateBoundaryCount(
  decisions: readonly BoundaryContinuityDecision[],
  expected: number
): void {
  if (decisions.length !== expected) {
    throw new Error('Continuity analyzer returned an incomplete boundary set.');
  }
}

function requireRecord(value: unknown, fieldName: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`Continuity ${fieldName} metrics must be an object.`);
  return value;
}

function readFinite(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Continuity ${fieldName} must be finite.`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
