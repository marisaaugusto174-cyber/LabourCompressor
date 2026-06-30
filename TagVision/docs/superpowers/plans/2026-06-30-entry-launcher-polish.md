# Entry and Launcher Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix entry navigation, rounder Liquid Glass surfaces, safe launcher restart, and Finder dialog focus behavior.

**Architecture:** Keep all product data flows unchanged. Modify only the static entry page, shared CSS, the macOS launcher shell script, AppleScript dialog generation, and source-based unit tests that lock those contracts.

**Tech Stack:** HTML/CSS/vanilla JavaScript, Bash, AppleScript through `osascript`, Node `node:test`.

---

## File Structure

- Modify: `apps/web/public/index.html`
  - Replace old descriptive entry page with a minimal Liquid Glass entry that links to `/review.html`.
- Modify: `apps/web/public/styles.css`
  - Add shared radius variables and apply them to core review surfaces.
- Modify: `Start TagVision macOS.command`
  - Add safe stale-server detection and restart.
  - Run dependency sync on each launch.
  - Start the server detached, open browser, exit launcher.
- Modify: `apps/web/local-dialogs.ts`
  - Remove Finder activation from the AppleScript.
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`
  - Update tests for entry page, radius tokens, launcher safety, and Finder behavior.

---

### Task 1: Entry page navigation

- [ ] Write a failing test that asserts `index.html` has no old marketing copy, contains `<h1>TagVision</h1>`, and exposes `/review.html` text `进入检视台`.
- [ ] Run `npm test -- packages/testing/unit/web/tag-review-ui.test.ts` and verify failure.
- [ ] Replace `index.html` with the minimal Liquid Glass entry page.
- [ ] Run the focused test and verify pass.
- [ ] Commit `fix: simplify entry page navigation`.

### Task 2: Rounded module radii

- [ ] Write a failing test that asserts CSS variables `--radius-surface`, `--radius-card`, `--radius-control`, `--radius-inner`, and key selectors use them.
- [ ] Run focused test and verify failure.
- [ ] Add radius variables and update key panel/card/control/detail selectors.
- [ ] Run focused test and verify pass.
- [ ] Commit `style: round review glass surfaces`.

### Task 3: Safe launcher restart

- [ ] Write a failing test that asserts the launcher contains `stop_existing_tagvision_servers`, `is_tagvision_server_process`, `npm install --no-audit --no-fund`, `nohup npm run web`, refuses non-TagVision port owners, and no longer opens existing stale service.
- [ ] Run focused test and verify failure.
- [ ] Rewrite the launcher logic to stop only verified TagVision servers and then start the current folder server detached.
- [ ] Run focused test and verify pass.
- [ ] Commit `fix: restart launcher with current TagVision server`.

### Task 4: Finder dialog focus

- [ ] Write a failing test that asserts `local-dialogs.ts` does not contain `tell application "Finder" to activate` and still contains `choose folder`.
- [ ] Run focused test and verify failure.
- [ ] Remove the Finder activation line from `buildChoosePathScript`.
- [ ] Run focused test and verify pass.
- [ ] Commit `fix: avoid activating Finder for folder picker`.

### Task 5: Verification

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run pack:macos:v0.1`.
- [ ] Browser-check `/` and `/review.html` on `127.0.0.1:4312`.
- [ ] Merge to `main`, rerun verification, push.

---

## Self-Review

- Spec coverage: All four user requests are mapped to tests and implementation tasks.
- Placeholder scan: No placeholders remain.
- Type consistency: File paths, function names, and test targets match the current codebase.
