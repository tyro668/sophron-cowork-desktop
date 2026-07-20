import { describe, expect, it } from 'vitest';
import {
  applyJavascriptFunctionPatch,
  compileJavascriptWorkflowToIr,
} from '../src/main/data/workflow/javascript-workflow-compiler';
import { compileGeneratedWorkflowIr } from '../src/main/data/workflow/operation-compiler';
import { reconcileGeneratedWorkflowWithDslInference } from '../src/main/data/workflow/schema-inferencer';
import { inferUnpivotValueType, normalizeDslTypeName } from '../src/main/data/workflow/utils';

function asFunctionWorkflow(chain: string): string {
  return `function main() {\n  return ${chain};\n}`;
}

function validateGeneratedWorkflow(
  compiled: ReturnType<typeof compileGeneratedWorkflowIr>,
  columns: Array<{ name: string; type?: string }>
) {
  return reconcileGeneratedWorkflowWithDslInference(compiled, columns);
}

describe('generated workflow IR compiler', () => {
  it('uses one canonical unpivot type inference rule across compiler stages', () => {
    expect(inferUnpivotValueType([{ type: 'bigint' }, { type: 'integer' }])).toBe('integer');
    expect(inferUnpivotValueType([{ type: 'number' }, { type: 'decimal' }])).toBe('decimal');
    expect(inferUnpivotValueType([{ type: 'integer' }, { type: 'float' }])).toBe('decimal');
    expect(() => inferUnpivotValueType([{ type: 'text' }, { type: 'integer' }])).toThrow(
      'incompatible types'
    );
    expect(normalizeDslTypeName('number')).toBe('decimal');
  });

  it('rejects the removed single-chain JavaScript format', () => {
    expect(() =>
      compileJavascriptWorkflowToIr(
        'workflow().inputDataset(INPUT_TABLE_ID, "src").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
      )
    ).toThrow('may only contain named function declarations');
  });

  it('compiles function-oriented JavaScript without executing generated code', () => {
    const ir = compileJavascriptWorkflowToIr(`
function removeRecordCount(input) {
  return input.drop(["记录数"]);
}

function filterPositiveProfit(input) {
  return input.filter(col("Profit").gt(lit(0)));
}

function sortByProfit(input) {
  return input.sort(col("Profit"), "desc");
}

function main() {
  const input = workflow().inputDataset(INPUT_TABLE_ID, "src");
  const withoutCount = removeRecordCount(input);
  const positive = filterPositiveProfit(withoutCount);
  const sorted = sortByProfit(positive);
  return sorted.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });
}
`);

    expect(ir.operations.map((operation) => operation.type)).toEqual(['drop', 'filter', 'sort']);
    expect(ir.operations.map((operation) => operation.location?.functionName)).toEqual([
      'removeRecordCount',
      'filterPositiveProfit',
      'sortByProfit',
    ]);

    const compiled = compileGeneratedWorkflowIr({
      ir,
      inputTableId: 'sales',
      outputTableName: 'result',
      requirement: '删除记录数，只保留 Profit 大于 0 并按 Profit 降序排列',
      columns: [
        { name: 'Profit', type: 'decimal' },
        { name: '记录数', type: 'integer' },
      ],
    });

    expect(compiled.workflowDsl).toContain('drop [记录数]');
    expect(compiled.workflowDsl).toContain('filter [Profit] > 0');
    expect(compiled.workflowDsl).toContain('sort by [Profit] desc');
    expect(compiled.operationOrigins).toEqual([
      expect.objectContaining({
        operatorIndex: 0,
        operationType: 'drop',
        functionName: 'removeRecordCount',
      }),
      expect.objectContaining({
        operatorIndex: 1,
        operationType: 'filter',
        functionName: 'filterPositiveProfit',
      }),
      expect.objectContaining({
        operatorIndex: 2,
        operationType: 'sort',
        functionName: 'sortByProfit',
      }),
    ]);
  });

  it('rejects generated helpers that chain multiple workflow operations', () => {
    expect(() =>
      compileJavascriptWorkflowToIr(
        `
function cleanPrice(input) {
  return input.drop("记录数").rename("Adj Close", "adj_close").cast("adj_close", "decimal");
}

function main() {
  const input = workflow().inputDataset(INPUT_TABLE_ID, "src");
  const cleaned = cleanPrice(input);
  return cleaned.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });
}
`,
        { enforceAtomicHelpers: true }
      )
    ).toThrow('Each helper must contain exactly one operation');
  });

  it('accepts generated programs composed from atomic helpers', () => {
    const ir = compileJavascriptWorkflowToIr(
      `
function dropRecordCount(input) {
  return input.drop("记录数");
}

function renameAdjClose(input) {
  return input.rename("Adj Close", "adj_close");
}

function castAdjClose(input) {
  return input.cast("adj_close", "decimal");
}

function main() {
  const input = workflow().inputDataset(INPUT_TABLE_ID, "src");
  const withoutCount = dropRecordCount(input);
  const renamed = renameAdjClose(withoutCount);
  const converted = castAdjClose(renamed);
  return converted.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });
}
`,
      { enforceAtomicHelpers: true }
    );

    expect(ir.operations.map((operation) => operation.location?.functionName)).toEqual([
      'dropRecordCount',
      'renameAdjClose',
      'castAdjClose',
    ]);
  });

  it('rejects unsafe top-level JavaScript with line diagnostics', () => {
    expect(() =>
      compileJavascriptWorkflowToIr(`
const secret = process.env;
function main() {
  return workflow().inputDataset(INPUT_TABLE_ID, "src").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });
}
`)
    ).toThrow('may only contain named function declarations');
  });

  it('maps field validation diagnostics back to the generated helper function', () => {
    const ir = compileJavascriptWorkflowToIr(`
function filterProfit(input) {
  return input.filter(col("MissingProfit").gt(lit(0)));
}

function main() {
  const input = workflow().inputDataset(INPUT_TABLE_ID, "src");
  const filtered = filterProfit(input);
  return filtered.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });
}
`);

    try {
      compileGeneratedWorkflowIr({
        ir,
        inputTableId: 'sales',
        outputTableName: 'result',
        requirement: '过滤利润',
        columns: [{ name: 'Profit', type: 'decimal' }],
      });
      throw new Error('Expected compilation to fail');
    } catch (error) {
      expect(error).toMatchObject({
        details: {
          diagnostics: [
            expect.objectContaining({
              functionName: 'filterProfit',
              line: 3,
            }),
          ],
        },
      });
    }
  });

  it('applies a repair patch to only the diagnosed helper function', () => {
    const original = `
function sortProfit(input) {
  return input.sort(col("Profit"), "ascending");
}

function main() {
  const input = workflow().inputDataset(INPUT_TABLE_ID, "src");
  const sorted = sortProfit(input);
  return sorted.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });
}
`;
    const patched = applyJavascriptFunctionPatch(
      original,
      'sortProfit',
      'function sortProfit(input) {\n  return input.sort(col("Profit"), "desc");\n}'
    );

    expect(patched).toContain('input.sort(col("Profit"), "desc")');
    expect(patched).toContain('function main()');
    expect(compileJavascriptWorkflowToIr(patched).operations).toEqual([
      expect.objectContaining({ type: 'sort', direction: 'desc' }),
    ]);
  });

  it('allows a repair patch to split one helper into atomic helpers', () => {
    const original = `
function renameFields(input) {
  return input.rename("Company Name", "company_name").rename("Ticker", "ticker");
}

function main() {
  const input = workflow().inputDataset(INPUT_TABLE_ID, "src");
  const renamed = renameFields(input);
  return renamed.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });
}
`;
    const patched = applyJavascriptFunctionPatch(
      original,
      'renameFields',
      `function renameCompany(input) {
  return input.rename("Company Name", "company_name");
}

function renameTicker(input) {
  return input.rename("Ticker", "ticker");
}

function renameFields(input) {
  const companyRenamed = renameCompany(input);
  return renameTicker(companyRenamed);
}`
    );

    expect(patched).toContain('function main()');
    expect(
      compileJavascriptWorkflowToIr(patched, { enforceAtomicHelpers: true }).operations
    ).toEqual([
      expect.objectContaining({
        type: 'rename',
        source: 'Company Name',
        target: 'company_name',
        location: expect.objectContaining({ functionName: 'renameCompany' }),
      }),
      expect.objectContaining({
        type: 'rename',
        source: 'Ticker',
        target: 'ticker',
        location: expect.objectContaining({ functionName: 'renameTicker' }),
      }),
    ]);
  });

  it('rejects helper patches that replace main or redefine an existing helper', () => {
    const original = `
function renameFields(input) {
  return input.rename("Company Name", "company_name");
}

function existingHelper(input) {
  return input.drop("记录数");
}

function main() {
  const input = workflow().inputDataset(INPUT_TABLE_ID, "src");
  const renamed = renameFields(input);
  return renamed.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });
}
`;

    expect(() =>
      applyJavascriptFunctionPatch(
        original,
        'renameFields',
        'function renameFields(input) { return input; }\nfunction main() { return null; }'
      )
    ).toThrow('must not replace function main');
    expect(() =>
      applyJavascriptFunctionPatch(
        original,
        'renameFields',
        'function renameFields(input) { return input; }\nfunction existingHelper(input) { return input; }'
      )
    ).toThrow('cannot redefine existing function existingHelper');
  });

  it('compiles typed row-level IR without an operations adapter', () => {
    const ir = compileJavascriptWorkflowToIr(
      asFunctionWorkflow(
        [
          'workflow()',
          '.inputDataset(INPUT_TABLE_ID, "src")',
          '.drop(["记录数"])',
          '.filter(col("Unit Price").gt(lit(0)))',
          '.derive("Price Label", fn.concat(lit("¥"), col("Unit Price")))',
          '.sort(col("Unit Price"), "asc")',
          '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
        ].join('')
      )
    );
    const input = {
      inputTableId: 'input-table-id',
      outputTableName: '单价升序结果',
      requirement: '删除记录数，过滤非正数，生成价格标签并按单价升序排列',
      columns: [
        { name: 'Product', type: 'text' },
        { name: 'Unit Price', type: 'decimal' },
        { name: '记录数', type: 'integer' },
      ],
    };

    const typed = compileGeneratedWorkflowIr({
      ...input,
      ir,
    });

    expect(typed.workflowDsl).toContain('drop [记录数]');
    expect(typed.workflowDsl).toContain('filter [`Unit Price`] > 0');
    expect(typed.workflowDsl).toContain('sort by [`Unit Price`] asc');
    expect(typed.requiredColumns).toEqual([
      { name: '记录数', type: 'integer' },
      { name: 'Unit Price', type: 'decimal' },
    ]);
    expect(typed.expectedOutputSchema).toEqual([
      { name: 'Product', type: 'text' },
      { name: 'Unit Price', type: 'decimal' },
      { name: 'Price Label', type: 'text' },
    ]);
    expect(typed.lineage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Price Label',
          sourceColumns: [{ name: 'Unit Price', type: 'decimal' }],
        }),
      ])
    );
  });

  it('compiles typed aggregate IR without an operations adapter', () => {
    const ir = compileJavascriptWorkflowToIr(
      asFunctionWorkflow(
        [
          'workflow()',
          '.inputDataset(INPUT_TABLE_ID, "src")',
          '.aggregate({ groupBy: [col("Market")], metrics: [metric.sum(col("Sales")).as("Sales 总和"), metric.count().as("记录数")] })',
          '.sort(col("Sales 总和"), "desc")',
          '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
        ].join('')
      )
    );
    const input = {
      inputTableId: 'sales-input',
      outputTableName: '销售汇总',
      requirement: '按市场汇总销售额并降序排列',
      columns: [
        { name: 'Market', type: 'text' },
        { name: 'Sales', type: 'decimal' },
      ],
    };

    const typed = compileGeneratedWorkflowIr({
      ...input,
      ir,
    });

    expect(typed.workflowDsl).toContain(
      'aggregate by [Market] metrics sum([Sales]) as [`Sales 总和`], count(*) as [记录数]'
    );
    expect(typed.workflowDsl).toContain('sort by [`Sales 总和`] desc');
    expect(typed.requiredColumns).toEqual([
      { name: 'Market', type: 'text' },
      { name: 'Sales', type: 'decimal' },
    ]);
    expect(typed.expectedOutputSchema).toEqual([
      { name: 'Market', type: 'text' },
      { name: 'Sales 总和', type: 'decimal' },
      { name: '记录数', type: 'integer' },
    ]);
  });

  it('preserves expression-tree grouping and compiles expression filters directly', () => {
    const ir = compileJavascriptWorkflowToIr(
      asFunctionWorkflow(
        [
          'workflow()',
          '.inputDataset(INPUT_TABLE_ID, "src")',
          '.filter(col("Revenue").sub(col("Cost")).gt(lit(0)))',
          '.derive("Weighted Profit", col("Revenue").sub(col("Cost")).mul(col("Weight")))',
          '.aggregate({ groupBy: [col("Market")], metrics: [metric.sum(col("Revenue").sub(col("Cost"))).as("Profit")] })',
          '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
        ].join('')
      )
    );

    const compiled = compileGeneratedWorkflowIr({
      ir,
      inputTableId: 'sales-input',
      outputTableName: '利润汇总',
      requirement: '过滤正利润，计算加权利润并按市场汇总利润',
      columns: [
        { name: 'Market', type: 'text' },
        { name: 'Revenue', type: 'decimal' },
        { name: 'Cost', type: 'decimal' },
        { name: 'Weight', type: 'integer' },
      ],
    });

    expect(compiled.workflowDsl).toContain('filter [Revenue] - [Cost] > 0');
    expect(compiled.workflowDsl).toContain(
      'derive [`Weighted Profit`] = ([Revenue] - [Cost]) * [Weight]'
    );
    expect(compiled.workflowDsl).toContain(
      'aggregate by [Market] metrics sum([Revenue] - [Cost]) as [Profit]'
    );
    expect(compiled.requiredColumns).toEqual([
      { name: 'Revenue', type: 'decimal' },
      { name: 'Cost', type: 'decimal' },
      { name: 'Weight', type: 'integer' },
      { name: 'Market', type: 'text' },
    ]);
    expect(compiled.lineage).toEqual([
      {
        name: 'Market',
        type: 'text',
        sourceColumns: [{ name: 'Market', type: 'text' }],
        expression: undefined,
      },
      {
        name: 'Profit',
        type: 'decimal',
        sourceColumns: [
          { name: 'Revenue', type: 'decimal' },
          { name: 'Cost', type: 'decimal' },
        ],
        expression: '[Revenue] - [Cost]',
      },
    ]);
  });

  it('compiles deduplicate, missing-value and limit capabilities', () => {
    const ir = compileJavascriptWorkflowToIr(`
function cleanRows(input) {
  return input
    .deduplicate({ by: ["OrderId"], keep: "last", orderBy: [{ field: "UpdatedAt", direction: "desc" }] })
    .handleMissing({ rules: [
      { column: "Region", method: "nullify_values", values: ["", "N/A"] },
      { column: "Region", method: "literal_fill", value: "UNKNOWN" }
    ] })
    .top(10, [{ field: "Profit", direction: "desc", nulls: "last" }]);
}

function main() {
  const input = workflow().inputDataset(INPUT_TABLE_ID, "src");
  const cleaned = cleanRows(input);
  return cleaned.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });
}
`);
    const compiled = validateGeneratedWorkflow(
      compileGeneratedWorkflowIr({
        ir,
        inputTableId: 'orders',
        outputTableName: 'result',
        requirement: '去重、处理缺失值并保留利润最高的十条',
        columns: [
          { name: 'OrderId', type: 'text' },
          { name: 'UpdatedAt', type: 'datetime' },
          { name: 'Region', type: 'text' },
          { name: 'Profit', type: 'decimal' },
        ],
      }),
      [
        { name: 'OrderId', type: 'text' },
        { name: 'UpdatedAt', type: 'datetime' },
        { name: 'Region', type: 'text' },
        { name: 'Profit', type: 'decimal' },
      ]
    );

    expect(compiled.workflowDsl).toContain(
      'deduplicate by [OrderId] keep last order by [UpdatedAt] desc'
    );
    expect(compiled.workflowDsl).toContain(
      "missing value [Region] nullify values ('', 'N/A'), [Region] fill 'UNKNOWN'"
    );
    expect(compiled.workflowDsl).toContain('top 10 by [Profit] desc nulls last');
    expect(compiled.expectedOutputSchema).toEqual([
      { name: 'OrderId', type: 'text' },
      { name: 'UpdatedAt', type: 'datetime' },
      { name: 'Region', type: 'text' },
      { name: 'Profit', type: 'decimal' },
    ]);
  });

  it('infers deterministic unpivot output schema and lineage', () => {
    const ir = compileJavascriptWorkflowToIr(
      asFunctionWorkflow(
        'workflow().inputDataset(INPUT_TABLE_ID, "src").unpivot({ columns: ["Jan", "Feb"], nameColumn: "Month", valueColumn: "Sales" }).sort(col("Sales"), "desc").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
      )
    );
    const compiled = validateGeneratedWorkflow(
      compileGeneratedWorkflowIr({
        ir,
        inputTableId: 'monthly',
        outputTableName: 'long_sales',
        requirement: '反透视月度销售额',
        columns: [
          { name: 'Region', type: 'text' },
          { name: 'Jan', type: 'integer' },
          { name: 'Feb', type: 'decimal' },
        ],
      }),
      [
        { name: 'Region', type: 'text' },
        { name: 'Jan', type: 'integer' },
        { name: 'Feb', type: 'decimal' },
      ]
    );

    expect(compiled.workflowDsl).toContain('unpivot [Jan], [Feb] into name [Month] value [Sales]');
    expect(compiled.workflowDsl).toContain('sort by [Sales] desc');
    expect(compiled.expectedOutputSchema).toEqual([
      { name: 'Region', type: 'text' },
      { name: 'Month', type: 'text' },
      { name: 'Sales', type: 'decimal' },
    ]);
  });

  it('compiles list unnest and adds deterministic alias and index fields', () => {
    const ir = compileJavascriptWorkflowToIr(
      asFunctionWorkflow(
        'workflow().inputDataset(INPUT_TABLE_ID, "src").unnest({ sourceKind: "list", column: "Items", alias: "Item", withIndex: "ItemIndex" }).sort(col("ItemIndex"), "asc").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
      )
    );
    const compiled = validateGeneratedWorkflow(
      compileGeneratedWorkflowIr({
        ir,
        inputTableId: 'orders',
        outputTableName: 'items',
        requirement: '展开商品列表',
        columns: [
          { name: 'OrderId', type: 'text' },
          { name: 'Items', type: 'list' },
        ],
      }),
      [
        { name: 'OrderId', type: 'text' },
        { name: 'Items', type: 'list' },
      ]
    );

    expect(compiled.workflowDsl).toContain('unnest [Items] as [Item] with index [ItemIndex]');
    expect(compiled.workflowDsl).toContain('sort by [ItemIndex] asc');
    expect(compiled.expectedOutputSchema).toEqual([
      { name: 'OrderId', type: 'text' },
      { name: 'Items', type: 'list' },
      { name: 'Item', type: undefined },
      { name: 'ItemIndex', type: 'integer' },
    ]);
  });

  it('requires fixed pivot values and infers pivot columns', () => {
    const ir = compileJavascriptWorkflowToIr(
      asFunctionWorkflow(
        'workflow().inputDataset(INPUT_TABLE_ID, "src").pivot({ on: ["Month"], values: ["Jan", "Feb"], using: [{ function: "sum", expression: col("Revenue"), alias: "Revenue" }], groupBy: ["Region"] }).sort(col("Jan_Revenue"), "desc").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
      )
    );
    const compiled = validateGeneratedWorkflow(
      compileGeneratedWorkflowIr({
        ir,
        inputTableId: 'sales',
        outputTableName: 'pivot_sales',
        requirement: '按月份透视收入',
        columns: [
          { name: 'Region', type: 'text' },
          { name: 'Month', type: 'text' },
          { name: 'Revenue', type: 'decimal' },
        ],
      }),
      [
        { name: 'Region', type: 'text' },
        { name: 'Month', type: 'text' },
        { name: 'Revenue', type: 'decimal' },
      ]
    );

    expect(compiled.workflowDsl).toContain(
      "pivot on [Month] in ('Jan', 'Feb') using sum([Revenue]) as [Revenue] group by [Region]"
    );
    expect(compiled.workflowDsl).toContain('sort by [Jan_Revenue] desc');
    expect(compiled.expectedOutputSchema).toEqual([
      { name: 'Region', type: 'text' },
      { name: 'Jan_Revenue', type: 'decimal' },
      { name: 'Feb_Revenue', type: 'decimal' },
    ]);
  });
});
