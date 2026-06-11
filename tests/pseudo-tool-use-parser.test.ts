import { describe, expect, it } from 'vitest';
import { extractPseudoToolUsesFromText } from '../src/main/claude/pseudo-tool-use-parser';

describe('extractPseudoToolUsesFromText', () => {
  it('extracts pseudo tool use XML and removes it from assistant text', () => {
    const result = extractPseudoToolUsesFromText(
      '查看项目表： <tool_use name="data_list_cloud_tables" id="call_1">{"spaceId":"space-growth","projectId":"project-sales"}</tool_use>'
    );

    expect(result.cleanText).toBe('查看项目表：');
    expect(result.toolUses).toEqual([
      {
        raw: '<tool_use name="data_list_cloud_tables" id="call_1">{"spaceId":"space-growth","projectId":"project-sales"}</tool_use>',
        name: 'data_list_cloud_tables',
        id: 'call_1',
        input: {
          spaceId: 'space-growth',
          projectId: 'project-sales',
        },
      },
    ]);
  });

  it('keeps normal assistant text unchanged when there is no pseudo tool use', () => {
    const text = '第一行\n\n  第二行  ';

    expect(extractPseudoToolUsesFromText(text)).toEqual({
      cleanText: text,
      toolUses: [],
    });
  });

  it('parses XML-escaped JSON bodies', () => {
    const result = extractPseudoToolUsesFromText(
      '<tool_use name="data_list_cloud_projects" id="call_2">{&quot;spaceId&quot;:&quot;space-growth&quot;}</tool_use>'
    );

    expect(result.toolUses[0]?.input).toEqual({ spaceId: 'space-growth' });
  });
});
