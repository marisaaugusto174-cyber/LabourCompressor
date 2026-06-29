# User Spreadsheet Working Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网页端用户表任务在启动前于原表同目录创建规范命名的可写副本，并使整条任务链路只使用该副本。

**Architecture:** Orchestrator 提供通用异步 options 准备钩子，在任务 ID 和创建时间确定后、任务持久化前执行。Web composition root 注入文件系统工作副本准备器；CLI 与 `resume-cache` 等系统生成表流程保持不变。前端从任务创建响应同步副本路径。

**Tech Stack:** TypeScript、Node.js `fs/promises`、Node test runner、现有 Web API 与 runtime task service。

---

## 文件结构

- 新建 `apps/web/user-spreadsheet-working-copy.ts`：命名、排他复制、权限修正、失败清理与 options 转换。
- 修改 `packages/orchestrator/runtime-task-service.ts` 和 `packages/orchestrator/index.ts`：通用准备钩子与冲突重试。
- 修改 `apps/web/task-service.ts` 和 `apps/web/server.ts`：仅在 Web composition root 注入准备器。
- 修改 `apps/web/public/app.js`：任务创建后同步副本路径。
- 新建 `packages/testing/unit/web/user-spreadsheet-working-copy.test.ts`，修改 runtime 与 UI 测试。

### Task 1: Orchestrator 任务准备钩子

**Files:**
- Modify: `packages/orchestrator/runtime-task-service.ts`
- Modify: `packages/orchestrator/index.ts`
- Modify: `apps/web/task-service.ts`
- Test: `packages/testing/unit/cli/runtime-task-service.test.ts`

- [ ] **Step 1: 写失败测试**

增加测试，固定 ID 和时间，断言准备器先于持久化和 runner 执行，快照与 runner 只看到新路径：

```ts
test('prepares options before a runtime task is created', async () => {
  let runnerPath = '';
  const service = createRuntimeTaskService({
    createId: () => 'a1b2c3d4-0000-0000-0000-000000000000',
    now: () => '2026-06-29T08:30:15.000Z',
    prepareOptions: async ({ taskId, createdAt, options }) => {
      assert.equal(taskId.slice(0, 8), 'a1b2c3d4');
      assert.equal(createdAt, '2026-06-29T08:30:15.000Z');
      return { ...options, spreadsheet: '/tmp/tasks-copy.xlsx' };
    },
    pipelineRunner: async ({ options }) => {
      runnerPath = options.spreadsheet;
      return createEmptyPipelineResult('prepared');
    }
  });
  const task = await service.startTask(createMinimalPipelineOptions());
  await waitForTask(service, task.id);
  assert.equal(task.options.spreadsheet, '/tmp/tasks-copy.xlsx');
  assert.equal(runnerPath, '/tmp/tasks-copy.xlsx');
});
```

另加测试：准备器抛错时 `startTask` reject，runner 不执行，`listTasks()` 为空。

- [ ] **Step 2: 运行 RED**

```bash
node --test packages/testing/unit/cli/runtime-task-service.test.ts
```

Expected: FAIL，`prepareOptions`、`createId` 或 `now` 尚未被 Web facade 接受。

- [ ] **Step 3: 实现最小钩子**

新增并导出：

```ts
export interface RuntimeTaskPreparationInput<TOptions> {
  readonly taskId: string;
  readonly createdAt: string;
  readonly options: TOptions;
}
export type RuntimeTaskOptionsPreparer<TOptions> =
  (input: RuntimeTaskPreparationInput<TOptions>) => Promise<TOptions>;
```

`RuntimeTaskEngine.startTask` 先生成 ID 和时间，await `prepareOptions`，成功后才构造 state、持久化并排队执行。`apps/web/task-service.ts` 透传 `prepareOptions`、`createId`、`now`；未注入时行为不变。

- [ ] **Step 4: 运行 GREEN**

```bash
node --test packages/testing/unit/cli/runtime-task-service.test.ts
npm run typecheck
```

- [ ] **Step 5: 提交**

```bash
git add packages/orchestrator/runtime-task-service.ts packages/orchestrator/index.ts apps/web/task-service.ts packages/testing/unit/cli/runtime-task-service.test.ts
git commit -m "feat: prepare runtime task options before launch"
```

