import { describe, expect, it } from 'vitest';
import {
  compileWorkflowJavaScript,
  executeWorkflowJavaScriptInSandbox,
} from '../src/main/data/workflow/javascript-runtime';
import { compileGeneratedJavaScriptWorkflow } from '../src/main/data/workflow/workflow-generation-pipeline';
import {
  canonicalizeWorkflowIr,
  computeWorkflowIrSemanticHash,
} from '../src/main/data/workflow/workflow-ir';
import { lowerWorkflowIrToOperations } from '../src/main/data/workflow/workflow-lowering';
import { applyWorkflowFunctionPatch } from '../src/main/data/workflow/javascript-runtime';

const SOURCE = `function removeCount(input) {
  return drop(input, "记录数");
}
function main() {
  const input = inputDataset(INPUT_TABLE_ID, "src");
  const cleaned = removeCount(input);
  return outputTable(cleaned, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;

function buildIr(source = SOURCE) {
  return executeWorkflowJavaScriptInSandbox({
    compiled: compileWorkflowJavaScript(source),
    inputTableId: 'input-1',
    outputTableName: 'output-1',
  });
}

describe('JavaScript Workflow SDK pipeline', () => {
  it('uses V8 to compile standard JavaScript and the sandbox SDK to build stable IR', () => {
    const ir = buildIr();
    expect(ir).toMatchObject({
      irVersion: '1.0',
      kind: 'workflow',
      sourceLanguage: 'javascript',
      sdkVersion: '1.0.0',
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

  it('applies a function-scoped repair patch without rewriting main', () => {
    const patched = applyWorkflowFunctionPatch(
      SOURCE,
      'removeCount',
      'function removeCount(input) { return drop(input, "旧字段"); }'
    );
    expect(patched).toContain('drop(input, "旧字段")');
    expect(patched).toContain('function main()');
  });

  it('terminates non-terminating generated JavaScript in the sandbox', () => {
    const source = `function spin(input) { while (true) {} }\nfunction main() { const input = inputDataset(INPUT_TABLE_ID, "src"); return outputTable(spin(input), OUTPUT_TABLE_NAME); }`;
    expect(() => buildIr(source)).toThrow(/timeout|timed out|Script execution/i);
  });

  it('does not expose Node globals or dynamic code generation', () => {
    const processSource = `function inspect(input) { process.cwd(); return input; }\nfunction main() { const input = inputDataset(INPUT_TABLE_ID, "src"); return outputTable(inspect(input), OUTPUT_TABLE_NAME); }`;
    expect(() => buildIr(processSource)).toThrow(/process is not defined/);
    const dynamicSource = `function inspect(input) { Function("return 1")(); return input; }\nfunction main() { const input = inputDataset(INPUT_TABLE_ID, "src"); return outputTable(inspect(input), OUTPUT_TABLE_NAME); }`;
    expect(() => buildIr(dynamicSource)).toThrow(/Code generation from strings disallowed/);
  });
});
