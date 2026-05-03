# V0.2 Engineering Governance and Security Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a safe V0.2 baseline by separating source files from local runtime/user data and verifying that secrets cannot be committed or logged.

**Architecture:** This plan does not change product behavior. It adds governance verification around `.gitignore`, sensitive local configs, runtime artifacts, baseline manifests, and logging safety before other V0.2 feature work proceeds.

**Tech Stack:** Node.js, native `node --test`, shell utilities, Markdown governance documents, Git.

---

## Scope

This plan covers only engineering baseline readiness, sensitive local config isolation, runtime artifact exclusion, logging safety verification, and baseline manifest generation.

This plan does not cover Web UI feature work, download platform expansion, model provider expansion, spreadsheet behavior changes, or AfterEdit behavior changes.

## File Structure

Files to inspect:

- `/Users/tianyi/Desktop/codex/jobtask/.gitignore`
- `/Users/tianyi/Desktop/codex/jobtask/apps/web/server.ts`
- `/Users/tianyi/Desktop/codex/jobtask/packages/testing/unit/governance/gitignore-baseline.test.ts`
- `/Users/tianyi/Desktop/codex/jobtask/packages/testing/unit/governance/web-server-logging.test.ts`

Files to create:

- `/Users/tianyi/Desktop/codex/jobtask/docs/release/V0.2_BASELINE_MANIFEST.md`
- `/Users/tianyi/Desktop/codex/jobtask/docs/release/V0.2_LOCAL_EXCLUSIONS.md`

Files to modify only if checks fail:

- `/Users/tianyi/Desktop/codex/jobtask/.gitignore`
- `/Users/tianyi/Desktop/codex/jobtask/apps/web/server.ts`
- `/Users/tianyi/Desktop/codex/jobtask/packages/testing/unit/governance/gitignore-baseline.test.ts`
- `/Users/tianyi/Desktop/codex/jobtask/packages/testing/unit/governance/web-server-logging.test.ts`

## Task 1: Verify Current Governance Baseline

**Files:**

- Inspect: `/Users/tianyi/Desktop/codex/jobtask/.gitignore`
- Inspect: `/Users/tianyi/Desktop/codex/jobtask/packages/testing/unit/governance/gitignore-baseline.test.ts`

- [ ] **Step 1: Read the existing ignore contract**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
sed -n '1,120p' .gitignore
sed -n '1,160p' packages/testing/unit/governance/gitignore-baseline.test.ts
```

Expected:

```text
.gitignore includes .cache, .runtime-state, .runtime-uploads, .web-ui.log, .web-ui.pid, .DS_Store, *.local.json, node_modules.
The governance test asserts these required ignore entries.
```

- [ ] **Step 2: Run the governance ignore test**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
node --test packages/testing/unit/governance/gitignore-baseline.test.ts
```

Expected:

```text
pass
```

- [ ] **Step 3: If the test fails, update `.gitignore` minimally**

Use `apply_patch` to add only missing lines:

```gitignore
.cache
.runtime-state
.runtime-uploads
.web-ui.log
.web-ui.pid
.DS_Store
*.local.json
node_modules
```

- [ ] **Step 4: Re-run the governance ignore test**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
node --test packages/testing/unit/governance/gitignore-baseline.test.ts
```

Expected:

```text
pass
```

## Task 2: Verify Logging Does Not Leak Preflight Bodies or Secrets

**Files:**

- Inspect: `/Users/tianyi/Desktop/codex/jobtask/apps/web/server.ts`
- Inspect: `/Users/tianyi/Desktop/codex/jobtask/packages/testing/unit/governance/web-server-logging.test.ts`

- [ ] **Step 1: Run the existing logging safety test**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
node --test packages/testing/unit/governance/web-server-logging.test.ts
```

Expected:

```text
pass
```

- [ ] **Step 2: Search for high-risk logging patterns**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
rg -n "PRELIGHT_BODY|PREFLIGHT_BODY|console\\.log\\(.*body|console\\.log\\(.*apiKey|console\\.log\\(.*cookies" apps packages config -g '!**/*.local.json'
```

Expected:

```text
No matches.
```

- [ ] **Step 3: If a high-risk log exists, remove it**

Example patch shape:

```ts
- console.log('PRELIGHT_BODY', JSON.stringify(uiOptions));
```

Do not replace it with another request body log. If debugging is required later, add a redacted logger in a separate task.

- [ ] **Step 4: Re-run logging safety test**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
node --test packages/testing/unit/governance/web-server-logging.test.ts
```

Expected:

```text
pass
```

## Task 3: Generate Baseline Manifest

**Files:**

- Create: `/Users/tianyi/Desktop/codex/jobtask/docs/release/V0.2_BASELINE_MANIFEST.md`

- [ ] **Step 1: Create release docs directory**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
mkdir -p docs/release
```

Expected: `docs/release` exists.

- [ ] **Step 2: Generate source manifest without local data**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
{
  echo '# V0.2 Baseline Manifest'
  echo
  echo 'Generated: 2026-05-04'
  echo
  echo '## Included Source and Project Files'
  echo
  rg --files \
    -g '!node_modules/**' \
    -g '!.cache/**' \
    -g '!.runtime-state/**' \
    -g '!.runtime-uploads/**' \
    -g '!*.local.json' \
    -g '!.web-ui.log' \
    -g '!.web-ui.pid' \
    -g '!**/.DS_Store' \
    -g '!视频数据下载缓存/**' \
    | sort | sed 's#^#- #'
} > docs/release/V0.2_BASELINE_MANIFEST.md
```

Expected: `docs/release/V0.2_BASELINE_MANIFEST.md` exists and does not list local json configs, cache files, runtime files, `node_modules`, or downloaded videos.

