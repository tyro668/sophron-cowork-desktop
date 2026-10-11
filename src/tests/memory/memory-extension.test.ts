import { describe, expect, it, vi } from 'vitest';
import type { Session, Message } from '../../shared/contracts';
import { MemoryExtension } from '../../main/memory/memory-extension';
import type { MemoryService } from '../../main/memory/memory-service';
import { AgentRuntimeExtensionManager } from '../../main/extensions/agent-runtime-extension-manager';

vi.mock('../../main/utils/logger', () => ({ logWarn: vi.fn(), logError: vi.fn() }));

const session: Session = {
  id: 'memory-session',
  title: 'Memory regression',
  status: 'idle',
  cwd: '/tmp/workspace',
  memoryEnabled: true,
  mountedPaths: [],
  allowedTools: [],
  createdAt: 1,
  updatedAt: 1,
};
const note =
  'type:experience\nname:报告要求\ncontent:使用真实坐标轴，按有效天数比较\nsource:本轮会话';
const messages: Message[] = [
  {
    id: 'request',
    sessionId: session.id,
    role: 'user',
    timestamp: 1,
    content: [{ type: 'text', text: '记住报告需要真实坐标轴，并按有效天数比较。' }],
  },
];

function setup(enabled = true) {
  const service = {
    isEnabled: vi.fn(() => enabled),
    buildPromptPrefix: vi.fn(async () => ''),
    enqueueIngestion: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
  };
  const extension = new MemoryExtension(service as unknown as MemoryService);
  const manager = new AgentRuntimeExtensionManager([extension]);
  return { service, extension, manager };
}

describe('automatic memory runtime compatibility', () => {
  it.each([true, false])(
    'registers legacy calls with empty retrieved memory (cold start: %s)',
    async (isColdStart) => {
      const { manager, service } = setup();
      const result = await manager.beforeSessionRun({
        session,
        prompt: '继续',
        existingMessages: messages,
        isColdStart,
      });
      expect(result.stablePrompt).toContain('Memory is enabled');
      expect(result.stablePrompt).toContain('Do not invent memory_search');
      expect(result.activateTools).toContain('memory_update');
      expect(result.customTools?.map((tool) => tool.name)).toEqual(['memory_update']);
      const tool = result.customTools!.find((tool) => tool.name === 'memory_update')!;
      const response = await tool.execute(
        'legacy-call',
        { content: note },
        undefined,
        undefined,
        {} as never
      );
      expect(response.details).toEqual({ status: 'managed_automatically', saved: false });
      expect(response.content).toEqual([
        expect.objectContaining({ text: expect.stringContaining('No memory was written') }),
      ]);
      expect(service.enqueueIngestion).not.toHaveBeenCalled();
      // Only the normal end-of-turn hook queues the real conversation, once.
      await manager.afterSessionRun({ session, prompt: '继续', messages });
      expect(service.enqueueIngestion).toHaveBeenCalledExactlyOnceWith({
        session,
        prompt: '继续',
        messages,
      });
    }
  );

  it.each([
    [false, true],
    [true, false],
  ])('respects global=%s and session=%s memory toggles', async (globalEnabled, sessionEnabled) => {
    const { manager, service } = setup(globalEnabled);
    const disabledSession = { ...session, memoryEnabled: sessionEnabled };
    const result = await manager.beforeSessionRun({
      session: disabledSession,
      prompt: '记住它',
      existingMessages: [],
      isColdStart: false,
    });
    expect(result.stablePrompt).toContain('Memory is disabled');
    expect(service.buildPromptPrefix).not.toHaveBeenCalled();
    const response = await result.customTools![0].execute(
      'legacy-call',
      { content: note },
      undefined,
      undefined,
      {} as never
    );
    expect(response.details).toEqual({ status: 'disabled', saved: false });
    await manager.afterSessionRun({ session: disabledSession, prompt: '记住它', messages });
    expect(service.enqueueIngestion).not.toHaveBeenCalled();
  });

  it('rechecks the global switch at execution time', async () => {
    const { manager, service } = setup();
    const result = await manager.beforeSessionRun({
      session,
      prompt: '继续',
      existingMessages: [],
      isColdStart: false,
    });
    service.isEnabled.mockReturnValue(false);
    const response = await result.customTools![0].execute(
      'legacy-call',
      { content: note },
      undefined,
      undefined,
      {} as never
    );
    expect(response.details).toEqual({ status: 'disabled', saved: false });
    await manager.afterSessionRun({ session, prompt: '继续', messages });
    expect(service.enqueueIngestion).not.toHaveBeenCalled();
  });

  it('retains the compatibility handler when memory retrieval fails', async () => {
    const { manager, service } = setup();
    service.buildPromptPrefix.mockRejectedValueOnce(new Error('retrieval unavailable'));
    const result = await manager.beforeSessionRun({
      session,
      prompt: '继续',
      existingMessages: [],
      isColdStart: false,
    });
    expect(result.activateTools).toContain('memory_update');
    expect(result.stablePrompt).toContain('background extraction');
  });
});
