import os from 'node:os';
import path from 'node:path';
import Store from 'electron-store';
import { describe, expect, it } from 'vitest';
import type { AgentRuntimeConfig } from '../src/renderer/types';
import { generateDataTaskWorkflowFromRequirement } from '../src/main/data/workflow/workflow-generator';
import { compileLoweredWorkflowToPlatformNodes } from '../src/main/data/workflow/workflow-node-compiler';
import { exportPrepWorkflowDsl } from '../src/shared/prep-dsl';

type GenerationScenario = {
  name: string;
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
};

const FILTER_SCENARIO: GenerationScenario = {
  name: '筛选、选择与排序',
  inputTableId: 'sales-input-real-llm-demo',
  outputTableName: 'profitable-sales-by-region',
  requirement:
    '筛选 Profit 大于 0 的记录，只保留 OrderID、Region、Profit 三个字段，然后按 Profit 从高到低排序。',
  columns: [
    { name: 'OrderID', type: 'text' },
    { name: 'Region', type: 'text' },
    { name: 'Profit', type: 'decimal' },
    { name: 'RecordCount', type: 'integer' },
  ],
};

const CALCULATED_FIELD_SCENARIO: GenerationScenario = {
  name: '计算销售额字段',
  inputTableId: 'order-lines-real-llm-demo',
  outputTableName: 'order-sales-amount-demo',
  requirement:
    '新增字段 SalesAmount，计算公式为 Quantity 乘以 UnitPrice；然后只保留 OrderID、Region、Quantity、UnitPrice、SalesAmount，并按 SalesAmount 从高到低排序。',
  columns: [
    { name: 'OrderID', type: 'text' },
    { name: 'Region', type: 'text' },
    { name: 'Quantity', type: 'integer' },
    { name: 'UnitPrice', type: 'decimal' },
    { name: 'Remark', type: 'text' },
  ],
};

type StoredProfile = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  contextWindow?: number;
  maxTokens?: number;
};

type StoredConfigSet = {
  id: string;
  provider: AgentRuntimeConfig['provider'];
  customProtocol?: AgentRuntimeConfig['customProtocol'];
  activeProfileKey: string;
  profiles?: Record<string, StoredProfile>;
  enableThinking?: boolean;
  thinkingLevel?: AgentRuntimeConfig['thinkingLevel'];
};

type StoredConfig = {
  activeConfigSetId?: string;
  configSets?: StoredConfigSet[];
};

function logLayer(title: string, value: unknown): void {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  console.log(`\n========== ${title} ==========\n${rendered}`);
}

function loadActiveRuntimeConfig(): AgentRuntimeConfig {
  const configDir = path.join(os.homedir(), 'Library', 'Application Support', 'sophron');
  const store = new Store<StoredConfig>({
    cwd: configDir,
    name: 'config',
    encryptionKey: 'sophron-config-stable-v1',
  });
  const saved = store.store;
  const configSet = saved.configSets?.find((item) => item.id === saved.activeConfigSetId);
  if (!configSet) throw new Error('没有找到应用当前启用的模型配置');
  const profile = configSet.profiles?.[configSet.activeProfileKey];
  if (!profile?.model) throw new Error('当前模型配置没有 model');
  if (configSet.provider !== 'ollama' && !profile.apiKey) {
    throw new Error('当前模型配置没有 API Key');
  }
  return {
    provider: configSet.provider,
    customProtocol: configSet.customProtocol,
    apiKey: profile.apiKey ?? '',
    baseUrl: profile.baseUrl,
    model: profile.model,
    contextWindow: profile.contextWindow,
    maxTokens: profile.maxTokens,
    enableThinking: configSet.enableThinking ?? false,
    thinkingLevel: configSet.thinkingLevel ?? 'medium',
  };
}

async function runRealLlmDataTaskGenerationDemo(scenario: GenerationScenario) {
  const runtimeConfig = loadActiveRuntimeConfig();
  logLayer(`0. 场景：${scenario.name}；真实模型配置（已脱敏）`, {
    provider: runtimeConfig.provider,
    customProtocol: runtimeConfig.customProtocol,
    model: runtimeConfig.model,
    baseUrlConfigured: Boolean(runtimeConfig.baseUrl),
    apiKeyConfigured: Boolean(runtimeConfig.apiKey),
  });
  logLayer('1. 用户处理要求', scenario.requirement);
  logLayer('2. 输入字段快照', scenario.columns);

  const startedAt = Date.now();
  const generated = await generateDataTaskWorkflowFromRequirement({
    inputTableId: scenario.inputTableId,
    outputTableName: scenario.outputTableName,
    requirement: scenario.requirement,
    columns: scenario.columns,
    runtimeConfig,
  });

  logLayer('3. LLM 实际生成的 JavaScript', generated.javascriptSource);
  logLayer('4. 沙箱生成的 Stable Workflow IR', generated.workflowIr);
  logLayer('5. IR Semantic Hash', generated.workflowIrSemanticHash);

  const nodePlan = compileLoweredWorkflowToPlatformNodes({
    semantics: generated,
    bindings: {
      inputTableId: scenario.inputTableId,
      outputTableName: scenario.outputTableName,
    },
  });
  const compatibilityDsl = exportPrepWorkflowDsl(nodePlan.nodes, nodePlan.edges);
  logLayer('6. IR 直接编译的平台节点与边', nodePlan);
  logLayer('7. 由平台节点导出的兼容/审计用 Prep DSL', compatibilityDsl);
  logLayer('8. 输出契约与血缘', {
    requiredColumns: generated.requiredColumns,
    expectedOutputSchema: generated.expectedOutputSchema,
    lineage: generated.lineage,
    operationOrigins: generated.operationOrigins,
  });
  logLayer('9. 调用摘要', {
    success: true,
    elapsedMs: Date.now() - startedAt,
    provider: runtimeConfig.provider,
    model: runtimeConfig.model,
  });
  return { generated, compatibilityDsl };
}

const describeRealLlm = process.env.RUN_REAL_LLM_DEMO === '1' ? describe : describe.skip;

describeRealLlm('真实 LLM 数据任务生成示例', () => {
  it('调用应用当前模型并打印 JavaScript、IR、平台节点和 Prep DSL', async () => {
    const result = await runRealLlmDataTaskGenerationDemo(FILTER_SCENARIO);
    expect(result.compatibilityDsl).toContain('filter [Profit] > 0');
    expect(result.compatibilityDsl).toContain('sort by [Profit] desc');
  }, 120_000);

  it('调用真实模型生成包含计算字段的工作流并打印每一层结果', async () => {
    const result = await runRealLlmDataTaskGenerationDemo(CALCULATED_FIELD_SCENARIO);
    expect(result.compatibilityDsl).toContain('derive [SalesAmount] = [Quantity] * [UnitPrice]');
    expect(result.compatibilityDsl).toContain('sort by [SalesAmount] desc');
    expect(result.generated.expectedOutputSchema).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'SalesAmount', type: 'decimal' })])
    );
  }, 120_000);
});
