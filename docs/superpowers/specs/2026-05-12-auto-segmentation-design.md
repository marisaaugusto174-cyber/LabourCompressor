# Auto Segmentation Design

## Document Status

- Project: `LabourCompressor`
- Date: `2026-05-12`
- Scope: automatic long-video segmentation before `AfterEdit`
- Status: design for user review

## Problem

The current V0.2 workflow pauses after download and waits for a human to edit files into `AfterEdit`. This keeps the workflow from becoming fully automatic.

The new capability should replace most manual cutting with automatic segmentation. The target is not creative highlight selection. The target is to split each downloaded long video into a sequence of meaningful, valid, short clips that can enter the existing tagging and archive workflow.

Example: a 3-minute commercial should be divided into clips that roughly follow scenes, shot groups, or continuous action units. Each final clip should be understandable enough to tag on its own and must obey the duration rules.

## Goals

- Segment downloaded videos automatically before tagging.
- Preserve near-complete coverage of valid source content.
- Avoid AI-based highlight selection or value ranking.
- Produce final clips in the `3-30s` range, with `5-30s` preferred.
- Route only segmented clips into `AfterEdit` and later tagging.
- Keep the original downloaded file as source material, but do not send it to tagging or archive.
- Put unresolved outputs into a `problem clips` folder and mark them in the generated table.

## Non-Goals

- Do not build a creative video editor.
- Do not select only the best or most valuable highlights.
- Do not require manual review before normal clips continue.
- Do not add full original-video tagging when segmentation is enabled.
- Do not make model judgment decide whether a clip should be kept for business value.
- Do not require extra table fields unless they are already produced by the segmentation process or needed for traceability.

## Core Approach

The feature uses a three-layer segmentation pipeline:

```text
Downloaded video
-> candidate cut detection
-> adjacent-shot continuity scoring
-> semantic segment assembly
-> duration governance
-> segmented clips in AfterEdit
-> existing AfterEdit table and tagging workflow
```

Candidate cut detection finds possible physical boundaries. It does not decide final clip boundaries by itself.

Adjacent-shot continuity scoring decides whether neighboring shots belong to the same continuous expression unit. This is where visual, audio, and optional model signals help preserve narrative continuity.

Duration governance enforces the hard `3-30s` rule after semantic segments are assembled.

## Candidate Cut Detection

The first implementation should use scene or shot boundary detection as the source of candidate cuts.

Recommended initial detector:

- `PySceneDetect AdaptiveDetector` for primary detection.

Fallback detector:

- `PySceneDetect ContentDetector` or FFmpeg `scdet`.

Future detector:

- `TransNetV2` or a similar shot-boundary model if traditional detection is not stable enough for short-video and ad material.

The output of this stage is a timeline of candidate boundaries, not final clips.

## Continuity Scoring

The segmentation system should judge adjacent shots, not judge whole-video business value.

For each pair of adjacent shots, calculate whether they likely belong to the same continuous segment. Signals can include:

- visual continuity: background, product, person, color palette, composition;
- action continuity: motion direction, movement strength, continuous gesture or product demonstration;
- audio continuity: uninterrupted music, voiceover, sound effect, or silence pattern;
- text continuity: subtitles or speech transcript continuing the same sentence or selling point;
- transition signals: black frame, white flash, logo card, title card, hard visual reset.

The decision produced by this stage is:

```text
merge_with_next: true | false
reason_code: visual_continuity | action_continuity | audio_continuity | text_continuity | transition_boundary | weak_continuity
```

The system should store this internally for traceability. It does not need to add all of these fields to user-facing spreadsheets unless needed for debugging or failure handling.

## Semantic Segment Assembly

Candidate shots are assembled into final candidate segments according to continuity.

Rules:

- Merge adjacent shots when continuity is strong.
- Split at strong transition signals.
- Treat a fast-cut montage as one segment when its shots form a continuous expression unit.
- Prefer keeping a complete action, product demonstration, or spoken sentence group together.
- Do not merge across an obvious scene reset only to meet a target duration, unless required to avoid an invalid clip.

This stage aims to create meaningful segments before duration constraints are applied.

## Duration Governance

Final output clips must obey:

- hard minimum: `3s`
- preferred minimum: `5s`
- hard maximum: `30s`

Short segment rules:

- `<3s` segments should first merge with the adjacent segment that has the strongest continuity.
- If both sides are weak and no merge can produce a valid segment, route the isolated segment to problem clips.
- `3-5s` segments are allowed to enter the normal flow without extra marking.

Long segment rules:

- `>30s` segments must be split again.
- First retry inside the long segment with stricter or more sensitive candidate cut detection.
- If internal cuts exist, choose the weakest continuity boundary that keeps resulting clips valid.
- If no usable boundary exists, force split near a stable point before `30s` and allow the resulting valid clips into normal `AfterEdit`.

