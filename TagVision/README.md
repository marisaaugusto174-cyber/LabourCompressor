# TagVision

TagVision is the machine-tag review checker extracted from the V0.4
LabourCompressor workflow.

This folder keeps the review-specific source snapshot using the original
relative project layout, so future standalone packaging can preserve imports
with minimal churn.

Included areas:

- `apps/web/tag-review.ts`: scan, import-package, export parsing, and review state logic
- `apps/web/services/label-studio.ts`: Label Studio HTTP integration
- `apps/web/api/routes/tag-review.ts`: HTTP route wiring for review APIs
- `apps/web/public/review.html` and `apps/web/public/tag-review.js`: review UI
- `packages/testing/unit/web/tag-review*.test.ts`: focused review tests

The runnable integrated project remains in `../LabourCompressor`.
