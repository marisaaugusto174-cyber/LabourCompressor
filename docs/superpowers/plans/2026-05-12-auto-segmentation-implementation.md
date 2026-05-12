# Auto Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build V0.3 automatic segmentation so downloaded long videos are split into valid `3-30s` clips before `AfterEdit`, with about `80%` effective-content coverage and problem clips isolated.

**Architecture:** Add a focused segmentation feature with pure domain rules for records, continuity assembly, duration governance, and fingerprints. Put all media probing, scene detection, export, and filesystem writes behind media adapters. Integrate through the existing local pipeline so Web UI and CLI trigger use cases without directly calling `ffmpeg`, `PySceneDetect`, or filesystem operations.

**Tech Stack:** Node.js 22, TypeScript strict mode, `node:test`, `xlsx`, `ffmpeg`/`ffprobe`, optional `scenedetect` CLI for V0.3 scene detection.

---

## V0.2 Baseline Protection

Before implementation begins, preserve the existing V0.2 baseline and keep V0.3 work isolated.

- Existing local tag: `v0.2.0` at `c24bc1e`.
- Current `origin/main`: `358ad1d fix: simplify first-run local setup`.
- Current `main` includes V0.3 design-only commits after `origin/main`.
- Remote tag verification failed in the current environment because GitHub credentials were unavailable. Do not delete or rewrite local `v0.2.0`, `origin/main`, or existing history.

Execution branch for code work:

```bash
git switch -c codex/v0.3-auto-segmentation
```

Expected:

```text
Switched to a new branch 'codex/v0.3-auto-segmentation'
```

## File Structure

Create:

- `packages/features/segmentation/domain/segmentation-records.ts`: public segmentation types, status constants, problem categories.
- `packages/features/segmentation/domain/segmentation-policy.ts`: duration governance, segment assembly, forced split policy.
- `packages/features/segmentation/domain/index.ts`: named exports.
- `packages/adapters/media/ffprobe-media-info.ts`: `ffprobe` duration/resolution helper.
- `packages/adapters/media/pyscenedetect-boundary-detector.ts`: `scenedetect` command adapter and output parser.
- `packages/adapters/media/ffmpeg-segment-exporter.ts`: `ffmpeg` segment export adapter.
- `apps/cli/local-pipeline-segmentation.ts`: local pipeline glue between downloaded assets, segmentation domain, adapters, `AfterEdit`, and problem clips.
- `packages/testing/unit/segmentation/segmentation-records.test.ts`
- `packages/testing/unit/segmentation/segmentation-policy.test.ts`
- `packages/testing/unit/media/ffmpeg-segment-exporter.test.ts`
- `packages/testing/unit/media/pyscenedetect-boundary-detector.test.ts`
- `packages/testing/integration/phase5/phase5-auto-segmentation-cli.test.ts`

Modify:

- `packages/core/contracts/decision-fingerprint.ts`: add segmentation entity type.
- `apps/cli/local-pipeline-command.ts`: add V0.3 auto-segmentation options and call the segmentation stage before tagging.
- `apps/cli/main.ts`: expose CLI flags for auto segmentation.
- `apps/web/task-service.ts`: persist new options without stripping them.
- `apps/web/public/form-state.js`: add default auto-segmentation form values.
- `apps/web/public/api-client.js`: send auto-segmentation options to task creation.
- `apps/web/public/task-status-view.js`: render auto-segmentation status labels.
- `apps/web/public/task-list-view.js`: show segmentation counts in task summaries.
- `apps/web/public/styles.css`: style the compact V0.3 controls.
- `package.json`: include new tests in `npm run test:taxonomy-domain`.
- `scripts/setup-macos.sh`: check or document optional `scenedetect` availability.

## Task 1: Branch and Baseline Guard

**Files:**
- No source files changed.

- [ ] **Step 1: Create the V0.3 branch**

Run:

```bash
git switch -c codex/v0.3-auto-segmentation
git status --short
git tag --list 'v0.2*'
git log --oneline --decorate -5
```

Expected:

```text
v0.2.0
```

The log must still show `v0.2.0` on an older commit and the current V0.3 design commits on the new branch.