- [ ] **Step 3: Inspect manifest for sensitive paths**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
rg -n "providers\\.local|download-platform-credentials\\.local|\\.cache|\\.web-ui|node_modules|视频数据下载缓存|apiKey|cookies" docs/release/V0.2_BASELINE_MANIFEST.md || true
```

Expected: no matches.

## Task 4: Generate Local Exclusions Report

**Files:**

- Create: `/Users/tianyi/Desktop/codex/jobtask/docs/release/V0.2_LOCAL_EXCLUSIONS.md`

- [ ] **Step 1: Write exclusions report without secret values**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
{
  echo '# V0.2 Local Exclusions'
  echo
  echo 'Generated: 2026-05-04'
  echo
  echo 'These files or directories are intentionally excluded from source baseline and commits.'
  echo
  echo '## Sensitive Local Config'
  echo
  for f in config/model-providers/providers.local.json config/download-platform-credentials.local.json; do
    if [ -e "$f" ]; then echo "- $f"; fi
  done
  echo
  echo '## Runtime Artifacts'
  echo
  for f in .cache .runtime-state .runtime-uploads .web-ui.log .web-ui.pid; do
    if [ -e "$f" ]; then echo "- $f"; fi
  done
  echo
  echo '## User Data and Generated Media'
  for f in 视频数据下载缓存 视频数据采集总表.xlsx; do
    if [ -e "$f" ]; then echo "- $f"; fi
  done
  echo
  echo '## macOS Metadata'
  find . -path './node_modules' -prune -o -name '.DS_Store' -print | sort | sed 's#^./#- #'
} > docs/release/V0.2_LOCAL_EXCLUSIONS.md
```

Expected: `docs/release/V0.2_LOCAL_EXCLUSIONS.md` exists and lists paths only, never API key values or cookie values.

- [ ] **Step 2: Verify exclusions report does not contain secret-like values**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
rg -n "sk-[A-Za-z0-9]|apiKey\\s*[:=]|Authorization|Bearer|SESSDATA|bili_jct" docs/release/V0.2_LOCAL_EXCLUSIONS.md || true
```

Expected: no matches.

## Task 5: Verify Git Status Is Safe to Stage

**Files:**

- Inspect Git working tree only.

- [ ] **Step 1: List untracked and ignored files**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
git status --short
git status --ignored --short | sed -n '1,160p'
```

Expected: source files, docs, config templates, tests, and package files may be untracked; ignored local files include `*.local.json`, `node_modules`, runtime artifacts, and cache paths.

- [ ] **Step 2: Check whether sensitive local configs are ignored**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
git check-ignore -v config/model-providers/providers.local.json
git check-ignore -v config/download-platform-credentials.local.json
```

Expected:

```text
.gitignore:*.local.json config/model-providers/providers.local.json
.gitignore:*.local.json config/download-platform-credentials.local.json
```

- [ ] **Step 3: Check whether runtime files are ignored**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
git check-ignore -v .cache .web-ui.log .web-ui.pid node_modules 2>/dev/null
```

Expected: each existing path is matched by `.gitignore`.

## Task 6: Run Full Verification

**Files:**

- Test all project tests.

- [ ] **Step 1: Run focused governance tests**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
node --test packages/testing/unit/governance/*.test.ts
```

Expected: pass.

- [ ] **Step 2: Run full local test suite**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
npm run test:taxonomy-domain
```

Expected: `150` tests pass, `0` fail.

## Task 7: Commit Safe Baseline Files

**Files:** Stage only safe source, tests, docs, templates, and package files. Do not stage `*.local.json`, runtime artifacts, caches, downloaded videos, or user-specific data.

- [ ] **Step 1: Preview staged candidate list**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
git status --short
```

Expected: review the list manually before staging.

- [ ] **Step 2: Stage safe files explicitly**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
git add \
  .gitignore \
  package.json \
  package-lock.json \
  tsconfig.json \
  apps \
  packages \
  config/*.template.json \
  config/*.README.md \
  config/model-providers/README.md \
  config/model-providers/providers.template.json \
  config/prompts \
  config/taxonomies \
  docs \
  PRD.md \
  TASKLIST.md \
  PROJECT_AUDIT_REPORT.md \
  PROJECT_AUDIT_EXECUTION_REPORT.md \
  V0.2_LOCAL_TEST_MANUAL.md \
  01_PROJECT_CHARTER.md \
  02_AGENTS_WORKFLOW.md \
  03_STRICT_RULES.md \
  04_STATE_AND_DATA.md \
  05_STEP_BY_STEP_PLAN.md \
  CSV格式要求.md \
  NUMBERS格式要求.md
```

Expected: only safe source, tests, config templates, and docs are staged.

- [ ] **Step 3: Confirm no local config or runtime file is staged**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
git diff --cached --name-only | rg "local\\.json|\\.cache|\\.runtime|\\.web-ui|node_modules|视频数据下载缓存|\\.DS_Store" && exit 1 || exit 0
```

Expected: exit code `0`.

- [ ] **Step 4: Commit baseline**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
git commit -m "chore: establish v0.2 engineering baseline"
```

Expected: commit succeeds.

## Self-Review Checklist

- [ ] The plan covers engineering baseline readiness.
- [ ] The plan covers sensitive local config isolation.
- [ ] The plan covers runtime artifact exclusion.
- [ ] The plan covers logging safety verification.
- [ ] The plan avoids printing API key or cookie values.
- [ ] The plan does not ask workers to delete user data.
- [ ] The plan does not include unrelated UI, download, model, spreadsheet, or AfterEdit changes.
