import { describe, expect, it } from 'vitest';
import {
  applyWorkflowFunctionPatch,
  compileWorkflowJavaScript,
  executeWorkflowJavaScriptInSandbox,
  WORKFLOW_SDK_RUNTIME_SOURCE,
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
  it('derives the prompt and runtime operation allowlist from one operation registry', () => {
    const prompt = getWorkflowJavascriptCapabilityPrompt();
    for (const definition of WORKFLOW_OPERATION_REGISTRY) {
      expect(prompt).toContain(definition.promptSignature);
      expect(WORKFLOW_SDK_RUNTIME_SOURCE).toContain(definition.irType);
    }
    expect(WORKFLOW_SDK_RUNTIME_SOURCE).toContain('step: (input, type, fields)');
    expect(WORKFLOW_SDK_RUNTIME_SOURCE).not.toContain('sdk.drop =');
    expect(prompt).toContain('strategy: "drop_empty_rows"');
    expect(prompt).toContain('strategy: "by_column"');
    expect(prompt).toContain('method: "skip|drop|nullify_values|literal_fill"');
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
      sdkVersion: '2.0.0',
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
