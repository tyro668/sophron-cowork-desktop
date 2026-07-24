import { beforeEach, describe, expect, it, vi } from 'vitest';

const runPiAiOneShotMock = vi.hoisted(() => vi.fn());

vi.mock('../../main/claude/claude-sdk-one-shot', () => ({
  runPiAiOneShot: runPiAiOneShotMock,
}));

import type { AgentRuntimeConfig } from '../../renderer/types';
import { analyzeDataTaskRequirement } from '../../main/data/workflow/requirement-analyzer';

const runtimeConfig = { model: 'test-model' } as AgentRuntimeConfig;

describe('analyzeDataTaskRequirement', () => {
  beforeEach(() => {
    runPiAiOneShotMock.mockReset();
  });

  it('returns supported when every requirement is supported', async () => {
    runPiAiOneShotMock.mockResolvedValue({
      text: JSON.stringify({
        items: [
          {
            requirement: '删除记录数字段',
            status: 'supported',
            operations: ['drop'],
          },
        ],
      }),
    });

    await expect(
      analyzeDataTaskRequirement({
        requirement: '删除记录数字段',
        columns: [{ name: '记录数' }],
        runtimeConfig,
      })
    ).resolves.toMatchObject({ status: 'supported' });
  });

  it('requires confirmation when supported and unsupported requirements are mixed', async () => {
    runPiAiOneShotMock.mockResolvedValue({
      text: JSON.stringify({
        items: [
          {
            requirement: '删除记录数字段',
            status: 'supported',
            operations: ['drop'],
          },
          {
            requirement: '把地址转换为经纬度',
            status: 'unsupported',
            reason: '当前不支持地理编码',
            operations: [],
          },
        ],
      }),
    });

    await expect(
      analyzeDataTaskRequirement({
        requirement: '删除记录数字段，把地址转换为经纬度',
        columns: [{ name: '记录数' }, { name: '地址' }],
        runtimeConfig,
      })
    ).resolves.toMatchObject({
      status: 'needs_confirmation',
      items: [{ status: 'supported' }, { status: 'unsupported' }],
    });
  });

  it('rejects an invalid or empty analysis result', async () => {
    runPiAiOneShotMock.mockResolvedValue({ text: '{"items":[]}' });

    await expect(
      analyzeDataTaskRequirement({
        requirement: '预测销售额',
        columns: [{ name: '销售额' }],
        runtimeConfig,
      })
    ).rejects.toThrow('did not return any requirement items');
  });
});
