// @vitest-environment happy-dom
/**
 * Formula editor: an expression that fails validation can never be saved, and the removed
 * case … when form offers a one-click rewrite to if … elseif.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import './i18n-test';
import { GlassExpressionInput } from '../../src/renderer/components/workflow-forms/shared/GlassExpressionInput';

const FIELDS = ['d', 's'];

function openEditor(value: string) {
  const onChange = vi.fn();
  render(
    <GlassExpressionInput
      value={value}
      onChange={onChange}
      fieldCompletions={FIELDS}
      columnTypes={{ d: 'INTEGER', s: 'VARCHAR' }}
    />
  );
  fireEvent.click(screen.getByTestId('expression-preview').closest('button')!);
  return onChange;
}

function confirmButton(): HTMLButtonElement {
  const grid = screen.getByTestId('formula-editor-grid');
  const buttons = Array.from(grid.ownerDocument.querySelectorAll('button'));
  return buttons.find((b) => b.getAttribute('aria-disabled') !== null)! as HTMLButtonElement;
}

describe('expression editor save guard', () => {
  it('blocks saving an invalid expression', async () => {
    const onChange = openEditor('[d] +');
    const confirm = confirmButton();
    await waitFor(() => expect(confirm.disabled).toBe(true));
    fireEvent.click(confirm);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts elseif and saves it', async () => {
    const expr = "if [d] > 30 then 'late' elseif [s] in ('A', 'B') then 'ab' else 'ok' end";
    const onChange = openEditor(expr);
    const confirm = confirmButton();
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    expect(onChange).toHaveBeenCalledWith(expr);
  });

  it('case is blocked and the quick-fix rewrites it to if … elseif', async () => {
    const onChange = openEditor("case [s] when 'A' then 1 when 'B' then 2 else 0 end");
    const confirm = confirmButton();
    await waitFor(() => expect(confirm.disabled).toBe(true));
    expect(screen.getByTestId('expression-grammar-error').textContent).toMatch(/elseif/);
    fireEvent.click(screen.getByTestId('expression-case-quickfix'));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());
    expect(onChange).toHaveBeenCalledWith("if [s] = 'A' then 1 elseif [s] = 'B' then 2 else 0 end");
  });
});
