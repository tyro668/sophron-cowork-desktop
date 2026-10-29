import { describe, expect, it } from 'vitest';
import { extractSavedScriptPackages } from '../../src/renderer/components/message/ScriptPackageCards';
import type { ContentBlock } from '../../src/shared/contracts/session';

describe('extractSavedScriptPackages', () => {
  it('reads saved drafts from script_package_save tool results', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 't1', name: 'script_package_save', input: {} },
      {
        type: 'tool_result',
        toolUseId: 't1',
        content: JSON.stringify({ id: 'fx', name: '汇率', version: 1, status: 'draft' }),
      },
      { type: 'tool_use', id: 't2', name: 'script_package_test', input: {} },
      { type: 'tool_result', toolUseId: 't2', content: JSON.stringify({ id: 'x', version: 9 }) },
      { type: 'tool_use', id: 't3', name: 'script_package_save', input: {} },
      { type: 'tool_result', toolUseId: 't3', content: '{"id":"fx","version":2}' },
      { type: 'tool_use', id: 't4', name: 'script_package_save', input: {} },
      { type: 'tool_result', toolUseId: 't4', content: 'boom', isError: true },
    ];
    expect(extractSavedScriptPackages(blocks)).toEqual([{ id: 'fx', name: 'fx', version: 2 }]);
  });
});
