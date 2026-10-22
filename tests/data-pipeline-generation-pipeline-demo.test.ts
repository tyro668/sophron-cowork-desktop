import { describe, expect, it } from 'vitest';
import {
  compileWorkflowJavaScript,
  executeWorkflowJavaScriptInSandbox,
} from '../src/main/data/workflow/javascript-runtime';
import { exportPrepWorkflowDsl } from '../src/shared/prep-dsl';
import { lowerGeneratedWorkflowIrSemantics } from '../src/main/data/workflow/workflow-ir-lowerer';
import { compileLoweredWorkflowToPlatformNodes } from '../src/main/data/workflow/workflow-node-compiler';
import { computeWorkflowIrSemanticHash } from '../src/main/data/workflow/workflow-ir';

const RAW_TABLE_ID = 'sales-input-demo';
const RESULT_TABLE_NAME = 'profitable-sales-demo';
const REQUIREMENT = '筛选 Profit > 0 的记录，只保留 OrderID、Region、Profit 字段';

// 模拟 LLM 在配置期返回的标准 JavaScript。helper 负责线性处理，main() 负责输入和输出。
const GENERATED_JAVASCRIPT = `function keepProfitableRows(input) {
  return workflow.step(input, "filter", {
    condition: expr(row => row["Profit"] > 0)
  });
}

function selectOutputColumns(input) {
  return workflow.step(input, "select", {
    fields: ["OrderID", "Region", "Profit"]
  });
}

function main() {
  const source = workflow.input(RAW_TABLE_ID, { alias: "sales" });
  const profitable = keepProfitableRows(source);
  const selected = selectOutputColumns(profitable);
  return workflow.output(selected, RESULT_TABLE_NAME, { mode: "replace" });
}`;

function logLayer(title: string, value: unknown): void {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  console.log(`\n========== ${title} ==========\n${rendered}`);
}

describe('数据任务生成分层日志示例', () => {
  it('记录 JavaScript、两次 IR、平台节点和兼容 Prep DSL', () => {
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
      rawTableId: RAW_TABLE_ID,
      resultTableName: RESULT_TABLE_NAME,
    });
    const secondIr = executeWorkflowJavaScriptInSandbox({
      compiled,
      rawTableId: RAW_TABLE_ID,
      resultTableName: RESULT_TABLE_NAME,
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

    const semantics = lowerGeneratedWorkflowIrSemantics({
      ir: firstIr,
      requirement: REQUIREMENT,
      columns: [
        { name: 'OrderID', type: 'text' },
        { name: 'Region', type: 'text' },
        { name: 'Profit', type: 'decimal' },
        { name: 'RecordCount', type: 'integer' },
      ],
    });
    const nodePlan = compileLoweredWorkflowToPlatformNodes({
      semantics,
      bindings: {
        rawTableId: RAW_TABLE_ID,
        resultTableName: RESULT_TABLE_NAME,
        outputPhysicalTableName: 'demo_output_physical',
      },
    });
    logLayer('5. IR 直接编译的平台节点与边', {
      nodes: nodePlan.nodes,
      edges: nodePlan.edges,
    });

    const compatibilityDsl = exportPrepWorkflowDsl(nodePlan.nodes, nodePlan.edges);
    logLayer('6. 由节点导出的兼容 Prep DSL', compatibilityDsl);
    logLayer('7. 节点编译同时生成的契约信息', {
      requiredColumns: nodePlan.requiredColumns,
      expectedOutputSchema: nodePlan.expectedOutputSchema,
      lineage: nodePlan.lineage,
      operationOrigins: nodePlan.operationNodeOrigins,
    });

    expect(firstHash).toBe(secondHash);
    expect(nodePlan.nodes.filter((node) => !['input', 'output'].includes(node.type))).toHaveLength(
      2
    );
    expect(compatibilityDsl).toContain('filter [Profit] > 0');
    expect(compatibilityDsl).toContain('select [OrderID], [Region], [Profit]');
    expect(compatibilityDsl).toContain(`output table "${RESULT_TABLE_NAME}" mode replace`);
  });
});
