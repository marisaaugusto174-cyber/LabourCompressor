# V0.4 Architecture Boundary Refactor Design

## Goal

This refactor makes the V0.4 project easier to understand and extend by clarifying module boundaries. The first pass is structural: keep current behavior, tests, and local data isolation intact while moving responsibilities into explicit areas.

The success criterion is not fewer files. The success criterion is that a developer can answer these questions without reading several large files:

- Where are pipeline options defined and defaulted?
- Where does each pipeline stage run?
- Where does the Web API parse requests?
- Where are local project paths, runtime state, and local config files managed?
- Where does tag-review and Label Studio integration live?

## Current Pain Points

The project already has useful V0.4 capabilities, but several files now act as aggregation points:

- `apps/cli/local-pipeline-stages.ts` mixes stage orchestration, row state creation, writeback, path resolution, sidecar JSON handling, and archive placement.
- `apps/cli/local-pipeline-command.ts` overlaps with staged execution and contains full-pipeline orchestration.
- `apps/web/server.ts` mixes HTTP routing, static serving, task APIs, provider config APIs, platform credential APIs, cache APIs, download probes, tag-review APIs, Label Studio calls, and media streaming.
- `apps/web/public/app.js` mixes form state, defaults, task control, event streams, AfterEdit sheet generation, and partial writeback.
- Defaults are repeated across CLI, Web, and tests, including selected model profile, stage names, writeback target, local paths, and runtime mode defaults.

These are architecture clarity issues, not proof that the current behavior is broken.

## Target Boundaries

### Pipeline

Owns execution of V0.4 processing stages:

- download
- segment
- compress
- tag
- archive
- all-stage sequencing
- result and failure shape
- writeback behavior

Pipeline code should not parse HTTP requests, know Web route names, or create local Web runtime state.

### Pipeline Options

Owns option defaults, parsing, normalization, and validation for CLI and Web callers.

This module becomes the single source for:

- default taxonomy preset
- default prompt library
- default provider config path
- default platform credential path
- default downloader and merge modes
- default tagging mode
- default selected model profile
- default `AfterEdit` and `ProblemClips` names
- default writeback target by caller

CLI and Web may choose different user-facing defaults, but those choices should be explicit through a shared builder rather than hardcoded in multiple files.

### Runtime Task

Owns Web task lifecycle:

- queued/running/paused/cancelled/succeeded/failed state
- task persistence
- event stream subscription
- pause/resume/stop controls
- mapping pipeline events into task snapshots

Runtime task code should not parse pipeline form payloads or contain route logic.

### Web API

Owns HTTP concerns:

- route matching
- request body/query parsing
- response formatting
- status codes
- CORS headers for media endpoints
- mapping HTTP input into service calls

Web API code should call services and pipeline option builders. It should not contain business workflows directly.

### Local Project State

Owns project-local paths and files:

- project root
- default local config paths
- local runtime directories
- cache paths
- default master spreadsheet path
- first-run local file creation

This boundary keeps personal data and runtime artifacts isolated from source assets.

### Tag Review

Owns review-specific behavior:

- scanning video and sidecar JSON pairs
- review state files
- Label Studio import package building
- Label Studio export parsing
- review media path safety checks
- media content-type resolution

Label Studio HTTP calls should be separated from pure tag-review parsing and packaging.

## Proposed Directory Shape

```text
apps/
  cli/
    commands/
      main.ts
      args.ts
    pipeline/
      options.ts
      runner.ts
      result.ts
      status.ts
      control.ts
      writeback.ts
      row-state.ts
      paths.ts
      stages/
        download.ts
        segment.ts
        compress.ts
        tag.ts
        archive.ts
      support/
        after-edit.ts
        segmentation-dependencies.ts
        taxonomy-presets.ts
    project-state/
      paths.ts
  web/
    server.ts
    api/
      http.ts
      routes/
        defaults.ts
        tasks.ts
        pipeline.ts
        local-dialogs.ts
        provider-config.ts
        platform-credentials.ts
        cache.ts
        download-probe.ts
        tag-review.ts
        static.ts
    runtime/
      task-service.ts
    services/
      local-runtime.ts
      provider-config.ts
      platform-credentials.ts
      tag-review.ts
      label-studio.ts
```

This is a target shape, not a requirement to move every file in one patch. The migration should happen in small verified steps.

## Data Flow

### CLI Flow

```text
CLI args
  -> parseCliPipelineOptions
  -> normalizePipelineOptions
  -> runPipeline
  -> stage runner
  -> writeback/result
```

