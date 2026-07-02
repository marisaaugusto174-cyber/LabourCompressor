# 原子镜头切点精度治理施工计划

## Summary

将自动分割升级为“高召回候选切点 → 原子镜头帧级精修与伪切点过滤 → 连续性组装 → 组装后精确重编码导出”。目标是让最终片段的切割点落在真实镜头切换帧，避免 stream copy 在非关键帧处带入收尾帧。

本轮只修改 LabourCompressor，不触碰相邻 `TagVision*` 目录。

## Implementation Changes

### 1. 原子切点精修器

- 新增 `ShotBoundaryRefinerPort`，接在 PySceneDetect 后、连续性分析前。
- 新增 Python 脚本复用项目现有 OpenCV/NumPy 环境，一次处理单个视频的全部候选边界。
- 对每个候选切点在 ±12 帧内扫描局部峰值，输出原始切点、精修切点、精修帧号、接受状态、过滤原因和 LAB/边缘/直方图/ORB 指标。
- 默认过滤亮度/遮挡伪切点、连续运镜伪切点、非孤立突变弱变化。
- 不落盘原子镜头文件，只生成精修后的原子镜头时间区间和诊断 JSON。

### 2. 分割链路接入

- PySceneDetect 继续负责候选镜头召回；CSV 解析补充读取 frame/time seconds 字段。
- `ffprobe` media info 增加 `frameRate`，供精修、半帧 guard 和测试断言使用。
- `local-pipeline-segmentation` 流程调整为：

```text
media info
→ PySceneDetect candidate shots
→ shot boundary refinement
→ refined shots
→ continuity analysis
→ continuity-first assembly
→ final segment export
```

- 连续性分析和 5–60 秒组装逻辑不重写，只改用精修后的 shots。
- 精修器失败时不直接失败任务，回退到 PySceneDetect 原始边界，并在 `.segmentation/<asset>/boundary-refinement.json` 标记 `fallbackApplied=true`。

### 3. 最终导出改为精确重编码

- 自动分割主路径从 `stream copy` 改为精确重编码：
  - `ffmpeg -ss <start> -i <input> -t <duration>`
  - `-c:v libx264 -preset veryfast -crf 18`
  - `-c:a aac -b:a 192k`
  - `-movflags +faststart`
- 保留 stream copy 为内部兼容模式，但自动分割默认不再使用它。
- 半帧保护只在组装后的最终片段导出应用：
  - 对非最后一个 accepted segment，将导出时长减少 `0.5 / frameRate` 秒。
  - 不修改原子镜头边界、连续性判断、AfterEdit 记录或文件名中的计算区间。
  - ProblemClips 不应用半帧保护，保留问题区间原样。

### 4. 诊断与文档

- `.segmentation/<asset>/boundary-refinement.json` 保存算法版本、阈值、原始候选、精修结果、过滤原因和 fallback 状态。
- 不保存抽取帧、PCM、视频片段、凭证或完整媒体内容。
- 更新 README、V0.5 release notes 和分割计划说明。

## Public Interfaces

- `CandidateShot` 增加可选 `startFrame`、`endFrame`、`sourceBoundary` 元数据；现有只读 `startSeconds/endSeconds` 调用保持兼容。
- `MediaInfoProbeResult` 增加 `frameRate`。
- `AutoSegmentationDependencies` 增加可注入 `shotBoundaryRefiner`。
- `ExportSegmentInput` 增加内部导出模式与 `endGuardSeconds`；CLI 参数、Web API、电子表格结构、预设 ID 和归档结构不变。

## Test Plan

先按 TDD 增加失败测试，再实现。

- PySceneDetect CSV：读取 `Start Frame / End Frame`，优先使用 `Start Time (seconds) / End Time (seconds)`，旧 CSV 仍兼容。
- 切点精修：硬切候选移动到真实峰值帧；亮度变化和连续运镜伪切点被过滤；重复/过近切点按帧率去重；精修器异常时回退原始边界并写诊断。
- 分割流水线：连续性分析收到 refined shots；精修后边界仍满足 5–60 秒治理；精修失败不阻断任务；诊断文件不包含帧图、音频、凭证或媒体内容。
- 导出：默认参数为精确重编码；非最后 accepted segment 应用半帧 guard；最后 accepted segment 和 ProblemClips 不应用 guard；合成硬切视频导出后，边界前后无明显残留颜色帧。

回归命令：

```bash
node --test \
  packages/testing/unit/media/pyscenedetect-boundary-detector.test.ts \
  packages/testing/unit/media/ffprobe-media-info.test.ts \
  packages/testing/unit/media/shot-boundary-refiner.test.ts \
  packages/testing/unit/media/ffmpeg-segment-exporter.test.ts \
  packages/testing/unit/cli/pipeline-segmentation.test.ts \
  packages/testing/unit/segmentation/*.test.ts \
  packages/testing/integration/phase5/*.test.ts

npm run verify
git diff --check
```

## Execution Defaults

- 执行分支：`codex/atomic-shot-precision`。
- 提交粒度：
  - `feat: refine atomic shot boundaries`
  - `feat: route segmentation through refined shots`
  - `fix: export precise segmentation clips`
  - `docs: document atomic shot precision`
- 不新增 AI/OCR 依赖。
- 不物理落盘原子镜头文件。
- 不改变 5–60 秒计算规则、连续性优先策略、Web/CLI 用户参数或归档逻辑。
