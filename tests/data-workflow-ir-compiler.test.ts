import { describe, expect, it } from 'vitest';
import {
  applyWorkflowFunctionPatch,
  compileWorkflowJavaScript,
  executeWorkflowJavaScriptInSandbox,
  WORKFLOW_SANDBOX_RUNNER_SOURCE,
} from '../src/main/data/workflow/javascript-runtime';
import { compileGeneratedJavaScriptWorkflow } from '../src/main/data/workflow/workflow-generator';
import { lowerWorkflowIrToOperations } from '../src/main/data/workflow/operation-compiler';
import {
  canonicalizeWorkflowIr,
  computeWorkflowIrSemanticHash,
} from '../src/main/data/workflow/workflow-ir';
import {
  getWorkflowJavascriptCapabilityPrompt,
  WORKFLOW_OPERATION_REGISTRY,
} from '../src/main/data/workflow/workflow-operation-registry';
import {
  getWorkflowExpressionCapabilityPrompt,
  getWorkflowExpressionRuntimeCapabilities,
  getWorkflowExpressionTypeScriptDeclarations,
  WORKFLOW_EXPRESSION_FUNCTION_REGISTRY,
  WORKFLOW_EXPRESSION_FUNCTIONS,
  WORKFLOW_NATIVE_EXPRESSION_INTRINSICS,
} from '../src/main/data/workflow/workflow-expression-registry';

