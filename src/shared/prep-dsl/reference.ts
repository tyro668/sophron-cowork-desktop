import type { PrepOperatorType } from './ast';

export const PREP_DSL_REFERENCE_VERSION = 'prep-dsl/v2';

export type PrepDslReferenceTopic =
  'overview' | 'workflow' | 'operators' | 'derive_window' | 'reshape' | 'examples' | 'all';

export interface PrepDslWorkflowExample {
  id: string;
  title: string;
  dsl: string;
}

export interface PrepDslOperatorExample {
  type: PrepOperatorType;
  title: string;
  dsl: string;
}

export const PREP_DSL_WORKFLOW_EXAMPLES: PrepDslWorkflowExample[] = [
  {
    id: 'split-package-size',
    title: 'Split package size "20x18x22" into three numeric columns',
    dsl: [
      'input source rawTable "<rawTableId>" as src',
      "  | derive [包装长CM] = CAST(split_part([包装尺寸CM], 'x', 1) AS INTEGER), [包装宽CM] = CAST(split_part([包装尺寸CM], 'x', 2) AS INTEGER), [包装高CM] = CAST(split_part([包装尺寸CM], 'x', 3) AS INTEGER)",
      '  | output table "02_商品主数据_尺寸拆分" mode replace',
    ].join('\n'),
  },
  {
    id: 'left-join-dimension',
    title: 'Join a main table with a dimension table',
    dsl: [
      'input source rawTable "<ordersRawTableId>" as orders',
      'input source rawTable "<customersRawTableId>" as customers',
      '',
      'from orders',
      '  | join left customers',
      '      on [orders].[customer_id] = [customers].[customer_id]',
      '      keep left *, [customers].[name] as [customer_name]',
      '  | output table "Orders with customers" mode replace',
    ].join('\n'),
  },
  {
    id: 'branching-steps',
    title: 'Branch one cleaned stream into a result and a sample',
    dsl: [
      'input source rawTable "<ordersRawTableId>" as orders',
      '',
      'step base = orders',
      '  | filter [amount] > 0',
      '  | sort by [created_at] desc',
      'step result = base',
      '  | aggregate by [region] metrics sum([amount]) as [total]',
      '  | output table "Regional totals" mode replace',
      'step sample = base',
      '  | limit 10',
      '  | output table "Recent orders sample" mode replace',
    ].join('\n'),
  },
];

export const PREP_DSL_OPERATOR_EXAMPLES: PrepDslOperatorExample[] = [
  { type: 'field_select', title: 'Select fields', dsl: 'select [order_id], [region]' },
  { type: 'filter', title: 'Filter rows', dsl: 'filter [amount] > 0' },
  {
    type: 'calculate_field',
    title: 'Derive fields',
    dsl: 'derive [margin] = [profit] / [revenue]',
  },
  {
    type: 'type_convert',
    title: 'Cast field types',
    dsl: 'cast [amount] as decimal on_error null',
  },
  {
    type: 'deduplicate',
    title: 'Deduplicate rows',
    dsl: 'deduplicate by [id] keep last order by [updated_at] desc',
  },
  {
    type: 'missing_value',
    title: 'Drop empty rows',
    dsl: 'missing value row drop when all_null',
  },
  {
    type: 'missing_value',
    title: 'Fill and nullify missing values',
    dsl: 'missing value [region] nullify values ("", "N/A"), [score] fill 0',
  },
  {
    type: 'sort',
    title: 'Sort rows',
    dsl: 'sort by [created_at] desc nulls last',
  },
  {
    type: 'aggregate',
    title: 'Aggregate metrics',
    dsl: 'aggregate by year([Date]), [region] metrics sum([revenue]) as [total_revenue], count(*) as [row_count]',
  },
  {
    type: 'field_mapping',
    title: 'Rename fields',
    dsl: 'map [old_name] to [new_name]',
  },
  {
    type: 'join',
    title: 'Join tables',
    dsl: 'join left customers on [orders].[customer_id] = [customers].[customer_id] keep left *, [customers].[name] as [customer_name]',
  },
  {
    type: 'limit',
    title: 'Limit rows',
    dsl: 'limit 100',
  },
  {
    type: 'limit',
    title: 'Top N rows',
    dsl: 'top 10 by [amount] desc',
  },
  {
    type: 'calculate_field',
    title: 'Derive window fields',
    dsl: 'derive [rn] = ranking(row_number()) over(partition by [region] order by [amount] desc)',
  },
  {
    type: 'pivot',
    title: 'Pivot table',
    dsl: 'pivot on [month] using sum([revenue]) as [revenue_sum] group by [region]',
  },
  {
    type: 'unpivot',
    title: 'Unpivot table',
    dsl: 'unpivot [jan], [feb], [mar] into name [month] value [sales]',
  },
  {
    type: 'set_op',
    title: 'Union tables',
    dsl: 'union returns mode all by name',
  },
  {
    type: 'unnest',
    title: 'Unnest list field',
    dsl: 'unnest [items] as [item]',
  },
  {
    type: 'expect',
    title: 'Assert row quality',
    dsl: 'expect [amount] > 0',
  },
  {
    type: 'expect',
    title: 'Assert unique business keys with reject stream',
    dsl: 'expect unique [order_id] reject to bad_keys',
  },
  {
    type: 'expect',
    title: 'Assert minimum row count',
    dsl: 'expect rows >= 1',
  },
];