### Task 2: 同目录可写工作副本

**Files:**
- Create: `apps/web/user-spreadsheet-working-copy.ts`
- Create: `packages/testing/unit/web/user-spreadsheet-working-copy.test.ts`

- [ ] **Step 1: 写失败测试**

在临时目录创建只读 `测试 集_O2.xlsx`，调用准备器后断言：原表内容和 `0o222` 权限位不变；副本名为 `测试_集_O2_任务副本_20260629_163015_a1b2c3d4.xlsx`；副本同目录、内容一致且用户可写。

```ts
const prepared = await prepareUserSpreadsheetWorkingCopy({
  taskId: 'a1b2c3d4-0000-0000-0000-000000000000',
  createdAt: '2026-06-29T08:30:15.000Z',
  options: createOptions(source)
});
assert.equal(path.dirname(prepared.spreadsheet), tempDir);
assert.equal(path.basename(prepared.spreadsheet),
  '测试_集_O2_任务副本_20260629_163015_a1b2c3d4.xlsx');
assert.equal((await stat(source)).mode & 0o222, 0);
assert.notEqual((await stat(prepared.spreadsheet)).mode & 0o200, 0);
```

独立测试覆盖 `.csv` 扩展名、连续非法字符合并、空名称回退、`resume-cache` 原样返回、目标已存在不覆盖、目录不可写和失败后无残留。

- [ ] **Step 2: 运行 RED**

```bash
node --test packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
```

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现准备器**

模块公开：

```ts
export class WorkingCopyNameConflictError extends Error {}
export function buildUserSpreadsheetWorkingCopyPath(input: {
  readonly sourcePath: string;
  readonly taskId: string;
  readonly createdAt: string;
}): string;
export async function prepareUserSpreadsheetWorkingCopy(
  input: RuntimeTaskPreparationInput<RunLocalPipelineOptions>
): Promise<RunLocalPipelineOptions>;
```

规则：除 `pipelineStage === 'resume-cache'` 外的网页用户表任务均复制；`resume-cache` 是现有 AfterEdit 与素材目录导入路径，保持原样。只接受 `.xlsx`、`.csv`；名称字符用 `/[^\p{L}\p{N}._-]+/gu` 替换为 `_` 并合并连续 `_`；时间按服务器本地时区输出 `YYYYMMDD_HHmmss`。先检查源文件可读与父目录可写，再用 `copyFile(..., COPYFILE_EXCL)`，设置 `0o644`，验证 `R_OK | W_OK`。`EEXIST` 转为 `WorkingCopyNameConflictError`；复制后任一失败都删除目标，绝不 chmod 或删除原表。

- [ ] **Step 4: 运行 GREEN**

```bash
node --test packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
npm run typecheck
```

- [ ] **Step 5: 提交**

```bash
git add apps/web/user-spreadsheet-working-copy.ts packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
git commit -m "feat: create writable user spreadsheet copies"
```

### Task 3: 冲突重试与 Web 接入

**Files:**
- Modify: `packages/orchestrator/runtime-task-service.ts`
- Modify: `apps/web/task-service.ts`
- Modify: `apps/web/server.ts`
- Test: `packages/testing/unit/cli/runtime-task-service.test.ts`

- [ ] **Step 1: 写冲突重试失败测试**

准备器第一次对 ID `aaaaaaaa...` 抛 `WorkingCopyNameConflictError`，第二次对 `bbbbbbbb...` 成功。断言最终 task ID 为第二个、列表只有一个任务、runner 仅执行一次。普通复制错误不得重试。

- [ ] **Step 2: 运行 RED**

```bash
node --test packages/testing/unit/cli/runtime-task-service.test.ts
```

Expected: FAIL，第一次冲突直接 reject。

- [ ] **Step 3: 实现最多三次冲突重试并注入**

orchestrator 增加可选 dependencies：

```ts
readonly isPreparationConflict?: (error: unknown) => boolean;
readonly maximumPreparationAttempts?: number;
```

