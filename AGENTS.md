# Project instructions

## Process boundaries (enforced)

Cross-process contracts live in `src/shared/contracts/` (`config/`, `session/`, `data/`, `ipc/`, `remote/`, plus `mcp/`, `skills/`, `memory/`, `schedule/`, `update/`, `automation/`). Rules:

- `src/main/**` and `src/preload/**` must never import from `src/renderer/**` — import contract types from `../shared/contracts` instead. `src/renderer/types/index.ts` is a compatibility re-export barrel plus renderer-local view types only.
- `src/shared/**` must never import from `src/main/**`, `src/renderer/**`, or `src/preload/**`. Shared code is pure (no Electron/browser APIs).
- `src/renderer/**` must never import from `src/main/**` or `src/preload/**` — use the `electronAPI` bridge.
- Shared i18n locale resources live in `src/shared/i18n/locales/` (used by both renderer UI and main-process remote messages).

Enforcement: ESLint `no-restricted-imports` overrides in `.eslintrc.cjs`, plus `src/tests/contracts/architecture-boundaries.test.ts` (vitest scan).

## IPC input validation (enforced)

All `ipcMain.handle` registrations must go through `handleIpc()` in `src/main/ipc-handle.ts` — never call `ipcMain.handle` directly in feature code. Every channel must have a positional argument schema entry in `IPC_INPUT_SCHEMAS` (`src/shared/contracts/ipc/schemas.ts`); `client-event`/`client-invoke` payloads are validated by `clientEventSchema`. `src/tests/contracts/ipc-boundary.test.ts` fails if a registered channel lacks a schema.

## Entrypoint layout (enforced)

- `src/main/index.ts` is a thin composition root: env bootstrap, single-instance lock, `registerAllIpc()`, `registerAppLifecycle()`, `whenReady().then(bootstrap)`. It must not register IPC handlers or create windows directly — `src/tests/contracts/architecture-boundaries.test.ts` fails otherwise.
- `src/main/app/` holds app infrastructure: `context.ts` (shared runtime state `appContext`), `bootstrap.ts` (service assembly), `lifecycle.ts` (app events + shutdown cleanup), `window.ts`, `tray.ts`, `menu.ts`, `workdir.ts`, `theme.ts`, `notifications.ts`, `events.ts`, `file-open.ts`, `runtime-config.ts`, `sandbox-bootstrap.ts`.
- `src/main/features/<domain>/ipc.ts` registers that domain's channels; `service.ts` holds domain state/logic. New channels belong in the matching domain module (or a new one), wired via `registerAllIpc()` in `src/main/features/index.ts`.
- `src/preload/index.ts` composes `src/preload/api/<domain>.ts` factories into one object checked with `satisfies ElectronApi`. The bridge type lives in `src/shared/contracts/electron-api.ts`; the `Window` global is declared once in `src/shared/contracts/electron-api.d.ts`.
- `src/main/mcp/gui-operate-server.ts` is a thin MCP adapter (tool schemas + request dispatch + `main()`); all capability logic lives in `src/main/mcp/gui-operate/` with one-directional layering: `types`/`app-aliases` ← `env` ← `windows` ← `display` ← `macos` ← `click-history` ← `actions` ← `vision` ← `planner`. The boundary test fails on upward imports.
- `src/main/claude/agent-runner.ts` is the run orchestrator; extracted siblings hold stable responsibilities: `agent-runner-env` (bundled Node/skill paths + PATH enrichment), `agent-runner-log-utils` (safeStringify/message summaries/token normalization), `agent-runner-tools` (MCP→SDK tool bridge), `agent-runner-skills` (skill path resolution/sync, `AgentRunnerSkills`), `agent-runner-sandbox-sync` (WSL/Lima init + skill sync), `agent-runner-event-bridge` (per-run SDK→ServerEvent bridge owning all streaming state via `AgentRunBridgeDeps`). Shared per-run mutable state crosses through explicit deps (`modelClock` cell, `seenToolCallIds` set, abort callbacks) — never module-level globals.

## Data store layering (enforced)

`src/main/data/` uses composition, not inheritance — the old `DataStoreRuntime → … → DataTaskStore` chain is gone:

