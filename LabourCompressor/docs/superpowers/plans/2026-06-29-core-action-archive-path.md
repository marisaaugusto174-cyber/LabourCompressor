# Core Action Archive Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new `core-v0.3-drama` tasks require one legal `核心动作/主动作` and archive by that tag's complete path without changing the taxonomy tree, existing labels, spreadsheet schema, or legacy archive paths.

**Architecture:** Add an optional role-aware `archivePathPolicy` to taxonomy preset metadata. Preserve structured tag roles beside existing path arrays, derive one immutable `selectedArchivePath`, and keep filesystem archiving dimension-agnostic. Existing presets and accepted spreadsheet paths retain their compatibility behavior.

**Tech Stack:** Node.js 22, TypeScript 6 strict mode, `node:test`, existing taxonomy parser, xlsx adapters, filesystem archive adapter.

---

## File Structure

- Create `packages/features/tagging/domain/structured-tag-response.ts` for typed structured model tags.
- Create `packages/features/tagging/domain/archive-path-policy.ts` for the policy contract and fail-closed primary-tag selection.
- Modify `apps/cli/taxonomy-presets.ts` and the V0.3 manifest for optional policy configuration.
- Modify `real-model-tagging.ts` and `local-pipeline-tagging.ts` for role-aware prompting, selection, and one repair attempt.
- Modify `pipeline/row-state.ts` and `pipeline/stages/archive.ts` to consume generic paths.
- Modify result presentation and focused tests for classified review failures.

The taxonomy Markdown file must not be modified.

### Task 1: Register the Optional Archive Path Policy

**Files:**
- Create: `packages/features/tagging/domain/archive-path-policy.ts`
- Modify: `packages/features/tagging/domain/index.ts`
- Modify: `apps/cli/taxonomy-presets.ts`
- Modify: `config/repositories/taxonomies/core-v0.3-drama.json`
- Test: `packages/testing/unit/cli/taxonomy-presets.test.ts`

- [ ] **Step 1: Write failing manifest tests**

Assert V0.3 exposes the exact policy and old presets do not:

```ts
assert.deepEqual(preset.archivePathPolicy, {
  dimension: '核心动作',
  primaryRole: '主动作',
  requiredCount: 1,
  onInvalid: 'retry-once-then-review'
});
assert.equal(coreV01.archivePathPolicy, undefined);
```

Create an invalid temporary manifest with `requiredCount: 2` and assert `loadTaxonomyPresetRepository()` throws `/archivePathPolicy/u`.

- [ ] **Step 2: Run the test and verify RED**

```bash
node --test packages/testing/unit/cli/taxonomy-presets.test.ts
```

Expected: FAIL because the policy is not parsed.

- [ ] **Step 3: Implement strict optional parsing**

Create the shared contract in `archive-path-policy.ts` and export it from `domain/index.ts`:

```ts
export interface ArchivePathPolicy {
  readonly dimension: string;
  readonly primaryRole: string;
  readonly requiredCount: 1;
  readonly onInvalid: 'retry-once-then-review';
}
```

Import that type into `taxonomy-presets.ts` and add this property to the existing `TaxonomyPresetDefinition` interface without changing its other fields:

```ts
readonly archivePathPolicy?: ArchivePathPolicy | undefined;
```

Implement `readArchivePathPolicy(value, manifestPath)`. `undefined` remains valid; a present object requires non-empty dimension/role, `requiredCount === 1`, and the exact supported strategy. Include it in `readTaxonomyPresetManifest()`.

- [ ] **Step 4: Opt only V0.3 into the policy**

Append to `core-v0.3-drama.json`, without changing `archiveDimension` or taxonomy Markdown:

```json
"archivePathPolicy": {
  "dimension": "核心动作",
  "primaryRole": "主动作",
  "requiredCount": 1,
  "onInvalid": "retry-once-then-review"
}
```

- [ ] **Step 5: Verify and commit**

