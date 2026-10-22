import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';
import { validateGeneratedExecutableWorkflow } from '../src/main/data/workflow/generated-workflow-graph-validator';
import {
  compileWorkflowJavaScript,
  executeWorkflowJavaScriptInSandbox,
} from '../src/main/data/workflow/javascript-runtime';
import { validateAndNormalizeWorkflowIr } from '../src/main/data/workflow/workflow-ir';
import { AI_PREP_DSL_OPERATION_CAPABILITIES } from '../src/main/data/workflow/prep-dsl-capability-profile';
import {
  getRequiredRequirementCapabilities,
  REQUIREMENT_CAPABILITY_REGISTRY,
  type RequirementCapabilityId,
} from '../src/main/data/workflow/requirement-capability-registry';
import { lowerGeneratedWorkflowIrSemantics } from '../src/main/data/workflow/workflow-ir-lowerer';
import { compileLoweredWorkflowToPlatformNodes } from '../src/main/data/workflow/workflow-node-compiler';
import type { WorkflowOperationIr } from '../src/main/data/workflow/workflow-model';

const CORE_OPERATION_TYPES = [
  'select',
  'rename',
  'cast',
  'missing_value',
  'deduplicate',
  'derive',
  'filter',
  'sort',
  'select',
  'limit',
] as const;
const AGGREGATE_OPERATION_TYPES = ['aggregate'] as const;
const PERCENT_OF_TOTAL_OPERATION_TYPES = ['aggregate', 'derive_window', 'derive', 'sort'] as const;
const PIVOT_OPERATION_TYPES = ['pivot'] as const;
const UNPIVOT_OPERATION_TYPES = ['unpivot'] as const;
const UNNEST_OPERATION_TYPES = ['unnest'] as const;
const CERTIFIED_OPERATION_GROUPS = [
  CORE_OPERATION_TYPES,
  AGGREGATE_OPERATION_TYPES,
  PERCENT_OF_TOTAL_OPERATION_TYPES,
  PIVOT_OPERATION_TYPES,
  UNPIVOT_OPERATION_TYPES,
  UNNEST_OPERATION_TYPES,
] as const;

