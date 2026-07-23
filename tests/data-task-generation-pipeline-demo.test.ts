import { describe, expect, it } from 'vitest';
import {
  compileWorkflowJavaScript,
  executeWorkflowJavaScriptInSandbox,
} from '../src/main/data/workflow/javascript-runtime';
import {
  exportWorkflowOperationsToPrepDsl,
  lowerWorkflowIrToOperations,
} from '../src/main/data/workflow/operation-compiler';
import { computeWorkflowIrSemanticHash } from '../src/main/data/workflow/workflow-ir';

const INPUT_TABLE_ID = 'sales-input-demo';
const OUTPUT_TABLE_NAME = 'profitable-sales-demo';
const REQUIREMENT = '筛选 Profit > 0 的记录，只保留 OrderID、Region、Profit 字段';

// 模拟 LLM 在配置期返回的标准 JavaScript。每个 helper 只创建一个 operation，
// main() 只负责串联输入、处理步骤和输出。
const GENERATED_JAVASCRIPT = `function keepProfitableRows(input) {
  return workflow.step(input, "filter", {
    condition: col("Profit").gt(0)
  });
}

function selectOutputColumns(input) {
  return workflow.step(input, "select", {
    columns: ["OrderID", "Region", "Profit"]
  });
}

function main() {
  const source = workflow.input(INPUT_TABLE_ID, { alias: "sales" });
  const profitable = keepProfitableRows(source);
  const selected = selectOutputColumns(profitable);
  return workflow.output(selected, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;

function logLayer(title: string, value: unknown): void {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  console.log(`\n========== ${title} ==========\n${rendered}`);
}

describe('数据任务生成分层日志示例', () => {
  it('记录 JavaScript、两次 IR、Operations JSON 和最终 Prep DSL', () => {
    logLayer('0. 用户处理要求', REQUIREMENT);
    logLayer('1. 模拟 LLM 生成的 JavaScript', GENERATED_JAVASCRIPT);

    const compiled = compileWorkflowJavaScript(GENERATED_JAVASCRIPT);
    logLayer('2. V8 编译结果', {
      success: true,
      filename: 'generated-workflow.js',
      functions: compiled.functions,
    });

    const firstIr = executeWorkflowJavaScriptInSandbox({
      compiled,
      inputTableId: INPUT_TABLE_ID,
      outputTableName: OUTPUT_TABLE_NAME,
    });
    const secondIr = executeWorkflowJavaScriptInSandbox({
      compiled,
      inputTableId: INPUT_TABLE_ID,
      outputTableName: OUTPUT_TABLE_NAME,
    });
    const firstHash = computeWorkflowIrSemanticHash(firstIr);
    const secondHash = computeWorkflowIrSemanticHash(secondIr);

    logLayer('3. 第一次沙箱执行生成的 Stable Workflow IR', firstIr);
    logLayer('4. 第二次 IR 与确定性校验', {
      semanticHash1: firstHash,
      semanticHash2: secondHash,
      deterministic: firstHash === secondHash,
      ir: secondIr,
    });

    const operationsJson = lowerWorkflowIrToOperations({
      ir: firstIr,
      inputTableId: INPUT_TABLE_ID,
      outputTableName: OUTPUT_TABLE_NAME,
    });
    logLayer('5. Lowering 后的 Operations JSON 1.0', operationsJson);

    const generated = exportWorkflowOperationsToPrepDsl({
      workflow: operationsJson,
      sourceIr: firstIr,
      requirement: REQUIREMENT,
      columns: [
        { name: 'OrderID', type: 'text' },
        { name: 'Region', type: 'text' },
        { name: 'Profit', type: 'decimal' },
        { name: 'RecordCount', type: 'integer' },
      ],
    });
    logLayer('6. 最终 Prep DSL', generated.workflowDsl);
    logLayer('7. 随 DSL 一并生成的契约信息', {
      requiredColumns: generated.requiredColumns,
      expectedOutputSchema: generated.expectedOutputSchema,
      lineage: generated.lineage,
      operationOrigins: generated.operationOrigins,
    });

    expect(firstHash).toBe(secondHash);
    expect(operationsJson.operations).toHaveLength(2);
    expect(generated.workflowDsl).toContain('filter [Profit] > 0');
    expect(generated.workflowDsl).toContain('select [OrderID], [Region], [Profit]');
    expect(generated.workflowDsl).toContain(`output table "${OUTPUT_TABLE_NAME}" mode replace`);
  });
});