```bash
node --test packages/testing/unit/cli/taxonomy-presets.test.ts
npm run typecheck
git add packages/features/tagging/domain/archive-path-policy.ts packages/features/tagging/domain/index.ts apps/cli/taxonomy-presets.ts config/repositories/taxonomies/core-v0.3-drama.json packages/testing/unit/cli/taxonomy-presets.test.ts
git commit -m "feat: configure core action archive policy"
```

### Task 2: Preserve Structured Tag Roles

**Files:**
- Create: `packages/features/tagging/domain/structured-tag-response.ts`
- Modify: `packages/features/tagging/domain/real-model-tagging.ts`
- Modify: `packages/features/tagging/domain/index.ts`
- Test: `packages/testing/unit/tagging/real-model-tagging.test.ts`

- [ ] **Step 1: Add failing parser tests**

Use one main and one secondary action and assert:

```ts
const result = parseModelTaggingResponse(JSON.stringify(response));
assert.deepEqual(result.structuredResponse?.tags.map((tag) => ({
  dimension: tag.dimension,
  tagRole: tag.tagRole,
  labelPath: tag.labelPath
})), [
  { dimension: '核心动作', tagRole: '主动作', labelPath: ['核心动作', '身体动作', '位移动作', '跑动'] },
  { dimension: '核心动作', tagRole: '次动作', labelPath: ['核心动作', '姿态动作', '手势表达'] }
]);
```

Also assert both remain in `candidatePaths`, while array-only responses have no structured result.

- [ ] **Step 2: Run and verify RED**

```bash
node --test packages/testing/unit/tagging/real-model-tagging.test.ts
```

- [ ] **Step 3: Create the parser**

Define:

```ts
export interface StructuredTagCandidate {
  readonly dimension: string;
  readonly labelPath: readonly string[];
  readonly selectedLevel: string;
  readonly tagRole: string;
  readonly entityId: string;
  readonly targetEntityId: string;
  readonly confidenceScore?: number | undefined;
}

export interface StructuredTaggingResponse {
  readonly reviewRequired: boolean;
  readonly reviewReason: string;
  readonly tags: readonly StructuredTagCandidate[];
}
```

`parseStructuredTaggingResponse()` must read `tags`, `fact_tags`, `metadata_tags`, and `production_tags`; normalize snake_case fields; freeze results; and reject invalid archive-relevant field types. Missing unrelated strings normalize to `''`.

- [ ] **Step 4: Return a parallel structured result**

Extend `parseModelTaggingResponse()` and `GenerateModelCandidatePathsResult` with:

```ts
readonly structuredResponse?: StructuredTaggingResponse | undefined;
```

For objects, derive paths from typed tags while keeping `parsedJson` unchanged. Export the contracts from `domain/index.ts`.

- [ ] **Step 5: Verify and commit**

```bash
node --test packages/testing/unit/tagging/real-model-tagging.test.ts
npm run typecheck
git add packages/features/tagging/domain/structured-tag-response.ts packages/features/tagging/domain/real-model-tagging.ts packages/features/tagging/domain/index.ts packages/testing/unit/tagging/real-model-tagging.test.ts
git commit -m "feat: preserve structured tagging roles"
```

### Task 3: Enforce One Legal Primary Action

**Files:**
- Modify: `packages/features/tagging/domain/archive-path-policy.ts`
- Modify: `packages/features/tagging/domain/index.ts`
- Test: `packages/testing/unit/tagging/archive-path-policy.test.ts`

- [ ] **Step 1: Write the failing selector matrix**

Use the parsed V0.3 taxonomy and cover one valid main action, a secondary action that does not affect selection, zero main actions, two main actions, wrong role, wrong dimension root, unknown taxonomy path, mismatched `selectedLevel`, core-action review required, and valid `静止呈现`.

