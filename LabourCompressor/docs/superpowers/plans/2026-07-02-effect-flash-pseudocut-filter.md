# Effect/Flash Pseudo-Cut Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent same-shot effect/flash peaks from becoming segmentation cut points while preserving high-confidence real shot changes.

**Architecture:** Keep PySceneDetect and frame refinement as the candidate recall path, then add local quality classification to boundary refinement results. Continuity assembly consumes normalized boundary decisions and ignores low-confidence weak boundaries for soft-length splits, while preserving the 5-60s hard rule.

**Tech Stack:** TypeScript domain tests, Node test runner, Python OpenCV/NumPy boundary refiner, existing FFmpeg/OpenCV runtime.

---

### Task 1: Boundary refinement quality model

**Files:**
- Modify: `packages/features/segmentation/domain/shot-boundary-refinement.ts`
- Modify: `packages/adapters/media/local-shot-boundary-refiner.ts`
- Modify: `scripts/refine-shot-boundaries.py`
- Test: `packages/testing/unit/media/shot-boundary-refiner.test.ts`

- [ ] Add optional refinement fields:
  - `quality: 'high' | 'medium' | 'low'`
  - `pseudoCutCategory: 'effect-flash-internal' | 'motion-blur-internal'`
- [ ] Write failing tests proving parser preserves these fields and source boundary metadata carries them into refined shots.
- [ ] Write failing Python test/fixture proving a low-score, low-prominence, low-structure, sustained effect peak is rejected as `effect-flash-internal`.
- [ ] Implement the minimal parser/domain/Python changes.
- [ ] Run `node --test packages/testing/unit/media/shot-boundary-refiner.test.ts`.

### Task 2: Continuity boundary normalization

**Files:**
- Modify: `packages/features/segmentation/domain/continuity-analysis.ts`
- Modify: `packages/adapters/media/local-continuity-analyzer.ts`
- Test: `packages/testing/unit/segmentation/continuity-analysis.test.ts`

- [ ] Add optional fields to `BoundaryContinuityDecision`:
  - `originalClassification`
  - `normalizationReason`
  - `softSplitEligible`
- [ ] Write failing tests for low-confidence visual+motion discontinuity with continuous audio being downgraded from `strong-boundary` to `weak-or-unknown`.
- [ ] Keep high-confidence strong boundaries unchanged.
- [ ] Implement normalization using `CandidateShot.sourceBoundary.quality`.
- [ ] Run `node --test packages/testing/unit/segmentation/continuity-analysis.test.ts`.

### Task 3: Soft split eligibility

**Files:**
- Modify: `packages/features/segmentation/domain/continuity-segmentation.ts`
- Test: `packages/testing/unit/segmentation/continuity-segmentation.test.ts`

- [ ] Write failing test showing a 40-60s range does not split on `weak-or-unknown` when `softSplitEligible=false`.
- [ ] Write passing-control test showing `softSplitEligible=true` still permits soft split after 40s.
- [ ] Preserve `>60s` mandatory splitting even when weak candidates are not soft-eligible.
- [ ] Run `node --test packages/testing/unit/segmentation/continuity-segmentation.test.ts`.

### Task 4: Pipeline diagnostics and regression

**Files:**
- Modify: `apps/cli/local-pipeline-continuity.ts`
- Test: `packages/testing/unit/cli/pipeline-segmentation.test.ts`

- [ ] Ensure `continuity.json` records `originalClassification`, `normalizationReason`, and `softSplitEligible`.
- [ ] Keep `boundary-refinement.json` free of frames, audio, credentials, and media payload.
- [ ] Run:
  ```bash
  node --test \
    packages/testing/unit/media/shot-boundary-refiner.test.ts \
    packages/testing/unit/segmentation/continuity-analysis.test.ts \
    packages/testing/unit/segmentation/continuity-segmentation.test.ts \
    packages/testing/unit/cli/pipeline-segmentation.test.ts
  ```

### Task 5: Real-sample validation

**Files:**
- No committed fixture changes.

- [ ] Re-run `/Users/tianyi/Desktop/LS测试文件/测试集3电影部分` to a new desktop output directory.
- [ ] Verify `哪吒2动画` is not split at source `61.6s`.
- [ ] Verify real cuts around `67.25s` and `70.95s` remain available as boundaries.
- [ ] Verify all accepted computed ranges remain within `5-60s`.
- [ ] Run `npm run verify` and `git diff --check`.
