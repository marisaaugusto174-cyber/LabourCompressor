# One-Click Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the generated macOS app launcher so first launch can run project setup before opening the Web UI.

**Architecture:** Keep the existing app bundle generator and native executable. Extend only the generated `Contents/Resources/launcher.sh` with prerequisite detection, setup invocation, and failure dialogs.

**Tech Stack:** TypeScript, Node test runner, Bash launcher script, macOS `osascript`, existing `scripts/setup-macos.sh`.

---

### Task 1: Launcher Script Contract

**Files:**
- Modify: `packages/testing/unit/desktop/macos-app-bundle.test.ts`
- Modify: `packages/features/desktop/domain/macos-app-bundle.ts`

- [ ] **Step 1: Write the failing test**

Add assertions to the existing `creates a macos app bundle spec for the local web ui launcher` test for `scripts/setup-macos.sh`, `needs_setup`, `run_setup`, `node_modules`, `providers.local.json`, `download-platform-credentials.local.json`, and `Setup failed`. Assert that missing `.tools/bin/scenedetect` does not trigger launcher setup by itself.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/testing/unit/desktop/macos-app-bundle.test.ts`

Expected: FAIL because the current launcher script does not include the first-run setup contract.

- [ ] **Step 3: Implement the launcher setup path**

Update `createLauncherScript()` to define `SETUP_SCRIPT`, manual prerequisite helpers, `needs_setup()`, and `run_setup()`. Call setup after Node validation and before port selection.

- [ ] **Step 4: Run desktop launcher tests**

Run: `node --test packages/testing/unit/desktop/macos-app-bundle.test.ts`

Expected: PASS.

### Task 2: Full Verification

**Files:**
- Read: `README.md`
- Run: package test command

- [ ] **Step 1: Run full test suite**

Run: `npm run test:taxonomy-domain`

Expected: `# fail 0`.

- [ ] **Step 2: Generate launcher app locally**

Run: `npm run app:mac`

Expected: `Created macOS app: .../dist/LabourCompressor.app`.

- [ ] **Step 3: Inspect generated launcher**

Run: `rg -n 'needs_setup|run_setup|setup-macos|serve-web-ui' dist/LabourCompressor.app/Contents/Resources/launcher.sh`

Expected: setup functions and Web UI startup are present.
