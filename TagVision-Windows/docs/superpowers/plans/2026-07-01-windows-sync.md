# TagVision Windows Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `TagVision-Windows/` to functional parity with the current macOS TagVision review tool while preserving Windows launch and packaging entry points.

**Architecture:** Treat macOS `TagVision/` as the canonical implementation for web UI, backend review logic, Plyr offline assets, and tests. Keep Windows-specific files for launcher and packaging, then adapt those scripts to the same safe restart and deterministic dependency behavior.

**Tech Stack:** Node.js ESM server, TypeScript, native `node --test`, PowerShell launcher/packaging, offline Plyr dependency.

---

### Task 1: Add Windows parity regression tests

**Files:**
- Modify: `TagVision-Windows/packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] **Step 1: Add failing assertions**

Add assertions that Windows exposes the same compact review UI contracts as macOS:

```ts
assert.equal(packageJson.dependencies?.plyr, '3.8.4');
assert.match(reviewHtml, /review-player-stage/u);
assert.match(reviewHtml, /review-detail-layout/u);
assert.match(reviewJs, /Plyr/u);
assert.match(stylesCss, /--radius-surface: 32px/u);
assert.match(launcherScript, /Stop-ExistingTagVisionServers/u);
assert.match(launcherScript, /Test-TagVisionServerProcess/u);
assert.match(launcherScript, /npm ci --omit=dev --no-audit --no-fund/u);
assert.match(launcherScript, /Refusing to stop non-TagVision process/u);
assert.doesNotMatch(launcherScript, /Opening existing TagVision URL/u);
```

- [ ] **Step 2: Run the Windows UI test and verify RED**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask/TagVision-Windows
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: FAIL because current Windows package lacks Plyr dependency, modern detail modules, rounder CSS tokens, and safe restart launcher logic.

### Task 2: Sync canonical web implementation into Windows

**Files:**
- Copy from `TagVision/apps/web/api/routes/tag-review.ts` to `TagVision-Windows/apps/web/api/routes/tag-review.ts`
- Copy from `TagVision/apps/web/public/` to `TagVision-Windows/apps/web/public/`
- Copy from `TagVision/apps/web/server.ts` to `TagVision-Windows/apps/web/server.ts`
- Copy from `TagVision/apps/web/tag-review.ts` to `TagVision-Windows/apps/web/tag-review.ts`
- Delete: `TagVision-Windows/apps/web/services/label-studio.ts`
- Modify: `TagVision-Windows/package.json`
- Modify: `TagVision-Windows/package-lock.json`

- [ ] **Step 1: Copy canonical review files**

Copy macOS canonical files into Windows for shared implementation:

```bash
rsync -a --delete TagVision/apps/web/public/ TagVision-Windows/apps/web/public/
cp TagVision/apps/web/api/routes/tag-review.ts TagVision-Windows/apps/web/api/routes/tag-review.ts
cp TagVision/apps/web/server.ts TagVision-Windows/apps/web/server.ts
cp TagVision/apps/web/tag-review.ts TagVision-Windows/apps/web/tag-review.ts
rm -f TagVision-Windows/apps/web/services/label-studio.ts
```

- [ ] **Step 2: Preserve Windows package metadata**

Keep:

```json
{
  "name": "tagvision-windows",
  "description": "TagVision V0.1 Windows local review tool for accepted video tag sidecars",
  "scripts": {
    "pack:windows:v0.1": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-windows.ps1"
  }
}
```

Add:

```json
{
  "dependencies": {
    "plyr": "3.8.4"
  }
}
```

- [ ] **Step 3: Refresh lockfile deterministically**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask/TagVision-Windows
npm install --package-lock-only --no-audit --no-fund
```

Expected: `package-lock.json` includes `plyr` runtime dependency.

- [ ] **Step 4: Run focused tests and verify GREEN for shared UI/backend**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask/TagVision-Windows
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: UI tests pass except any remaining launcher-specific expectations that Task 3 will implement.

### Task 3: Modernize Windows launcher and packaging

**Files:**
- Modify: `TagVision-Windows/Start TagVision Windows.ps1`
- Modify: `TagVision-Windows/scripts/pack-windows.ps1`
- Create: `TagVision-Windows/scripts/pack-windows.mjs`
- Create: `TagVision-Windows/.gitignore`
- Modify: `TagVision-Windows/packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] **Step 1: Implement safe process detection**

In `Start TagVision Windows.ps1`, add functions:

```powershell
function Test-TagVisionPackageDir {
  param([string]$CandidateDir)
  $PackagePath = Join-Path $CandidateDir "package.json"
  if (-not (Test-Path $PackagePath)) { return $false }
  $Package = Get-Content $PackagePath -Raw | ConvertFrom-Json
  return $Package.name -eq "tagvision-windows"
}

function Test-TagVisionServerProcess {
  param([int]$ProcessId)
  $Process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $Process) { return $false }
  if ($Process.CommandLine -notlike "*node apps/web/server.ts*") { return $false }
  if ($Process.ExecutablePath) {
    $WorkingDirectory = Split-Path -Parent $Process.ExecutablePath
  }
  return (Test-TagVisionPackageDir $ScriptDir)
}
```

Use the function before stopping any listener on `TAGVISION_WEB_PORT`. If the listener is not TagVision, print `Refusing to stop non-TagVision process` and exit with code 1.

- [ ] **Step 2: Implement deterministic dependency sync and background launch**

Add:

```powershell
function Sync-Dependencies {
  if (Test-Path (Join-Path $ScriptDir "package-lock.json")) {
    npm ci --omit=dev --no-audit --no-fund
    return
  }
  npm install --omit=dev --no-audit --no-fund
}
```

Start the server with hidden `cmd.exe`, write `tagvision-windows-server.pid`, open the URL when ready, and exit instead of waiting on the server process.

- [ ] **Step 3: Ignore and exclude runtime files**

Create `.gitignore` with:

```gitignore
.DS_Store
*.log
tagvision-windows-server.pid
node_modules
dist
```

Update `pack-windows.ps1` to call the cross-platform Node packer. Create `pack-windows.mjs` so this package can be verified on macOS/Linux while Windows still uses PowerShell for `Compress-Archive` when available. The packer must remove or exclude:

```powershell
tagvision-windows-launcher.log
tagvision-windows-server.pid
node_modules
dist
```

- [ ] **Step 4: Run focused launcher tests**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask/TagVision-Windows
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: all UI/launcher tests pass.

### Task 4: Full Windows verification, commit, push

**Files:**
- All changed files under `TagVision-Windows/`

- [ ] **Step 1: Run full verification**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask/TagVision-Windows
npm test
npm run typecheck
npm run pack:windows:v0.1
```

Expected: tests pass, TypeScript passes, Windows zip is written to `TagVision-Windows/dist/TagVision-Windows-V0.1.zip`.

- [ ] **Step 2: Commit**

Run:

```bash
cd /Users/tianyi/Desktop/codex/jobtask
git add TagVision-Windows
git commit -m "feat: sync TagVision Windows version"
```

- [ ] **Step 3: Push**

Run:

```bash
git push origin main
```

Expected: `main` pushed to origin.
