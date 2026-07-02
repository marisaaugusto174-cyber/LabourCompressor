# TagVision Launch Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LabourCompressor's built-in review page entry with a launcher that starts TagVision.

**Architecture:** LabourCompressor exposes a small `POST /api/tagvision/launch` route that delegates to a server-side launcher. The web header button calls that route and reports running/success/failure states. The old LabourCompressor `/review.html` page is removed from the static route surface.

**Tech Stack:** Node HTTP route handlers, Node `child_process`, existing browser `apiPost`, Node test runner.

---

### Task 1: Backend launcher route

**Files:**
- Create: `apps/web/tagvision-launcher.ts`
- Create: `apps/web/api/routes/tagvision-launch.ts`
- Modify: `apps/web/api/context.ts`
- Modify: `apps/web/api/routes/index.ts`
- Modify: `apps/web/server.ts`
- Test: `packages/testing/unit/web/tagvision-launch.test.ts`

- [ ] Write failing route and launcher tests.
- [ ] Verify tests fail because the route and launcher do not exist.
- [ ] Implement the minimal launcher and route.
- [ ] Verify tests pass.

### Task 2: Remove old LabourCompressor review page entry

**Files:**
- Modify: `apps/web/api/routes/static.ts`
- Modify: `apps/web/public/index.html`
- Test: `packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] Update tests to require no `/review.html` link and no static `/review.html` route.
- [ ] Verify tests fail against the current route and link.
- [ ] Remove the static `/review.html` branch and replace the header link with a button.
- [ ] Verify tests pass.

### Task 3: Frontend launch behavior

**Files:**
- Create: `apps/web/public/tagvision-launch.js`
- Modify: `apps/web/public/app.js`
- Modify: `apps/web/public/index.html`
- Modify: `apps/web/public/styles.css`
- Test: `packages/testing/unit/web/tag-review-ui.test.ts`
- Test: `packages/testing/unit/web/v04-stage-ui.test.ts`

- [ ] Write tests for the button, status region, module import, and API path.
- [ ] Verify tests fail because the frontend module is absent.
- [ ] Implement the module and styles.
- [ ] Verify Web tests pass.

### Task 4: Final verification

- [ ] Run `node --test packages/testing/unit/web/*.test.ts`.
- [ ] Run `git diff --check`.
- [ ] Confirm changed files are limited to LabourCompressor.
