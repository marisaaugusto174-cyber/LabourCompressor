# LabourCompressor Remaining Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete GOV-003, GOV-001, GOV-002, GOV-005, and GOV-006 without changing V0.5 product behavior.

**Architecture:** Establish application ports before splitting oversized modules, then enforce TypeScript, move cross-stage state into an adapter-free orchestrator, and finally place JSON and optional SQLite persistence behind one store contract. Existing HTTP, CLI, spreadsheet, and task snapshot interfaces remain compatible.

**Tech Stack:** Node.js 22+, TypeScript 6.0.3, `@types/node` 22.20.0, Node test runner, `node:sqlite` (opt-in only).

---

## Execution gates

- [ ] Establish platform credential service, repository, and connectivity probe boundaries; keep Web DTOs stable.
- [ ] Split every production `.ts`/`.js` file above 500 lines and enforce the limit with a governance test.
- [ ] Add strict typecheck for `apps/**/*.ts` and `packages/**/*.ts`; fix diagnostics without suppressions.
- [ ] Add adapter-free pipeline and runtime-task orchestration with compatibility facades.
- [ ] Add `RuntimeTaskStore`, atomic JSON persistence, optional SQLite, and verified JSON-to-SQLite migration.
- [ ] After every gate, run focused tests and the complete regression suite, update governance evidence, and commit independently.

## Compatibility and rollout

- JSON remains the default task store.
- SQLite requires `LABOUR_COMPRESSOR_TASK_STORE=sqlite`; its path can be overridden with `LABOUR_COMPRESSOR_TASK_DB_PATH`.
- Existing routes, DTOs, CLI flags, spreadsheet columns, and legacy module paths remain available.
- Real credentials, access tokens, and signed media URLs must not enter source, tests, logs, or persistence.
