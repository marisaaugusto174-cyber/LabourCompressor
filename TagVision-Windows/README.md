# TagVision V0.5 Windows

TagVision V0.5 Windows is a local Web review tool for machine-generated video
tag results on Windows.

In the current `jobtask` workflow, LabourCompressor produces segmented clips and
model JSON sidecars. TagVision lets reviewers inspect each clip, choose legal
taxonomy paths, and write a manual accepted result beside the original model
JSON. LabourCompressor can then consume the accepted sidecar for spreadsheet
writeback and archive placement.

## Windows Requirements

- Windows 10 or later
- No preinstalled Node.js is required for the V0.5 zip package; it includes
  portable Node.js at `runtime\node\node.exe`.
- ffmpeg available in `PATH` for task-card thumbnails
- PowerShell 5+ for the local launcher and folder picker

## Run Locally

Double-click the Windows launcher:

```text
Start TagVision Windows.bat
```

It starts the local server, opens the review page, and keeps a PowerShell window
only long enough to verify startup. The TagVision server continues in the
background.

Manual start from the V0.5 zip package:

```powershell
.\runtime\node\node.exe .\apps\web\server.ts
```

Manual start from a source checkout:

```powershell
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

```powershell
npm test
npm run typecheck
```

## Package V0.5 Windows

Create Windows distributables:

```powershell
npm run pack:windows:v0.5
```

The packaged artifacts are written to:

```text
dist/TagVision-Windows-V0.5.zip
dist/tagvision-windows-0.5.0.tgz
```

The npm package uses semver `0.5.0`; the human-facing release name is
`TagVision V0.5 Windows`.

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

`version: 1` is the accepted sidecar schema version. It is intentionally not
the same as the product release name.

TagVision rejects accepted paths that are not present in the batch taxonomy
snapshot.

## LabourCompressor Handoff

LabourCompressor's partial sidecar writeback checks for `<stem>.accepted.json`
before reading `<stem>.json`.

- If an accepted sidecar exists, its `acceptedPaths` drive writeback and archive
  path selection.
- If no accepted sidecar exists, the existing model JSON sidecar flow remains
  available for automatic tagging workflows.
- The original model JSON remains available for audit and comparison.

## Local Review Workflow

TagVision V0.5 Windows completes the review loop locally. Select a directory,
inspect the paired videos and model tags, edit paths from the taxonomy
snapshot, and save the confirmed result directly as `<stem>.accepted.json`.

The application does not require Label Studio or any other external review
service. Existing legacy `_tag-review-state.json` files are ignored and are
never modified or deleted.
