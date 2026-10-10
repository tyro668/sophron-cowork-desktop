import { describe, expect, it } from 'vitest';
import {
  applyWorkflowFunctionPatch,
  compileWorkflowJavaScript,
  executeWorkflowJavaScriptInSandbox,
  WORKFLOW_SANDBOX_RUNNER_SOURCE,
} from '../src/main/data/workflow/javascript-runtime';
import { compileGeneratedJavaScriptWorkflow } from '../src/main/data/workflow/workflow-generator';
import { buildWorkflowGenerationSystemPrompt } from '../src/main/prompts';
import { validateGeneratedOperatorConfig } from '../src/main/data/workflow/generated-operator-config-validator';
import { lowerGeneratedWorkflowIrSemantics } from '../src/main/data/workflow/workflow-ir-lowerer';
import { compileLoweredWorkflowToPlatformNodes } from '../src/main/data/workflow/workflow-node-compiler';
import { exportPrepWorkflowDsl } from '../src/shared/prep-dsl';
import {
  canonicalizeWorkflowIr,
  computeWorkflowIrSemanticHash,
  validateAndNormalizeWorkflowIr,
} from '../src/main/data/workflow/workflow-ir';
import {
  getWorkflowJavascriptCapabilityPrompt,
  getWorkflowIrOperationTypeScriptDeclarations,
  WORKFLOW_IR_OPERATION_REGISTRY,
} from '../src/main/data/workflow/workflow-ir-operation-registry';
import {
  getWorkflowExpressionCapabilityPrompt,
  getWorkflowExpressionTypeScriptDeclarations,
  WORKFLOW_EXPRESSION_FUNCTION_REGISTRY,
  WORKFLOW_EXPRESSION_FUNCTIONS,
  WORKFLOW_NATIVE_EXPRESSION_INTRINSICS,
} from '../src/main/data/workflow/workflow-expression-registry';
import {
  AI_PREP_DSL_OPERATION_CAPABILITIES,
  AI_PREP_DSL_RUNTIME_PROFILE_VERSION,
} from '../src/main/data/workflow/prep-dsl-capability-profile';
import { validateGeneratedWorkflowGenerationContract } from '../src/main/data/workflow/schema-inferencer';

const SOURCE = `function removeCount(input) {
  return workflow.step(input, "drop", { columns: ["记录数"] });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  const cleaned = removeCount(input);
  return workflow.output(cleaned, RESULT_TABLE_NAME, { mode: "replace" });
}`;

function buildIr(source = SOURCE) {
  return executeWorkflowJavaScriptInSandbox({
    compiled: compileWorkflowJavaScript(source),
    rawTableId: 'input-1',
    resultTableName: 'output-1',
  });
}

function compileWorkflowIrToPlatformNodes(input: {
  ir: ReturnType<typeof buildIr>;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  bindings: Parameters<typeof compileLoweredWorkflowToPlatformNodes>[0]['bindings'];
}) {
  return compileLoweredWorkflowToPlatformNodes({
    semantics: lowerGeneratedWorkflowIrSemantics(input),
    bindings: input.bindings,
  });
}

function exportGeneratedWorkflowDsl(
  generated: ReturnType<typeof compileGeneratedJavaScriptWorkflow>
): string {
  const plan = compileLoweredWorkflowToPlatformNodes({
    semantics: generated,
    bindings: {
      rawTableId: 'input-1',
      resultTableName: 'output-1',
    },
  });
  return exportPrepWorkflowDsl(plan.nodes, plan.edges);
}

