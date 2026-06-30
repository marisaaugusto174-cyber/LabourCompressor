# TagVision V0.1 macOS

TagVision V0.1 macOS is a local Web review tool for machine-generated video
tag results on macOS.

In the current `jobtask` workflow, LabourCompressor produces segmented clips and
model JSON sidecars. TagVision lets reviewers inspect each clip, choose legal
taxonomy paths, and write a manual accepted result beside the original model
JSON. LabourCompressor can then consume the accepted sidecar for spreadsheet
writeback and archive placement.

## Run Locally

Double-click the macOS launcher:

```text
Start TagVision macOS.command
```

It opens the review page and keeps a Terminal window running the local server.

Manual start:

```bash
npm install
npm run web
```

The local UI starts at:

```text
http://127.0.0.1:4312/review.html
```

Optional environment variables:

- `TAGVISION_WEB_HOST`: default `127.0.0.1`
- `TAGVISION_WEB_PORT`: default `4312`
- `TAGVISION_REVIEW_DIR`: optional default review directory path

## Test

```bash
npm test
npm run typecheck
```

## Package V0.1 macOS

Create a distributable tarball:

```bash
npm run pack:macos:v0.1
```

The packaged artifacts are written to:

```text
dist/TagVision-macOS-V0.1.zip
dist/tagvision-macos-0.1.0.tgz
```

The npm package uses semver `0.1.0`; the human-facing release name is
`TagVision V0.1 macOS`.

## Review Batch Contract

A TagVision review batch is a local directory containing:

- video clips, such as `clip_01.mp4`
- same-stem model JSON files, such as `clip_01.json`
- a taxonomy snapshot at `_tagvision-taxonomy.json`

The taxonomy snapshot is the source of truth for selectable review paths:

```json
{
  "version": 1,
  "taxonomyVersion": "Core_Prompt_V0.1",
  "taxonomyChecksum": "sha256:example",
  "paths": [
    "内容领域 > 商业营销 > 产品广告",
    "表现形式 > 社媒直播 > 个人创作"
  ]
}
```

TagVision scans recursively and pairs video files with same-directory,
same-stem JSON files. The model JSON is treated as candidate evidence and is
not overwritten.

## Accepted Output

When a reviewer saves an accepted result, TagVision writes:

```text
<stem>.accepted.json
```

beside the original clip and model JSON. The minimum shape is:

```json
{
  "version": 1,
  "reviewItemId": "review-...",
  "videoRelativePath": "clip_01.mp4",
  "sourceJsonRelativePath": "clip_01.json",
  "taxonomyVersion": "Core_Prompt_V0.1",
  "taxonomyChecksum": "sha256:example",
  "status": "通过",
  "acceptedPaths": [
    "内容领域 > 商业营销 > 产品广告"
  ],
  "source": "manual",
  "reviewedAt": "2026-06-15T00:00:00.000Z"
}
```

TagVision rejects accepted paths that are not present in the batch taxonomy
snapshot.

## LabourCompressor Handoff

LabourCompressor's partial sidecar writeback now checks for
`<stem>.accepted.json` before reading `<stem>.json`.

- If an accepted sidecar exists, its `acceptedPaths` drive writeback and archive
  path selection.
- If no accepted sidecar exists, the existing model JSON sidecar flow remains
  available for automatic tagging workflows.
- The original model JSON remains available for audit and comparison.

## Local Review Workflow

TagVision V0.1 completes the review loop locally. Select a directory, inspect
the paired videos and model tags, edit paths from the taxonomy snapshot, and
save the confirmed result directly as `<stem>.accepted.json`.

The application does not require an external review service. Existing legacy
`_tag-review-state.json` files are ignored and are never modified or deleted.