const OVERVIEW = [
  `Data workflow DSL version: ${PREP_DSL_REFERENCE_VERSION}.`,
  'Data workflow DSL is a text pipeline language for reusable data pipelines. It is not JSON.',
  'Always use data_get_workflow_dsl_reference for DSL help. Do not read source-tree design docs; packaged apps may not include them.',
  'A workflow starts with one or more input source lines, optionally chooses a main source with from <alias>, then pipes operators with lines starting with |.',
  'Fields use bracket syntax: [field_name]. Brackets hold the raw name with no quotes — use [Year of Transaction Date], not [`Year of Transaction Date`]. Backtick-quoting inside brackets is only for names that contain ] or a backtick. Qualified fields use [table_alias].[field_name], never [table_alias.field_name].',
  'Cast target types are text, date, datetime, integer, float, decimal, and boolean.',
  'For created input/output tables, prefer passing inputResources (alias -> rawTableId) and resultTableId to data_apply_workflow_dsl/data_apply_workflow_plan instead of embedding or guessing node ids.',
].join('\n');

const WORKFLOW = [
  'Workflow shape:',
  'input source rawTable "<rawTableId>" as src',
  '  | select [col1], [col2]',
  '  | filter [amount] > 0',
  '  | filter [field with spaces] = "value"',
  '  | output table "Result table" mode replace',
  '',
  'Input source forms:',
  '- input source pipeline as src',
  '- input source rawTable "<rawTableId-or-name>" as src',
  '- input source file "/authorized/path/file.csv" as src',
  '',
  'Important: input source pipeline requires the pipeline to have a sourcePath. If the pipeline reads a created input table, use rawTable input or bind it via inputResources: { <alias>: "<rawTableId>" } on data_apply_workflow_dsl/data_apply_workflow_plan (multi-source: one key per input alias).',
  '',
  'Named dataflows (branching):',
  'step <name> = <ref> starts a named chain; <ref> is a source alias or an earlier step name.',
  'from <ref> starts an anonymous chain. Operators follow on lines starting with |.',
  'join/set_op right inputs and fan-out points reference these stream names. Multiple output sinks are allowed; each ends its own chain.',
  'Forward references are rejected: a step can only read sources and earlier steps.',
  '',
  'Multiple-source workflow example:',
  PREP_DSL_WORKFLOW_EXAMPLES.find((example) => example.id === 'left-join-dimension')?.dsl ?? '',
].join('\n');

const OPERATORS = [
  'Supported pipeline operators:',
  ...PREP_DSL_OPERATOR_EXAMPLES.map((example) => `- ${example.dsl}`),
  '- output table "Result table" mode replace',
  '- output table "Result table" mode merge by [order_id]',
  '- output table "Result table" mode append schema strict',
  'Output modes: replace (default) rewrites the target table; append adds rows matched by column name (missing columns become null); error_if_exists fails when the target already exists; merge by [key], ... upserts rows on business keys (matching keys are replaced, new keys inserted; NULL keys match NULL keys, and duplicate keys inside one batch keep the last row — reruns stay idempotent). Schema drift policy after the mode: schema extend (default; union columns by name, new columns added, missing become null), schema strict (fail when the incoming columns differ from the existing table), schema ignore (drop incoming-only columns, null-fill missing). Only "output table" targets are executable; "output rawTable"/"output file" parse but are not supported. Multiple output sinks are all committed, each with its own mode/policy.',
  'expect assertions: expect <expression> fails the run when any row violates — a NULL/unknown expression result counts as a violation; expect unique [k1], [k2] fails on duplicate key tuples including duplicate NULL keys; expect rows >= 1 checks the row count. Append reject to <stream-name> to route violating rows to a named stream instead of failing (expression/unique only — row-count violations have no rows to route, so reject to is rejected there); the stream can feed its own chain (e.g. its own output sink).',
  'Bound input tables are read in full on every run. For pipeline/file sources, incremental by [updated_at] reads only rows newer than the last committed watermark and advances it to MAX([updated_at]) after a successful run. Watermarks are stored per input node AND column — switching the incremental column starts a fresh read instead of reusing a stale watermark.',
  '',
  'Expressions are compiled for DuckDB-like execution. Common functions such as CAST(...) and split_part(...) can be used in derive/filter expressions.',
  'Use DECIMAL or DECIMAL(18,2) rather than FLOAT for money, prices, rates, percentages, and other fixed-decimal business values.',
  'Window analysis is expressed with derive ... over(...); do not use a standalone window operator.',
].join('\n');