只在 predicate 返回 true 时重新分配 ID，默认最多三次；其他错误立即抛出。Web facade 透传字段。`apps/web/server.ts` 注入：

```ts
prepareOptions: prepareUserSpreadsheetWorkingCopy,
isPreparationConflict: (error) => error instanceof WorkingCopyNameConflictError
```

CLI 不注入，行为不变。

- [ ] **Step 4: 运行回归**

```bash
node --test packages/testing/unit/cli/runtime-task-service.test.ts packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
npm run typecheck
```

- [ ] **Step 5: 提交**

```bash
git add packages/orchestrator/runtime-task-service.ts apps/web/task-service.ts apps/web/server.ts packages/testing/unit/cli/runtime-task-service.test.ts
git commit -m "feat: route web tasks through spreadsheet copies"
```

### Task 4: 前端同步副本路径

**Files:**
- Modify: `apps/web/public/app.js`
- Modify: `packages/testing/unit/web/v04-stage-ui.test.ts`

- [ ] **Step 1: 写失败 UI 契约测试**

读取 `app.js`，断言存在 `task?.options?.spreadsheet` 路径同步与“已创建任务工作副本”提示。

- [ ] **Step 2: 运行 RED**

```bash
node --test packages/testing/unit/web/v04-stage-ui.test.ts
```

- [ ] **Step 3: 实现响应同步**

在 `apiPost('/api/tasks', ...)` 返回后加入：

```js
const workingSpreadsheet = task?.options?.spreadsheet;
if (typeof workingSpreadsheet === 'string' && workingSpreadsheet.length > 0) {
  setField('spreadsheet', workingSpreadsheet);
  preflightOutput.textContent = `已创建任务工作副本：${workingSpreadsheet}`;
}
```

保持 `app.js` 不超过 500 行；若超限，将逻辑提取到现有 UI helper，不用压缩代码规避门禁。

- [ ] **Step 4: 运行 GREEN 与治理门禁**

```bash
node --test packages/testing/unit/web/v04-stage-ui.test.ts
node --test packages/testing/unit/governance/*.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add apps/web/public/app.js packages/testing/unit/web/v04-stage-ui.test.ts
git commit -m "feat: show spreadsheet working copy path"
```

### Task 5: 根因回归、文档与完整验收

**Files:**
- Modify: `README.md`
- Modify: `packages/testing/unit/web/user-spreadsheet-working-copy.test.ts`

- [ ] **Step 1: 增加 EACCES 根因回归测试**

用 `xlsx` 创建有效只读原表，生成副本后调用现有 `writeTagResultsToSpreadsheet` 回写副本。断言原表 SHA-256 和权限不变、副本新增结果列并保持可写。

- [ ] **Step 2: 运行根因测试**

```bash
node --test packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
```

Expected: PASS，复现输入条件下不再出现回写 `EACCES`。

- [ ] **Step 3: 更新 README**

说明网页任务会在原表同目录生成 `<原名>_任务副本_<时间>_<任务ID前8位>`；系统只修改副本；原目录必须可写；失败或取消后保留副本。

- [ ] **Step 4: 完整验证**

```bash
node --test packages/testing/unit/cli/runtime-task-service.test.ts packages/testing/unit/web/user-spreadsheet-working-copy.test.ts packages/testing/unit/web/v04-stage-ui.test.ts
npm run typecheck
npm run verify
node --test packages/testing/unit/governance/*.test.ts
git diff --check
```

Expected: 所有命令返回 0；完整测试无失败；`TagVision-Windows/` 不进入差异。

- [ ] **Step 5: 提交**

```bash
git add README.md packages/testing/unit/web/user-spreadsheet-working-copy.test.ts
git commit -m "docs: document spreadsheet working copies"
```

## 完成条件

- 只读用户表不再导致任务回写 `EACCES`，原表内容与权限始终不变。
- 副本固定在原表同目录，命名、权限、失败清理和冲突策略均有测试。
- 任务持久化和 UI 只引用副本路径；恢复、暂停和续跑不重复复制。
- `resume-cache`、AfterEdit、素材目录导入与 CLI 行为不变。
- 不新增 HTTP 路由、数据库字段或电子表格字段。