- [ ] **Step 2: Commit nothing**

Run:

```bash
git status --short
```

Expected: no source changes from this task.

## Task 2: Segmentation Records and Fingerprints

**Files:**
- Create: `packages/features/segmentation/domain/segmentation-records.ts`
- Create: `packages/features/segmentation/domain/index.ts`
- Modify: `packages/core/contracts/decision-fingerprint.ts`
- Test: `packages/testing/unit/segmentation/segmentation-records.test.ts`

- [ ] **Step 1: Write the failing record tests**

Create `packages/testing/unit/segmentation/segmentation-records.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProblemClipRecord,
  createSegmentRecord
} from '../../../features/segmentation/domain/index.ts';

test('creates accepted segment record with duration and source trace', () => {
  const record = createSegmentRecord({
    id: 'seg-1',
    sourceAssetId: 'asset-1',
    sourceFilePath: '/tmp/source.mp4',
    sourceHash: 'hash-1',
    segmentIndex: 1,
    startSeconds: 10,
    endSeconds: 22,
    outputPath: '/tmp/AfterEdit/ad_720P_260512_000012_01.mp4',
    outputFileName: 'ad_720P_260512_000012_01.mp4',
    profileId: 'standard_ad',
    decisionFingerprintId: 'fp-1'
  });

  assert.equal(record.durationSeconds, 12);
  assert.equal(record.status, 'accepted');
  assert.equal(record.segmentIndex, 1);
});

test('creates problem clip record with one of the three V0.3 categories', () => {
  const record = createProblemClipRecord({
    id: 'problem-1',
    sourceAssetId: 'asset-1',
    sourceFilePath: '/tmp/source.mp4',
    sourceHash: 'hash-1',
    segmentIndex: 2,
    problemCategory: 'detection-result-invalid',
    outputPath: '/tmp/ProblemClips/source_problem_02.mp4',
    outputFileName: 'source_problem_02.mp4',
    profileId: 'standard_ad',
    decisionFingerprintId: 'fp-2'
  });

  assert.equal(record.status, 'problem');
  assert.equal(record.problemCategory, 'detection-result-invalid');
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test packages/testing/unit/segmentation/segmentation-records.test.ts
```

Expected: FAIL because `packages/features/segmentation/domain/index.ts` does not exist.

- [ ] **Step 3: Add segmentation records**

Create `packages/features/segmentation/domain/segmentation-records.ts`:

```ts
export const SEGMENTATION_PROFILES = Object.freeze({
  standardAd: 'standard_ad',
  fastCut: 'fast_cut',
  conservative: 'conservative'
} as const);

export type SegmentationProfileId =
  (typeof SEGMENTATION_PROFILES)[keyof typeof SEGMENTATION_PROFILES];

export type ProblemClipCategory =
  | 'duration-rule-unsatisfied'
  | 'export-failed'
  | 'detection-result-invalid';

export interface SegmentRecord {
  readonly id: string;
  readonly sourceAssetId: string;
  readonly sourceFilePath: string;
  readonly sourceHash: string;
  readonly segmentIndex: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly durationSeconds: number;
  readonly outputPath: string;
  readonly outputFileName: string;
  readonly profileId: SegmentationProfileId;
  readonly decisionFingerprintId: string;
  readonly status: 'accepted';
}

export interface ProblemClipRecord {
  readonly id: string;
  readonly sourceAssetId: string;
  readonly sourceFilePath: string;
  readonly sourceHash: string;
  readonly segmentIndex: number;
  readonly outputPath: string;
  readonly outputFileName: string;
  readonly profileId: SegmentationProfileId;
  readonly decisionFingerprintId: string;
  readonly problemCategory: ProblemClipCategory;
  readonly status: 'problem';
}

export function createSegmentRecord(input: Omit<SegmentRecord, 'durationSeconds' | 'status'>): SegmentRecord {
  assertPositiveIndex(input.segmentIndex);
  assertTimeRange(input.startSeconds, input.endSeconds);

  return Object.freeze({
    ...input,
    durationSeconds: roundSeconds(input.endSeconds - input.startSeconds),
    status: 'accepted'
  });
}

export function createProblemClipRecord(input: Omit<ProblemClipRecord, 'status'>): ProblemClipRecord {
  assertPositiveIndex(input.segmentIndex);

  return Object.freeze({
    ...input,
    status: 'problem'
  });
}

function assertPositiveIndex(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Segment index must be a positive integer.');
  }
}

function assertTimeRange(startSeconds: number, endSeconds: number): void {
  if (startSeconds < 0 || endSeconds <= startSeconds) {
    throw new Error('Segment time range must be positive.');
  }
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
```