const SOURCE = `function removeCount(input) {
  return workflow.step(input, "drop", { columns: ["记录数"] });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const cleaned = removeCount(input);
  return workflow.output(cleaned, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;

function buildIr(source = SOURCE) {
  return executeWorkflowJavaScriptInSandbox({
    compiled: compileWorkflowJavaScript(source),
    inputTableId: 'input-1',
    outputTableName: 'output-1',
  });
}

describe('JavaScript Workflow SDK pipeline', () => {
  it('derives the prompt from the registry and keeps the generic runtime step API', () => {
    const prompt = getWorkflowJavascriptCapabilityPrompt();
    for (const definition of WORKFLOW_OPERATION_REGISTRY) {
      expect(prompt).toContain(definition.promptSignature);
    }
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).toContain('allowedOperationTypes.has(type)');
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).toContain('step: (inputValue, type, fields)');
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).not.toContain('sdk.drop =');
    expect(prompt).toContain('strategy: "drop_empty_rows"');
    expect(prompt).toContain('strategy: "by_column"');
    expect(prompt).toContain('method: "skip|drop|nullify_values|literal_fill"');
    const expressionPrompt = getWorkflowExpressionCapabilityPrompt();
    const runtimeCapabilities = getWorkflowExpressionRuntimeCapabilities();
    const typeDeclarations = getWorkflowExpressionTypeScriptDeclarations();
    for (const functionName of Object.keys(WORKFLOW_EXPRESSION_FUNCTIONS)) {
      if (functionName !== 'ifElse') expect(expressionPrompt).toContain(functionName);
      expect(runtimeCapabilities.functions).toContain(functionName);
    }
    for (const [functionName, definition] of Object.entries(
      WORKFLOW_EXPRESSION_FUNCTION_REGISTRY
    )) {
      if (definition.native) {
        expect(typeDeclarations).toContain(`function ${functionName}`);
      }
    }
    for (const intrinsicName of Object.keys(WORKFLOW_NATIVE_EXPRESSION_INTRINSICS)) {
      expect(expressionPrompt).toContain(intrinsicName);
      expect(typeDeclarations).toContain(`function ${intrinsicName}`);
    }
    expect(runtimeCapabilities.binaryMethods).toMatchObject({ and: 'and', or: 'or' });
  });

  it('accepts the canonical by-column NULL marker configuration', () => {
    const source = `function nullifyMarkers(input) {
  return workflow.step(input, "missing_value", {
    config: {
      strategy: "by_column",
      rules: [{
        column: "Close value",
        method: "nullify_values",
        values: ["NULL"]
      }]
    }
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const cleaned = nullifyMarkers(input);
  return workflow.output(cleaned, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
    const ir = buildIr(source);
    expect(ir.operations[0]).toMatchObject({
      type: 'missing_value',
      config: {
        strategy: 'by_column',
        rules: [
          {
            column: 'Close value',
            method: 'nullify_values',
            values: ['NULL'],
          },
        ],
      },
    });
  });

  it('reports the invalid missing-value strategy produced by a model', () => {
    const source = `function nullifyMarkers(input) {
  return workflow.step(input, "missing_value", {
    config: { strategy: "nullify_values", rules: [] }
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const cleaned = nullifyMarkers(input);
  return workflow.output(cleaned, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
    expect(() => buildIr(source)).toThrow(
      'config.strategy must be one of drop_empty_rows, by_column; received "nullify_values"'
    );
  });

  it('uses V8 to compile standard JavaScript and the sandbox SDK to build stable IR', () => {
    const ir = buildIr();
    expect(ir).toMatchObject({
      irVersion: '1.0',
      kind: 'workflow',
      sourceLanguage: 'javascript',
      sdkVersion: '2.1.0',
      outputOperationId: 'remove-count',
      operations: [
        expect.objectContaining({
          operationId: 'remove-count',
          inputOperationId: 'input',
          type: 'drop',
          columns: ['记录数'],
        }),
      ],
    });
    expect(ir.provenance[0]?.source.functionName).toBe('removeCount');
  });

  it('returns precise V8 syntax diagnostics before sandbox execution', () => {
    try {
      compileWorkflowJavaScript(`function broken(input { return input; }\nfunction main() {}`);
      throw new Error('expected compilation to fail');
    } catch (error) {
      const details = (error as { details?: { diagnostics?: Array<Record<string, unknown>> } })
        .details;
      expect(details?.diagnostics?.[0]).toMatchObject({
        code: 'JAVASCRIPT_SYNTAX_ERROR',
      });
    }
  });

  it('keeps semantic IR hash stable when provenance changes', () => {
    const ir = buildIr();
    const moved = {
      ...ir,
      provenance: ir.provenance.map((item) => ({
        ...item,
        source: { ...item.source, line: item.source.line + 10 },
      })),
    };
    expect(canonicalizeWorkflowIr(ir)).toBe(canonicalizeWorkflowIr(moved));
    expect(computeWorkflowIrSemanticHash(ir)).toBe(computeWorkflowIrSemanticHash(moved));
  });

  it('lowers Stable IR to Operations JSON with runtime bindings', () => {
    const ir = buildIr();
    const operations = lowerWorkflowIrToOperations({
      ir,
      inputTableId: 'runtime-input',
      outputTableName: 'runtime-output',
    });
    expect(operations).toMatchObject({
      operationsVersion: '1.0',
      inputTableId: 'runtime-input',
      outputTableName: 'runtime-output',
      outputOperationId: 'remove-count',
    });
  });

  it('runs the complete JavaScript -> IR -> Operations -> Prep DSL pipeline', () => {
    const result = compileGeneratedJavaScriptWorkflow({
      javascriptSource: SOURCE,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '删除记录数',
      columns: [{ name: '记录数', type: 'integer' }],
    });
    expect(result.javascriptSource).toContain('function removeCount');
    expect(result.workflowDsl).toContain('input source dataset "input-1" as src');
    expect(result.workflowDsl).toContain('drop [记录数]');
    expect(result.workflowDsl).toContain('output table "output-1" mode replace');
    expect(result.operationOrigins?.[0]).toMatchObject({
      operationId: 'remove-count',
      functionName: 'removeCount',
    });
  });

  it('compiles safe division with fn.nullif and preserves the numeric result type', () => {
    const source = `function addProfitMargin(input) {
  return workflow.step(input, "derive", {
    column: "Profit Margin",
    expression: col("Profit").div(fn.nullif(col("Sales"), lit(0))).mul(lit(100)).cast("decimal", { scale: 2 })
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const derived = addProfitMargin(input);
  return workflow.output(derived, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
    const result = compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '新增 Profit Margin，Sales 为 0 或空时结果置空',
      columns: [
        { name: 'Profit', type: 'decimal' },
        { name: 'Sales', type: 'decimal' },
      ],
    });

    expect(result.workflowDsl).toContain(
      'derive [`Profit Margin`] = CAST([Profit] / NULLIF([Sales], 0) * 100 AS DECIMAL(18,2))'
    );
    expect(result.expectedOutputSchema).toContainEqual({
      name: 'Profit Margin',
      type: 'decimal',
    });
  });

  it('accepts the numeric shorthand for an expression decimal scale', () => {
    const source = `function roundValue(input) {
  return workflow.step(input, "derive", {
    column: "Rounded",
    expression: col("Value").cast("decimal", 2)
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(roundValue(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
    const result = compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '保留两位小数',
      columns: [{ name: 'Value', type: 'decimal' }],
    });

    expect(result.workflowDsl).toContain('derive [Rounded] = CAST([Value] AS DECIMAL(18,2))');
  });

  it('keeps legacy text functions compatible by coercing a numeric first argument', () => {
    const source = `function stringifyValue(input) {
  return workflow.step(input, "derive", {
    column: "Upper Value",
    expression: fn.upper(col("Value"))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(stringifyValue(input), OUTPUT_TABLE_NAME);
}`;
    const result = compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '将数值转成大写文本',
      columns: [{ name: 'Value', type: 'integer' }],
    });

    expect(result.workflowDsl).toContain(
      'derive [`Upper Value`] = UPPER(CAST([Value] AS VARCHAR))'
    );
  });

  it('rejects decimal scales that would otherwise be silently normalized', () => {
    const nativeSource = (scale: number) => `function roundValue(input) {
  return workflow.step(input, "derive", {
    column: "Rounded",
    expression: expr(row => cast(row["Value"], "decimal", { scale: ${scale} }))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(roundValue(input), OUTPUT_TABLE_NAME);
}`;
    const compile = (javascriptSource: string) =>
      compileGeneratedJavaScriptWorkflow({
        javascriptSource,
        inputTableId: 'input-1',
        outputTableName: 'output-1',
        requirement: '转换为小数',
        columns: [{ name: 'Value', type: 'decimal' }],
      });

    expect(() => compile(nativeSource(99))).toThrow(/scale must be an integer from 0 to 12/);
    expect(() => compile(nativeSource(1.5))).toThrow(/scale must be an integer from 0 to 12/);

    const legacySource = nativeSource(99).replace(
      'expr(row => cast(row["Value"], "decimal", { scale: 99 }))',
      'col("Value").cast("decimal", { scale: 99 })'
    );
    expect(() => compile(legacySource)).toThrow(/scale must be an integer from 0 to 12/);
  });

  it('uses Acorn ranges to patch only the diagnosed function', () => {
    const replacement = `function removeCount(input) {
  return workflow.step(input, "drop", { columns: ["旧字段"] });
}`;
    const patched = applyWorkflowFunctionPatch(SOURCE, 'removeCount', replacement);
    expect(patched).toContain('columns: ["旧字段"]');
    expect(patched.slice(patched.indexOf('function main()'))).toBe(
      SOURCE.slice(SOURCE.indexOf('function main()'))
    );
  });

  it('lets Acorn locate functions safely when regex literals contain braces', () => {
    const source = `function inspect(input) {
  const pattern = /function fake\\(\\) \\{\\}/;
  return input;
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(inspect(input), OUTPUT_TABLE_NAME);
}`;
    const replacement = 'function inspect(input) { return input; }';
    const patched = applyWorkflowFunctionPatch(source, 'inspect', replacement);
    expect(patched).toContain(replacement);
    expect(patched).toContain('function main()');
  });

  it('terminates non-terminating generated JavaScript in the sandbox', () => {
    const source = `function spin(input) { while (true) {} }\nfunction main() { const input = workflow.input(INPUT_TABLE_ID); return workflow.output(spin(input), OUTPUT_TABLE_NAME); }`;
    expect(() => buildIr(source)).toThrow(/timeout|timed out|Script execution/i);
  });

  it('does not expose Node globals or dynamic code generation', () => {
    const processSource = `function inspect(input) { process.cwd(); return input; }\nfunction main() { const input = workflow.input(INPUT_TABLE_ID); return workflow.output(inspect(input), OUTPUT_TABLE_NAME); }`;
    expect(() => buildIr(processSource)).toThrow(/process is not defined/);
    const dynamicSource = `function inspect(input) { Function("return 1")(); return input; }\nfunction main() { const input = workflow.input(INPUT_TABLE_ID); return workflow.output(inspect(input), OUTPUT_TABLE_NAME); }`;
    expect(() => buildIr(dynamicSource)).toThrow(/Code generation from strings disallowed/);
  });
});

it('compiles chained and/or conditions from generated expressions', () => {
  const source = `function keepUsableSales(input) {
  return workflow.step(input, "filter", {
    condition: col("Sales").isNotNull().and(col("Sales").neq(lit(0))).or(col("Profit").gt(lit(0)))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(keepUsableSales(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    inputTableId: 'input-1',
    outputTableName: 'output-1',
    requirement: '保留 Sales 非空且非零或者 Profit 大于零的数据',
    columns: [
      { name: 'Sales', type: 'decimal' },
      { name: 'Profit', type: 'decimal' },
    ],
  });

  expect(result.workflowDsl).toContain(
    'filter [Sales] IS NOT NULL AND [Sales] <> 0 OR [Profit] > 0'
  );
});

it('compiles a date difference in days and sorts by the derived field', () => {
  const source = `function addShippingDays(input) {
  return workflow.step(input, "derive", {
    column: "Shipping Days",
    expression: fn.dateDiff(lit("day"), col("Order Date"), col("Ship Date"))
  });
}
function sortShippingDays(input) {
  return workflow.step(input, "sort", {
    column: col("Shipping Days"),
    direction: "desc"
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const derived = addShippingDays(input);
  const sorted = sortShippingDays(derived);
  return workflow.output(sorted, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    inputTableId: 'input-1',
    outputTableName: 'output-1',
    requirement: '新增 Shipping Days，计算运输天数并降序排列',
    columns: [
      { name: 'Order Date', type: 'date' },
      { name: 'Ship Date', type: 'date' },
    ],
  });

  expect(result.workflowDsl).toContain(
    "derive [`Shipping Days`] = DATE_DIFF('day', [`Order Date`], [`Ship Date`])"
  );
  expect(result.workflowDsl).toContain('sort by [`Shipping Days`] desc');
  expect(result.expectedOutputSchema).toContainEqual({
    name: 'Shipping Days',
    type: 'integer',
  });
});

it('compiles a conditional text flag with fn.ifElse', () => {
  const source = `function addHighDiscountFlag(input) {
  return workflow.step(input, "derive", {
    column: "High Discount Flag",
    expression: fn.ifElse(
      col("Discount").gte(lit(0.08)),
      lit("高折扣"),
      lit("普通折扣")
    )
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const derived = addHighDiscountFlag(input);
  return workflow.output(derived, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    inputTableId: 'input-1',
    outputTableName: 'output-1',
    requirement: 'Discount 大于等于 0.08 标记为高折扣，否则标记为普通折扣',
    columns: [{ name: 'Discount', type: 'decimal' }],
  });

  expect(result.workflowDsl).toContain(
    "derive [`High Discount Flag`] = if [Discount] >= 0.08 then '高折扣' else '普通折扣' end"
  );
  expect(result.expectedOutputSchema).toContainEqual({
    name: 'High Discount Flag',
    type: 'text',
  });
});

it('rejects fn.ifElse when the condition is not boolean', () => {
  const source = `function addInvalidFlag(input) {
  return workflow.step(input, "derive", {
    column: "Flag",
    expression: fn.ifElse(col("Discount"), lit("yes"), lit("no"))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(addInvalidFlag(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;

  expect(() =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '创建标记',
      columns: [{ name: 'Discount', type: 'decimal' }],
    })
  ).toThrow(/ifElse argument 1 must be boolean/);
});

it('statically lowers native JavaScript row expressions to stable workflow IR', () => {
  const nativeSource = `function addHighDiscountFlag(input) {
  return workflow.step(input, "derive", {
    column: "High Discount Flag",
    expression: expr(row => row["Discount"] >= 0.08 ? "高折扣" : "普通折扣")
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(addHighDiscountFlag(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const nativeResult = compileGeneratedJavaScriptWorkflow({
    javascriptSource: nativeSource,
    inputTableId: 'input-1',
    outputTableName: 'output-1',
    requirement: '创建高折扣标记',
    columns: [{ name: 'Discount', type: 'decimal' }],
  });

  expect(nativeResult.workflowDsl).toContain(
    "derive [`High Discount Flag`] = if [Discount] >= 0.08 then '高折扣' else '普通折扣' end"
  );
  expect(nativeResult.javascriptSource).toContain('expr(row =>');
  expect(nativeResult.expectedOutputSchema).toContainEqual({
    name: 'High Discount Flag',
    type: 'text',
  });
});

it('produces the same semantic IR for native and legacy expressions', () => {
  const nativeSource = `function addMargin(input) {
  return workflow.step(input, "derive", {
    column: "Margin",
    expression: expr(row => row["Sales"] === 0 ? null : round(row["Profit"] / row["Sales"] * 100, 2))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(addMargin(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const legacySource = `function addMargin(input) {
  return workflow.step(input, "derive", {
    column: "Margin",
    expression: fn.ifElse(
      col("Sales").eq(lit(0)),
      lit(null),
      fn.round(col("Profit").div(col("Sales")).mul(lit(100)), lit(2))
    )
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(addMargin(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const compile = (javascriptSource: string) =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '创建利润率',
      columns: [
        { name: 'Sales', type: 'decimal' },
        { name: 'Profit', type: 'decimal' },
      ],
    });

  const nativeResult = compile(nativeSource);
  const legacyResult = compile(legacySource);
  expect(nativeResult.workflowIrSemanticHash).toBe(legacyResult.workflowIrSemanticHash);
  expect(nativeResult.workflowDsl).toBe(legacyResult.workflowDsl);
});

it('reports native expression type errors at the original helper location', () => {
  const source = `function addInvalidFlag(input) {
  return workflow.step(input, "derive", {
    column: "Flag",
    expression: expr(row => (row["Discount"] >= 0.08).replace("true", "高折扣"))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(addInvalidFlag(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;

  try {
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '创建标记',
      columns: [{ name: 'Discount', type: 'decimal' }],
    });
    throw new Error('expected native expression type checking to fail');
  } catch (error) {
    const commandError = error as {
      message?: string;
      details?: { diagnostics?: Array<Record<string, unknown>> };
    };
    expect(commandError.message).toContain("Property 'replace' does not exist on type 'boolean'");
    expect(commandError.details?.diagnostics?.[0]).toMatchObject({
      code: expect.stringContaining('JAVASCRIPT_TYPE_ERROR_'),
      functionName: 'addInvalidFlag',
      line: 4,
    });
  }
});

it('rejects unknown input columns in native JavaScript expressions', () => {
  const source = `function addValue(input) {
  return workflow.step(input, "derive", {
    column: "Value",
    expression: expr(row => row["Missing Column"] * 2)
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(addValue(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;

  expect(() =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '创建字段',
      columns: [{ name: 'Discount', type: 'decimal' }],
    })
  ).toThrow(/Missing Column/);
});

it('lowers native dateDiff, null checks, logical operators, cast, and sorting', () => {
  const source = `function addShippingDays(input) {
  return workflow.step(input, "derive", {
    column: "Shipping Days",
    expression: expr(row => row["Order Date"] == null || row["Ship Date"] == null
      ? null
      : cast(dateDiff("day", row["Order Date"], row["Ship Date"]), "integer"))
  });
}
function sortShippingDays(input) {
  return workflow.step(input, "sort", { column: col("Shipping Days"), direction: "desc" });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const derived = addShippingDays(input);
  return workflow.output(sortShippingDays(derived), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    inputTableId: 'input-1',
    outputTableName: 'output-1',
    requirement: '计算运输天数并降序',
    columns: [
      { name: 'Order Date', type: 'date' },
      { name: 'Ship Date', type: 'date' },
    ],
  });

  expect(result.workflowDsl).toContain(
    "if [`Order Date`] IS NULL OR [`Ship Date`] IS NULL then NULL else CAST(DATE_DIFF('day', [`Order Date`], [`Ship Date`]) AS INTEGER) end"
  );
  expect(result.workflowDsl).toContain('sort by [`Shipping Days`] desc');
});

it('keeps authoring JavaScript separate from executable source and expression sidecars', () => {
  const source = `function addValue(input) {
  return workflow.step(input, "derive", {
    column: "Value",
    expression: expr(row => row["Sales"] * 2)
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(addValue(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const compiled = compileWorkflowJavaScript(source, {
    columns: [{ name: 'Sales', type: 'decimal' }],
  });

  expect(compiled.originalSource).toBe(source);
  expect(compiled.executableSource).toContain('__workflowExpression("expr_1")');
  expect(compiled.executableSource).not.toContain('"kind":"binary"');
  expect(Object.isFrozen(compiled.expressions)).toBe(true);
  expect(Object.isFrozen(compiled.expressions[0]?.ir)).toBe(true);
  expect(compiled.expressions).toMatchObject([
    {
      id: 'expr_1',
      ir: {
        kind: 'binary',
        op: '*',
        left: { kind: 'column', name: 'Sales' },
        right: { kind: 'literal', value: 2 },
      },
      source: { functionName: 'addValue', line: 4 },
    },
  ]);
});

it('rejects direct access to compiler-owned expression and finish identifiers', () => {
  const forged = `function addValue(input) {
  return workflow.step(input, "derive", {
    column: "Value",
    expression: __workflowExpression("expr_1")
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(addValue(input), OUTPUT_TABLE_NAME);
}`;
  expect(() => compileWorkflowJavaScript(forged)).toThrow(/reserved for the workflow compiler/);
});

it('rejects async callbacks and local bindings that shadow the native expression SDK', () => {
  const asyncSource = `function addValue(input) {
  return workflow.step(input, "derive", {
    column: "Value",
    expression: expr(async row => row["Sales"] * 2)
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(addValue(input), OUTPUT_TABLE_NAME);
}`;
  expect(() =>
    compileWorkflowJavaScript(asyncSource, {
      columns: [{ name: 'Sales', type: 'decimal' }],
    })
  ).toThrow(/synchronous and non-generator/);

  const shadowedSource = `function inspect(expr) { return expr(() => 1); }
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(inspect(input), OUTPUT_TABLE_NAME);
}`;
  expect(() => compileWorkflowJavaScript(shadowedSource)).toThrow(/must not be redeclared/);

  const shadowedDomainFunction = `function round(value) { return value * 10; }
function addValue(input) {
  return workflow.step(input, "derive", {
    column: "Value",
    expression: expr(row => round(row["Sales"]))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(addValue(input), OUTPUT_TABLE_NAME);
}`;
  expect(() => compileWorkflowJavaScript(shadowedDomainFunction)).toThrow(
    /identifier round must not be redeclared/
  );
});

it('does not trust marker-shaped objects as workflow expressions', () => {
  const source = `function addValue(input) {
  return workflow.step(input, "derive", {
    column: "Value",
    expression: { __expression: { kind: "literal", value: 999 } }
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(addValue(input), OUTPUT_TABLE_NAME);
}`;
  expect(() => buildIr(source)).toThrow(/kind/);
});

it('keeps sandbox SDK functions in the VM realm', () => {
  const source = `function inspect(input) {
  workflow.step.constructor("return process")();
  return input;
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(inspect(input), OUTPUT_TABLE_NAME);
}`;
  expect(() => buildIr(source)).toThrow(/Code generation from strings disallowed/);
});

it('does not let generated code forge the sandbox result by poisoning JSON', () => {
  const source = `function poison(input) {
  JSON = {
    stringify: () => '{"ok":true,"ir":{"irVersion":"1.0","kind":"workflow","sourceLanguage":"javascript","inputSeen":true,"outputSeen":true,"outputOperationId":"input","operations":[],"provenance":[]}}'
  };
  return input;
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return poison(input);
}`;

  expect(() => buildIr(source)).toThrow(/must declare an output/);
});

it('prevents operation payloads from overriding IR-owned fields', () => {
  const source = `function removeValue(input) {
  return workflow.step(input, "drop", { columns: ["Value"], type: "derive" });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(removeValue(input), OUTPUT_TABLE_NAME);
}`;
  expect(() => buildIr(source)).toThrow(/reserved field: type/);
});

it('allows later native expressions to read statically declared derived fields', () => {
  const source = `function addGross(input) {
  return workflow.step(input, "derive", {
    column: "Gross",
    expression: expr(row => row["Sales"] * 2)
  });
}
function addAdjusted(input) {
  return workflow.step(input, "derive", {
    column: "Adjusted",
    expression: expr(row => row["Gross"] * 0.9)
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const gross = addGross(input);
  const adjusted = addAdjusted(gross);
  return workflow.output(adjusted, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    inputTableId: 'input-1',
    outputTableName: 'output-1',
    requirement: '连续派生字段',
    columns: [{ name: 'Sales', type: 'decimal' }],
  });

  expect(result.workflowDsl).toContain('derive [Gross] = [Sales] * 2');
  expect(result.workflowDsl).toContain('derive [Adjusted] = [Gross] * 0.9');
});

it('enforces domain-function argument types after derived schema becomes known', () => {
  const source = `function addLabel(input) {
  return workflow.step(input, "derive", {
    column: "Label",
    expression: expr(row => concat(row["Category"], " label"))
  });
}
function addYear(input) {
  return workflow.step(input, "derive", {
    column: "Invalid Year",
    expression: expr(row => year(row["Label"]))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(addYear(addLabel(input)), OUTPUT_TABLE_NAME);
}`;

  expect(() =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '先生成文本标签，再错误地提取年份',
      columns: [{ name: 'Category', type: 'text' }],
    })
  ).toThrow(/year argument 1 must be temporal.*\[Label\] \(text\)/);
});

it('requires an integer argument for round digits', () => {
  const source = `function addRounded(input) {
  return workflow.step(input, "derive", {
    column: "Rounded",
    expression: expr(row => round(row["Sales"], 1.5))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(addRounded(input), OUTPUT_TABLE_NAME);
}`;

  expect(() =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '按非法位数取整',
      columns: [{ name: 'Sales', type: 'decimal' }],
    })
  ).toThrow(/round argument 2 must be integer/);
});

it('allows a native expression to read a statically renamed field', () => {
  const source = `function renameSales(input) {
  return workflow.step(input, "rename", { source: "Sales", target: "Revenue" });
}
function addDoubleRevenue(input) {
  return workflow.step(input, "derive", {
    column: "Double Revenue",
    expression: expr(row => row["Revenue"] * 2)
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const renamed = renameSales(input);
  const derived = addDoubleRevenue(renamed);
  return workflow.output(derived, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    inputTableId: 'input-1',
    outputTableName: 'output-1',
    requirement: '重命名后派生字段',
    columns: [{ name: 'Sales', type: 'decimal' }],
  });

  expect(result.workflowDsl).toContain('map [Sales] to [Revenue]');
  expect(result.workflowDsl).toContain('derive [`Double Revenue`] = [Revenue] * 2');
});

it('patches a helper even when its original native expression cannot be lowered', () => {
  const failed = `function addFlag(input) {
  return workflow.step(input, "derive", {
    column: "Flag",
    expression: expr(row => (row["Discount"] >= 0.08).replace("true", "高折扣"))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(addFlag(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const replacement = `function addFlag(input) {
  return workflow.step(input, "derive", {
    column: "Flag",
    expression: expr(row => row["Discount"] >= 0.08 ? "高折扣" : "普通折扣")
  });
}`;
  const patched = applyWorkflowFunctionPatch(failed, 'addFlag', replacement);
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: patched,
    inputTableId: 'input-1',
    outputTableName: 'output-1',
    requirement: '折扣标记',
    columns: [{ name: 'Discount', type: 'decimal' }],
  });

  expect(patched.slice(patched.indexOf('function main()'))).toBe(
    failed.slice(failed.indexOf('function main()'))
  );
  expect(result.workflowDsl).toContain("if [Discount] >= 0.08 then '高折扣' else '普通折扣' end");
});

it('produces the same semantic IR for native and legacy contains expressions', () => {
  const native = `function keepChairs(input) {
  return workflow.step(input, "filter", {
    condition: expr(row => contains(row["Product Name"], "Chair"))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID);
  return workflow.output(keepChairs(input), OUTPUT_TABLE_NAME);
}`;
  const legacy = native.replace(
    'expr(row => contains(row["Product Name"], "Chair"))',
    'col("Product Name").contains(lit("Chair"))'
  );
  const compile = (javascriptSource: string) =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '保留产品名含 Chair 的记录',
      columns: [{ name: 'Product Name', type: 'text' }],
    });

  const nativeResult = compile(native);
  const legacyResult = compile(legacy);
  expect(nativeResult.workflowIrSemanticHash).toBe(legacyResult.workflowIrSemanticHash);
  expect(nativeResult.workflowDsl).toBe(legacyResult.workflowDsl);
});

it('types native cast results and normalizes timestamp as datetime during DSL lowering', () => {
  const source = `function addAmount(input) {
  return workflow.step(input, "derive", {
    column: "Amount",
    expression: expr(row => cast(row["Raw"], "decimal", { scale: 2 }) * 2)
  });
}
function keepRecent(input) {
  return workflow.step(input, "filter", {
    condition: expr(row => row["Created At"] >= cast("2020-01-01 00:00:00", "timestamp"))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const derived = addAmount(input);
  const filtered = keepRecent(derived);
  return workflow.output(filtered, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const compile = (javascriptSource: string) =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource,
      inputTableId: 'input-1',
      outputTableName: 'output-1',
      requirement: '转换金额并过滤日期',
      columns: [
        { name: 'Raw', type: 'text' },
        { name: 'Created At', type: 'timestamp' },
      ],
    });
  const result = compile(source);
  const canonicalAlias = compile(source.replace('"timestamp"', '"datetime"'));

  expect(result.workflowDsl).toContain('CAST([Raw] AS DECIMAL(18,2)) * 2');
  expect(result.workflowDsl).toContain("[`Created At`] >= CAST('2020-01-01 00:00:00' AS DATETIME)");
  expect(result.workflowIrSemanticHash).toBe(canonicalAlias.workflowIrSemanticHash);
});

it('computes dateDiff for timestamp-typed columns', () => {
  const source = `function addElapsedHours(input) {
  return workflow.step(input, "derive", {
    column: "Elapsed Hours",
    expression: expr(row => dateDiff("hour", row["Started At"], row["Finished At"]))
  });
}
function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  return workflow.output(addElapsedHours(input), OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    inputTableId: 'input-1',
    outputTableName: 'output-1',
    requirement: '计算相差小时数',
    columns: [
      { name: 'Started At', type: 'timestamp' },
      { name: 'Finished At', type: 'datetime' },
    ],
  });

  expect(result.workflowDsl).toContain(
    "derive [`Elapsed Hours`] = DATE_DIFF('hour', [`Started At`], [`Finished At`])"
  );
});
