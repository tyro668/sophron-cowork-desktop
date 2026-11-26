// @vitest-environment happy-dom
import i18n from '../../src/renderer/i18n/config';
import { RawTableError } from '../../src/shared/contracts/data/issues';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmLeave, useLeaveGuard } from '../../src/renderer/utils/leave-guard';
import { formatDataErrorMessage } from '../../src/renderer/features/data/model/errors';

function Editor({
  dirty,
  ask,
  active,
  onDiscard,
}: {
  dirty: boolean;
  ask: () => Promise<boolean>;
  active?: boolean;
  onDiscard?: () => void;
}) {
  useLeaveGuard(dirty, ask, { active, onDiscard });
  return null;
}

afterEach(() => cleanup());

describe('leave guard', () => {
  it('lets the user leave when nothing is unsaved', async () => {
    const ask = vi.fn(async () => false);
    render(<Editor dirty={false} ask={ask} />);
    expect(await confirmLeave()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks every dirty editor, newest first, and stops at the first refusal', async () => {
    const order: string[] = [];
    const outer = vi.fn(async () => (order.push('outer'), true));
    const inner = vi.fn(async () => (order.push('inner'), false));
    render(
      <>
        <Editor dirty ask={outer} />
        <Editor dirty ask={inner} />
      </>
    );
    expect(await confirmLeave()).toBe(false);
    expect(order).toEqual(['inner']);
    inner.mockImplementation(async () => (order.push('inner'), true));
    expect(await confirmLeave()).toBe(true);
    expect(order).toEqual(['inner', 'inner', 'outer']);
  });

  it('never asks an editor whose page is hidden (keep-alive), e.g. 新建任务 from 自动化', async () => {
    const ask = vi.fn(async () => false);
    render(<Editor dirty active={false} ask={ask} />);
    expect(await confirmLeave()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('drops the unsaved work after 放弃修改 so it is not asked about again', async () => {
    const ask = vi.fn(async () => true);
    const onDiscard = vi.fn();
    render(<Editor dirty ask={ask} onDiscard={onDiscard} />);
    expect(await confirmLeave()).toBe(true);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('discards nothing when any stacked editor refuses', async () => {
    const outerDiscard = vi.fn();
    const innerDiscard = vi.fn();
    render(
      <>
        <Editor dirty ask={async () => false} onDiscard={outerDiscard} />
        <Editor dirty ask={async () => true} onDiscard={innerDiscard} />
      </>
    );
    expect(await confirmLeave()).toBe(false);
    expect(innerDiscard).not.toHaveBeenCalled();
    expect(outerDiscard).not.toHaveBeenCalled();
  });

  it('its own back button still asks while the page is hidden-flagged', async () => {
    const ask = vi.fn(async () => true);
    let own: (() => Promise<boolean>) | null = null;
    function Own() {
      own = useLeaveGuard(true, ask, { active: false });
      return null;
    }
    render(<Own />);
    expect(await own!()).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('unregisters on unmount', async () => {
    const ask = vi.fn(async () => false);
    const view = render(<Editor dirty ask={ask} />);
    view.unmount();
    expect(await confirmLeave()).toBe(true);
  });
});

describe('formatDataErrorMessage', () => {
  it('turns a refresh-check failure into a plain sentence', () => {
    const t = ((key: string, options?: { reason?: string }) =>
      key === 'data.rawTables.errors.abnormal'
        ? `数据异常：${options?.reason}。已保留上次的数据。`
        : key) as never;
    expect(
      formatDataErrorMessage(
        { kind: 'raw-table-issue', code: 'E_RAW_TABLE_ABNORMAL', message: '刷新后缺少列：销售额' },
        t
      )
    ).toBe('数据异常：刷新后缺少列：销售额。已保留上次的数据。');
  });
});

it.each(['en', 'zh'])(
  'renders structured data errors in %s with the complete cause',
  (language) => {
    const translate = i18n.getFixedT(language);
    const reason = 'invalid field. Expected two columns.';
    expect(
      formatDataErrorMessage(new RawTableError('E_RAW_TABLE_ABNORMAL', reason), translate)
    ).toBe(translate('data.rawTables.errors.abnormal', { reason }));
    expect(
      formatDataErrorMessage(new RawTableError('DATA_CSV_ENCODING_ERROR', reason), translate)
    ).toBe(translate('data.rawTables.errors.csvEncoding'));
  }
);
