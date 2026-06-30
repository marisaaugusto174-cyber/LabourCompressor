# TagVision review filename sorting design

## Goal

Make review cards for videos with the same filename appear consecutively even when the files are stored in different archive directories. This reduces navigation during manual review.

## Sorting rule

The scan result's paired review items will be ordered using two keys:

1. Compare `videoFileName` in ascending order with the existing `zh-Hans-CN` locale.
2. When filenames are equal, compare `videoRelativePath` in ascending order with the same locale to provide deterministic ordering.

The implementation will compare complete filenames. It will not parse source names, strip segment suffixes, or perform numeric segment grouping.

## Scope

The change applies only to paired items displayed in the review grid and detail navigation. Diagnostic collections for unpaired videos, orphan JSON files, and invalid JSON files retain their current relative-path ordering.

The source implementation and the packaged macOS application must use the same rule. The browser continues to render items in API response order without client-side sorting.

## Verification

Unit coverage will demonstrate that:

- identical filenames in different directories are adjacent;
- filename ordering takes precedence over directory ordering;
- equal filenames use relative path as a deterministic tie-breaker;
- existing pairing and diagnostic behavior remains unchanged.

After rebuilding the macOS package, the running review page will be checked to confirm the packaged application serves the new order.
