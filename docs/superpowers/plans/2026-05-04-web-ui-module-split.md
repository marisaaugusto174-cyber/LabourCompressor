# Web UI Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1020-line Web UI `app.js` into focused ES modules while preserving browser behavior.

**Architecture:** Keep `app.js` as the page coordinator. Move API calls, form state, path picking/drop handling, task status rendering, result rendering, and config dialogs into independent browser ES modules under `apps/web/public/`.

**Tech Stack:** Browser ES modules, vanilla JavaScript, local Web UI served by `apps/web/server.ts`, Node test suite.

---

## File Structure

Create:

- `apps/web/public/api-client.js`
- `apps/web/public/form-state.js`
- `apps/web/public/path-inputs.js`
- `apps/web/public/task-status-view.js`
- `apps/web/public/results-view.js`
- `apps/web/public/config-dialogs.js`

Modify:

- `apps/web/public/app.js`

Do not modify:

- Backend API paths.
- `apps/web/public/index.html`, unless cache busting is required after verification.
- Product behavior or field names.

## Tasks

### Task 1: Extract API Client

- Move `apiGet`, `apiPost`, `uploadDroppedFile`, and `buildDebugJson` into `api-client.js`.
- Export those functions.
- Import them from `app.js` and other modules.

### Task 2: Extract Form State

- Move `setField`, `fieldValue`, `collectFormData`, `validateRequiredFields`, `findNamedField`, `escapeHtml`, and `updateFilledState` into `form-state.js`.
- Initialize the module with the form element and optional change callback.
- Preserve current behavior when spreadsheet or manual edit fields change.

### Task 3: Extract Path Inputs

- Move picker binding, drop target binding, dropped path resolution, file URI decode, and drag upload flow into `path-inputs.js`.
- Keep directory drops as a user-facing warning that says to use “选择目录”.
- Reuse `apiPost`, `uploadDroppedFile`, `setField`, and a provided output node.

### Task 4: Extract Status View

- Move source/platform/next-action labels, task model/source/platform inference, phase/status humanization, overall status derivation, and reset logic into `task-status-view.js`.
- The module should receive DOM refs and callbacks for model label/form field access.

### Task 5: Extract Results View

- Move result cards, AfterEdit file cards, failure code labels, failure hints, filename derivation, and stage class derivation into `results-view.js`.
- Keep HTML output identical.

### Task 6: Extract Config Dialogs

- Move provider config and platform credential dialog logic into `config-dialogs.js`.
- Keep API paths and payloads unchanged.
- Rebind picker buttons after rendering platform credential fields.

### Task 7: Reduce `app.js` to Coordinator

- `app.js` should own boot, default loading, task start/preflight, event stream, polling, exports, and module wiring.
- Target `app.js` under 500 lines.
- All newly created JS files must also stay under 500 lines.

### Task 8: Verify

- Run line count check:

```bash
wc -l apps/web/public/*.js
```

- Run tests:

```bash
npm run test:taxonomy-domain
```

- Run a static import smoke check:

```bash
node --check apps/web/public/app.js
```

Expected:

- Every `apps/web/public/*.js` file is below 500 lines.
- Full test suite passes.
- `node --check` reports no syntax errors.