Overlap rule:

- Adjacent clips may include a small overlap when it avoids cutting an action or sentence unnaturally.
- Initial default overlap should be conservative, such as `0.3-0.8s`.

## Problem Clips

Normal automation should not stop the whole task when a small number of clips are unresolved.

Problem clips are written to a dedicated folder under the download cache:

```text
视频数据下载缓存/ProblemClips
```

Initial problem categories:

- source media unreadable;
- candidate cut detection failed;
- clip cannot satisfy `3-30s`;
- export failed;
- exported clip missing;
- segmentation result empty.

The generated table should mark problem rows with a status such as:

```text
自动分割待处理
```

Detailed failure handling can be expanded later, but these categories are enough to preserve automation without hiding invalid outputs.

## AfterEdit Integration

When automatic segmentation is enabled, the workflow becomes:

```text
downloaded_waiting_after_edit
-> auto_segmenting
-> auto_segmented
-> after_edit_table_generated
-> after_edit_validated
-> video_cache_created
-> video_tagged
-> tags_accepted
-> spreadsheet_written
-> archived
-> completed
```

The segmentation stage writes valid clips into the existing `AfterEdit` folder. Existing AfterEdit scanning, filename governance, record table generation, validation, tagging, writeback, and archive behavior should be reused.

Original downloaded files remain in the download cache and are traceable as source files, but they do not continue into tagging when auto segmentation succeeds.

## File Naming

The user-facing naming rule should be simple:

```text
原剪辑文件名_01.mp4
原剪辑文件名_02.mp4
原剪辑文件名_03.mp4
```

The actual file should still pass existing AfterEdit filename governance. If the existing system requires resolution/date/duration metadata, the segment suffix should be added without losing that compatibility.

Recommended normalized form:

```text
清洗后的原文件名_分辨率P_YYMMDD_片段秒数_01.mp4
```

The numeric suffix is the segment order within the source video.

## Data and Traceability

The system should record segmentation metadata internally:

- source file path;
- source file hash;
- detector profile;
- continuity scoring profile;
- segment index;
- start time;
- end time;
- duration;
- output path;
- problem category when applicable.

These fields are not all required in the user-facing spreadsheet. They are needed for retry, debugging, and future audits.

## User Interface

The Web UI should present automatic segmentation as part of the post-download stage.

Initial UI behavior:

- offer an `自动分割` action when downloads are ready;
- show progress as `自动分割中`;
- show valid clip count and problem clip count;
- let the existing `生成 AfterEdit 表格` path continue after segmentation;
- expose problem clips as a clear folder/status instead of blocking the whole task.

The UI should avoid exposing low-level detector parameters in the first version. Profiles are better than raw thresholds.

## Configuration Profiles

Initial profiles:

- `standard_ad`: balanced scene continuity for commercials and common short-video ads.
- `fast_cut`: more willing to merge fast short shots into montage groups.
- `conservative`: fewer semantic merges, stronger respect for visual transitions.

Each profile maps to detector thresholds, continuity scoring weights, overlap policy, and long-segment retry behavior.

## Testing

Unit tests:

- duration governance for `<3s`, `3-5s`, `5-30s`, and `>30s`;
- continuity merge decisions;
- suffix naming order;
- problem clip routing;
- source-to-segment trace records.

Integration tests:

- one long source splits into multiple valid `AfterEdit` clips;
- fast-cut source groups short shots instead of exporting unusable tiny clips;
- long continuous source is recursively split under `30s`;
- problem clips do not block valid clips;
- generated `AfterEdit_归档记录表.xlsx` only sends valid clips into tagging.

Manual acceptance:

- use a 2-3 minute commercial;
- verify final clips are all `3-30s`;
- verify most source content is covered;
- verify clips mostly correspond to scenes, continuous action groups, or montage groups;
- verify original full video is not tagged or archived when segmentation succeeds.

## Forced Split Policy

If a `>30s` segment has no reliable internal boundary, the default behavior is to force split and allow the resulting valid clips into normal `AfterEdit`.

This default preserves automation and near-complete content coverage. The segment should only enter `ProblemClips` when the system cannot export valid media, cannot keep the output within `3-30s`, or cannot read the source segment safely.

## References

- PySceneDetect detector API: `https://www.scenedetect.com/docs/latest/api/detectors.html`
- FFmpeg `scdet` filter: `https://ayosec.github.io/ffmpeg-filters-docs/8.0/Filters/Video/scdet.html`
- TransNetV2 repository: `https://github.com/soCzech/TransNetV2`
- Microsoft Research shot grouping paper: `https://www.microsoft.com/en-us/research/publication/automatic-video-scene-extraction-by-shot-grouping/`
