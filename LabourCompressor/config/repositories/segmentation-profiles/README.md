# Segmentation Profile Repository

Place segmentation profile manifests in this directory as `*.json`.

Required fields:

- `id`
- `detector`: `adaptive` or `content`
- `minimumSeconds`
- `preferredMinimumSeconds`
- `preferredMaximumSeconds`
- `maximumSeconds`

内置和 repository profile 的时长字段必须统一为 `5 / 5 / 30 / 60`。profile 可通过可选 `continuityThresholds.visual`、`motion`、`audio` 和 `sampling` 分组覆盖本地连续性阈值；Web UI 不暴露这些高级参数。

Optional fields:

- `label`