- `src/main/data/store/data-store-context.ts` (`DataStoreContext`) is the infrastructure runtime: DuckDB instance/connection, optional SQLite metadata DB, the serialized `runExclusive` section, schema init, and generic query/physical-table helpers. Domain logic does not live here; `registerPostReadyHook` is how upper layers plug into post-init recovery (e.g. output-commit recovery — runtime recovery only, never schema work).
- `src/main/data/store/migrations.ts` is the versioned metadata schema layer: `data_schema_migrations` ledger, `METADATA_MIGRATIONS` (ascending versions, each applied once inside its own transaction, rolled back + unrecorded on failure). Schema changes and one-time data normalization are new migrations appended here — never boot-time side effects in repositories/services/context, never renumber or edit an applied version. A ledger version higher than `METADATA_SCHEMA_VERSION` marks the context `metadataReadOnly`: `metaRunSql`/`runSql` throw instead of letting an older binary write a schema it does not understand.
- `src/main/db/database.ts` follows the same rule for the main `cowork.db`: `app_schema_migrations` ledger + `MAIN_SCHEMA_MIGRATIONS` (baseline v1 covers all current tables/indexes/columns and the legacy session→project backfill). `migrateMainSchema` detects a newer-version file via pure reads BEFORE writing; a newer schema opens with `PRAGMA query_only = ON` — writes fail, reads still work.
- `src/main/data/store/repositories/` owns row-level access per metadata table (`task`, `dataset`, `workflow`, `run-stats`, `cache`, `watermark`, `output-commit-journal`, `normalizer`). Repositories never execute workflows, compile operator SQL, or contain DDL/schema-upgrade logic (no `CREATE`/`ALTER`/`INDEX`); reads must not trigger cleanup or upgrades.
- `src/main/data/store/services/` holds application services (`workflow-validator`, `workflow-executor`, `workflow-node-preview-service`, `output-commit-coordinator`, `task-service`, `input-table-service`, `normalizer-service`, `workflow-compiler`, `workflow-binding-resolver`, `input-source-summary-service`, `dashboard-service`). Services take narrow constructor deps (context + only the repositories/services they need).
- `src/main/data/data-task-store.ts` (`DataTaskStore`) is the composition facade exposing the same public API; `createDataTaskStore(dbPath, options?)` is the entry point. It contains no SQL and no `extends`.
- `store/workflow-model.ts` + `shared/workflow-plan/` stay the domain layer (pure workflow model/rules); `store/input-source.ts` + `store/data-store-records.ts` stay pure fs/record helpers.

`architecture-boundaries.test.ts` fails on `extends` inside `store/repositories|services`, SQL inside the facade, or metadata DDL outside `migrations.ts`. `tests/data-schema-migrations.test.ts` covers ledger creation, legacy-fixture upgrade, no-rerun on reopen, and rollback.

## Operator registry (enforced)

`src/shared/operators/` is the single operator registration point:

- `OPERATOR_TYPES` (`definition.ts`) is the canonical operator-type list — `DataWorkflowOperatorType` derives from it (re-exported via `data-workflow-types.ts`).
- `OPERATOR_DEFINITIONS` (`definitions.ts`) binds each type to its `OperatorDefinition<T>`: config `schema`, `createDefaultConfig()`, `ports` (edge handles), `dsl` codec, `compileKind`, and `validateConfig`. The `satisfies Record<DataWorkflowOperatorType, …>` makes missing/extra entries compile errors.
- Derived facets: `SCHEMA_MAP` + `getOperatorConfigValidation`/`validateOperatorConfig` (re-exported via `operator-schemas`), DSL codec list (`prep-dsl/operators/registry.ts`), graph handle rules (`workflow-plan/graph.ts`), SQL dispatch (`compileKind` in `WorkflowCompiler`), capability-manifest enum + `ports`.
- Renderer UI facets live in `OPERATOR_UI` (`workflow/operator-catalog.ts`): labelKey, icon, colors, lazy `form` loader, `summarize`. `OperatorFormProps` lives in `workflow-forms/types.ts`; `workflow-forms/index.ts` is a barrel only.

Adding an operator = schema file + codec file + SQL compile (when `compileKind: 'strategy'`) + one `OPERATOR_DEFINITIONS` entry + one `OPERATOR_UI` entry. `operator-registry.test.ts` fails on any drift between registries.

## Renderer data feature layering (enforced)

The data workspace is feature-sliced under `src/renderer/features/data/`:

