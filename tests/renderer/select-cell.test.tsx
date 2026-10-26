// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FormGrid, SelectCell } from '../../src/renderer/components/workflow-forms/shared/FormGrid';

vi.mock('../../src/renderer/components/workflow-forms/shared/dropdownWidth', () => ({
  measureMaxTextWidth: () => 0,
  computeDropdownWidth: (w: number) => ({ minWidth: w, maxWidth: w * 2 }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
  { value: 'replace', label: '覆盖', description: '清空后写入' },
  {
    value: 'append',
    label: '追加',
    description: '追加新行',
    icon: createElement('i', { 'data-testid': 'icon-append' }),
  },
  { value: 'merge', label: '合并' },
] as const;

async function renderCell(props: Partial<Parameters<typeof SelectCell>[0]> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        FormGrid,
        { columns: '104px 120px 120px 120px 1fr' },
        createElement(SelectCell<string>, {
          value: 'append',
          options: [...OPTIONS],
          onChange,
          ariaLabel: '写入方式',
          ...props,
        })
      )
    )
  );
  return {
    host,
    onChange,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
      document.body.innerHTML = '';
    },
  };
}

describe('SelectCell', () => {
  it('renders one flush ctl cell spanning the option count by default', async () => {
    const { host, cleanup } = await renderCell();
    const cell = host.querySelector('.opg-c.ctl') as HTMLElement;
    expect(cell).toBeTruthy();
    expect(cell.style.gridColumn).toBe('span 3 / span 3');
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(0);
    const trigger = cell.querySelector('button') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('写入方式');
    expect(trigger.textContent).toContain('追加');
    // Selected option's icon and description surface on the trigger.
    expect(trigger.querySelector('[data-testid="icon-append"]')).toBeTruthy();
    expect(trigger.getAttribute('title')).toBe('追加新行');
    await cleanup();
  });

  it('honours an explicit span', async () => {
    const { host, cleanup } = await renderCell({ span: 1 });
    const cell = host.querySelector('.opg-c.ctl') as HTMLElement;
    expect(cell.style.gridColumn).toBe('');
    await cleanup();
  });

  it('lists options with descriptions and reports a new choice', async () => {
    const { host, onChange, cleanup } = await renderCell();
    const trigger = host.querySelector('.opg-c.ctl button') as HTMLButtonElement;
    await act(async () => trigger.click());
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    expect(options.map((o) => o.textContent)).toEqual(['覆盖清空后写入', '追加追加新行', '合并']);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      options[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('replace');
    await cleanup();
  });

  it('does not fire onChange when re-picking the current value', async () => {
    const { host, onChange, cleanup } = await renderCell();
    await act(async () => (host.querySelector('.opg-c.ctl button') as HTMLButtonElement).click());
    const current = document.querySelectorAll('[role="option"]')[1];
    await act(async () => {
      current.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    await cleanup();
  });

  it('disables the trigger', async () => {
    const { host, cleanup } = await renderCell({ disabled: true });
    expect((host.querySelector('.opg-c.ctl button') as HTMLButtonElement).disabled).toBe(true);
    await cleanup();
  });
});
