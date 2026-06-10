import type { PrepOperatorType } from './ast';

export const PREP_DSL_REFERENCE_VERSION = 'prep-dsl/v1';

export type PrepDslReferenceTopic =
  | 'overview'
  | 'workflow'
  | 'operators'
  | 'derive_window'
  | 'reshape'
  | 'examples'
  | 'all';

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
      'input source dataset "<inputTableId>" as src',
      "  | derive [包装长CM] = CAST(split_part([包装尺寸CM], 'x', 1) AS INTEGER), [包装宽CM] = CAST(split_part([包装尺寸CM], 'x', 2) AS INTEGER), [包装高CM] = CAST(split_part([包装尺寸CM], 'x', 3) AS INTEGER)",
      '  | output table "02_商品主数据_尺寸拆分" mode replace',
    ].join('\n'),
  },
  {
    id: 'left-join-dimension',
    title: 'Join a main table with a dimension table',
    dsl: [
      'input source dataset "<ordersInputTableId>" as orders',
      'input source dataset "<customersInputTableId>" as customers',
      '',
      'from orders',
      '  | join left customers',
      '      on [orders].[customer_id] = [customers].[customer_id]',
      '      keep left *, [customers].[name] as [customer_name]',
      '  | output table "Orders with customers" mode replace',
    ].join('\n'),
  },
];

export const PREP_DSL_OPERATOR_EXAMPLES: PrepDslOperatorExample[] = [
  { type: 'field_select', title: 'Select fields', dsl: 'select [order_id], [region]' },
  { type: 'field_select', title: 'Drop fields', dsl: 'drop [internal_note], [debug_flag]' },
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
    dsl: 'aggregate by [region] metrics sum([revenue]) as [total_revenue], count(*) as [row_count]',
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
    dsl: 'derive [rn] = row_number() over(partition by [region] order by [amount] desc)',
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
];

const OVERVIEW = [
  `Data workflow DSL version: ${PREP_DSL_REFERENCE_VERSION}.`,
  'Data workflow DSL is a text pipeline language for reusable data tasks. It is not JSON.',
  'Always use data_get_workflow_dsl_reference for DSL help. Do not read source-tree design docs; packaged apps may not include them.',
  'A workflow starts with one or more input source lines, optionally chooses a main source with from <alias>, then pipes operators with lines starting with |.',
  'Fields use bracket syntax: [field_name]. Qualified fields use [table_alias].[field_name], never [table_alias.field_name].',
  'Cast target types are text, date, datetime, integer, float, decimal, and boolean.',
  'For created input/output tables, prefer passing inputTableId and outputTableId to data_apply_workflow_dsl instead of embedding or guessing node ids.',
].join('\n');

const WORKFLOW = [
  'Workflow shape:',
  'input source dataset "<inputTableId>" as src',
  '  | select [col1], [col2]',
  '  | filter [amount] > 0',
  '  | output table "Result table" mode replace',
  '',
  'Input source forms:',
  '- input source task as src',
  '- input source dataset "<inputTableId-or-name>" as src',
  '- input source file "/authorized/path/file.csv" as src',
  '',
  'Important: input source task requires the task to have a sourcePath. If the task reads a created input table, use dataset input or pass inputTableId to data_apply_workflow_dsl.',
  '',
  'Multiple-source workflow example:',
  PREP_DSL_WORKFLOW_EXAMPLES.find((example) => example.id === 'left-join-dimension')?.dsl ?? '',
].join('\n');

const OPERATORS = [
  'Supported pipeline operators:',
  ...PREP_DSL_OPERATOR_EXAMPLES.map((example) => `- ${example.dsl}`),
  '- output table "Result table" mode replace',
  '',
  'Expressions are compiled for DuckDB-like execution. Common functions such as CAST(...) and split_part(...) can be used in derive/filter expressions.',
  'Window analysis is expressed with derive ... over(...); do not use a standalone window operator.',
].join('\n');

const DERIVE_WINDOW = [
  'Window analysis is part of derive/calculate_field DSL:',
  'derive [rn] = row_number() over(partition by [region] order by [amount] desc)',
  'derive [running_amount] = sum([amount]) over(partition by [region] order by [created_at] rows between unbounded preceding and current row)',
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
  '- data_apply_workflow_dsl({ taskId, dsl, inputTableId, outputTableId, dryRun: true })',
  '- data_apply_workflow_dsl({ taskId, dsl, inputTableId, outputTableId, dryRun: false })',
  '- data_run_task({ taskId, mode: "temporary", previewRows: 20 })',
  '- data_run_task({ taskId, mode: "persisted", previewRows: 20 }) after confirmation.',
].join('\n');

const SECTION_BY_TOPIC: Record<PrepDslReferenceTopic, string> = {
  overview: OVERVIEW,
  workflow: WORKFLOW,
  operators: OPERATORS,
  derive_window: DERIVE_WINDOW,
  reshape: RESHAPE,
  examples: EXAMPLES,
  all: [OVERVIEW, WORKFLOW, OPERATORS, DERIVE_WINDOW, RESHAPE, EXAMPLES].join('\n\n'),
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
    '## Tool Call Flow',
    '',
    '- `data_get_workflow_dsl_reference({ topic })` reads this same embedded reference at runtime.',
    '- `data_apply_workflow_dsl({ taskId, dsl, inputTableId, outputTableId, dryRun: true })` validates the workflow.',
    '- `data_apply_workflow_dsl({ taskId, dsl, inputTableId, outputTableId, dryRun: false })` saves the workflow.',
    '- `data_run_task({ taskId, mode: "temporary", previewRows: 20 })` validates output without replacing the formal table.',
    '- `data_run_task({ taskId, mode: "persisted", previewRows: 20 })` writes the formal output after confirmation.',
  ];
  return `${lines.join('\n').trim()}\n`;
}