```ts
assert.equal(
  selectArchivePathFromStructuredTags(validInput),
  '核心动作 > 身体动作 > 位移动作 > 跑动'
);
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test packages/testing/unit/tagging/archive-path-policy.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement classified selection**

```ts
export type ArchivePrimaryTagErrorCode =
  | 'archive-primary-tag-missing'
  | 'archive-primary-tag-conflict'
  | 'archive-primary-tag-role-invalid'
  | 'archive-primary-tag-path-invalid'
  | 'archive-primary-tag-review-required';

export class ArchivePrimaryTagError extends Error {
  readonly code: ArchivePrimaryTagErrorCode;

  constructor(code: ArchivePrimaryTagErrorCode, message: string) {
    super(message);
    this.name = 'ArchivePrimaryTagError';
    this.code = code;
  }
}
```

`selectArchivePathFromStructuredTags()` must filter exact dimension/role, require one candidate, require the configured root, validate `selectedLevel === l${labelPath.length}`, and call existing taxonomy legality validation. Never select by depth or order. `targetEntityId` is preserved but is not a directory or selection condition.

- [ ] **Step 4: Verify and commit**

```bash
node --test packages/testing/unit/tagging/archive-path-policy.test.ts
npm run typecheck
git add packages/features/tagging/domain/archive-path-policy.ts packages/features/tagging/domain/index.ts packages/testing/unit/tagging/archive-path-policy.test.ts
git commit -m "feat: enforce unique primary action archive path"
```

### Task 4: Add Role-aware Prompting and One Repair Attempt

**Files:**
- Modify: `packages/features/tagging/domain/real-model-tagging.ts`
- Modify: `apps/cli/local-pipeline-tagging.ts`
- Test: `packages/testing/unit/tagging/real-model-tagging.test.ts`
- Test: `packages/testing/unit/cli/pipeline-tagging-helpers.test.ts`

- [ ] **Step 1: Add failing prompt and repair tests**

Assert a pure policy instruction contains the configured dimension, role and count. Add helper tests proving valid input does not repair; missing/duplicate main action repairs once; repair replaces only `核心动作` tags; other dimensions remain byte-for-byte equivalent; and a second invalid response throws its classified error.

- [ ] **Step 2: Run and verify RED**

```bash
node --test packages/testing/unit/tagging/real-model-tagging.test.ts packages/testing/unit/cli/pipeline-tagging-helpers.test.ts
```

- [ ] **Step 3: Add exact policy prompting**

```ts
export function buildArchivePolicyInstruction(policy: ArchivePathPolicy): string {
  return [
    `The response must include exactly ${policy.requiredCount} tag`,
    `with dimension "${policy.dimension}" and tag_role "${policy.primaryRole}".`,
    'Keep every other applicable tag and preserve the prompt JSON schema.'
  ].join(' ');
}
```

Pass the optional policy through model generation. Old presets and path-array prompting remain unchanged.

- [ ] **Step 4: Implement archive-path resolution and repair**

Add:

```ts
resolveRequiredArchivePath({
  structuredResponse,
  acceptedPaths,
  policy,
  taxonomyTree,
  requestRepair
})
```

Its explicit result contract is:

```ts
interface RequiredArchivePathResolution {
  readonly acceptedPaths: readonly string[];
  readonly structuredResponse?: StructuredTaggingResponse | undefined;
  readonly mergedModelJson?: unknown | undefined;
  readonly selectedArchivePath: string;
  readonly repairApplied: boolean;
}
```

It calls Task 3 selection, catches only `ArchivePrimaryTagError`, requests one structured repair, replaces only tags matching `policy.dimension`, reruns ordinary path validation, and selects again.

When a preset has `archivePathPolicy`, bypass the legacy `resolveRequiredContentTopic()` archive gate; `内容领域` remains an ordinary optional tag. When the policy is absent, call the legacy resolver unchanged.

For simulated path-array fixtures only, exactly one legal path under the configured dimension may be synthesized as the main action; zero or multiple paths fail. This exception must not apply to real model responses.

- [ ] **Step 5: Preserve tags and write the path**

Merge the repair into a cloned `parsedJson.tags` array by replacing only original tags whose `dimension` matches the policy; preserve all top-level fields and all other tag objects. Return this as `mergedModelJson` and write it to the existing sidecar. Keep every accepted non-archive and secondary tag. Build `archivePath` from `selectedArchivePath`. Leave the existing `buildStructuredLevelValues(acceptedPaths, archiveDimension)` compatibility call unchanged so the new policy cannot remove secondary actions.

- [ ] **Step 6: Verify and commit**

```bash
node --test packages/testing/unit/tagging/real-model-tagging.test.ts packages/testing/unit/cli/pipeline-tagging-helpers.test.ts
npm run typecheck
git add packages/features/tagging/domain/real-model-tagging.ts apps/cli/local-pipeline-tagging.ts packages/testing/unit/tagging/real-model-tagging.test.ts packages/testing/unit/cli/pipeline-tagging-helpers.test.ts
git commit -m "feat: repair missing primary action tags"
```

### Task 5: Consume Archive Paths Without Hard-coded Dimensions

**Files:**
- Modify: `apps/cli/pipeline/row-state.ts`
- Modify: `apps/cli/pipeline/stages/archive.ts`
- Test: `packages/testing/unit/cli/pipeline-stages.test.ts`

- [ ] **Step 1: Add failing compatibility cases**

Test all three paths:

```text
视频数据归档库/核心动作/身体动作/位移动作/跑动
视频数据归档库/内容领域/商业营销/产品广告
内容题材/生活方式/日常记录
```

Each must resolve to the expected placement path. Empty/root-only paths remain `等待打标`; already archived rows remain untouched.

- [ ] **Step 2: Run and verify RED**

```bash
node --test packages/testing/unit/cli/pipeline-stages.test.ts
```

- [ ] **Step 3: Implement a generic resolver**

```ts
export function resolveSelectedArchivePath(row: SpreadsheetTaskRow): string | undefined {
  const segments = (row.values['归档路径'] ?? '')
    .split('/').map((part) => part.trim()).filter(Boolean);
  const rootIndex = segments.indexOf('视频数据归档库');
  const relative = rootIndex >= 0 ? segments.slice(rootIndex + 1) : segments;
  return relative.length >= 2 ? relative.join(' > ') : undefined;
}