Create `packages/features/segmentation/domain/index.ts`:

```ts
export * from './segmentation-records.ts';
```

Modify `packages/core/contracts/decision-fingerprint.ts`:

```ts
export type DecisionEntityType =
  | 'download'
  | 'merge-job'
  | 'segmentation-record'
  | 'tag-candidate-set'
  | 'tag-assignment'
  | 'archive-record'
  | 'retrieval-report'
  | 'delivery-request'
  | 'taxonomy-migration';
```

- [ ] **Step 4: Run the record test**

Run:

```bash
node --test packages/testing/unit/segmentation/segmentation-records.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/features/segmentation/domain packages/core/contracts/decision-fingerprint.ts packages/testing/unit/segmentation/segmentation-records.test.ts
git commit -m "feat: add segmentation records"
```

## Task 3: Duration Governance and Segment Assembly

**Files:**
- Create: `packages/features/segmentation/domain/segmentation-policy.ts`
- Modify: `packages/features/segmentation/domain/index.ts`
- Test: `packages/testing/unit/segmentation/segmentation-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create `packages/testing/unit/segmentation/segmentation-policy.test.ts` with tests for:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleSegments,
  enforceSegmentDurations
} from '../../../features/segmentation/domain/index.ts';

test('merges sub-3s shots into adjacent continuity group', () => {
  const segments = assembleSegments({
    shots: [
      { startSeconds: 0, endSeconds: 1.2 },
      { startSeconds: 1.2, endSeconds: 4.8 },
      { startSeconds: 4.8, endSeconds: 10 }
    ],
    continuity: [
      { leftShotIndex: 0, rightShotIndex: 1, mergeWithNext: true, reasonCode: 'action_continuity' },
      { leftShotIndex: 1, rightShotIndex: 2, mergeWithNext: false, reasonCode: 'transition_boundary' }
    ]
  });

  assert.deepEqual(segments, [
    { startSeconds: 0, endSeconds: 4.8 },
    { startSeconds: 4.8, endSeconds: 10 }
  ]);
});

test('forces long segment under 30 seconds', () => {
  const governed = enforceSegmentDurations({
    segments: [{ startSeconds: 0, endSeconds: 45 }],
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30
  });

  assert.deepEqual(governed.accepted, [
    { startSeconds: 0, endSeconds: 22.5, forced: true },
    { startSeconds: 22.5, endSeconds: 45, forced: true }
  ]);
  assert.deepEqual(governed.problems, []);
});
```

- [ ] **Step 2: Run failing policy tests**

Run:

```bash
node --test packages/testing/unit/segmentation/segmentation-policy.test.ts
```

Expected: FAIL because `assembleSegments` and `enforceSegmentDurations` are missing.

- [ ] **Step 3: Implement policy functions**

Create `packages/features/segmentation/domain/segmentation-policy.ts` with pure functions only. It must not import `node:fs`, `child_process`, time, network, or adapters.

Implementation contract:

```ts
export interface CandidateShot {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface ContinuityDecision {
  readonly leftShotIndex: number;
  readonly rightShotIndex: number;
  readonly mergeWithNext: boolean;
  readonly reasonCode:
    | 'visual_continuity'
    | 'action_continuity'
    | 'audio_continuity'
    | 'text_continuity'
    | 'transition_boundary'
    | 'weak_continuity';
}

export interface SegmentTimeRange {
  readonly startSeconds: number;
  readonly endSeconds: number;
}
```

Add `assembleSegments` by walking shots in order and splitting only when the adjacent continuity decision has `mergeWithNext === false`.

Add `enforceSegmentDurations` with these exact rules:

