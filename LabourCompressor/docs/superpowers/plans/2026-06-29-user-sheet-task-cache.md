# User Sheet Task Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网页用户表任务在原表同目录创建任务独占的视频下载缓存，并使后续流水线与界面只使用该目录。

**Architecture:** 扩展现有用户表 options 准备器，在任务 ID 分配后排他创建缓存目录和工作副本，并同时替换 `spreadsheet`、`downloadDir`。Web Preflight 校验原表父目录，前端从任务快照同步最终路径；CLI 与 `resume-cache` 保持原样。

**Tech Stack:** TypeScript、Node.js `fs/promises`、Node test runner、现有 runtime task preparation hook。

---

## 文件结构

- 修改 `apps/web/user-spreadsheet-working-copy.ts`：增加缓存路径构造、排他目录创建和事务清理。
- 修改 `apps/web/runtime-support-checks.ts` 与 `apps/web/api/routes/pipeline.ts`：用户表 Preflight 检查原表父目录。
- 修改 `apps/web/public/app-configuration.js` 与 `apps/web/public/app.js`：同步任务工作区路径且维持 500 行门禁。
- 扩展现有 Web、CLI runtime 和治理测试；更新 README。

### Task 1: 创建任务独占缓存目录

**Files:**
- Modify: `apps/web/user-spreadsheet-working-copy.ts`
- Modify: `packages/testing/unit/web/user-spreadsheet-working-copy.test.ts`

- [ ] **Step 1: 写失败测试**

扩展只读原表测试，断言返回的 `downloadDir` 位于原表同目录，命名为 `测试_集_O2_视频下载缓存_a1b2c3d4` 且目录真实存在：

```ts
assert.equal(
  prepared.downloadDir,
  path.join(tempDir, '测试_集_O2_视频下载缓存_a1b2c3d4')
);
assert.equal((await stat(prepared.downloadDir)).isDirectory(), true);
```

增加 `buildUserSheetTaskCachePath()` 单元测试，确认 `.csv` 与 `.xlsx` 使用同一原表名规范；增加 `resume-cache` 测试，断言 `spreadsheet` 与 `downloadDir` 均保持原值。

- [ ] **Step 2: 运行 RED**

```bash
node --test packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
```

Expected: FAIL，`downloadDir` 仍为旧值或缓存路径函数不存在。

- [ ] **Step 3: 实现最小目录准备逻辑**

公开路径函数：

```ts
export function buildUserSheetTaskCachePath(input: {
  readonly sourcePath: string;
  readonly taskId: string;
}): string {
  const extension = path.extname(input.sourcePath);
  const baseName = path.basename(input.sourcePath, extension);
  return path.join(
    path.dirname(input.sourcePath),
    `${normalizeBaseName(baseName)}_视频下载缓存_${input.taskId.slice(0, 8)}`
  );
}
```

准备器在源文件与父目录校验后，用 `mkdir(cachePath, { recursive: false, mode: 0o755 })` 排他创建目录，再复制工作副本，最终返回：

```ts
return {
  ...input.options,
  spreadsheet: workingCopyPath,
  downloadDir: cachePath
};
```

`mkdir` 的 `EEXIST` 转成 `WorkingCopyNameConflictError`，从而复用现有任务 ID 重试机制。

- [ ] **Step 4: 运行 GREEN**

```bash
node --test packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
npm run typecheck
```

- [ ] **Step 5: 提交**

```bash
git add apps/web/user-spreadsheet-working-copy.ts packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
git commit -m "feat: create user sheet task cache directories"
```

### Task 2: 失败清理与冲突安全

**Files:**
- Modify: `apps/web/user-spreadsheet-working-copy.ts`
- Modify: `packages/testing/unit/web/user-spreadsheet-working-copy.test.ts`
- Modify: `packages/testing/unit/cli/runtime-task-service.test.ts`

- [ ] **Step 1: 写失败路径测试**

增加依赖注入的文件系统 seam，测试在目录创建成功后让副本复制失败，断言新建空目录被删除：

