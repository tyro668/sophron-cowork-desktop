// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSkillMentions } from '../../src/renderer/hooks/useSkillMentions';
import './i18n-test';

function Composer({ initial = '' }: { initial?: string }) {
  const [prompt, setPrompt] = useState(initial);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useSkillMentions({ prompt, setPrompt, textareaRef, isElectron: false });
  return (
    <div>
      <textarea
        aria-label="prompt"
        ref={textareaRef}
        value={prompt}
        onChange={mentions.handlePromptChange}
      />
      <button type="button" onClick={mentions.insertMentionTrigger}>
        at
      </button>
      <span data-testid="open">{String(mentions.isMentionMenuOpen)}</span>
    </div>
  );
}

afterEach(cleanup);

describe('composer @ button', () => {
  it('inserts @ at the caret and opens the mention picker', () => {
    render(<Composer />);
    act(() => {
      fireEvent.click(screen.getByText('at'));
    });
    expect((screen.getByLabelText('prompt') as HTMLTextAreaElement).value).toBe('@');
    expect(screen.getByTestId('open').textContent).toBe('true');
  });

  it('adds a separating space after existing text so the trigger fires', () => {
    render(<Composer initial="分析一下" />);
    const textarea = screen.getByLabelText('prompt') as HTMLTextAreaElement;
    textarea.setSelectionRange(4, 4);
    act(() => {
      fireEvent.click(screen.getByText('at'));
    });
    expect(textarea.value).toBe('分析一下 @');
    expect(screen.getByTestId('open').textContent).toBe('true');
  });
});