const DERIVE_WINDOW = [
  'Window analysis is part of derive/calculate_field DSL:',
  'derive [rn] = ranking(row_number()) over(partition by [region] order by [amount] desc)',
  'derive [running_amount] = sum([amount]) over(partition by [region] order by [created_at] rows between unbounded preceding and current row)',
  '',
  'Period comparison domain functions:',
  'derive [previous_amount] = compare(previous([amount], [created_at], "value")) over(partition by [region])',
  'derive [yoy_rate] = compare(sameperiodlastyear([amount], [created_at], "month", "percentchange")) over(partition by [region])',
  'Supported year-over-year grains: "year", "quarter", "month", "week", and "day".',
  'A missing matching year-over-year period produces null.',
  '',
  'Time accumulation domain functions:',
  'derive [year_amount] = accumulate(yeartodate(sum([amount]), [created_at])) over(partition by [region])',
  'derive [fiscal_year_amount] = accumulate(yeartodate(sum([amount]), [created_at], 4)) over(partition by [region])',
  'derive [month_amount] = accumulate(monthtodate(sum([amount]), [created_at])) over(partition by [region])',
  'derive [rolling_7_day_amount] = accumulate(rolling(sum([amount]), [created_at], 7, "day")) over(partition by [region])',
  'Supported time aggregates: sum, avg, count, count(distinct [field]), min, and max.',
  'Domain-function over(...) clauses may contain partition by only; date arguments determine ordering and window behavior.',
].join('\n');

const RESHAPE = [
  'Reshape operators:',
  'pivot on [month] using sum([revenue]) as [revenue_sum] group by [region]',
  'unpivot [jan], [feb], [mar] into name [month] value [sales]',
  'unnest [items] as [item]',
  'explode json [payload] path "$.items" as [item]',
].join('\n');

const EXAMPLES = [
  ...PREP_DSL_WORKFLOW_EXAMPLES.flatMap((example) => [
    `Example: ${example.title}:`,
    example.dsl,
    '',
  ]),
  'Recommended tool call flow:',
  '- data_get_workflow_capability_manifest({ rawTableIds, resultTableIds }) returns the versioned plan schema, per-operator config schemas, binding contract, and real column snapshots.',
  '- data_apply_workflow_plan({ pipelineId, plan, inputResources: { alias: rawTableId }, resultTableId, dryRun: true }) validates a constrained plan and returns the canonical DSL.',
  '- data_apply_workflow_plan({ pipelineId, plan, inputResources, resultTableId, dryRun: false }) saves the workflow.',
  '- data_apply_workflow_dsl({ pipelineId, dsl, inputResources, resultTableId, dryRun: true|false }) applies DSL text instead of a plan.',
  '- data_run_pipeline({ pipelineId, mode: "temporary", previewRows: 20 })',
  '- data_run_pipeline({ pipelineId, mode: "persisted", previewRows: 20 }) after confirmation.',
].join('\n');

const VALIDATION = [
  'Validation is staged before a workflow is saved or run:',
  '- Every operator config is validated against the typed platform schema for its node type; unknown or malformed fields are rejected.',
  '- The workflow graph is checked: edges must reference existing nodes, join/set_op require exactly one left and one right input, other operators require exactly one input, input nodes take no incoming edges, output nodes take no outgoing edges, and the graph must be acyclic.',
  '- Step and source names must be unique; a step input must reference a declared source or an earlier step; operators after an output sink in the same step are rejected.',
  '- Multiple output sinks are supported, one per chain; a step that ends in `output` still exposes its last data stream for later steps.',
  '- Schemas propagate along the graph: every field referenced by a filter, expression, sort key, mapping, join condition, pivot axis, or set operation is checked against the columns the upstream operators produce. A field that does not exist blocks saving.',
  '- Join equality conditions and set_operation columns are checked for type compatibility when both sides are known.',
  '- limit without order by, deduplicate without order by, and random sampling without seed report nondeterminism warnings.',
  '- output table is the only executable destination; rawTable/file destinations are rejected at validation, not just at run time. mode must be replace, append, error_if_exists, or merge; merge requires by [key] columns that exist upstream, and by keys without mode merge are rejected. Two output sinks resolving to the same target table are rejected (outputTargetDuplicate).',
  '- expect expressions and unique fields are checked against the upstream schema; a declared reject stream that no edge consumes reports a warning, and a reject edge without a configured reject stream is an error.',
  '- incremental by [field] applies only to pipeline/file sources and is checked against the source schema.',
].join('\n');