```ts
const prepared = createUserSpreadsheetWorkspacePreparer({
  copyFile: async () => { throw new Error('copy failed'); }
});
await assert.rejects(prepared(request), /copy failed/u);
await assert.rejects(stat(expectedCachePath), { code: 'ENOENT' });
```

另加测试：预先创建同名缓存目录并放入文件，准备器抛 `WorkingCopyNameConflictError`，既有目录和文件不变；运行时冲突测试同时断言第二个任务 ID 生成第二个缓存目录。

- [ ] **Step 2: 运行 RED**

```bash
node --test packages/testing/unit/web/user-spreadsheet-working-copy.test.ts packages/testing/unit/cli/runtime-task-service.test.ts
```

Expected: FAIL，尚无可注入准备器或失败目录仍存在。

- [ ] **Step 3: 实现事务式准备器**

新增工厂并保留原导出兼容：

```ts
export const prepareUserSpreadsheetWorkingCopy =
  createUserSpreadsheetWorkspacePreparer();

export function createUserSpreadsheetWorkspacePreparer(
  fileSystem: UserSpreadsheetWorkspaceFileSystem = defaultFileSystem
): RuntimeTaskOptionsPreparer<RunLocalPipelineOptions>;
```

缓存目录创建后使用 `try/catch` 执行副本复制；失败时仅调用 `rmdir(cachePath)`，它只能删除空目录。清理错误不得覆盖原始复制错误。绝不使用递归删除。缓存目录冲突发生在创建前，不执行清理。

- [ ] **Step 4: 运行 GREEN 与冲突回归**

```bash
node --test packages/testing/unit/web/user-spreadsheet-working-copy.test.ts packages/testing/unit/cli/runtime-task-service.test.ts
npm run typecheck
```

- [ ] **Step 5: 提交**

```bash
git add apps/web/user-spreadsheet-working-copy.ts packages/testing/unit/web/user-spreadsheet-working-copy.test.ts packages/testing/unit/cli/runtime-task-service.test.ts
git commit -m "fix: clean incomplete user task workspaces"
```

### Task 3: Preflight 校验用户表父目录

**Files:**
- Modify: `apps/web/runtime-support-checks.ts`
- Modify: `apps/web/api/routes/pipeline.ts`
- Modify: `packages/testing/unit/cli/runtime-support-checks.test.ts`

- [ ] **Step 1: 写失败测试**

给 `runPipelinePreflight` 增加用户工作区模式测试，传入一个只读父目录和仍可写的旧 `downloadDir`，断言 `user-sheet-directory` 检查失败；普通模式仍返回 `download-dir` 检查。

```ts
const checks = await runPipelinePreflight(options, { userSheetWorkspace: true });
assert.equal(checks.some((item) => item.key === 'user-sheet-directory' && !item.ok), true);
assert.equal(checks.some((item) => item.key === 'download-dir'), false);
```

- [ ] **Step 2: 运行 RED**

```bash
node --test packages/testing/unit/cli/runtime-support-checks.test.ts
```

Expected: FAIL，第二参数或检查键尚不存在。

- [ ] **Step 3: 实现模式化检查并接入路由**

`runPipelinePreflight` 增加可选参数：

```ts
options: { readonly userSheetWorkspace?: boolean } = {}
```

当为 `true` 时，用 `checkDirectoryWritable('user-sheet-directory', path.dirname(options.spreadsheet))` 替换原 `download-dir` 检查。`/api/preflight` 路由在 `pipelineStage !== 'resume-cache'` 时传入 `userSheetWorkspace: true`。CLI/直接调用不传参数，继续检查既有 `downloadDir`。

- [ ] **Step 4: 运行 GREEN**

```bash
node --test packages/testing/unit/cli/runtime-support-checks.test.ts
npm run typecheck
```

- [ ] **Step 5: 提交**

```bash
git add apps/web/runtime-support-checks.ts apps/web/api/routes/pipeline.ts packages/testing/unit/cli/runtime-support-checks.test.ts
git commit -m "feat: preflight user sheet workspace directories"
```