describe('JavaScript Workflow SDK pipeline', () => {
  it('derives the prompt from the registry and keeps the generic runtime step API', () => {
    const prompt = getWorkflowJavascriptCapabilityPrompt();
    for (const definition of WORKFLOW_IR_OPERATION_REGISTRY) {
      expect(prompt).toContain(definition.promptSignature);
    }
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).toContain('allowedOperationTypes.has(type)');
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).toContain('step: (inputValue, type, fields)');
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).not.toContain('sdk.drop =');
    expect(prompt).toContain('strategy: "drop_empty_rows"');
    expect(prompt).toContain('strategy: "drop_rows_by_nulls"');
    expect(prompt).toContain('strategy: "by_column"');
    expect(prompt).toContain('mean_fill|median_fill|mode_fill|forward_fill|backward_fill');
    expect(prompt).toContain('Per-group limits are unsupported');
    expect(prompt).toContain('Percent limits require offset 0');
    expect(buildWorkflowGenerationSystemPrompt()).toContain(
      'config.strategy is only "drop_empty_rows", "drop_rows_by_nulls", or "by_column"'
    );
    expect(prompt).toContain('on: [{ field: "pivotField"');
    expect(prompt).toContain('groupBy: ["groupField"]');
    expect(prompt).toContain('never use expr(...) in on[].field or groupBy');
    expect(prompt).toContain('only using[].expression uses expr(...)');
    expect(prompt).toContain('workflow.step(input, "derive_window"');
    expect(prompt).toContain('Use empty partitionBy and orderBy for an all-rows total');
    const expressionPrompt = getWorkflowExpressionCapabilityPrompt();
    const typeDeclarations = getWorkflowExpressionTypeScriptDeclarations();
    const operationDeclarations = getWorkflowIrOperationTypeScriptDeclarations();
    for (const functionName of Object.keys(WORKFLOW_EXPRESSION_FUNCTIONS)) {
      if (functionName !== 'ifElse') expect(expressionPrompt).toContain(functionName);
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
    for (const definition of WORKFLOW_IR_OPERATION_REGISTRY) {
      expect(operationDeclarations).toContain(`"${definition.irType}":`);
      expect(operationDeclarations).toContain(definition.typescriptPayload);
    }
    expect(operationDeclarations).toContain('interface WorkflowStepPayloadMap');
    expect(operationDeclarations).toContain('T extends keyof WorkflowStepPayloadMap');
    expect(operationDeclarations).not.toContain('Record<string, unknown>');
    expect(prompt).not.toContain('mode: "top"');
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).not.toContain("defineGlobal('col'");
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).not.toContain("defineGlobal('lit'");
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).not.toContain("defineGlobal('fn'");
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).not.toContain("defineGlobal('metric'");
    expect(WORKFLOW_SANDBOX_RUNNER_SOURCE).not.toContain('expressionCapabilities');
    expect(typeDeclarations).toContain(
      'declare function nullif(value: number, other: number): number;'
    );
    expect(typeDeclarations).not.toContain('function nullif<T>');
    expect(prompt).not.toContain('Prep node:');
    expect(prompt).not.toContain('runtime compatibility profile:');
    expect(new Set(Object.keys(AI_PREP_DSL_OPERATION_CAPABILITIES))).toEqual(
      new Set(WORKFLOW_IR_OPERATION_REGISTRY.map((definition) => definition.irType))
    );
    expect(
      new Set(WORKFLOW_IR_OPERATION_REGISTRY.map((definition) => definition.irType)).size
    ).toBe(WORKFLOW_IR_OPERATION_REGISTRY.length);
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
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  const cleaned = nullifyMarkers(input);
  return workflow.output(cleaned, RESULT_TABLE_NAME, { mode: "replace" });
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

  it('normalizes the legacy aggregate alias at the IR boundary but advertises only canonical names', () => {
    const source = `function summarize(input) {
  return workflow.step(input, "aggregate", {
    groupBy: [expr(row => row["Region"])],
    metrics: [{ fn: "countDistinct", expression: expr(row => row["Customer ID"]), alias: "Customers" }]
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(summarize(input), RESULT_TABLE_NAME);
}`;
    const ir = buildIr(source);
    expect(ir.operations[0]).toMatchObject({
      type: 'aggregate',
      metrics: [{ fn: 'count_distinct', alias: 'Customers' }],
    });
    expect(getWorkflowJavascriptCapabilityPrompt()).toContain('count_distinct');
    expect(getWorkflowJavascriptCapabilityPrompt()).toContain('never countDistinct');
    expect(getWorkflowIrOperationTypeScriptDeclarations()).not.toContain('fn: "countDistinct"');
  });

  it('type-checks every workflow operation against its precise payload contract', () => {
    const invalidSelect = `function selectFields(input) {
  return workflow.step(input, "select", { columns: [42] });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(selectFields(input), RESULT_TABLE_NAME);
}`;
    expect(() => compileWorkflowJavaScript(invalidSelect, { columns: [] })).toThrow(
      /No overload matches this call|not assignable to type 'string'/
    );

    const invalidScale = `function convertValue(input) {
  return workflow.step(input, "convert_type", {
    column: "Value",
    targetType: "integer",
    options: { scale: 2 }
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(convertValue(input), RESULT_TABLE_NAME);
}`;
    expect(() =>
      compileWorkflowJavaScript(invalidScale, { columns: [{ name: 'Value', type: 'text' }] })
    ).toThrow(/No overload matches this call|scale/);

    const invalidKeepPolicy = `function removeDuplicates(input) {
  return workflow.step(input, "deduplicate", {
    config: { columns: ["ID"], keep: "middle", orderBy: [] }
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(removeDuplicates(input), RESULT_TABLE_NAME);
}`;
    expect(() =>
      compileWorkflowJavaScript(invalidKeepPolicy, {
        columns: [{ name: 'ID', type: 'integer' }],
      })
    ).toThrow(/not assignable|No overload matches this call/);

    const nonTextNullMarker = `function nullifyMarkers(input) {
  return workflow.step(input, "missing_value", {
    config: {
      strategy: "by_column",
      rules: [{ column: "Value", method: "nullify_values", values: [0] }]
    }
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(nullifyMarkers(input), RESULT_TABLE_NAME);
}`;
    expect(() =>
      compileWorkflowJavaScript(nonTextNullMarker, {
        columns: [{ name: 'Value', type: 'text' }],
      })
    ).toThrow(/not assignable to type 'string'|No overload matches this call/);

    const invalidWindowStar = `function addTotal(input) {
  return workflow.step(input, "derive_window", {
    column: "Total",
    function: "sum",
    expression: "*",
    partitionBy: [],
    orderBy: []
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(addTotal(input), RESULT_TABLE_NAME);
}`;
    expect(() =>
      compileWorkflowJavaScript(invalidWindowStar, {
        columns: [{ name: 'Value', type: 'integer' }],
      })
    ).toThrow(/No overload matches this call|not assignable/);
  });

  it('reports the canonical limit payload instead of the unrelated last overload', () => {
    const invalidTop = `function takeTopRows(input) {
  return workflow.step(input, "limit", {
    config: { mode: "top", limit: 10, unit: "rows", offset: 0, orderBy: [] }
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(takeTopRows(input), RESULT_TABLE_NAME);
}`;

    try {
      compileWorkflowJavaScript(invalidTop, { columns: [] });
      throw new Error('expected invalid limit payload to fail');
    } catch (error) {
      const commandError = error as {
        message?: string;
        details?: { diagnostics?: Array<Record<string, unknown>> };
      };
      expect(commandError.message).toContain('Invalid workflow.step payload for operation "limit"');
      expect(commandError.message).toContain('mode: "limit"');
      expect(commandError.message).not.toContain(
        `Argument of type '"limit"' is not assignable to parameter of type '"unnest"'`
      );
      expect(commandError.details?.diagnostics?.[0]).toMatchObject({
        functionName: 'takeTopRows',
        operationType: 'limit',
        expectedSignature: expect.stringContaining('mode: "limit"'),
        repairHint: expect.stringContaining('Never use config.mode="top"'),
      });
    }
  });

  it('rejects declaration shapes that the native expression AST cannot lower', () => {
    const compileExpression = (expression: string) =>
      compileWorkflowJavaScript(
        `function addValue(input) {
  return workflow.step(input, "derive", { column: "Result", expression: expr(row => ${expression}) });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(addValue(input), RESULT_TABLE_NAME);
}`,
        { columns: [{ name: 'Value', type: 'integer' }] }
      );

    expect(() => compileExpression('cast(row["Value"], "integer", { scale: 2 })')).toThrow(
      /No overload matches this call|Expected 2 arguments|not assignable to parameter of type '"decimal"'/
    );
    expect(() => compileExpression('contains(row["Value"], 2)')).toThrow(
      /not assignable to parameter of type 'string'/
    );
    expect(() => compileExpression('coalesce(undefined, row["Value"])')).toThrow(
      /No overload matches this call/
    );
    expect(() => compileExpression('row["Value"] == 1')).toThrow(/Use === or !==/);
    expect(() =>
      compileWorkflowJavaScript(
        `function addValue(input) {
  return workflow.step(input, "derive", { column: "Result", expression: expr(row => row["Label"] + 1) });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(addValue(input), RESULT_TABLE_NAME);
}`,
        { columns: [{ name: 'Label', type: 'text' }] }
      )
    ).toThrow(/Native \+ is numeric-only/);
  });

  it('rejects reading intermediate workflow data and directs repair to derive_window', () => {
    const source = `function summarize(input) {
  return workflow.step(input, "aggregate", {
    groupBy: [],
    metrics: [{ fn: "sum", expression: expr(row => row["Sales"]), alias: "全部销售额" }]
  });
}
function addShare(input, totalAgg) {
  return workflow.step(input, "derive", {
    column: "占比",
    expression: expr(row => row["Sales"] / totalAgg.data[0]["全部销售额"])
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  const totalAgg = summarize(input);
  return workflow.output(addShare(input, totalAgg), RESULT_TABLE_NAME);
}`;

    try {
      compileWorkflowJavaScript(source, { columns: [{ name: 'Sales', type: 'decimal' }] });
      throw new Error('expected workflow data access to fail');
    } catch (error) {
      const commandError = error as {
        message?: string;
        details?: { diagnostics?: Array<Record<string, unknown>> };
      };
      expect(commandError.message).toContain('Workflow values are opaque graph handles');
      expect(commandError.details?.diagnostics?.[0]).toMatchObject({
        code: 'WORKFLOW_VALUE_DATA_ACCESS_UNSUPPORTED',
        expectedSignature: expect.stringContaining('derive_window'),
        repairHint: expect.stringContaining('Do not read .data'),
      });
    }
  });

  it('reports the invalid missing-value strategy produced by a model', () => {
    const source = `function nullifyMarkers(input) {
  return workflow.step(input, "missing_value", {
    config: { strategy: "nullify_values", rules: [] }
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  const cleaned = nullifyMarkers(input);
  return workflow.output(cleaned, RESULT_TABLE_NAME, { mode: "replace" });
}`;
    expect(() => buildIr(source)).toThrow(
      'config.strategy must be one of drop_empty_rows, drop_rows_by_nulls, by_column; received "nullify_values"'
    );
  });

  it('keeps schema-only or non-scalar runtime capabilities closed to generated workflows', () => {
    const listAggregate = `function summarize(input) {
  return workflow.step(input, "aggregate", {
    groupBy: [],
    metrics: [{ fn: "list", expression: expr(row => row["Value"]), alias: "values" }]
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(summarize(input), RESULT_TABLE_NAME);
}`;
    expect(() =>
      compileWorkflowJavaScript(listAggregate, {
        columns: [{ name: 'Value', type: 'integer' }],
      })
    ).toThrow(/not assignable|No overload matches/);

    const jsonObjectUnnest = `function expandObject(input) {
  return workflow.step(input, "unnest", {
    config: {
      sourceKind: "json",
      column: "Value",
      alias: "item",
      keepParentNames: false,
      preserveOrder: false
    }
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(expandObject(input), RESULT_TABLE_NAME);
}`;
    expect(() =>
      compileWorkflowJavaScript(jsonObjectUnnest, {
        columns: [{ name: 'Value', type: 'text' }],
      })
    ).toThrow(/not assignable|No overload matches/);
  });

  it('uses V8 to compile standard JavaScript and the sandbox SDK to build stable IR', () => {
    const ir = buildIr();
    expect(ir).toMatchObject({
      irVersion: '1.0',
      kind: 'workflow',
      sourceLanguage: 'javascript',
      sdkVersion: '2.2.0',
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
    const source = `function broken(input) {
  return workflow.step(input, "drop", { columns: ["记录数"] }));
}
function main() {}`;
    try {
      compileWorkflowJavaScript(source);
      throw new Error('expected compilation to fail');
    } catch (error) {
      const details = (error as { details?: { diagnostics?: Array<Record<string, unknown>> } })
        .details;
      expect(details?.diagnostics?.[0]).toMatchObject({
        code: 'JAVASCRIPT_SYNTAX_ERROR',
        line: 2,
        column: expect.any(Number),
        functionName: 'broken',
        sourceLine: expect.stringContaining('workflow.step'),
        sourceExcerpt: expect.stringContaining('2 |'),
        caret: expect.stringContaining('^'),
        repairHint: expect.stringContaining('do not copy the failing line unchanged'),
      });
    }
  });

  it('patches a syntax-invalid helper through the best-effort function index', () => {
    const invalidSource = `function removeCount(input) {
  return workflow.step(input, "drop", { columns: ["记录数"] }));
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(removeCount(input), RESULT_TABLE_NAME, { mode: "replace" });
}`;
    const patched = applyWorkflowFunctionPatch(
      invalidSource,
      'removeCount',
      `function removeCount(input) {
  return workflow.step(input, "drop", { columns: ["记录数"] });
}`
    );

    expect(buildIr(patched).operations).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'drop', columns: ['记录数'] })])
    );
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

  it('rejects branched or reordered IR before lowering it to a linear platform graph', () => {
    const ir = buildIr();
    expect(() =>
      validateAndNormalizeWorkflowIr({
        ...ir,
        outputOperationId: 'second-drop',
        operations: [
          ...ir.operations,
          {
            operationId: 'second-drop',
            inputOperationId: 'input',
            type: 'drop',
            columns: ['另一列'],
          },
        ],
      })
    ).toThrow(/single linear chain/);
  });

  it('normalizes the legacy top limit shape at the IR boundary', () => {
    const ir = buildIr();
    const operationId = ir.operations[0]?.operationId;
    const normalized = validateAndNormalizeWorkflowIr({
      ...ir,
      operations: [
        {
          operationId,
          inputOperationId: 'input',
          type: 'limit',
          config: {
            mode: 'top',
            limit: 10,
            unit: 'rows',
            offset: 0,
            orderBy: [{ field: '记录数', direction: 'desc' }],
          },
        },
      ],
    });

    expect(normalized.operations[0]).toMatchObject({
      type: 'limit',
      config: { mode: 'limit', unit: 'rows', offset: 0, ties: false },
    });
  });

  it('lowers stable IR directly to platform nodes with runtime bindings', () => {
    const ir = buildIr();
    const plan = compileWorkflowIrToPlatformNodes({
      ir,
      requirement: '删除记录数',
      columns: [{ name: '记录数', type: 'integer' }],
      bindings: {
        rawTableId: 'runtime-input',
        resultTableName: 'runtime-output',
        outputPhysicalTableName: 'runtime_output_physical',
      },
    });
    expect(plan.nodes.map((node) => node.type)).toEqual(['input_source', 'field_select', 'output']);
    expect(plan.nodes[0]?.config).toMatchObject({ rawTableId: 'runtime-input' });
    expect(plan.nodes.at(-1)?.config).toMatchObject({ table: 'runtime_output_physical' });
  });

  it('keeps generated artifacts DSL-free until native nodes export compatibility Prep DSL', () => {
    const result = compileGeneratedJavaScriptWorkflow({
      javascriptSource: SOURCE,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
      requirement: '删除记录数',
      columns: [{ name: '记录数', type: 'integer' }],
    });
    expect(result.javascriptSource).toContain('function removeCount');
    expect(result.runtimeCompatibilityProfileVersion).toBe(AI_PREP_DSL_RUNTIME_PROFILE_VERSION);
    expect(result).not.toHaveProperty('workflowDsl');
    expect(result.platformOperators).toEqual([
      expect.objectContaining({
        type: 'field_select',
        config: { mode: 'exclude', columns: ['记录数'] },
      }),
    ]);
    expect(result.platformOperators[0]?.config).not.toHaveProperty('dsl');
    const compatibilityDsl = exportGeneratedWorkflowDsl(result);
    expect(compatibilityDsl).toContain('input source rawTable "input-1" as src');
    expect(compatibilityDsl).toContain('drop [记录数]');
    expect(compatibilityDsl).toContain('output table "output-1" mode replace');
    expect(result.operationOrigins?.[0]).toMatchObject({
      operationId: 'remove-count',
      functionName: 'removeCount',
    });
  });

  it('rejects a generated artifact from a stale Prep DSL runtime profile', () => {
    const columns = [
      { name: '记录数', type: 'integer' },
      { name: '名称', type: 'text' },
    ];
    const result = compileGeneratedJavaScriptWorkflow({
      javascriptSource: SOURCE,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
      requirement: '删除记录数',
      columns,
    });
    const diagnostics = validateGeneratedWorkflowGenerationContract(
      {
        ...result,
        runtimeCompatibilityProfileVersion: 'prep-runtime-compat/stale',
      },
      columns
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'runtimeCompatibilityProfileMismatch',
      })
    );
  });

  it('rejects a generated artifact when its Workflow IR semantic hash was tampered with', () => {
    const columns = [{ name: '记录数', type: 'integer' }];
    const result = compileGeneratedJavaScriptWorkflow({
      javascriptSource: SOURCE,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
      requirement: '删除记录数',
      columns,
    });

    expect(
      validateGeneratedWorkflowGenerationContract(
        { ...result, workflowIrSemanticHash: 'stale-semantic-hash' },
        columns
      )
    ).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'workflowIrSemanticHashMismatch',
      })
    );
  });

  it('compiles safe division with native nullif and preserves the numeric result type', () => {
    const source = `function addProfitMargin(input) {
  return workflow.step(input, "derive", {
    column: "Profit Margin",
    expression: expr(row => cast(row["Profit"] / nullif(row["Sales"], 0) * 100, "decimal", { scale: 2 }))
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  const derived = addProfitMargin(input);
  return workflow.output(derived, RESULT_TABLE_NAME, { mode: "replace" });
}`;
    const result = compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
      requirement: '新增 Profit Margin，Sales 为 0 或空时结果置空',
      columns: [
        { name: 'Profit', type: 'decimal' },
        { name: 'Sales', type: 'decimal' },
      ],
    });

    expect(exportGeneratedWorkflowDsl(result)).toContain(
      'derive [Profit Margin] = CAST([Profit] / NULLIF([Sales], 0) * 100 AS DECIMAL(18,2))'
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
    expression: expr(row => cast(row["Value"], "decimal", 2))
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(roundValue(input), RESULT_TABLE_NAME, { mode: "replace" });
}`;
    const result = compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
      requirement: '保留两位小数',
      columns: [{ name: 'Value', type: 'decimal' }],
    });

    expect(exportGeneratedWorkflowDsl(result)).toContain(
      'derive [Rounded] = CAST([Value] AS DECIMAL(18,2))'
    );
  });

  it('keeps native text functions compatible by coercing a numeric first argument', () => {
    const source = `function stringifyValue(input) {
  return workflow.step(input, "derive", {
    column: "Upper Value",
    expression: expr(row => upper(row["Value"]))
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(stringifyValue(input), RESULT_TABLE_NAME);
}`;
    const result = compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
      requirement: '将数值转成大写文本',
      columns: [{ name: 'Value', type: 'integer' }],
    });

    expect(exportGeneratedWorkflowDsl(result)).toContain(
      'derive [Upper Value] = UPPER(CAST([Value] AS VARCHAR))'
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
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(roundValue(input), RESULT_TABLE_NAME);
}`;
    const compile = (javascriptSource: string) =>
      compileGeneratedJavaScriptWorkflow({
        javascriptSource,
        rawTableId: 'input-1',
        resultTableName: 'output-1',
        requirement: '转换为小数',
        columns: [{ name: 'Value', type: 'decimal' }],
      });

    expect(() => compile(nativeSource(99))).toThrow(/not assignable|scale must be an integer/);
    expect(() => compile(nativeSource(1.5))).toThrow(/not assignable|scale must be an integer/);

    const legacySource = nativeSource(99).replace(
      'expr(row => cast(row["Value"], "decimal", { scale: 99 }))',
      'col("Value").cast("decimal", { scale: 99 })'
    );
    expect(() => compile(legacySource)).toThrow(/Legacy workflow expression API col/);
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
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(inspect(input), RESULT_TABLE_NAME);
}`;
    const replacement = 'function inspect(input) { return input; }';
    const patched = applyWorkflowFunctionPatch(source, 'inspect', replacement);
    expect(patched).toContain(replacement);
    expect(patched).toContain('function main()');
  });

  it('terminates non-terminating generated JavaScript in the sandbox', () => {
    const source = `function spin(input) { while (true) {} }\nfunction main() { const input = workflow.input(RAW_TABLE_ID); return workflow.output(spin(input), RESULT_TABLE_NAME); }`;
    expect(() => buildIr(source)).toThrow(/timeout|timed out|Script execution/i);
  });

  it('does not expose Node globals or dynamic code generation', () => {
    const processSource = `function inspect(input) { process.cwd(); return input; }\nfunction main() { const input = workflow.input(RAW_TABLE_ID); return workflow.output(inspect(input), RESULT_TABLE_NAME); }`;
    expect(() => buildIr(processSource)).toThrow(/process is not defined/);
    const dynamicSource = `function inspect(input) { Function("return 1")(); return input; }\nfunction main() { const input = workflow.input(RAW_TABLE_ID); return workflow.output(inspect(input), RESULT_TABLE_NAME); }`;
    expect(() => buildIr(dynamicSource)).toThrow(/Code generation from strings disallowed/);
  });
});

it('compiles chained and/or conditions from generated expressions', () => {
  const source = `function keepUsableSales(input) {
  return workflow.step(input, "filter", {
    condition: expr(row => (row["Sales"] != null && row["Sales"] !== 0) || row["Profit"] > 0)
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(keepUsableSales(input), RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: '保留 Sales 非空且非零或者 Profit 大于零的数据',
    columns: [
      { name: 'Sales', type: 'decimal' },
      { name: 'Profit', type: 'decimal' },
    ],
  });

  expect(exportGeneratedWorkflowDsl(result)).toContain(
    'filter [Sales] IS NOT NULL AND [Sales] <> 0 OR [Profit] > 0'
  );
});

it('compiles a date difference in days and sorts by the derived field', () => {
  const source = `function addShippingDays(input) {
  return workflow.step(input, "derive", {
    column: "Shipping Days",
    expression: expr(row => dateDiff("day", row["Order Date"], row["Ship Date"]))
  });
}
function sortShippingDays(input) {
  return workflow.step(input, "sort", {
    column: expr(row => row["Shipping Days"]),
    direction: "desc"
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  const derived = addShippingDays(input);
  const sorted = sortShippingDays(derived);
  return workflow.output(sorted, RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: '新增 Shipping Days，计算运输天数并降序排列',
    columns: [
      { name: 'Order Date', type: 'date' },
      { name: 'Ship Date', type: 'date' },
    ],
  });

  expect(exportGeneratedWorkflowDsl(result)).toContain(
    "derive [Shipping Days] = DATE_DIFF('day', [Order Date], [Ship Date])"
  );
  expect(exportGeneratedWorkflowDsl(result)).toContain('sort by [Shipping Days] desc');
  expect(result.expectedOutputSchema).toContainEqual({
    name: 'Shipping Days',
    type: 'integer',
  });
});

it('compiles a conditional text flag with a native conditional expression', () => {
  const source = `function addHighDiscountFlag(input) {
  return workflow.step(input, "derive", {
    column: "High Discount Flag",
    expression: expr(row => row["Discount"] >= 0.08 ? "高折扣" : "普通折扣")
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  const derived = addHighDiscountFlag(input);
  return workflow.output(derived, RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: 'Discount 大于等于 0.08 标记为高折扣，否则标记为普通折扣',
    columns: [{ name: 'Discount', type: 'decimal' }],
  });

  expect(exportGeneratedWorkflowDsl(result)).toContain(
    "derive [High Discount Flag] = if [Discount] >= 0.08 then '高折扣' else '普通折扣' end"
  );
  expect(result.expectedOutputSchema).toContainEqual({
    name: 'High Discount Flag',
    type: 'text',
  });
});

it('rejects a native conditional when the condition is not boolean', () => {
  const source = `function addInvalidFlag(input) {
  return workflow.step(input, "derive", {
    column: "Flag",
    expression: expr(row => row["Discount"] ? "yes" : "no")
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(addInvalidFlag(input), RESULT_TABLE_NAME, { mode: "replace" });
}`;

  expect(() =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
      requirement: '创建标记',
      columns: [{ name: 'Discount', type: 'decimal' }],
    })
  ).toThrow(/ifElse (?:condition|argument 1).*boolean|condition.*boolean/);
});

it('statically lowers native JavaScript row expressions to stable workflow IR', () => {
  const nativeSource = `function addHighDiscountFlag(input) {
  return workflow.step(input, "derive", {
    column: "High Discount Flag",
    expression: expr(row => row["Discount"] >= 0.08 ? "高折扣" : "普通折扣")
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(addHighDiscountFlag(input), RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const nativeResult = compileGeneratedJavaScriptWorkflow({
    javascriptSource: nativeSource,
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: '创建高折扣标记',
    columns: [{ name: 'Discount', type: 'decimal' }],
  });

  expect(exportGeneratedWorkflowDsl(nativeResult)).toContain(
    "derive [High Discount Flag] = if [Discount] >= 0.08 then '高折扣' else '普通折扣' end"
  );
  expect(nativeResult.javascriptSource).toContain('expr(row =>');
  expect(nativeResult.expectedOutputSchema).toContainEqual({
    name: 'High Discount Flag',
    type: 'text',
  });
});

it('accepts native expressions and rejects the legacy expression SDK', () => {
  const nativeSource = `function addMargin(input) {
  return workflow.step(input, "derive", {
    column: "Margin",
    expression: expr(row => row["Sales"] === 0 ? null : round(row["Profit"] / row["Sales"] * 100, 2))
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(addMargin(input), RESULT_TABLE_NAME, { mode: "replace" });
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
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(addMargin(input), RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const columns = [
    { name: 'Sales', type: 'decimal' },
    { name: 'Profit', type: 'decimal' },
  ];
  const nativeCompiled = compileWorkflowJavaScript(nativeSource, { columns });
  expect(nativeCompiled.expressions).toHaveLength(1);
  expect(() => compileWorkflowJavaScript(legacySource, { columns })).toThrow(
    /Legacy workflow expression API fn/
  );
});

it('reports native expression type errors at the original helper location', () => {
  const source = `function addInvalidFlag(input) {
  return workflow.step(input, "derive", {
    column: "Flag",
    expression: expr(row => (row["Discount"] >= 0.08).replace("true", "高折扣"))
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(addInvalidFlag(input), RESULT_TABLE_NAME, { mode: "replace" });
}`;

  try {
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
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
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(addValue(input), RESULT_TABLE_NAME, { mode: "replace" });
}`;

  expect(() =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
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
  return workflow.step(input, "sort", { column: expr(row => row["Shipping Days"]), direction: "desc" });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  const derived = addShippingDays(input);
  return workflow.output(sortShippingDays(derived), RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: '计算运输天数并降序',
    columns: [
      { name: 'Order Date', type: 'date' },
      { name: 'Ship Date', type: 'date' },
    ],
  });

  expect(exportGeneratedWorkflowDsl(result)).toContain(
    "if [Order Date] IS NULL OR [Ship Date] IS NULL then NULL else CAST(DATE_DIFF('day', [Order Date], [Ship Date]) AS INTEGER) end"
  );
  expect(exportGeneratedWorkflowDsl(result)).toContain('sort by [Shipping Days] desc');
});

it('keeps authoring JavaScript separate from executable source and expression sidecars', () => {
  const source = `function addValue(input) {
  return workflow.step(input, "derive", {
    column: "Value",
    expression: expr(row => row["Sales"] * 2)
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(addValue(input), RESULT_TABLE_NAME, { mode: "replace" });
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
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(addValue(input), RESULT_TABLE_NAME);
}`;
  expect(() => compileWorkflowJavaScript(forged)).toThrow(/reserved for the workflow compiler/);
});

it('provides actionable repair guidance for statement-bodied expr callbacks', () => {
  const source = `function addProfitRate(input) {
  return workflow.step(input, "derive", {
    column: "利润率",
    expression: expr(row => {
      const sales = row["Sales"];
      return sales === 0 ? 0 : row["Profit"] / sales;
    })
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(addProfitRate(input), RESULT_TABLE_NAME);
}`;

  try {
    compileWorkflowJavaScript(source, {
      columns: [
        { name: 'Sales', type: 'decimal' },
        { name: 'Profit', type: 'decimal' },
      ],
    });
    expect.fail('Expected the statement-bodied expr callback to be rejected');
  } catch (error) {
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: {
        diagnostics: [
          expect.objectContaining({
            code: 'NATIVE_EXPRESSION_BODY_UNSUPPORTED',
            functionName: 'addProfitRate',
            expectedSignature: 'expr(row => expression)',
            repairHint: expect.stringContaining('nested condition ? whenTrue : whenFalse'),
          }),
        ],
      },
    });
  }
});

it('rejects async callbacks and local bindings that shadow the native expression SDK', () => {
  const asyncSource = `function addValue(input) {
  return workflow.step(input, "derive", {
    column: "Value",
    expression: expr(async row => row["Sales"] * 2)
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(addValue(input), RESULT_TABLE_NAME);
}`;
  expect(() =>
    compileWorkflowJavaScript(asyncSource, {
      columns: [{ name: 'Sales', type: 'decimal' }],
    })
  ).toThrow(/synchronous and non-generator/);

  const shadowedSource = `function inspect(expr) { return expr(() => 1); }
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(inspect(input), RESULT_TABLE_NAME);
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
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(addValue(input), RESULT_TABLE_NAME);
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
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(addValue(input), RESULT_TABLE_NAME);
}`;
  expect(() => buildIr(source)).toThrow(/kind/);
});

it('keeps sandbox SDK functions in the VM realm', () => {
  const source = `function inspect(input) {
  workflow.step.constructor("return process")();
  return input;
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(inspect(input), RESULT_TABLE_NAME);
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
  const input = workflow.input(RAW_TABLE_ID);
  return poison(input);
}`;

  expect(() => buildIr(source)).toThrow(/workflow\.output\(\) exactly once/);
});

it.each([
  {
    contract: 'a missing input call',
    source: `function main() {
  return {};
}`,
    expected: /workflow\.input\(\) exactly once/,
  },
  {
    contract: 'a duplicate input call',
    source: `function main() {
  const first = workflow.input(RAW_TABLE_ID);
  const second = workflow.input(RAW_TABLE_ID);
  return workflow.output(second, RESULT_TABLE_NAME);
}`,
    expected: /workflow\.input\(\) exactly once/,
  },
  {
    contract: 'a duplicate output call',
    source: `function main() {
  const input = workflow.input(RAW_TABLE_ID);
  workflow.output(input, RESULT_TABLE_NAME);
  return workflow.output(input, RESULT_TABLE_NAME);
}`,
    expected: /workflow\.output\(\) exactly once/,
  },
  {
    contract: 'a main result other than the output return object',
    source: `function main() {
  const input = workflow.input(RAW_TABLE_ID);
  const output = workflow.output(input, RESULT_TABLE_NAME);
  return input;
}`,
    expected: /main\(\) must return the object returned by workflow\.output\(\)/,
  },
  {
    contract: 'an invented input binding',
    source: `function main() {
  const input = workflow.input("invented-input");
  return workflow.output(input, RESULT_TABLE_NAME);
}`,
    expected: /bind workflow\.input\(\) to RAW_TABLE_ID/,
  },
  {
    contract: 'an invented output binding',
    source: `function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(input, "invented-output");
}`,
    expected: /bind workflow\.output\(\) to RESULT_TABLE_NAME/,
  },
])('rejects $contract', ({ source, expected }) => {
  expect(() => buildIr(source)).toThrow(expected);
});

it('prevents operation payloads from overriding IR-owned fields', () => {
  const source = `function removeValue(input) {
  return workflow.step(input, "drop", { columns: ["Value"], type: "derive" });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(removeValue(input), RESULT_TABLE_NAME);
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
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  const gross = addGross(input);
  const adjusted = addAdjusted(gross);
  return workflow.output(adjusted, RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: '连续派生字段',
    columns: [{ name: 'Sales', type: 'decimal' }],
  });

  expect(exportGeneratedWorkflowDsl(result)).toContain('derive [Gross] = [Sales] * 2');
  expect(exportGeneratedWorkflowDsl(result)).toContain('derive [Adjusted] = [Gross] * 0.9');
});

it('allows one helper to compose multiple sequential named workflow operations', () => {
  const source = `function prepareSales(input) {
  const sorted = workflow.step(input, "sort", {
    column: expr(row => row["Sales"]),
    direction: "desc"
  });
  const cleaned = workflow.step(sorted, "drop", { columns: ["Row ID"] });
  return cleaned;
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  const prepared = prepareSales(input);
  return workflow.output(prepared, RESULT_TABLE_NAME);
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: '按销售额降序并删除 Row ID',
    columns: [
      { name: 'Sales', type: 'decimal' },
      { name: 'Row ID', type: 'integer' },
    ],
  });

  expect(result.workflowIr?.operations).toHaveLength(2);
  expect(result.workflowIr?.provenance.map((item) => item.source.functionName)).toEqual([
    'prepareSales',
    'prepareSales',
  ]);
  expect(exportGeneratedWorkflowDsl(result)).toContain('sort by [Sales] desc');
  expect(exportGeneratedWorkflowDsl(result)).toContain('drop [Row ID]');
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
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(addYear(addLabel(input)), RESULT_TABLE_NAME);
}`;

  expect(() =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
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
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(addRounded(input), RESULT_TABLE_NAME);
}`;

  expect(() =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
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
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  const renamed = renameSales(input);
  const derived = addDoubleRevenue(renamed);
  return workflow.output(derived, RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: '重命名后派生字段',
    columns: [{ name: 'Sales', type: 'decimal' }],
  });

  expect(exportGeneratedWorkflowDsl(result)).toContain('map [Sales] to [Revenue]');
  expect(exportGeneratedWorkflowDsl(result)).toContain('derive [Double Revenue] = [Revenue] * 2');
});

it('patches a helper even when its original native expression cannot be lowered', () => {
  const failed = `function addFlag(input) {
  return workflow.step(input, "derive", {
    column: "Flag",
    expression: expr(row => (row["Discount"] >= 0.08).replace("true", "高折扣"))
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(addFlag(input), RESULT_TABLE_NAME, { mode: "replace" });
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
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: '折扣标记',
    columns: [{ name: 'Discount', type: 'decimal' }],
  });

  expect(patched.slice(patched.indexOf('function main()'))).toBe(
    failed.slice(failed.indexOf('function main()'))
  );
  expect(exportGeneratedWorkflowDsl(result)).toContain(
    "if [Discount] >= 0.08 then '高折扣' else '普通折扣' end"
  );
});

it('accepts native contains and rejects the legacy contains chain', () => {
  const native = `function keepChairs(input) {
  return workflow.step(input, "filter", {
    condition: expr(row => contains(row["Product Name"], "Chair"))
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(keepChairs(input), RESULT_TABLE_NAME);
}`;
  const legacy = native.replace(
    'expr(row => contains(row["Product Name"], "Chair"))',
    'col("Product Name").contains(lit("Chair"))'
  );
  const columns = [{ name: 'Product Name', type: 'text' }];
  const nativeCompiled = compileWorkflowJavaScript(native, { columns });
  expect(nativeCompiled.expressions[0]?.ir).toMatchObject({
    kind: 'binary',
    op: 'contains',
  });
  expect(() => compileWorkflowJavaScript(legacy, { columns })).toThrow(
    /Legacy workflow expression API col/
  );
});

it('materializes a root boolean function used directly as a filter predicate', () => {
  const source = `function keepMatchingCodes(input) {
  return workflow.step(input, "filter", {
    condition: expr(row => regexpMatches(row["Code"], "^[A-Z]+-[0-9]+$"))
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(keepMatchingCodes(input), RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: '只保留编码格式正确的记录',
    columns: [{ name: 'Code', type: 'text' }],
  });
  const dsl = exportGeneratedWorkflowDsl(result);

  expect(dsl).toContain(
    "derive [__sophron_ai_filter_predicate] = REGEXP_MATCHES([Code], '^[A-Z]+-[0-9]+$')"
  );
  expect(dsl).toContain('filter [__sophron_ai_filter_predicate] = true');
  expect(dsl).toContain('drop [__sophron_ai_filter_predicate]');
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
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  const derived = addAmount(input);
  const filtered = keepRecent(derived);
  return workflow.output(filtered, RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const compile = (javascriptSource: string) =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
      requirement: '转换金额并过滤日期',
      columns: [
        { name: 'Raw', type: 'text' },
        { name: 'Created At', type: 'timestamp' },
      ],
    });
  const result = compile(source);
  const canonicalAlias = compile(source.replace('"timestamp"', '"datetime"'));

  expect(exportGeneratedWorkflowDsl(result)).toContain('CAST([Raw] AS DECIMAL(18,2)) * 2');
  expect(exportGeneratedWorkflowDsl(result)).toContain(
    "derive [__sophron_ai_filter_predicate] = [Created At] >= CAST('2020-01-01 00:00:00' AS DATETIME)"
  );
  expect(exportGeneratedWorkflowDsl(result)).toContain(
    'filter [__sophron_ai_filter_predicate] = true'
  );
  expect(exportGeneratedWorkflowDsl(result)).toContain('drop [__sophron_ai_filter_predicate]');
  expect(result.workflowIr?.operations[1]).toMatchObject({
    type: 'filter',
    condition: {
      right: { kind: 'cast', targetType: 'datetime' },
    },
  });
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
  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });
  return workflow.output(addElapsedHours(input), RESULT_TABLE_NAME, { mode: "replace" });
}`;
  const result = compileGeneratedJavaScriptWorkflow({
    javascriptSource: source,
    rawTableId: 'input-1',
    resultTableName: 'output-1',
    requirement: '计算相差小时数',
    columns: [
      { name: 'Started At', type: 'timestamp' },
      { name: 'Finished At', type: 'datetime' },
    ],
  });

  expect(exportGeneratedWorkflowDsl(result)).toContain(
    "derive [Elapsed Hours] = DATE_DIFF('hour', [Started At], [Finished At])"
  );
});

it('rejects a generated percent limit whose offset would be discarded by the platform schema', () => {
  const source = `function takePercent(input) {
  return workflow.step(input, "limit", {
    config: { mode: "limit", limit: 25, unit: "percent", offset: 5, orderBy: [] }
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(takePercent(input), RESULT_TABLE_NAME);
}`;

  expect(() => compileWorkflowJavaScript(source, { columns: [] })).toThrow(
    /not assignable|No overload matches|offset/
  );
  expect(
    validateGeneratedOperatorConfig('limit', {
      mode: 'fixed',
      limit: 25,
      unit: 'percent',
      offset: 5,
      orderBy: [],
      ties: false,
    })
  ).toEqual([
    expect.objectContaining({
      severity: 'error',
      params: expect.objectContaining({ path: 'offset' }),
      message: expect.stringContaining('not canonical'),
    }),
  ]);
});

it('rejects an IR operation type that was not approved by requirement analysis', () => {
  expect(() =>
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: SOURCE,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
      requirement: '删除记录数',
      columns: [{ name: '记录数', type: 'integer' }],
      requirementContract: {
        capabilityIds: ['filter.boolean_predicate'],
      },
    })
  ).toThrow(/does not match the confirmed requirement-analysis capability contract/);
});

it('rejects a generated operation variant that differs from the analyzed capability', () => {
  const source = `function deduplicate(input) {
  return workflow.step(input, "deduplicate", {
    config: { columns: ["id"], keep: "last", orderBy: [] }
  });
}
function main() {
  const input = workflow.input(RAW_TABLE_ID);
  return workflow.output(deduplicate(input), RESULT_TABLE_NAME);
}`;

  try {
    compileGeneratedJavaScriptWorkflow({
      javascriptSource: source,
      rawTableId: 'input-1',
      resultTableName: 'output-1',
      requirement: '按 id 去重并保留第一条',
      columns: [{ name: 'id', type: 'integer' }],
      requirementContract: {
        capabilityIds: ['deduplicate.keep_first'],
      },
    });
    throw new Error('expected capability mismatch to fail');
  } catch (error) {
    const diagnostics = (error as { details?: { diagnostics?: Array<Record<string, unknown>> } })
      .details?.diagnostics;
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ANALYSIS_CAPABILITY_MISMATCH',
          operationType: 'deduplicate',
          repairClass: 'full_regeneration',
        }),
      ])
    );
  }
});
