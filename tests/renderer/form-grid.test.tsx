// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Cell,
  FormGrid,
  GlassCommitTextInput,
  SegmentCells,
} from '../../src/renderer/components/workflow-forms/shared/FormGrid';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(element: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('FormGrid', () => {
  it('uses one grid-template-columns and spans cells', async () => {
    const { host, cleanup } = await render(
      createElement(FormGrid, { columns: '104px 1fr 112px' }, [
        createElement(Cell, { key: 'a', v: ['lab'] }, 'A'),
        createElement(Cell, { key: 'b', span: 2 }, 'B'),
      ])
    );
    const grid = host.querySelector('.opg') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('104px 1fr 112px');
    expect((grid.children[1] as HTMLElement).style.gridColumn).toBe('span 2 / span 2');
    await cleanup();
  });

  it('segment cells mark the active option and emit changes', async () => {
    const onChange = vi.fn();
    const { host, cleanup } = await render(
      createElement(SegmentCells<'a' | 'b'>, {
        value: 'a',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        onChange,
      })
    );
    const buttons = host.querySelectorAll('button');
    expect(buttons[0].className).toContain('on');
    await act(async () => buttons[1].click());
    expect(onChange).toHaveBeenCalledWith('b');
    await cleanup();
  });
});

describe('GlassCommitTextInput', () => {
  it('commits only on blur / Enter and restores on Escape', async () => {
    const onCommit = vi.fn();
    const { host, cleanup } = await render(
      createElement(GlassCommitTextInput, { value: '销售额', onCommit })
    );
    const input = host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.focus();
      type(input, '销售额合计');
    });
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onCommit).toHaveBeenLastCalledWith('销售额合计');

    onCommit.mockClear();
    await act(async () => {
      input.focus();
      type(input, 'xyz');
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('销售额');
    await cleanup();
  });
});

describe('validateAggregateMetrics', () => {
  it('flags empty expression, duplicate alias and group-by collision', async () => {
    const { validateAggregateMetrics } =
      await import('../../src/renderer/components/workflow-forms/shared/metricValidation');
    const issues = validateAggregateMetrics(
      [
        { function: 'sum', expression: '[金额]', alias: '销售额' },
        { function: 'count', expression: '', alias: '省' },
        { function: 'avg', expression: '', alias: '销售额' },
      ],
      ['省']
    );
    expect(issues[0].messages).toEqual([]);
    expect(issues[1].aliasError).toBe(true);
    expect(issues[1].expressionError).toBe(false);
    expect(issues[2].expressionError).toBe(true);
    expect(issues[2].messages.map((m) => m.key)).toEqual([
      'metricExpressionEmpty',
      'metricAliasDuplicate',
    ]);
  });
});
