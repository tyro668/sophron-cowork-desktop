import { describe, expect, it } from 'vitest';
import {
  detectAutomationIntent,
  detectScriptPackageIntent,
} from '../../src/main/extensions/agent-intent';
import {
  createScriptPackageAgentRuntimeExtension,
  createScriptPackageTools,
} from '../../src/main/automation/script-packages/agent-tools';
import type { ScriptPackageService } from '../../src/main/automation/script-packages/service';
import type { Message } from '../../src/shared/contracts';

const detect = (prompt: string, existingMessages: Message[] = [], stickyActive = false) =>
  detectScriptPackageIntent({ prompt, existingMessages }, { stickyActive }).active;

describe('script package intent', () => {
  it.each([
    '把这个取数过程固化成脚本',
    '保存为脚本吧',
    '帮我做成脚本包',
    '生成脚本，以后每天跑',
    '以后每天自动取这个汇率',
    '把这个做成每天早上 9 点自动跑',
    '每天自动跑',
    '定时取数不要用AI',
    '每天从 open-meteo 拉一次天气，不要消耗 AI',
    '这样跑不消耗 token 吧？做一个',
    '别再调用大模型了，脚本化',
    'save this as a script',
    'Turn this into a script that runs every morning',
    'make it a script package',
    'Fetch the exchange rates daily without using AI',
    'pull this data every day with zero-token runs',
  ])('recognises %s', (prompt) => {
    expect(detect(prompt)).toBe(true);
  });

  it.each([
    'Python 脚本里 if __name__ == "__main__" 是什么意思？',
    '这个 shell 脚本的 $1 参数怎么用',
    '帮我看看这段 JavaScript 有什么 bug',
    'what does this bash script do?',
    '写一首关于秋天的诗',
  ])('ignores %s', (prompt) => {
    expect(detect(prompt)).toBe(false);
  });

  it('keeps the tools for a bare follow-up after script tools were used', () => {
    const history = [
      {
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'script_package_propose', input: {} }],
      },
    ] as unknown as Message[];
    expect(detect('好的', history)).toBe(true);
    expect(detect('好的', [], true)).toBe(true);
    expect(detect('好的')).toBe(false);
  });

  it('activates the tools and guide only on intent', async () => {
    const extension = createScriptPackageAgentRuntimeExtension({
      rootDir: '/scripts',
    } as unknown as ScriptPackageService);
    const session = { id: 's1' } as never;
    const run = (prompt: string) =>
      extension.beforeSessionRun!({ session, prompt, existingMessages: [], isColdStart: false });
    const hit = await run('把这个取数过程固化成脚本');
    expect(hit?.activateTools).toEqual(['script_package_list', 'script_package_propose']);
    const guide = hit?.toolContexts?.[0]?.stablePrompt ?? '';
    expect(guide).toContain('script_package_propose');
    expect(guide).toContain('固化成脚本');
    // Only the editor's generation agent writes packages: no save/test tools in the chat.
    expect(guide).not.toMatch(/script_package_(save|test|publish)/);
    // A bare "ok" right after stays sticky; a topic change releases the tools.
    expect((await run('可以'))?.activateTools).toHaveLength(2);
    expect((await run('写一首诗'))?.activateTools).toEqual([]);
    // Still discoverable through capabilities_search.
    expect(Object.keys(hit?.toolPacks ?? {})).toEqual(['automation.scripts']);
  });

  it('script_package_propose only returns the card payload', async () => {
    const tools = createScriptPackageTools({} as unknown as ScriptPackageService);
    const propose = tools.find((tool) => tool.name === 'script_package_propose')!;
    const result = await propose.execute(
      'c1',
      { scheduleTime: '09:00' } as never,
      undefined as never,
      undefined as never,
      undefined as never
    );
    expect(result.details).toMatchObject({ proposed: true, scheduleTime: '09:00' });
    expect(tools.map((tool) => tool.name)).toEqual([
      'script_package_list',
      'script_package_propose',
    ]);
  });

  it('routes English schedules and a yes after a saved script to automation tools', () => {
    const opts = { stickyActive: false, hasPendingReceipts: false };
    expect(
      detectAutomationIntent(
        { prompt: 'Yes please, every day at 07:30.', existingMessages: [] },
        opts
      ).active
    ).toBe(true);
    expect(
      detectAutomationIntent({ prompt: 'run it daily at 8', existingMessages: [] }, opts).active
    ).toBe(true);
    const afterSave = [
      {
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'script_package_propose', input: {} }],
      },
    ] as unknown as Message[];
    expect(
      detectAutomationIntent({ prompt: '好的', existingMessages: afterSave }, opts).active
    ).toBe(true);
    expect(detectAutomationIntent({ prompt: '好的', existingMessages: [] }, opts).active).toBe(
      false
    );
  });
});