export const resolveSelectedContentTopicPath = resolveSelectedArchivePath;
```

Keep the alias for one release. Update the stage import only. Do not change placement planning, copy mode, duplicate naming, sidecars, spreadsheet fields or HTTP DTOs.

- [ ] **Step 4: Verify and commit**

```bash
node --test packages/testing/unit/cli/pipeline-stages.test.ts packages/testing/unit/archive/*.test.ts
npm run typecheck
git add apps/cli/pipeline/row-state.ts apps/cli/pipeline/stages/archive.ts packages/testing/unit/cli/pipeline-stages.test.ts
git commit -m "refactor: consume generic archive paths"
```

### Task 6: Surface Classified Review Failures

**Files:**
- Modify: `apps/cli/local-pipeline-tagging.ts`
- Modify: `apps/web/public/results-view.js`
- Test: `packages/testing/unit/cli/pipeline-tagging-helpers.test.ts`
- Test: `packages/testing/unit/web/results-view.test.ts`

- [ ] **Step 1: Add failing mappings**

Assert every Task 3 code reaches `RunLocalPipelineFailure.errorCode`, uses a `待复核：...` archive state, and renders a Chinese action. The existing DTO shape must remain unchanged.

- [ ] **Step 2: Run and verify RED**

```bash
node --test packages/testing/unit/cli/pipeline-tagging-helpers.test.ts packages/testing/unit/web/results-view.test.ts
```

- [ ] **Step 3: Implement explicit mappings**

```ts
const PRIMARY_ACTION_MESSAGES = {
  'archive-primary-tag-missing': '待复核：核心动作主动作缺失',
  'archive-primary-tag-conflict': '待复核：存在多个核心动作主动作',
  'archive-primary-tag-role-invalid': '待复核：核心动作角色不合法',
  'archive-primary-tag-path-invalid': '待复核：核心动作路径不合法',
  'archive-primary-tag-review-required': '待复核：核心动作无法确定'
} as const;
```

Do not classify by parsing error message text. Failed rows keep sidecars but receive no formal archive path or archive file.

- [ ] **Step 4: Verify and commit**

```bash
node --test packages/testing/unit/cli/pipeline-tagging-helpers.test.ts packages/testing/unit/web/results-view.test.ts
npm run typecheck
git add apps/cli/local-pipeline-tagging.ts apps/web/public/results-view.js packages/testing/unit/cli/pipeline-tagging-helpers.test.ts packages/testing/unit/web/results-view.test.ts
git commit -m "feat: report primary action review failures"
```

### Task 7: End-to-end Compatibility and Documentation

**Files:**
- Modify: affected fixtures in `packages/testing/integration/phase3/`, `phase4/`, and `phase5/`
- Modify: `README.md`
- Modify: `01_PROJECT_CHARTER.md`
- Modify: `04_STATE_AND_DATA.md`
- Test: `packages/testing/integration/phase3/*.test.ts`
- Test: `packages/testing/integration/phase4/*.test.ts`
- Test: `packages/testing/integration/phase5/*.test.ts`

- [ ] **Step 1: Add failing V0.3 workflow tests**

Use one main action, one secondary action and unrelated labels. Assert:

```ts
assert.match(result.archivePath, /视频数据归档库\/核心动作\/身体动作\/位移动作\/跑动/u);
assert.equal(sidecar.tags.some((tag) => tag.tag_role === '次动作'), true);
assert.equal(sidecar.tags.some((tag) => tag.dimension === '内容领域'), true);
```

Add a failed-repair case producing no archived media and an explicit historical content-domain path case that stays green.

- [ ] **Step 2: Run integration tests and verify RED**

```bash
node --test packages/testing/integration/phase{3,4,5}/*.test.ts
```

- [ ] **Step 3: Update fixtures and documentation**

Add one legal core-action path to path-array simulation fixtures used with V0.3. Do not alter taxonomy Markdown. Document the new directory root, unique-main-action gate, old-path compatibility and one-repair limit.

- [ ] **Step 4: Run targeted acceptance**

```bash
node --test \
  packages/testing/unit/cli/taxonomy-presets.test.ts \
  packages/testing/unit/tagging/real-model-tagging.test.ts \
  packages/testing/unit/tagging/archive-path-policy.test.ts \
  packages/testing/unit/cli/pipeline-tagging-helpers.test.ts \
  packages/testing/unit/cli/pipeline-stages.test.ts \
  packages/testing/unit/web/results-view.test.ts \
  packages/testing/integration/phase{3,4,5}/*.test.ts
```

- [ ] **Step 5: Run complete acceptance**

```bash
npm run typecheck
npm run verify
node --test packages/testing/unit/governance/*.test.ts
git diff --check
git diff -- config/repositories/taxonomies/核心基座_标签提示词_V0.3_戏核增强候选.md
```

Expected: every test returns 0 and the final command has no output. Scan the diff and logs for cookies, tokens, signed media URLs and raw provider responses.

- [ ] **Step 6: Commit**

```bash
git add README.md 01_PROJECT_CHARTER.md 04_STATE_AND_DATA.md packages/testing
git commit -m "test: cover core action archive workflow"
```

## Final Acceptance

- New V0.3 tasks archive only from one legal `核心动作/主动作`.
- Secondary actions and all unrelated accepted tags remain unchanged.
- Static clips can archive through existing `静止呈现`.
- Invalid primary actions repair exactly once, then stop before archive with a classified review state.
- Existing files and spreadsheet paths are not migrated.
- V0.1, V0.2, HTTP DTOs, spreadsheet columns, copy semantics, sidecars and duplicate handling remain compatible.
- V0.3 taxonomy Markdown has no diff.
