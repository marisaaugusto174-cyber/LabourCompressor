# Label Studio Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Label Studio from TagVision V0.1 and make local scanning plus accepted-sidecar review the only visible and executable workflow.

**Architecture:** Delete the external-review UI and browser logic first, then remove Label Studio routes, services, import/export builders, and persisted sync-state overlays. Keep the scan, media, thumbnail, taxonomy, and accepted-result contracts unchanged.

**Tech Stack:** TypeScript, Node.js HTTP server, browser JavaScript, HTML/CSS, Node test runner, Plyr.

---

### Task 1: Remove Label Studio from the browser UI

**Files:**
- Modify: `apps/web/public/review.html`
- Modify: `apps/web/public/styles.css`
- Modify: `apps/web/public/tag-review.js`
- Test: `packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] **Step 1: Write the failing UI test**

Replace the existing Label Studio exposure test with assertions that `review.html` contains none of `Label Studio`, `download-ls-package`, `ls-url`, `import-ls`, `sync-ls`, or `open-current-ls-task`. Assert that `tag-review.js` contains no `labelStudio`, `/label-studio/`, `downloadLabelStudioPackage`, `importIntoLabelStudio`, or `syncLabelStudio` references. Add assertions for one `.review-source-bar` containing the directory input and both local actions.

- [ ] **Step 2: Verify the test fails**

Run: `node --test packages/testing/unit/web/tag-review-ui.test.ts`

Expected: FAIL because the current page and script expose Label Studio.

- [ ] **Step 3: Implement the compact local-only interface**

Delete all Label Studio controls and the detail task button. Replace the two-column control layout with:

```html
<div class="review-source-bar">
  <div class="path-meta">...</div>
  <div class="path-control">
    <input id="review-directory" name="reviewDirectory" />
    <button id="choose-review-directory" ...>选择目录</button>
    <button id="scan-button" ...>扫描目录</button>
  </div>
</div>
```

Delete all corresponding DOM refs, listeners, request helpers, status badges, and LS summary rendering from `tag-review.js`. Keep accepted-result status internal to the accepted sidecar and show only `Taxonomy`, `模型复核`, and `标签数` in the detail summary.

- [ ] **Step 4: Verify the UI test passes**

Run: `node --test packages/testing/unit/web/tag-review-ui.test.ts`

Expected: all UI tests pass.

- [ ] **Step 5: Commit the browser removal**

```bash
git add apps/web/public/review.html apps/web/public/styles.css apps/web/public/tag-review.js packages/testing/unit/web/tag-review-ui.test.ts
git commit -m "refactor: remove Label Studio review UI"
```

### Task 2: Remove Label Studio backend and sync state

**Files:**
- Delete: `apps/web/services/label-studio.ts`
- Modify: `apps/web/api/routes/tag-review.ts`
- Modify: `apps/web/tag-review.ts`
- Test: `packages/testing/unit/web/tag-review.test.ts`

- [ ] **Step 1: Write failing backend tests**

Remove tests that exercise Label Studio package/export behavior. Add a scan regression test that places a legacy `_tag-review-state.json` beside a valid video/JSON pair and asserts the scan result has no `reviewStatus`, `reviewNote`, or `labelStudioTaskId` properties. Add source assertions that the route file contains no `/label-studio/` endpoint and `tag-review.ts` contains no `TAG_REVIEW_STATE_FILE_NAME` or `source: 'label-studio'`.

- [ ] **Step 2: Verify the backend test fails**

Run: `node --test packages/testing/unit/web/tag-review.test.ts`

Expected: FAIL because scan still overlays legacy sync state and backend source still contains Label Studio code.

- [ ] **Step 3: Remove external-review implementation**

Delete the Label Studio service import and three API branches. Delete import-package construction, export parsing, sync-state writing/reading, related types, and scan overlays from `tag-review.ts`. Preserve the JSON filename exclusion for `_tag-review-state.json` as a literal legacy-ignore rule so the obsolete file is not treated as an orphan model JSON.

- [ ] **Step 4: Verify backend tests pass**

Run: `node --test packages/testing/unit/web/tag-review.test.ts`

Expected: all backend tests pass and the legacy state file is ignored.

- [ ] **Step 5: Commit backend removal**

```bash
git add apps/web/api/routes/tag-review.ts apps/web/tag-review.ts apps/web/services/label-studio.ts packages/testing/unit/web/tag-review.test.ts
git commit -m "refactor: remove Label Studio integration"
```

### Task 3: Update documentation and verify the packaged product

**Files:**
- Modify: `README.md`
- Verify: `apps/web/public/review.html`
- Verify: `apps/web/public/tag-review.js`
- Verify: `apps/web/api/routes/tag-review.ts`

- [ ] **Step 1: Update product documentation**

Delete the Label Studio section and describe TagVision as a local review tool that writes `.accepted.json` directly. Do not add a future-integration placeholder.

- [ ] **Step 2: Run full automated verification**

Run: `npm test && npm run typecheck && npm run pack:macos:v0.1`

Expected: all tests pass, TypeScript exits successfully, and `dist/TagVision-macOS-V0.1.zip` is written.

- [ ] **Step 3: Verify no integration references remain**

Run:

```bash
rg -n "Label Studio|labelStudio|label-studio|open-current-ls-task|_tag-review-state" apps README.md packages/testing/unit/web
```

Expected: only the intentional legacy filename ignore and its regression test may match `_tag-review-state`; no Label Studio integration references remain.

- [ ] **Step 4: Browser acceptance on port 4312**

Start the packaged server, scan a fixture with video, JSON, taxonomy, and a legacy `_tag-review-state.json`, then verify: compact source bar; no LS controls or status; one review card; detail opens; accepted path removal and save produce a valid `.accepted.json`.

- [ ] **Step 5: Commit documentation and final adjustments**

```bash
git add README.md
git commit -m "docs: describe local-only review workflow"
```