### Task 4: 前端同步任务缓存路径

**Files:**
- Modify: `apps/web/public/app-configuration.js`
- Modify: `apps/web/public/app.js`
- Modify: `packages/testing/unit/web/v04-stage-ui.test.ts`

- [ ] **Step 1: 写失败 UI 契约测试**

断言配置模块提供 `syncTaskWorkspacePaths`，同时读取 `task.options.spreadsheet` 与 `task.options.downloadDir`，更新 `downloadDirDisplay` 和 `afterEditDirDisplay`。

- [ ] **Step 2: 运行 RED**

```bash
node --test packages/testing/unit/web/v04-stage-ui.test.ts
```

Expected: FAIL，配置模块尚无同步方法。

- [ ] **Step 3: 提取同步方法并保持尺寸门禁**

在配置对象中新增：

```js
syncTaskWorkspacePaths(task) {
  const spreadsheet = task?.options?.spreadsheet;
  const downloadDir = task?.options?.downloadDir;
  if (typeof spreadsheet === 'string' && spreadsheet.length > 0) setField('spreadsheet', spreadsheet);
  if (typeof downloadDir !== 'string' || downloadDir.length === 0) return;
  setField('downloadDir', downloadDir);
  refs.downloadDirDisplay.textContent = downloadDir;
  refs.afterEditDirDisplay.textContent = `${downloadDir}/${fieldValue('afterEditDirectoryName')}`;
  refs.preflightOutput.textContent = `已创建任务工作副本与视频下载缓存：${downloadDir}`;
}
```

把 `app.js` 当前五行工作副本同步替换为一行 `configuration.syncTaskWorkspacePaths(task);`，使 `app.js` 继续低于 500 行。

- [ ] **Step 4: 运行 UI 与治理测试**

```bash
node --test packages/testing/unit/web/v04-stage-ui.test.ts
node --test packages/testing/unit/governance/*.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add apps/web/public/app-configuration.js apps/web/public/app.js packages/testing/unit/web/v04-stage-ui.test.ts
git commit -m "feat: show user task cache directory"
```

### Task 5: 文档与完整回归

**Files:**
- Modify: `README.md`
- Modify: `packages/testing/unit/web/user-spreadsheet-working-copy.test.ts`

- [ ] **Step 1: 扩展真实 XLSX 回归**

在现有只读 XLSX 回写测试中，将下载产物、`AfterEdit`、`ProblemClips` 和 `本次打标结果` 测试文件写入 `prepared.downloadDir` 的对应子路径，断言所有路径均位于原表目录内而非项目根目录。

- [ ] **Step 2: 运行根因回归**

```bash
node --test packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
```

- [ ] **Step 3: 更新 README**

将用户表工作副本说明扩展为：每个网页任务还会在原表同目录创建 `<原表名>_视频下载缓存_<任务ID前8位>`，下载、分割、AfterEdit、ProblemClips 和结果表均写入其中；目录在失败或取消后保留。

- [ ] **Step 4: 完整验证**

```bash
node --test packages/testing/unit/web/user-spreadsheet-working-copy.test.ts packages/testing/unit/cli/runtime-support-checks.test.ts packages/testing/unit/web/v04-stage-ui.test.ts
npm run typecheck
npm run verify
node --test packages/testing/unit/governance/*.test.ts
git diff --check
```

Expected: 所有命令返回 0，完整测试无失败，`TagVision-Windows/` 不进入差异。

- [ ] **Step 5: 提交**

```bash
git add README.md packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
git commit -m "docs: document user task cache directories"
```

## 完成条件

- 网页用户表任务的 `downloadDir` 固定为原表同目录的任务独占缓存。
- 工作副本与缓存目录共享任务 ID，冲突时均不覆盖。
- 准备失败不残留新建空目录，执行失败和取消保留目录。
- Preflight 检查实际目标父目录，UI 显示实际缓存路径。
- `resume-cache`、素材目录导入和 CLI 路径行为不变。