- `api/data-client.ts` is the typed IPC adapter — every `window.electronAPI` touch in the data domain funnels through it (`data.*` methods plus `selectFiles`/`selectInputTableSource`/`auth.login`, with `isAvailable()`/`has()`/`hasAuth()` for bridge guards). Components and hooks never reach for the bridge directly.
- `model/types.ts` holds view-model types only (`DataTab`, `InputTableDraft`, `StoredPreviewTarget`, `EMPTY_DASHBOARD`) — no component or IPC imports.
- `hooks/` splits state by kind: `use-data-view-ui` (UI state), `use-data-dashboard` + `use-input-tables` (server state), `use-data-view-editors` + `use-input-table-drafts` + `use-stored-preview` (editor/preview state), `use-data-actions` (commands), `use-data-navigation` (pending-navigation effects).
- `pages/DataViewPage.tsx` is the composition layer; `src/renderer/components/DataView.tsx` is a thin re-export kept for compatibility.
- Presentational components stay in `src/renderer/components/data-view/` and `workflow-forms/` and only receive state + action callbacks — they call `dataClient`, never `window.electronAPI`.

`architecture-boundaries.test.ts` fails on `electronAPI` usage outside `api/data-client.ts` in the data feature and data-view/workflow-form components.

## Large renderer modules (split by responsibility)

- `components/data-view/input-tables.tsx` is the entry (source filter bar + table list panel + editor wrapper); `input-table-editor-workbench.tsx` (editor surface), `input-table-version-history.tsx` (project tree + version diffing), `input-table-code-preview.tsx` (CodeMirror infra + file preview), `input-table-preview-dialog.tsx` (dataset preview dialog), `input-table-normalizer-utils.ts` (pure normalizer/config helpers). Dependency direction: utils → preview/tree/history → workbench → entry.
- `components/settings/schedule/editorPanels.tsx` is the entry (header/status/project/trigger panels + schedule/file-change config cards); `editor-controls.tsx` (shared row/select/segmented primitives + automation prompt fields + data-process helpers), `schedule-time-pickers.tsx` (weekday/month-day/times pickers), `cloud-action-editors.tsx` (cloud table-process editor + source/target selectors), `action-config-editors.tsx` (action chain + per-type action editors + action catalog metadata).
- `hooks/useApiConfigState.ts` is the React binding; `api-config-model.ts` (pure: profile keys, snapshots, config-set builders, labels) and `api-config-reducer.ts` (state + action union + reducer) hold everything testable without React. Public helpers stay re-exported from the hook for compatibility.

## UI work

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
- Output config is now typed (`OutputConfigSchema`/`InputSourceConfigSchema` in operator-schemas/input-output.ts): non-executable destinations, bad mode/schemaPolicy, mergeKeys without mode=merge, and unbound dataset/file sources are rejected at save/preflight — same rules the manifest advertises via z.toJSONSchema.
- `expect rows` cannot take `reject to` (row-count violations have no rows to route); DSL/canvas/apply paths all reject the combination.
- Duplicate-output detection compares RESOLVED physical targets (resolveWorkflowOutputTarget), not raw config fields — mixed binding styles (task fallback vs outputDatasetId) can't slip through.
- Failed restores keep the output-commit journal recoverable ('data_committed'/'prepared', never 'failed') so startup recovery retries instead of trusting a tombstone.
- Input-table reimports and output-table rebinds use the same journaled pattern via `data_table_commits` (migration v5, `TableCommitJournal`, `InputTableService.commitStagedTable`/`recoverPendingTableCommits`): stage the new physical table, rename the old target to a backup inside one DuckDB transaction, write metadata + journal state inside the metadata transaction, restore-or-stay-recoverable on failure. `updateDataset`/`updateOutputTable` both run under `runExclusive`.
- Mutation boundary rule: every DuckDB physical write/DDL — including TEMP tables on the shared connection — must run inside `ctx.runExclusive` (import/reimport/rebind/delete/run/preview paths all hold the lock; `*Unsafe` methods assume the caller holds it). Pure SELECT reads (`previewDataset`, `exportDatasetCsv`, dashboard queries) stay lock-free. Deletes drop the physical table first, then the metadata row — a leftover metadata row is a retryable ghost, while the reverse order would orphan invisible physical data.
- Resource ownership: a `data_datasets` row matching `outputTableConfigPredicateSql` is a user-managed output table that tasks may only reference (bound via `outputTableId`/`outputDatasetId`). `deleteTask` removes physical output tables + dataset rows ONLY when no explicit row claims the table name — task-owned outputs (`clean_task_*`, unbound sinks) are still cleaned up.
