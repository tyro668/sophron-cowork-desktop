# Project instructions

All UI work under `src/renderer` must follow [`UI_STYLE_GUIDE.md`](UI_STYLE_GUIDE.md).

- Preserve the existing layout unless the task explicitly requests a layout change.
- Use semantic theme tokens; do not hard-code accent colors in components.
- Keep configuration screens compact and omit helper descriptions below fields.
- Do not introduce gradients, glass blur, glow effects, or heavy shadows.
- All UI code must natively support i18n: never hard-code user-facing text in components — use `useTranslation`/`useFormTranslation` keys, and keep `zh.json` and `en.json` in sync.
- Visually verify affected screens after UI changes.

## Data workflow validation

Prep DSL, GUI workflows, and AI-generated plans all normalize into the versioned typed plan in `src/shared/workflow-plan/` (`buildWorkflowPlan` → `validateWorkflowPlanGraph` → `validateWorkflowPlanSchemas`). Add or change operator validation rules there — not in per-path validators. `saveTaskWorkflow` / `runTask` / `data_apply_workflow_dsl` all gate on `validateWorkflowPlanForTask`.

## Prep DSL round-trip

Prep DSL v2 (`src/shared/prep-dsl/`) models workflows as named steps (`step <name> = <ref>`), anonymous chains (`from <ref>`), and explicit `output` sinks (multiple allowed). Node ids are `<stepName>_<seq>` — never position-in-array. `exportPrepWorkflowDsl` decomposes the graph structurally and MUST throw for inexpressible graphs rather than linearizing; never re-introduce a `config.dsl` first-choice fallback — structured config is authoritative, and canonical output omits default clauses (`keep first`, `on_error null`, `suffix _left _right`).

## ETL runtime contract

Output modes: `replace` (default), `append` (UNION ALL BY NAME into existing target), `error_if_exists`, `merge by [keys]` (business-key upsert — the idempotent write mode; `append` is intentionally not idempotent). Schema drift policy `schema extend|strict|ignore` applies to append/merge into an existing table. `expect` asserts quality (expression / `unique` / `rows`); `reject to <stream>` routes violating rows to a named stream consumable by later chains via a `reject` canvas handle. `input source ... incremental by [col]` reads rows past the persisted watermark and advances it only after a successful commit. Per-node run stats (input/output/dropped/rejected + violation samples) persist to `data_task_node_run_stats` (latest run only) and surface on canvas nodes via `data.getTaskNodeStats`. Scheduling, credentials, and retry policy stay in task configuration — never in DSL text.

## Constrained workflow plans (LLM authoring)

`data_apply_workflow_plan` accepts `{version: "workflow-plan/v1", nodes, edges}` — configs are zod-validated, then bound (`inputResources: alias -> inputTableId`, `outputTableId`), then run through the same `validateWorkflowPlanForTask` pipeline as DSL and the canvas before `exportPrepWorkflowDsl` produces the canonical DSL. `data_get_workflow_capability_manifest` exposes the versioned manifest (per-operator JSON Schemas generated from `SCHEMA_MAP` via `z.toJSONSchema`, handle rules, binding contract, stable diagnostic codes). Keep plan validation in `src/shared/workflow-plan/` and binding logic in `workflow-dsl-compiler.ts` — no parallel validators.

## ETL commit semantics (review fixes)

- Multi-sink commits: every `output` node gets its own staging table + `data_output_commits` journal row (`<commitId>` / `<commitId>__<i>`); one DuckDB transaction covers all target renames/creates; watermark + node-stat writes live INSIDE the metadata transaction so post-commit failures roll back metadata and restore physical targets — a retry never double-appends.
- `expect` uses `IS NOT TRUE`/`IS NOT DISTINCT FROM`: NULL expression results are violations, and repeated NULL keys violate `unique`.
- `merge` matches keys NULL-safely and dedupes the incoming batch by key (last row wins via rowid) — reruns are idempotent even with NULL/duplicate keys.
- Watermarks are keyed by (task, node, column); switching `incrementalBy` starts a fresh watermark instead of reusing a stale one.
- `validateWorkflowPlanForTask` is the single save/run preflight — it includes operator config diagnostics; disabled nodes pass through (runtime semantics).
- Join output schema inference shares `planJoinProjectionColumns` (src/shared/prep-dsl/join-projection.ts) with the SQL compiler — keep/conflict naming can never drift apart.
