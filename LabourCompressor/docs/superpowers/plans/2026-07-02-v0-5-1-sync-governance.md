# V0.5.1 Governance Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize LabourCompressor product, release, governance, PRD, task-list, UI, and bundle version references to `v0.5.1`, and resolve current documentation conflicts in favor of verified V0.5.1 behavior.

**Architecture:** This is a documentation and governance-test alignment change. Product release references become `V0.5.1`; taxonomy asset versions such as V0.1, V0.2, and V0.3 remain unchanged. The archive conflict is resolved by documenting `核心动作/主动作` as the current V0.3 archive path policy and `内容题材` as legacy compatibility only. The segmentation duration conflict is resolved to the current `5-60s` hard range with `5-30s` preferred.

**Tech Stack:** Markdown governance docs, Node.js built-in test runner, TypeScript, static Web HTML, macOS plist template.

---

### Task 1: Lock The V0.5.1 Version Contract

**Files:**
- Modify: `packages/testing/unit/governance/v05-version-baseline.test.ts`
- Modify: `apps/web/public/index.html`
- Modify: `packages/features/desktop/domain/macos-app-bundle.ts`
- Modify: `README.md`
- Rename: `docs/release/V0.5_RELEASE_NOTES.md` to `docs/release/V0.5.1_RELEASE_NOTES.md`

- [ ] **Step 1: Update the governance test to require `v0.5.1` everywhere**

Change the test expectations so package metadata, UI badge, macOS bundle plist, current product docs, README release link, and release notes heading all point to `V0.5.1` / `0.5.1`.

- [ ] **Step 2: Run the targeted test and confirm the old state fails**

Run: `node --test packages/testing/unit/governance/v05-version-baseline.test.ts`

Expected before implementation: failure on the UI badge, macOS bundle version, product-document version references, README release link, or release notes heading.

- [ ] **Step 3: Update user-facing and release files**

Set the Web badge to `V0.5.1`, macOS plist versions to `0.5.1`, README release baseline text to `V0.5.1`, and release notes heading/tag to `V0.5.1` / `v0.5.1`.

- [ ] **Step 4: Re-run the targeted test**

Run: `node --test packages/testing/unit/governance/v05-version-baseline.test.ts`

Expected after implementation: PASS.

### Task 2: Resolve Archive Semantics

**Files:**
- Modify: `02_AGENTS_WORKFLOW.md`
- Modify: `03_STRICT_RULES.md`
- Modify: `PRD.md`
- Modify: `TASKLIST.md`
- Modify: `CSV格式要求.md`
- Modify: `NUMBERS格式要求.md`

- [ ] **Step 1: Update governance and product docs**

Replace current-flow `内容题材` archive statements with the current V0.3 rule: archive consumes exactly one legal `核心动作/主动作` complete path. Keep legacy `内容题材` only in compatibility statements for V0.1, V0.2, and already-persisted historical paths.

- [ ] **Step 2: Verify no current-flow document still says unique `内容题材` archive**

Run: `rg -n -F '唯一内容题材归档' PRD.md TASKLIST.md 02_AGENTS_WORKFLOW.md 03_STRICT_RULES.md`

Expected: no matches.

Run: `rg -n -F '归档只消费唯一 `内容题材`' 02_AGENTS_WORKFLOW.md 03_STRICT_RULES.md PRD.md TASKLIST.md`

Expected: no matches.

### Task 3: Resolve Duration And Portable Path Drift

**Files:**
- Modify: `PRD.md`
- Modify: `TASKLIST.md`

- [ ] **Step 1: Update segmentation duration references**

Replace current-flow `3-30s` statements with `5-60s` hard range and `5-30s` preferred range. Replace problem category `无法满足 3-30s` with `无法满足 5-60s`.

- [ ] **Step 2: Remove local absolute path drift**

Replace the TASKLIST related-document path `/Users/tianyi/Desktop/codex/jobtask/PRD.md` with `PRD.md`.

- [ ] **Step 3: Verify no stale duration or local path remains**

Run: `rg -n '3-30s|/Users/tianyi' PRD.md TASKLIST.md`

Expected: no matches.

### Task 4: Verify The Full Governance Contract

**Files:**
- No further edits expected.

- [ ] **Step 1: Run formatting diff check**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 2: Run governance tests**

Run: `node --test packages/testing/unit/governance/*.test.ts`

Expected: all tests pass.

- [ ] **Step 3: Run full verification**

Run: `npm run verify`

Expected: typecheck and full test suite pass.
