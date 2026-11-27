// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n-test';
import { ToolUseBlock } from '../../src/renderer/components/message/ToolUseBlock';
import type { ContentBlock, ToolUseContent } from '../../src/renderer/types';

describe('ToolUseBlock collapsed error', () => {
  afterEach(cleanup);
  it('shows the error wrapped to two lines with the full text on hover', async () => {
    await i18n.changeLanguage('zh');
    const message =
      'Tool "made_up_tool" is not available in this app. Call capabilities_search with a short task description to find and load the right tool, then retry with its exact name.';
    const block = {
      type: 'tool_use',
      id: 'call-1',
      name: 'made_up_tool',
      input: {},
    } as ToolUseContent;
    const allBlocks = [
      block,
      { type: 'tool_result', toolUseId: 'call-1', content: message, isError: true },
    ] as ContentBlock[];
    render(
      <I18nextProvider i18n={i18n}>
        <ToolUseBlock block={block} allBlocks={allBlocks} />
      </I18nextProvider>
    );
    const summary = screen.getByTitle(message);
    expect(summary.textContent).toBe(message);
    expect(summary.className).toContain('line-clamp-2');
    expect(summary.className).not.toContain('truncate');
  });
});
