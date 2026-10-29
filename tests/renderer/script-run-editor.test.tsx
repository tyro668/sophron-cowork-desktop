// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import './i18n-test';
import { ScriptRunEditor } from '../../src/renderer/components/settings/schedule/script-run-editor';
import type { AutomationActionNode } from '../../src/shared/automation/types';
import type { ScriptPackageSummary } from '../../src/shared/automation/script-package';

vi.mock('../../src/renderer/components/settings/schedule/editor-controls', () => ({
  FormRow: ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
    <div data-row={String(label)}>
      <span>{label}</span>
      {children}
    </div>
  ),
  FlushSelect: ({
    value,
    options,
    placeholder,
    onChange,
    ariaLabel,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    placeholder: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const pkg: ScriptPackageSummary = {
  id: 'fx',
  name: '汇率同步',
  dir: '/scripts/fx',
  entry: 'main.py',
  runtime: 'python',
  runtimeVersion: 'Python 3.12',
  depsFile: 'requirements.txt',
  depsReady: true,
  lastSuccess: { at: 1, rows: 126, durationMs: 10 },
};

const scripts = {
  list: vi.fn(async () => [pkg]),
  open: vi.fn(async () => undefined),
  testRun: vi.fn(async () => ({ ok: true, rows: 25, durationMs: 5, installedDeps: false })),
  confirmPending: vi.fn(async () => pkg),
  discardPending: vi.fn(async () => undefined),
};

beforeEach(async () => {
  await i18n.changeLanguage('zh');
  Object.assign(window, { electronAPI: { automation: { scripts } } });
  for (const fn of Object.values(scripts)) fn.mockClear();
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

function setup(config: Record<string, unknown>) {
  const onChange = vi.fn();
  const node: AutomationActionNode = { id: 'n', type: 'script.run', enabled: true, config };
  render(
    <ScriptRunEditor
      node={node}
      rawTables={[{ id: 'raw-1', name: '竞品价格_厨具' } as never]}
      onChange={onChange}
    />
  );
  return onChange;
}

describe('ScriptRunEditor', () => {
  it('shows entry, dependency state and last success for the chosen package', async () => {
    setup({ packageId: 'fx', timeoutMs: 120_000, rawTableId: 'raw-1' });
    expect(await screen.findByText('main.py · Python 3.12')).toBeTruthy();
    expect(screen.getByText('依赖已就绪 · 上次成功 126 行')).toBeTruthy();
    expect((screen.getByLabelText('超时') as HTMLSelectElement).value).toBe('120000');
    expect(screen.getByText('2 分钟')).toBeTruthy();
    expect(screen.getByText('原始表 · 竞品价格_厨具')).toBeTruthy();
    expect(screen.getByText('仅通知')).toBeTruthy();
    expect(screen.getByText('交给 AI 重新生成')).toBeTruthy();
  });

  it('updates config from the dropdowns', async () => {
    const onChange = setup({ packageId: '', timeoutMs: 120_000 });
    await waitFor(() => expect(scripts.list).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('脚本包'), { target: { value: 'fx' } });
    expect(onChange.mock.calls.at(-1)?.[0].config.packageId).toBe('fx');
    fireEvent.change(screen.getByLabelText('脚本出错'), { target: { value: 'ai_repair' } });
    expect(onChange.mock.calls.at(-1)?.[0].config.onScriptError).toBe('ai_repair');
    fireEvent.change(screen.getByLabelText('输出到'), { target: { value: 'raw-1' } });
    expect(onChange.mock.calls.at(-1)?.[0].config).toMatchObject({
      rawTableId: 'raw-1',
      rawTableName: '竞品价格_厨具',
    });
  });

  it('opens the folder and test-runs without saving', async () => {
    setup({ packageId: 'fx', timeoutMs: 60_000 });
    await screen.findByText('main.py · Python 3.12');
    fireEvent.click(screen.getByText('打开'));
    expect(scripts.open).toHaveBeenCalledWith('fx');
    fireEvent.click(screen.getByText('试运行', { selector: 'button' }));
    expect(await screen.findByText('试运行成功 · 25 行')).toBeTruthy();
    expect(scripts.testRun).toHaveBeenCalledWith('fx', 60_000);
  });

  it('offers adopt / discard for a pending AI version', async () => {
    scripts.list.mockResolvedValueOnce([
      { ...pkg, pending: { createdAt: 1, rows: 30, reason: 'x' } },
    ]);
    setup({ packageId: 'fx', timeoutMs: 60_000 });
    expect(await screen.findByText('AI 已重新生成 · 试运行 30 行，待确认')).toBeTruthy();
    fireEvent.click(screen.getByText('采用'));
    await waitFor(() => expect(scripts.confirmPending).toHaveBeenCalledWith('fx'));
  });
});