### Web Flow

```text
HTTP request
  -> route handler
  -> parse request body/query
  -> buildWebPipelineOptions or service input
  -> runtime task service or domain service
  -> JSON response / SSE event stream
```

### Shared Defaults

```text
project-state paths
  -> pipeline option defaults
  -> CLI options
  -> Web defaults endpoint
  -> Web form initialization
```

The front end should continue to use simple static JavaScript in the first pass. A build system is not required for this refactor.

## Migration Plan

### Phase 1: Shared Option Boundary

Create a shared pipeline option module and move default construction into it.

Expected moves:

- `RunLocalPipelineOptions` type
- CLI option normalization
- Web request option normalization
- default local paths and mode defaults

Verification:

- taxonomy preset tests pass
- Web V0.4 UI tests pass
- runtime support tests pass
- full test suite passes

### Phase 2: Web API Route Boundary

Split `apps/web/server.ts` into route handlers without changing endpoints.

Suggested extraction order:

1. static routes and JSON helpers
2. defaults and pipeline option route
3. task routes
4. local dialog/upload/cache routes
5. provider/platform credential routes
6. tag-review routes
7. download probe route

Verification:

- route behavior tests remain green
- `server.ts` becomes a thin entrypoint
- no public endpoint path changes

### Phase 3: Tag Review Service Boundary

Separate pure review logic from Label Studio HTTP integration.

Expected split:

- pure scan/package/state functions stay in review service
- Label Studio fetch/import/update/export moves to `label-studio.ts`
- media serving route remains HTTP-specific

Verification:

- tag-review unit tests pass
- review UI tests pass
- no Label Studio token or URL leaks into logs

### Phase 4: Pipeline Stage Boundary

Move stage implementations into `pipeline/stages/` and common helpers into smaller files.

Expected split:

- stage orchestration
- per-stage implementation
- row-state conversion
- sidecar JSON helpers
- writeback helpers
- archive path helpers

Verification:

- staged pipeline tests pass
- full-pipeline tests pass
- partial writeback tests pass
- phase4 and phase5 integration tests pass

### Phase 5: Governance

Add tests that prevent architecture drift:

- Web server entrypoint remains below a small size threshold.
- Route modules do not import CLI internals except the shared pipeline option builder.
- Pipeline modules do not import Web modules.
- Runtime task service imports pipeline runner through an interface.
- Runtime/source code remains free of this machine's absolute checkout path.

## Error Handling

The refactor should preserve current error behavior:

- route handlers return JSON errors with appropriate status codes
- pipeline failures are recorded as item failures where possible
- fatal pipeline failures fail the task
- cancelled tasks remain distinguishable from failed tasks
- provider and download errors remain sanitized
- request bodies containing credentials are not logged

New route helpers may standardize this behavior, but they should not change user-visible messages during the first pass unless tests are updated intentionally.

## Testing Strategy

Use existing tests as the safety net and add targeted architecture tests.

Required commands during implementation:

```bash
node --test packages/testing/unit/governance/*.test.ts
node --test packages/testing/unit/cli/taxonomy-presets.test.ts packages/testing/unit/cli/pipeline-stages.test.ts packages/testing/unit/web/v04-stage-ui.test.ts packages/testing/unit/web/tag-review.test.ts packages/testing/unit/web/tag-review-ui.test.ts
npm run test:taxonomy-domain
```

After steps that create runtime state, remove ignored local artifacts again:

```bash
rm -rf .cache .runtime-state .runtime-uploads .runtime-probe
```

Then verify:

```bash
git status --short --branch
```

## Non-Goals

This first refactor does not:

- introduce React, Vite, or a frontend build chain
- remove V0.2 compatibility paths
- remove simulated test modes
- change public Web API endpoint names
- change spreadsheet output formats
- alter tag taxonomy behavior
- change the V0.4 user workflow

## Rollback Boundary

Each phase should be reviewable as a small diff. If a phase fails, revert only that phase and keep previous phases.

The safest order is option boundary first, Web route boundary second, pipeline stage boundary last. Pipeline stage extraction has the largest blast radius and should not start until route and option boundaries are stable.

## Open Decisions Resolved

- Architecture clarity is the primary objective.
- Behavior compatibility is required for the first pass.
- No frontend framework migration in this pass.
- Existing tests remain the acceptance baseline.
- Route paths remain unchanged.
- Compatibility features stay available but can be moved behind clearer module boundaries.