const COLUMN_EXPRESSION = { kind: 'column', name: 'value' } as const;
const CAPABILITY_VARIANT_CASES: Array<{
  capability: RequirementCapabilityId;
  operation: WorkflowOperationIr;
}> = [
  {
    capability: 'filter.boolean_predicate',
    operation: {
      type: 'filter',
      condition: {
        kind: 'binary',
        op: '>',
        left: COLUMN_EXPRESSION,
        right: { kind: 'literal', value: 0 },
      },
    },
  },
  { capability: 'select.include_columns', operation: { type: 'select', fields: ['value'] } },
  {
    capability: 'select.exclude_columns',
    operation: { type: 'select', selection: 'exclude', fields: ['value'] },
  },
  {
    capability: 'rename.single_column',
    operation: { type: 'rename', source: 'value', target: 'renamed' },
  },
  {
    capability: 'derive.scalar',
    operation: { type: 'derive', column: 'derived', expression: COLUMN_EXPRESSION },
  },
  {
    capability: 'derive_window.aggregate',
    operation: {
      type: 'derive_window',
      column: 'total',
      function: 'sum',
      expression: COLUMN_EXPRESSION,
      partitionBy: [],
      orderBy: [],
    },
  },
  {
    capability: 'derive_window.ranking',
    operation: {
      type: 'derive_window',
      column: 'ranked',
      function: 'row_number',
      partitionBy: [],
      orderBy: [{ field: 'value', direction: 'asc' }],
    },
  },
  {
    capability: 'derive_window.value_or_offset',
    operation: {
      type: 'derive_window',
      column: 'previous',
      function: 'lag',
      expression: COLUMN_EXPRESSION,
      partitionBy: [],
      orderBy: [{ field: 'value', direction: 'asc' }],
    },
  },
  {
    capability: 'cast.certified',
    operation: { type: 'cast', column: 'value', targetType: 'decimal', options: {} },
  },
  {
    capability: 'sort.multi_key',
    operation: { type: 'sort', orderBy: [{ field: 'value', direction: 'asc' }] },
  },
  {
    capability: 'aggregate.scalar',
    operation: {
      type: 'aggregate',
      groupBy: [],
      metrics: [{ fn: 'sum', expression: COLUMN_EXPRESSION, alias: 'total' }],
    },
  },
  {
    capability: 'deduplicate.keep_first',
    operation: {
      type: 'deduplicate',
      config: { fields: ['value'], keep: 'first', orderBy: [] },
    },
  },
  {
    capability: 'deduplicate.keep_last',
    operation: {
      type: 'deduplicate',
      config: { fields: ['value'], keep: 'last', orderBy: [] },
    },
  },
  {
    capability: 'missing.drop_rows',
    operation: { type: 'missing_value', config: { strategy: 'drop_empty_rows' } },
  },
  {
    capability: 'missing.literal_or_sentinel',
    operation: {
      type: 'missing_value',
      config: {
        strategy: 'by_column',
        rules: [{ field: 'value', method: 'literal_fill', value: 0 }],
      },
    },
  },
  {
    capability: 'missing.statistical_fill',
    operation: {
      type: 'missing_value',
      config: {
        strategy: 'by_column',
        rules: [{ field: 'value', method: 'mean_fill' }],
      },
    },
  },
  {
    capability: 'missing.ordered_fill',
    operation: {
      type: 'missing_value',
      config: {
        strategy: 'by_column',
        rules: [{ field: 'value', method: 'forward_fill' }],
      },
    },
  },
  {
    capability: 'limit.global',
    operation: {
      type: 'limit',
      config: { sampling: 'fixed', limit: 10, unit: 'rows', offset: 0, orderBy: [] },
    },
  },
  {
    capability: 'limit.random',
    operation: {
      type: 'limit',
      config: { sampling: 'random', limit: 10, unit: 'rows', offset: 0, orderBy: [] },
    },
  },
  {
    capability: 'pivot.fixed_values',
    operation: {
      type: 'pivot',
      config: {
        on: [{ field: 'category', values: ['A'] }],
        using: [{ function: 'sum', expression: COLUMN_EXPRESSION, alias: 'total' }],
        groupBy: [],
      },
    },
  },
  {
    capability: 'unpivot.columns',
    operation: {
      type: 'unpivot',
      config: {
        selection: 'include',
        fields: ['value'],
        nameColumn: 'name',
        valueColumn: 'unpivoted_value',
        includeNulls: false,
      },
    },
  },
  {
    capability: 'unnest.list_rows',
    operation: {
      type: 'unnest',
      config: {
        sourceKind: 'list',
        field: 'value',
        alias: 'item',
        keepParentNames: false,
        preserveOrder: true,
      },
    },
  },
];

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('AI workflow capability contract', () => {
  it('keeps executable certification coverage synchronized with every AI-enabled operation', () => {
    const enabled = Object.values(AI_PREP_DSL_OPERATION_CAPABILITIES)
      .filter((capability) => capability.aiEnabled)
      .map((capability) => capability.irType)
      .sort();
    const certified = [...new Set(CERTIFIED_OPERATION_GROUPS.flat())].sort();
    const requirementAnalyzed = [
      ...new Set(
        Object.values(REQUIREMENT_CAPABILITY_REGISTRY).map((capability) => capability.operation)
      ),
    ].sort();

    expect(certified).toEqual(enabled);
    expect(requirementAnalyzed).toEqual(enabled);
  });

  it.each(CAPABILITY_VARIANT_CASES)(
    'classifies $capability from its canonical IR variant',
    ({ capability, operation }) => {
      const [canonicalOperation] = validateAndNormalizeWorkflowIr({
        irVersion: '1.0',
        kind: 'workflow',
        sourceLanguage: 'javascript',
        inputSeen: true,
        outputSeen: true,
        outputOperationId: 'op-1',
        operations: [{ ...operation, operationId: 'op-1', inputOperationId: 'input' }],
        provenance: [],
      }).operations;

      expect(getRequiredRequirementCapabilities(canonicalOperation)).toEqual([capability]);
      expect(REQUIREMENT_CAPABILITY_REGISTRY[capability].operation).toBe(canonicalOperation.type);
    }
  );

  it('keeps every registered requirement capability reachable from canonical IR', () => {
    const reachable = new Set(
      CAPABILITY_VARIANT_CASES.flatMap(({ operation }) =>
        getRequiredRequirementCapabilities(operation)
      )
    );
    expect([...reachable].sort()).toEqual(Object.keys(REQUIREMENT_CAPABILITY_REGISTRY).sort());
  });

  it('executes the certified core cleaning operations through native platform nodes', async () => {
    const result = await runCertifiedWorkflow({
      name: 'core-cleaning',
      csv: [
        'order_id,region,rev,profit,status,updated_at,obsolete',
        '1,East,$100,20,PAID,2026-01-01,x',
        '1,East,$120,36,PAID,2026-01-02,x',
        '2,,$80,24,PAID,2026-01-01,y',
        '3,West,$90,45,REFUND,2026-01-03,z',
        '4,North,$50,5,PAID,2026-01-04,q',
      ].join('\n'),
      columns: [
        { name: 'order_id', type: 'integer' },
        { name: 'region', type: 'text' },
        { name: 'rev', type: 'text' },
        { name: 'profit', type: 'integer' },
        { name: 'status', type: 'text' },
        { name: 'updated_at', type: 'date' },
        { name: 'obsolete', type: 'text' },
      ],
      expectedOperationTypes: CORE_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'selectColumns',
          type: 'select',
          payload:
            '{ fields: ["order_id", "region", "rev", "profit", "status", "updated_at", "obsolete"] }',
        },
        {
          name: 'renameRevenue',
          type: 'rename',
          payload: '{ source: "rev", target: "revenue" }',
        },
        {
          name: 'convertRevenue',
          type: 'cast',
          payload:
            '{ column: "revenue", targetType: "decimal", options: { removePrefix: "$", scale: 2 } }',
        },
        {
          name: 'fillRegion',
          type: 'missing_value',
          payload:
            '{ config: { strategy: "by_column", rules: [{ field: "region", method: "literal_fill", value: "UNKNOWN" }] } }',
        },
        {
          name: 'deduplicateOrders',
          type: 'deduplicate',
          payload:
            '{ config: { fields: ["order_id"], keep: "last", orderBy: [{ field: "updated_at", direction: "asc" }] } }',
        },
        {
          name: 'deriveMargin',
          type: 'derive',
          payload: '{ column: "margin", expression: expr(row => row["profit"] / row["revenue"]) }',
        },
        {
          name: 'filterProfitablePaidOrders',
          type: 'filter',
          payload: '{ condition: expr(row => row["status"] === "PAID" && row["margin"] >= 0.2) }',
        },
        {
          name: 'sortRevenue',
          type: 'sort',
          payload: '{ orderBy: [{ field: "revenue", direction: "desc" }] }',
        },
        {
          name: 'dropInternalColumns',
          type: 'select',
          payload: '{ selection: "exclude", fields: ["status", "updated_at", "obsolete"] }',
        },
        {
          name: 'limitRows',
          type: 'limit',
          payload:
            '{ config: { sampling: "fixed", limit: 2, unit: "rows", offset: 0, orderBy: [] } }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual([
      'input',
      'select',
      'rename',
      'derive',
      'select',
      'rename',
      'missing_value',
      'deduplicate',
      'derive',
      'filter',
      'sort',
      'select',
      'limit',
      'output',
    ]);
    const rows = await queryRows(
      result.dbPath,
      `SELECT order_id, region, revenue, profit, margin FROM ${result.resultTable} ORDER BY revenue DESC`
    );
    expect(
      rows.map((row) => ({
        order_id: Number(row.order_id),
        region: String(row.region),
        revenue: Number(row.revenue),
        profit: Number(row.profit),
        margin: Number(row.margin),
      }))
    ).toEqual([
      { order_id: 1, region: 'East', revenue: 120, profit: 36, margin: 0.3 },
      { order_id: 2, region: 'UNKNOWN', revenue: 80, profit: 24, margin: 0.3 },
    ]);
  });

  it('executes certified statistical and ordered missing-value fills', async () => {
    const result = await runCertifiedWorkflow({
      name: 'advanced-missing-fills',
      csv: ['id,amount,label', '1,10,A', '2,,', '3,30,B'].join('\n'),
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'amount', type: 'decimal' },
        { name: 'label', type: 'text' },
      ],
      expectedOperationTypes: ['missing_value'],
      javascriptSource: workflowSource([
        {
          name: 'fillMissingValues',
          type: 'missing_value',
          payload:
            '{ config: { strategy: "by_column", rules: [{ field: "amount", method: "mean_fill" }, { field: "label", method: "backward_fill" }] } }',
        },
      ]),
    });
    const rows = await queryRows(
      result.dbPath,
      `SELECT id, amount, label FROM ${result.resultTable} WHERE id = 2`
    );

    expect(
      rows.map((row) => ({ id: Number(row.id), amount: Number(row.amount), label: row.label }))
    ).toEqual([{ id: 2, amount: 20, label: 'B' }]);
  });

  it('executes aggregate through native platform nodes', async () => {
    const result = await runCertifiedWorkflow({
      name: 'aggregate',
      csv: ['region,amount', 'East,10', 'East,20', 'West,5'].join('\n'),
      columns: [
        { name: 'region', type: 'text' },
        { name: 'amount', type: 'integer' },
      ],
      expectedOperationTypes: AGGREGATE_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'aggregateRevenue',
          type: 'aggregate',
          payload:
            '{ groupBy: [expr(row => row["region"])], metrics: [{ fn: "sum", expression: expr(row => row["amount"]), alias: "total_amount" }, { fn: "count", expression: "*", alias: "row_count" }] }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual(['input', 'aggregate', 'output']);
    const rows = await queryRows(
      result.dbPath,
      `SELECT region, total_amount, row_count FROM ${result.resultTable} ORDER BY region`
    );
    expect(
      rows.map((row) => ({
        region: String(row.region),
        total_amount: Number(row.total_amount),
        row_count: Number(row.row_count),
      }))
    ).toEqual([
      { region: 'East', total_amount: 30, row_count: 2 },
      { region: 'West', total_amount: 5, row_count: 1 },
    ]);
  });

  it('executes certified scalar date, math, and text functions', async () => {
    const steps: WorkflowStepSource[] = [
      ['addDay', 'day_value', 'day(row["event_date"])'],
      ['addMonthStart', 'month_start', 'dateTrunc("month", row["event_date"])'],
      ['addParsedDate', 'parsed_date', 'strptime(row["raw_date"], "%d-%b-%Y")'],
      ['addCurrentDate', 'current_date_value', 'currentDate()'],
      ['addNow', 'current_timestamp_value', 'now()'],
      ['addCeil', 'ceil_value', 'ceil(row["amount"])'],
      ['addFloor', 'floor_value', 'floor(row["amount"])'],
      ['addLength', 'name_length', 'length(row["name"])'],
      ['addSubstring', 'name_prefix', 'substr(row["name"], 1, 3)'],
      ['addSplit', 'first_word', 'splitPart(row["name"], " ", 1)'],
      ['addStarts', 'starts_a', 'startsWith(row["name"], "A")'],
      ['addEnds', 'ends_e', 'endsWith(row["name"], "e")'],
      ['addRegexp', 'digits', 'regexpReplace(row["code"], "[^0-9]", "", "g")'],
      ['addRegexpMatch', 'has_digits', 'regexpMatches(row["code"], "[0-9]+")'],
      ['addLpad', 'left_padded', 'lpad(row["code"], 6, "0")'],
      ['addRpad', 'right_padded', 'rpad(row["code"], 6, "_")'],
      ['addReverse', 'reversed', 'reverse(row["code"])'],
      ['addRepeat', 'repeated', 'repeat(row["code"], 2)'],
    ].map(([name, column, expression]) => ({
      name,
      type: 'derive',
      payload: `{ column: ${JSON.stringify(column)}, expression: expr(row => ${expression}) }`,
    }));
    const result = await runCertifiedWorkflow({
      name: 'scalar-functions',
      csv: [
        'event_date,raw_date,amount,name,code',
        '2026-03-15,02-Apr-2026,10.25,Alice Doe,A-12',
      ].join('\n'),
      columns: [
        { name: 'event_date', type: 'date' },
        { name: 'raw_date', type: 'text' },
        { name: 'amount', type: 'decimal' },
        { name: 'name', type: 'text' },
        { name: 'code', type: 'text' },
      ],
      expectedOperationTypes: steps.map(() => 'derive'),
      javascriptSource: workflowSource(steps),
    });

    const [row] = await queryRows(
      result.dbPath,
      `SELECT *, CAST(month_start AS VARCHAR) AS month_text, CAST(parsed_date AS VARCHAR) AS parsed_text FROM ${result.resultTable}`
    );
    expect({
      day: Number(row.day_value),
      month: String(row.month_text).slice(0, 10),
      parsed: String(row.parsed_text).slice(0, 10),
      ceil: Number(row.ceil_value),
      floor: Number(row.floor_value),
      length: Number(row.name_length),
      prefix: String(row.name_prefix),
      firstWord: String(row.first_word),
      starts: Boolean(row.starts_a),
      ends: Boolean(row.ends_e),
      digits: String(row.digits),
      hasDigits: Boolean(row.has_digits),
      lpad: String(row.left_padded),
      rpad: String(row.right_padded),
      reverse: String(row.reversed),
      repeat: String(row.repeated),
      hasCurrentDate: row.current_date_value != null,
      hasCurrentTimestamp: row.current_timestamp_value != null,
    }).toEqual({
      day: 15,
      month: '2026-03-01',
      parsed: '2026-04-02',
      ceil: 11,
      floor: 10,
      length: 9,
      prefix: 'Ali',
      firstWord: 'Alice',
      starts: true,
      ends: true,
      digits: '12',
      hasDigits: true,
      lpad: '00A-12',
      rpad: 'A-12__',
      reverse: '21-A',
      repeat: 'A-12A-12',
      hasCurrentDate: true,
      hasCurrentTimestamp: true,
    });
  });

  it('executes certified scalar advanced aggregates and literal parameters', async () => {
    const result = await runCertifiedWorkflow({
      name: 'advanced-aggregates',
      csv: ['region,amount,name', 'East,10,A', 'East,20,B', 'East,20,C'].join('\n'),
      columns: [
        { name: 'region', type: 'text' },
        { name: 'amount', type: 'integer' },
        { name: 'name', type: 'text' },
      ],
      expectedOperationTypes: ['aggregate'],
      javascriptSource: workflowSource([
        {
          name: 'summarizeAdvancedMetrics',
          type: 'aggregate',
          payload:
            '{ groupBy: [expr(row => row["region"])], metrics: [' +
            '{ fn: "median", expression: expr(row => row["amount"]), alias: "median_amount" },' +
            '{ fn: "mode", expression: expr(row => row["amount"]), alias: "mode_amount" },' +
            '{ fn: "first", expression: expr(row => row["amount"]), alias: "first_amount" },' +
            '{ fn: "last", expression: expr(row => row["amount"]), alias: "last_amount" },' +
            '{ fn: "stddev_samp", expression: expr(row => row["amount"]), alias: "stddev_sample_amount" },' +
            '{ fn: "stddev_pop", expression: expr(row => row["amount"]), alias: "stddev_amount" },' +
            '{ fn: "var_samp", expression: expr(row => row["amount"]), alias: "sample_variance_amount" },' +
            '{ fn: "var_pop", expression: expr(row => row["amount"]), alias: "variance_amount" },' +
            '{ fn: "quantile_cont", expression: expr(row => row["amount"]), alias: "p50_cont", parameters: [0.5] },' +
            '{ fn: "quantile_disc", expression: expr(row => row["amount"]), alias: "p50_disc", parameters: [0.5] },' +
            '{ fn: "approx_quantile", expression: expr(row => row["amount"]), alias: "p50_approx", parameters: [0.5] },' +
            '{ fn: "approx_count_distinct", expression: expr(row => row["name"]), alias: "unique_names" },' +
            '{ fn: "string_agg", expression: expr(row => row["name"]), alias: "names", parameters: [","] }' +
            '] }',
        },
      ]),
    });

    const [row] = await queryRows(result.dbPath, `SELECT * FROM ${result.resultTable}`);
    expect(Number(row.median_amount)).toBe(20);
    expect(Number(row.mode_amount)).toBe(20);
    expect(Number(row.first_amount)).toBe(10);
    expect(Number(row.last_amount)).toBe(20);
    expect(Number(row.stddev_sample_amount)).toBeCloseTo(5.773503, 5);
    expect(Number(row.stddev_amount)).toBeCloseTo(4.714045, 5);
    expect(Number(row.sample_variance_amount)).toBeCloseTo(33.333333, 5);
    expect(Number(row.variance_amount)).toBeCloseTo(22.222222, 5);
    expect(Number(row.p50_cont)).toBe(20);
    expect(Number(row.p50_disc)).toBe(20);
    expect(Number(row.p50_approx)).toBe(20);
    expect(Number(row.unique_names)).toBe(3);
    expect(String(row.names).split(',').sort()).toEqual(['A', 'B', 'C']);
  });

  it('executes aggregate percentage-of-total through a structured window derive', async () => {
    const result = await runCertifiedWorkflow({
      name: 'percentage-of-total',
      csv: ['country,sales', 'China,10', 'China,30', 'France,60'].join('\n'),
      columns: [
        { name: 'country', type: 'text' },
        { name: 'sales', type: 'integer' },
      ],
      expectedOperationTypes: PERCENT_OF_TOTAL_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'summarizeCountrySales',
          type: 'aggregate',
          payload:
            '{ groupBy: [expr(row => row["country"])], metrics: [{ fn: "sum", expression: expr(row => row["sales"]), alias: "country_sales" }] }',
        },
        {
          name: 'addOverallSales',
          type: 'derive_window',
          payload:
            '{ column: "overall_sales", function: "sum", expression: expr(row => row["country_sales"]), partitionBy: [], orderBy: [] }',
        },
        {
          name: 'addSalesShare',
          type: 'derive',
          payload:
            '{ column: "sales_share", expression: expr(row => row["overall_sales"] === 0 ? 0 : row["country_sales"] / row["overall_sales"]) }',
        },
        {
          name: 'sortSalesShare',
          type: 'sort',
          payload: '{ orderBy: [{ field: "sales_share", direction: "desc" }] }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual([
      'input',
      'aggregate',
      'derive',
      'derive',
      'sort',
      'output',
    ]);
    expect(result.plan.nodes[2]?.config).toMatchObject({
      calculations: [
        {
          field: 'overall_sales',
          expression: 'sum([country_sales]) OVER ()',
        },
      ],
    });
    const rows = await queryRows(
      result.dbPath,
      `SELECT country, country_sales, overall_sales, sales_share FROM ${result.resultTable} ORDER BY sales_share DESC`
    );
    expect(
      rows.map((row) => ({
        country: String(row.country),
        country_sales: Number(row.country_sales),
        overall_sales: Number(row.overall_sales),
        sales_share: Number(row.sales_share),
      }))
    ).toEqual([
      { country: 'France', country_sales: 60, overall_sales: 100, sales_share: 0.6 },
      { country: 'China', country_sales: 40, overall_sales: 100, sales_share: 0.4 },
    ]);
  });

  it('executes ranking, offset, and explicit framed aggregate windows', async () => {
    const result = await runCertifiedWorkflow({
      name: 'advanced-windows',
      csv: ['region,id,amount', 'East,1,10', 'East,2,20', 'East,3,15', 'West,1,7'].join('\n'),
      columns: [
        { name: 'region', type: 'text' },
        { name: 'id', type: 'integer' },
        { name: 'amount', type: 'integer' },
      ],
      expectedOperationTypes: Array.from({ length: 9 }, () => 'derive_window'),
      javascriptSource: workflowSource([
        {
          name: 'addRowNumber',
          type: 'derive_window',
          payload:
            '{ column: "row_number", function: "row_number", partitionBy: ["region"], orderBy: [{ field: "id", direction: "asc" }] }',
        },
        {
          name: 'addAmountRank',
          type: 'derive_window',
          payload:
            '{ column: "amount_rank", function: "rank", partitionBy: ["region"], orderBy: [{ field: "amount", direction: "desc" }] }',
        },
        {
          name: 'addBucket',
          type: 'derive_window',
          payload:
            '{ column: "bucket", function: "ntile", buckets: 2, partitionBy: ["region"], orderBy: [{ field: "id", direction: "asc" }] }',
        },
        {
          name: 'addPreviousAmount',
          type: 'derive_window',
          payload:
            '{ column: "previous_amount", function: "lag", expression: expr(row => row["amount"]), offset: 1, defaultValue: 0, partitionBy: ["region"], orderBy: [{ field: "id", direction: "asc" }] }',
        },
        {
          name: 'addNextAmount',
          type: 'derive_window',
          payload:
            '{ column: "next_amount", function: "lead", expression: expr(row => row["amount"]), offset: 1, defaultValue: 0, partitionBy: ["region"], orderBy: [{ field: "id", direction: "asc" }] }',
        },
        {
          name: 'addFirstAmount',
          type: 'derive_window',
          payload:
            '{ column: "first_amount", function: "first_value", expression: expr(row => row["amount"]), partitionBy: ["region"], orderBy: [{ field: "id", direction: "asc" }] }',
        },
        {
          name: 'addSecondAmount',
          type: 'derive_window',
          payload:
            '{ column: "second_amount", function: "nth_value", expression: expr(row => row["amount"]), nth: 2, partitionBy: ["region"], orderBy: [{ field: "id", direction: "asc" }], frame: { type: "rows", start: { type: "unbounded_preceding" }, end: { type: "unbounded_following" } } }',
        },
        {
          name: 'addRunningAmount',
          type: 'derive_window',
          payload:
            '{ column: "running_amount", function: "sum", expression: expr(row => row["amount"]), partitionBy: ["region"], orderBy: [{ field: "id", direction: "asc" }], frame: { type: "rows", start: { type: "unbounded_preceding" }, end: { type: "current_row" } } }',
        },
        {
          name: 'addMovingAverage',
          type: 'derive_window',
          payload:
            '{ column: "moving_average", function: "avg", expression: expr(row => row["amount"]), partitionBy: ["region"], orderBy: [{ field: "id", direction: "asc" }], frame: { type: "rows", start: { type: "preceding", offset: 1 }, end: { type: "current_row" } } }',
        },
      ]),
    });

    const rows = await queryRows(
      result.dbPath,
      `SELECT region, id, row_number, amount_rank, bucket, previous_amount, next_amount, first_amount, second_amount, running_amount, moving_average FROM ${result.resultTable} ORDER BY region, id`
    );
    expect(
      rows.map((row) => ({
        region: String(row.region),
        id: Number(row.id),
        rowNumber: Number(row.row_number),
        rank: Number(row.amount_rank),
        bucket: Number(row.bucket),
        previous: Number(row.previous_amount),
        next: Number(row.next_amount),
        first: Number(row.first_amount),
        second: row.second_amount == null ? null : Number(row.second_amount),
        running: Number(row.running_amount),
        moving: Number(row.moving_average),
      }))
    ).toEqual([
      {
        region: 'East',
        id: 1,
        rowNumber: 1,
        rank: 3,
        bucket: 1,
        previous: 0,
        next: 20,
        first: 10,
        second: 20,
        running: 10,
        moving: 10,
      },
      {
        region: 'East',
        id: 2,
        rowNumber: 2,
        rank: 1,
        bucket: 1,
        previous: 10,
        next: 15,
        first: 10,
        second: 20,
        running: 30,
        moving: 15,
      },
      {
        region: 'East',
        id: 3,
        rowNumber: 3,
        rank: 2,
        bucket: 2,
        previous: 20,
        next: 0,
        first: 10,
        second: 20,
        running: 45,
        moving: 17.5,
      },
      {
        region: 'West',
        id: 1,
        rowNumber: 1,
        rank: 1,
        bucket: 1,
        previous: 0,
        next: 0,
        first: 7,
        second: null,
        running: 7,
        moving: 7,
      },
    ]);
  });

  it('executes a temporal range frame with a structured interval bound', async () => {
    const result = await runCertifiedWorkflow({
      name: 'temporal-range-window',
      csv: ['event_date,amount', '2026-01-01,10', '2026-01-02,20', '2026-01-04,40'].join('\n'),
      columns: [
        { name: 'event_date', type: 'date' },
        { name: 'amount', type: 'integer' },
      ],
      expectedOperationTypes: ['derive_window'],
      javascriptSource: workflowSource([
        {
          name: 'addPriorDayAmount',
          type: 'derive_window',
          payload:
            '{ column: "prior_day_amount", function: "sum", expression: expr(row => row["amount"]), partitionBy: [], orderBy: [{ field: "event_date", direction: "asc" }], frame: { type: "range", start: { type: "preceding", offset: 1, unit: "day" }, end: { type: "current_row" } } }',
        },
      ]),
    });
    const rows = await queryRows(
      result.dbPath,
      `SELECT prior_day_amount FROM ${result.resultTable} ORDER BY event_date`
    );
    expect(rows.map((row) => Number(row.prior_day_amount))).toEqual([10, 30, 40]);
  });

  it('executes pivot through native platform nodes', async () => {
    const result = await runCertifiedWorkflow({
      name: 'pivot',
      csv: ['region,quarter,revenue', 'East,Q1,10', 'East,Q2,20', 'West,Q1,5', 'West,Q2,7'].join(
        '\n'
      ),
      columns: [
        { name: 'region', type: 'text' },
        { name: 'quarter', type: 'text' },
        { name: 'revenue', type: 'integer' },
      ],
      expectedOperationTypes: PIVOT_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'pivotQuarter',
          type: 'pivot',
          payload:
            '{ config: { on: [{ field: "quarter", values: ["Q1", "Q2"] }], using: [{ function: "sum", expression: expr(row => row["revenue"]), alias: "sales" }], groupBy: ["region"] } }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual(['input', 'pivot', 'output']);
    const rows = await queryRows(
      result.dbPath,
      `SELECT * FROM ${result.resultTable} ORDER BY region`
    );
    expect(
      rows.map((row) => ({
        region: String(row.region),
        Q1_sales: Number(row.Q1_sales),
        Q2_sales: Number(row.Q2_sales),
      }))
    ).toEqual([
      { region: 'East', Q1_sales: 10, Q2_sales: 20 },
      { region: 'West', Q1_sales: 5, Q2_sales: 7 },
    ]);
  });

  it('executes pivot with multiple certified metrics', async () => {
    const result = await runCertifiedWorkflow({
      name: 'multi-metric-pivot',
      csv: ['region,quarter,revenue,units', 'East,Q1,10,1', 'East,Q2,20,2', 'West,Q1,5,3'].join(
        '\n'
      ),
      columns: [
        { name: 'region', type: 'text' },
        { name: 'quarter', type: 'text' },
        { name: 'revenue', type: 'integer' },
        { name: 'units', type: 'integer' },
      ],
      expectedOperationTypes: ['pivot'],
      javascriptSource: workflowSource([
        {
          name: 'pivotQuarterMetrics',
          type: 'pivot',
          payload:
            '{ config: { on: [{ field: "quarter", values: ["Q1", "Q2"] }], using: [' +
            '{ function: "sum", expression: expr(row => row["revenue"]), alias: "sales" },' +
            '{ function: "sum", expression: expr(row => row["units"]), alias: "units" }' +
            '], groupBy: ["region"] } }',
        },
      ]),
    });

    const rows = await queryRows(
      result.dbPath,
      `SELECT * FROM ${result.resultTable} ORDER BY region`
    );
    expect(
      rows.map((row) => ({
        region: String(row.region),
        Q1Sales: Number(row.Q1_sales),
        Q1Units: Number(row.Q1_units),
        Q2Sales: row.Q2_sales == null ? null : Number(row.Q2_sales),
        Q2Units: row.Q2_units == null ? null : Number(row.Q2_units),
      }))
    ).toEqual([
      { region: 'East', Q1Sales: 10, Q1Units: 1, Q2Sales: 20, Q2Units: 2 },
      { region: 'West', Q1Sales: 5, Q1Units: 3, Q2Sales: null, Q2Units: null },
    ]);
  });

  it('executes selected-null-row cleanup, multi-key sort, and a global percent limit', async () => {
    const result = await runCertifiedWorkflow({
      name: 'expanded-row-operators',
      csv: [
        'region,score,label,a,b',
        'East,20,B,,',
        'East,20,A,x,',
        'East,10,C,x,y',
        'East,5,D,x,y',
        'West,30,C,x,y',
        'West,30,A,x,y',
        'West,20,B,x,y',
        'West,10,D,x,y',
      ].join('\n'),
      columns: [
        { name: 'region', type: 'text' },
        { name: 'score', type: 'integer' },
        { name: 'label', type: 'text' },
        { name: 'a', type: 'text' },
        { name: 'b', type: 'text' },
      ],
      expectedOperationTypes: ['missing_value', 'sort', 'limit'],
      javascriptSource: workflowSource([
        {
          name: 'dropFullyEmptyMarkers',
          type: 'missing_value',
          payload:
            '{ config: { strategy: "drop_rows_by_nulls", fields: ["a", "b"], condition: "all_null" } }',
        },
        {
          name: 'sortByScoreAndLabel',
          type: 'sort',
          payload:
            '{ orderBy: [{ field: "score", direction: "desc" }, { field: "label", direction: "asc" }] }',
        },
        {
          name: 'takeTopHalf',
          type: 'limit',
          payload:
            '{ config: { sampling: "fixed", limit: 50, unit: "percent", offset: 0, orderBy: [{ field: "score", direction: "desc" }, { field: "label", direction: "asc" }], ties: false } }',
        },
      ]),
    });

    expect(result.plan.nodes[2]?.config).toMatchObject({
      orderBy: [
        { field: 'score', direction: 'desc' },
        { field: 'label', direction: 'asc' },
      ],
    });
    const rows = await queryRows(
      result.dbPath,
      `SELECT region, score, label FROM ${result.resultTable} ORDER BY region, score DESC, label`
    );
    expect(rows.map((row) => `${row.region}:${row.score}:${row.label}`)).toEqual([
      'East:20:A',
      'West:30:A',
      'West:30:C',
      'West:20:B',
    ]);
  });

  it('executes seeded random row sampling', async () => {
    const result = await runCertifiedWorkflow({
      name: 'random-sampling',
      csv: ['id', ...Array.from({ length: 20 }, (_, index) => String(index + 1))].join('\n'),
      columns: [{ name: 'id', type: 'integer' }],
      expectedOperationTypes: ['limit'],
      javascriptSource: workflowSource([
        {
          name: 'sampleRows',
          type: 'limit',
          payload:
            '{ config: { sampling: "random", limit: 5, unit: "rows", offset: 0, orderBy: [], method: "system", seed: 42 } }',
        },
      ]),
    });
    const [row] = await queryRows(
      result.dbPath,
      `SELECT COUNT(*) AS count FROM ${result.resultTable}`
    );
    expect(Number(row.count)).toBe(5);
  });

  it('does not advertise or compile per-group limits before the platform contract supports them', () => {
    expect(REQUIREMENT_CAPABILITY_REGISTRY).not.toHaveProperty('limit.grouped');

    const source = workflowSource([
      {
        name: 'takeBestPerRegion',
        type: 'limit',
        payload:
          '{ config: { sampling: "fixed", limit: 1, unit: "rows", offset: 0, orderBy: [{ field: "score", direction: "desc" }], groupBy: ["region"], ties: true } }',
      },
    ]);

    expect(() => {
      const compiled = compileWorkflowJavaScript(source, {
        columns: [
          { name: 'region', type: 'text' },
          { name: 'score', type: 'integer' },
        ],
      });
      executeWorkflowJavaScriptInSandbox({
        compiled,
        rawTableId: 'input-1',
        resultTableName: 'output-1',
      });
    }).toThrow(/groupBy|No overload matches|not assignable/);
  });

  it('executes unpivot through native platform nodes', async () => {
    const result = await runCertifiedWorkflow({
      name: 'unpivot',
      csv: ['region,Q1,Q2', 'East,10,20', 'West,5,7'].join('\n'),
      columns: [
        { name: 'region', type: 'text' },
        { name: 'Q1', type: 'integer' },
        { name: 'Q2', type: 'integer' },
      ],
      expectedOperationTypes: UNPIVOT_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'unpivotQuarter',
          type: 'unpivot',
          payload:
            '{ config: { selection: "include", fields: ["Q1", "Q2"], nameColumn: "quarter", valueColumn: "revenue", includeNulls: false } }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual(['input', 'unpivot', 'output']);
    const rows = await queryRows(
      result.dbPath,
      `SELECT region, quarter, revenue FROM ${result.resultTable} ORDER BY region, quarter`
    );
    expect(
      rows.map((row) => ({
        region: String(row.region),
        quarter: String(row.quarter),
        revenue: Number(row.revenue),
      }))
    ).toEqual([
      { region: 'East', quarter: 'Q1', revenue: 10 },
      { region: 'East', quarter: 'Q2', revenue: 20 },
      { region: 'West', quarter: 'Q1', revenue: 5 },
      { region: 'West', quarter: 'Q2', revenue: 7 },
    ]);
  });

  it('executes a JSON-array string through certified list unnest mode', async () => {
    const result = await runCertifiedWorkflow({
      name: 'unnest',
      csv: ['id,items', '1,"[10,20]"', '2,"[30]"'].join('\n'),
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'items', type: 'text' },
      ],
      expectedOperationTypes: UNNEST_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'unnestItems',
          type: 'unnest',
          payload:
            '{ config: { sourceKind: "list", field: "items", alias: "item", path: "$", keepParentNames: false, preserveOrder: true } }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual(['input', 'unnest', 'output']);
    const rows = await queryRows(
      result.dbPath,
      `SELECT id, CAST(item AS INTEGER) AS item FROM ${result.resultTable} ORDER BY id, item`
    );
    expect(
      rows.map((row) => ({
        id: Number(row.id),
        item: Number(row.item),
      }))
    ).toEqual([
      { id: 1, item: 10 },
      { id: 1, item: 20 },
      { id: 2, item: 30 },
    ]);
  });
});

interface WorkflowStepSource {
  name: string;
  type: string;
  payload: string;
}

function workflowSource(steps: WorkflowStepSource[]): string {
  const helpers = steps.map(
    (step) =>
      `function ${step.name}(input) {\n  return workflow.step(input, ${JSON.stringify(step.type)}, ${step.payload});\n}`
  );
  const main = [
    'function main() {',
    '  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });',
    ...steps.map(
      (step, index) =>
        `  const value${index + 1} = ${step.name}(${index === 0 ? 'input' : `value${index}`});`
    ),
    `  return workflow.output(value${steps.length}, RESULT_TABLE_NAME, { mode: "replace" });`,
    '}',
  ].join('\n');
  return [...helpers, main].join('\n\n');
}

async function runCertifiedWorkflow(input: {
  name: string;
  csv: string;
  columns: Array<{ name: string; type?: string }>;
  javascriptSource: string;
  expectedOperationTypes: readonly string[];
}): Promise<{
  dbPath: string;
  resultTable: string;
  plan: ReturnType<typeof compileLoweredWorkflowToPlatformNodes>;
}> {
  const { dbPath, store, tempRoot } = createStore(input.name);
  const csvPath = path.join(tempRoot, `${input.name}.csv`);
  fs.writeFileSync(csvPath, `${input.csv}\n`, 'utf8');
  const rawTable = await store.importRawTable({
    name: `${input.name} input`,
    sourceKind: 'csv',
    filePath: csvPath,
  });
  const pipeline = await store.createPipeline({
    name: `${input.name} pipeline`,
    sourceRawTableId: rawTable.id,
  });
  const resultTable = `ai_contract_${input.name.replace(/[^A-Za-z0-9_]/g, '_')}_output`;

  const compiled = compileWorkflowJavaScript(input.javascriptSource, { columns: input.columns });
  const ir = executeWorkflowJavaScriptInSandbox({
    compiled,
    rawTableId: rawTable.id,
    resultTableName: resultTable,
  });
  expect(ir.operations.map((operation) => operation.type)).toEqual(input.expectedOperationTypes);

  const semantics = lowerGeneratedWorkflowIrSemantics({
    ir,
    requirement: `certify ${input.name}`,
    columns: input.columns,
  });
  const plan = compileLoweredWorkflowToPlatformNodes({
    semantics,
    bindings: {
      rawTableId: rawTable.id,
      rawTableName: rawTable.name,
      resultTableName: resultTable,
    },
  });
  for (const node of plan.nodes.slice(1, -1)) {
    expect(node.config).not.toHaveProperty('dsl');
  }
  expect(validateGeneratedExecutableWorkflow({ nodes: plan.nodes, edges: plan.edges })).toEqual([]);

  await store.savePipelineWorkflow(pipeline.id, { nodes: plan.nodes, edges: plan.edges });
  const saved = await store.getPipelineWorkflow(pipeline.id);
  expect(saved.nodes.map((node) => node.type)).toEqual(plan.nodes.map((node) => node.type));
  const completed = await store.runPipeline(pipeline.id);
  expect(completed.status).toBe('completed');
  expect(completed.resultTable).toBe(resultTable);

  return { dbPath, resultTable, plan };
}

function createStore(name: string): { dbPath: string; store: DataPipelineStore; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `sophron-ai-capability-${name}-`));
  tempRoots.push(tempRoot);
  const dbPath = path.join(tempRoot, 'workspace.duckdb');
  const store = createDataPipelineStore(dbPath, { now: () => 1_780_000_000_000 });
  stores.push(store);
  return { dbPath, store, tempRoot };
}

async function queryRows(dbPath: string, sql: string): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