const SECTION_BY_TOPIC: Record<PrepDslReferenceTopic, string> = {
  overview: OVERVIEW,
  workflow: WORKFLOW,
  operators: OPERATORS,
  derive_window: DERIVE_WINDOW,
  reshape: RESHAPE,
  examples: EXAMPLES,
  all: [OVERVIEW, WORKFLOW, OPERATORS, DERIVE_WINDOW, RESHAPE, EXAMPLES, VALIDATION].join('\n\n'),
};

export function getPrepDslReference(topic: PrepDslReferenceTopic = 'all'): string {
  return SECTION_BY_TOPIC[topic] ?? SECTION_BY_TOPIC.all;
}

export function getPrepDslQuickReference(): string {
  return [OVERVIEW, EXAMPLES].join('\n\n');
}

export function buildPrepDslReferenceMarkdown(): string {
  const lines = [
    '# Prep DSL Reference',
    '',
    '<!-- Generated from src/shared/prep-dsl/reference.ts. Do not edit by hand. -->',
    '',
    `Version: \`${PREP_DSL_REFERENCE_VERSION}\``,
    '',
    '## Overview',
    '',
    OVERVIEW,
    '',
    '## Workflow',
    '',
    WORKFLOW,
    '',
    '## Operators',
    '',
    OPERATORS,
    '',
    '## Workflow Examples',
    '',
    ...PREP_DSL_WORKFLOW_EXAMPLES.flatMap((example) => [
      `### ${example.title}`,
      '',
      '```text',
      example.dsl,
      '```',
      '',
    ]),
    '## Operator Examples',
    '',
    ...PREP_DSL_OPERATOR_EXAMPLES.flatMap((example) => [
      `### ${example.title}`,
      '',
      `Type: \`${example.type}\``,
      '',
      '```text',
      example.dsl,
      '```',
      '',
    ]),
    '## Validation',
    '',
    VALIDATION,
    '',
    '## Constrained Plans',
    '',
    'Models should submit constrained plans, not guessed paths or field names:',
    '- `data_get_workflow_capability_manifest({ rawTableIds, resultTableIds })` returns the versioned manifest: plan JSON Schema, per-operator config schemas, handle rules, the `alias -> rawTableId` binding contract, runtime semantics, stable diagnostic codes, and real column snapshots for the requested tables.',
    '- A plan is `{ version: "workflow-plan/v1", nodes: [{id,type,config}], edges: [{sourceNodeId,targetNodeId,sourceHandle?,targetHandle?}] }`. Configs must satisfy `plan.operatorConfigSchemas[type]`; field references must exist on the upstream schema.',
    '- `data_apply_workflow_plan({ pipelineId, plan, inputResources, resultTableId, dryRun })` binds every `input_source` node by `config.alias` through `inputResources` (unknown aliases are rejected), runs the same validation pipeline as DSL and the canvas, exports the canonical DSL, and saves unless `dryRun`.',
    '- Diagnostics carry stable `code` values — repair by code, not by message text.',
    '',
    '## Tool Call Flow',
    '',
    '- `data_get_workflow_dsl_reference({ topic })` reads this same embedded reference at runtime.',
    '- `data_get_workflow_capability_manifest({ rawTableIds, resultTableIds })` returns the plan schema and resource snapshots.',
    '- `data_apply_workflow_plan({ pipelineId, plan, inputResources, resultTableId, dryRun })` applies a constrained plan.',
    '- `data_apply_workflow_dsl({ pipelineId, dsl, rawTableId, inputAlias, inputResources, resultTableId, dryRun })` applies DSL text.',
    '- `data_configure_input_operator` / `data_configure_output_operator` / `data_apply_operator_dsl` edit single nodes.',
    '- `data_run_pipeline({ pipelineId, mode: "temporary", previewRows: 20 })` validates output without replacing the formal table.',
    '- `data_run_pipeline({ pipelineId, mode: "persisted", previewRows: 20 })` writes the formal output after confirmation.',
  ];
  return `${lines.join('\n').trim()}\n`;
}