- `<3s`: merge into nearest accepted neighbor when possible; otherwise problem category `duration-rule-unsatisfied`.
- `3-30s`: accepted.
- `>30s`: split into equal windows no longer than `30s`, mark `forced: true`.

Export from `packages/features/segmentation/domain/index.ts`:

```ts
export * from './segmentation-policy.ts';
```

- [ ] **Step 4: Run policy tests**

Run:

```bash
node --test packages/testing/unit/segmentation/segmentation-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/features/segmentation/domain packages/testing/unit/segmentation/segmentation-policy.test.ts
git commit -m "feat: add segmentation duration governance"
```

## Task 4: Media Adapter Command Builders

**Files:**
- Create: `packages/adapters/media/ffprobe-media-info.ts`
- Create: `packages/adapters/media/pyscenedetect-boundary-detector.ts`
- Create: `packages/adapters/media/ffmpeg-segment-exporter.ts`
- Test: `packages/testing/unit/media/pyscenedetect-boundary-detector.test.ts`
- Test: `packages/testing/unit/media/ffmpeg-segment-exporter.test.ts`

- [ ] **Step 1: Write adapter tests**

Test command builders, parsers, and one real `ffmpeg` export using lavfi-generated fixture.

Required assertions:

```ts
assert.deepEqual(buildFfmpegSegmentArgs({
  inputFilePath: '/tmp/source.mp4',
  outputFilePath: '/tmp/out.mp4',
  startSeconds: 5,
  endSeconds: 12
}).slice(0, 8), ['-y', '-ss', '5', '-to', '12', '-i', '/tmp/source.mp4', '-map']);
```

```ts
assert.deepEqual(parseSceneDetectCsv('Start Timecode,End Timecode\\n00:00:00.000,00:00:05.000\\n'), [
  { startSeconds: 0, endSeconds: 5 }
]);
```

- [ ] **Step 2: Run failing adapter tests**

Run:

```bash
node --test packages/testing/unit/media/pyscenedetect-boundary-detector.test.ts packages/testing/unit/media/ffmpeg-segment-exporter.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement adapters**

Adapter constraints:

- Use `execFile`, never shell string execution.
- Return explicit `Result`-style failures or throw only for unexpected adapter failures consistent with existing media adapters.
- Keep command builders exported and unit-tested.
- Do not import feature internals into adapters except public domain types from `packages/features/segmentation/domain/index.ts`.

`ffmpeg-segment-exporter.ts` must create clips with stream copy first:

```ts
export function buildFfmpegSegmentArgs(input: {
  readonly inputFilePath: string;
  readonly outputFilePath: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}): readonly string[] {
  return Object.freeze([
    '-y',
    '-ss',
    String(input.startSeconds),
    '-to',
    String(input.endSeconds),
    '-i',
    input.inputFilePath,
    '-map',
    '0',
    '-c',
    'copy',
    input.outputFilePath
  ]);
}
```

- [ ] **Step 4: Run adapter tests**

Run:

```bash
node --test packages/testing/unit/media/pyscenedetect-boundary-detector.test.ts packages/testing/unit/media/ffmpeg-segment-exporter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/media packages/testing/unit/media
git commit -m "feat: add media segmentation adapters"
```

## Task 5: Pipeline Segmentation Stage

**Files:**
- Create: `apps/cli/local-pipeline-segmentation.ts`
- Modify: `apps/cli/local-pipeline-command.ts`
- Modify: `apps/cli/main.ts`
- Test: `packages/testing/integration/phase5/phase5-auto-segmentation-cli.test.ts`

- [ ] **Step 1: Write failing integration test**

Create a synthetic 45-second local video with `ffmpeg`, run the pipeline with auto segmentation, and assert:

- full source file is not passed to tagging;
- generated `AfterEdit` clips are all `3-30s`;
- forced split clips continue normally;
- `ProblemClips` exists only when there are problem records.

Command for test execution:

```bash
node --test packages/testing/integration/phase5/phase5-auto-segmentation-cli.test.ts
```

Expected: FAIL because pipeline options and segmentation stage do not exist.

- [ ] **Step 2: Add pipeline options**

Extend `RunLocalPipelineOptions`:

```ts
readonly autoSegmentation?: boolean;
readonly segmentationProfileId?: 'standard_ad' | 'fast_cut' | 'conservative';
readonly problemClipsDirectoryName?: string;
```

Add CLI flags in `apps/cli/main.ts`:

```text
--auto-segmentation
--segmentation-profile standard_ad
--problem-clips-directory-name ProblemClips
```

- [ ] **Step 3: Implement `runAutoSegmentationStage`**

`apps/cli/local-pipeline-segmentation.ts` should accept downloaded assets and return:

```ts
{
  readonly segmentedAssets: readonly DownloadedMediaAsset[];
  readonly problemRows: readonly PipelineRowState[];
  readonly failures: readonly RunLocalPipelineFailure[];
}
```

Rules:

- valid clips are written into `downloadDir/AfterEdit`;
- problem media is written into `downloadDir/ProblemClips`;
- generated `DownloadedMediaAsset` entries point to segmented clips, not original full videos;
- problem row status is `自动分割待处理`;
- original downloaded files remain in download cache.

- [ ] **Step 4: Wire before manual gate/tagging**

In `runLocalPipelineCommand`, after remote downloads succeed and before tagging:

```ts
if (input.options.autoSegmentation === true && remoteRows.length > 0) {
  const segmentation = await runAutoSegmentationStage({
    downloadedAssets: downloadBatch.downloadedAssets,
    remoteRows,
    rowByTaskId,
    downloadDirectoryPath: input.options.downloadDir,
    afterEditDirectoryPath,
    problemClipsDirectoryPath: path.join(
      input.options.downloadDir,
      input.options.problemClipsDirectoryName ?? 'ProblemClips'
    ),
    profileId: input.options.segmentationProfileId ?? 'standard_ad',
    startedAt,
    emit
  });
  downloadedAssets.length = 0;
  downloadedAssets.push(...segmentation.segmentedAssets);
  failures.push(...segmentation.failures);
  for (const row of segmentation.problemRows) {
    resultsByRow.set(row.rowNumber, row);
  }
}
```

Manual edit gate remains available for non-V0.3/manual workflows, but V0.3 auto segmentation should be the main path when enabled.

- [ ] **Step 5: Run integration test**

Run:

```bash
node --test packages/testing/integration/phase5/phase5-auto-segmentation-cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli packages/testing/integration/phase5
git commit -m "feat: integrate auto segmentation pipeline"
```

## Task 6: AfterEdit Table and Problem Status

**Files:**
- Modify: `packages/adapters/spreadsheets/local-spreadsheet.ts`
- Modify: `packages/adapters/spreadsheets/local-spreadsheet-helpers.ts`
- Test: `packages/testing/unit/spreadsheet/post-edit-record-sheet.test.ts`

- [ ] **Step 1: Extend spreadsheet test**

Add assertions that valid clips appear in `AfterEdit_归档记录表.xlsx`, while problem clip rows can be emitted with `归档状态 = 自动分割待处理` and `失败信息` containing one of the three categories.

- [ ] **Step 2: Run failing spreadsheet test**

Run:

```bash
node --test packages/testing/unit/spreadsheet/post-edit-record-sheet.test.ts
```

Expected: FAIL until problem row support is added.

- [ ] **Step 3: Add optional problem entries**

Extend `PostEditArchiveRecordFileEntry`:

```ts
readonly archiveState?: string;
readonly failureMessage?: string;
```

When provided, write those values into existing `归档状态` and `失败信息` columns. Do not add new visible columns.

- [ ] **Step 4: Run spreadsheet test**

Run:

```bash
node --test packages/testing/unit/spreadsheet/post-edit-record-sheet.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/spreadsheets packages/testing/unit/spreadsheet/post-edit-record-sheet.test.ts
git commit -m "feat: mark auto segmentation problem rows"
```

## Task 7: Web UI V0.3 Controls

**Files:**
- Modify: `apps/web/public/form-state.js`
- Modify: `apps/web/public/api-client.js`
- Modify: `apps/web/public/task-status-view.js`
- Modify: `apps/web/public/task-list-view.js`
- Modify: `apps/web/public/styles.css`
- Modify: `apps/web/task-service.ts`
- Test: `packages/testing/unit/web/task-list-view.test.ts`
- Test: `packages/testing/unit/cli/runtime-task-service.test.ts`

- [ ] **Step 1: Add failing UI tests**

Assertions:

- automatic segmentation option is sent as `autoSegmentation: true`;
- profile defaults to `standard_ad`;
- task status text can display `自动分割中`, `自动分割完成`, and `自动分割待处理`.

- [ ] **Step 2: Run failing UI tests**

Run:

```bash
node --test packages/testing/unit/web/task-list-view.test.ts packages/testing/unit/cli/runtime-task-service.test.ts
```

Expected: FAIL until UI/status mapping is added.

- [ ] **Step 3: Implement UI controls**

Add a compact post-download/V0.3 option:

```text
自动分割长视频
Profile: standard_ad | fast_cut | conservative
```

Do not expose raw detector thresholds in the first version.

- [ ] **Step 4: Run UI tests**

Run:

```bash
node --test packages/testing/unit/web/task-list-view.test.ts packages/testing/unit/cli/runtime-task-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web packages/testing/unit/web packages/testing/unit/cli
git commit -m "feat: add auto segmentation web controls"
```

## Task 8: Setup, Preflight, and Full Verification

**Files:**
- Modify: `scripts/setup-macos.sh`
- Modify: `README.md`
- Modify: `TASKLIST.md`
- Modify: `03_STRICT_RULES.md`
- Modify: `04_STATE_AND_DATA.md`
- Modify: `05_STEP_BY_STEP_PLAN.md`
- Modify: `package.json`

- [ ] **Step 1: Add test script coverage**

Update `npm run test:taxonomy-domain` to include:

```text
packages/testing/unit/segmentation/*.test.ts
packages/testing/unit/media/*segment*.test.ts
packages/testing/integration/phase5/*.test.ts
```

- [ ] **Step 2: Update docs for V0.3**

Document:

- V0.3 mainline auto segmentation;
- V0.2 is retained by `v0.2.0` and GitHub baseline;
- auto segmentation precedes `AfterEdit`;
- coverage target is about `80%`;
- problem categories are exactly `无法满足 3-30s`, `导出失败`, `检测结果异常`;
- original downloaded files are retained but not tagged.

- [ ] **Step 3: Run focused tests**

Run:

```bash
node --test packages/testing/unit/segmentation/*.test.ts packages/testing/unit/media/*segment*.test.ts packages/testing/integration/phase5/*.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full suite**

Run:

```bash
npm run test:taxonomy-domain
```

Expected: PASS.

- [ ] **Step 5: Run line-count check**

Run:

```bash
find apps packages -name '*.ts' -type f -print0 | xargs -0 wc -l | sort -nr | head -20
```

Expected: no touched source file exceeds `500` lines; no touched function exceeds `60` lines by inspection.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/setup-macos.sh README.md TASKLIST.md 03_STRICT_RULES.md 04_STATE_AND_DATA.md 05_STEP_BY_STEP_PLAN.md
git commit -m "docs: document v0.3 auto segmentation workflow"
```

## Self-Review

Spec coverage:

- `80%` effective-content coverage: Task 8 docs and Task 5 integration acceptance.
- `3-30s`, preferred `5-30s`: Task 3 duration governance and Task 5 integration.
- problem categories: Task 2 records, Task 5 pipeline, Task 6 table.
- forced split normal entry: Task 3 policy and Task 5 integration.
- original file retained but not tagged: Task 5 integration.
- `_01` suffix and segment duration in filename: Task 5 implementation and Task 6 table.
- Candidate/Record/Execution separation: Task 2 records, Task 4 adapters, Task 5 pipeline.
- V0.2 retention: Task 1 baseline guard and Task 8 docs.

Placeholder scan:

- This plan intentionally contains no unresolved implementation markers or unspecified file ownership.

Type consistency:

- Profile ids use `'standard_ad' | 'fast_cut' | 'conservative'`.
- Problem categories use `'duration-rule-unsatisfied' | 'export-failed' | 'detection-result-invalid'`.
- Decision entity type uses `'segmentation-record'`.
