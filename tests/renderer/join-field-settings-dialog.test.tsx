// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n-test';
import { JoinFieldSettingsDialog } from '../../src/renderer/components/workflow-forms/join/JoinFieldSettingsDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(JoinFieldSettingsDialog, {
        keepItems: [],
        conflict: {
          strategy: 'suffix',
          leftSuffix: '_left',
          rightSuffix: '_right',
          rightPrefix: 'right_',
        },
        leftFields: ['column_45', 'column_46', 'column_47'],
        rightFields: ['订单ID', '订单日期', '邮寄方式'],
        leftAlias: 'left',
        rightAlias: 'right',
        leftTitle: '输入',
        rightTitle: '输入2',
        onConfirm: () => {},
        onCancel: () => {},
      })
    );
  });
  return { host, root };
}

describe('JoinFieldSettingsDialog', () => {
  it('is not clamped by the base dialog max-w-md', async () => {
    const { host, root } = await mount();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.className).toContain('w-[800px]');
    expect(dialog.className).toContain('h-[560px]');
    expect(dialog.className).toContain('max-w-[92vw]');
    expect(dialog.className).not.toContain('max-w-md');
    await act(async () => root.unmount());
    host.remove();
  });

  it('renders checkbox, name, and alias input for every field row', async () => {
    const { host, root } = await mount();
    const rows = document.querySelectorAll('.flex.h-7');
    expect(rows.length).toBe(6);
    rows.forEach((row) => {
      expect(row.querySelector('input[type="checkbox"]')).not.toBeNull();
      expect(row.querySelector('input[type="text"]')).not.toBeNull();
    });
    expect(document.body.textContent).toContain('column_45');
    expect(document.body.textContent).toContain('订单ID');
    await act(async () => root.unmount());
    host.remove();
  });

  it('collapses and expands each side as an accordion section', async () => {
    const { host, root } = await mount();
    const toggles = document.querySelectorAll('[aria-expanded]');
    expect(toggles.length).toBe(2);

    // Collapse the left section: its field rows disappear, right rows remain.
    await act(async () => {
      (toggles[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect((toggles[0] as HTMLElement).getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('.flex.h-7').length).toBe(3);
    expect(document.body.textContent).not.toContain('column_45');
    expect(document.body.textContent).toContain('订单ID');

    // Expand it again.
    await act(async () => {
      (toggles[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelectorAll('.flex.h-7').length).toBe(6);
    expect(document.body.textContent).toContain('column_45');
    await act(async () => root.unmount());
    host.remove();
  });
});
