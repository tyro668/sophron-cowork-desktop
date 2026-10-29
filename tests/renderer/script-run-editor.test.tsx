// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import './i18n-test';
import { ScriptRunEditor } from '../../src/renderer/components/settings/schedule/script-run-editor';
import type { AutomationActionNode } from '../../src/shared/automation/types';
import type { ScriptPackageSummary } from '../../src/shared/automation/script-package';
import { useAppStore } from '../../src/renderer/store';

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
  versionCount: 3,
  published: {
    version: 3,
    status: 'published',
    source: 'rule',
    entry: 'main.py',
    runtime: 'python',
    createdAt: Date.UTC(2026, 9, 20, 1, 0),
    updatedAt: Date.UTC(2026, 9, 20, 1, 0),
    publishedAt: Date.UTC(2026, 9, 20, 1, 0),
  },
};

const scripts = {
  list: vi.fn(async () => [pkg]),
  open: vi.fn(async () => undefined),
  testRun: vi.fn(async () => ({ ok: true, rows: 25, durationMs: 5, installedDeps: false })),
};

beforeEach(async () => {
  await i18n.changeLanguage('zh');
  Object.assign(window, { electronAPI: { automation: { scripts } } });
  for (const fn of Object.values(scripts)) fn.mockClear();
  scripts.list.mockImplementation(async () => [pkg]);
  useAppStore.setState({ scriptEditor: null });
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
    expect(scripts.testRun).toHaveBeenCalledWith('fx', 60_000, 'published');
  });

  it('shows the published version and opens the editor', async () => {
    setup({ packageId: 'fx', timeoutMs: 60_000 });
    const text = await screen.findByTestId('script-version-text');
    expect(text.textContent).toMatch(/^v3 已发布 · 10-20 \d\d:00$/);
    fireEvent.click(screen.getByText('编辑脚本'));
    expect(useAppStore.getState().scriptEditor).toMatchObject({ packageId: 'fx', step: 'rules' });
  });

  it('shows a pending AI-repair draft and opens it for review', async () => {
    scripts.list.mockImplementation(async () => [
      {
        ...pkg,
        versionCount: 4,
        draft: { ...pkg.published!, version: 4, status: 'draft', source: 'ai_repair' },
      },
    ]);
    setup({ packageId: 'fx', timeoutMs: 60_000 });
    expect(await screen.findByText('· v4 草稿待发布（AI 修复）', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByText('查看草稿'));
    expect(useAppStore.getState().scriptEditor).toMatchObject({
      packageId: 'fx',
      version: 4,
      step: 'review',
    });
  });

  it('lists version numbers and a new-package entry', async () => {
    const onChange = setup({ packageId: '', timeoutMs: 60_000 });
    await waitFor(() => expect(scripts.list).toHaveBeenCalled());
    const select = screen.getByLabelText('脚本包') as HTMLSelectElement;
    await waitFor(() =>
      expect([...select.options].map((o) => o.textContent)).toContain('＋ 新建脚本包')
    );
    fireEvent.change(select, { target: { value: '__new_package__' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(useAppStore.getState().scriptEditor).toMatchObject({ step: 'rules' });
    expect(useAppStore.getState().scriptEditor?.packageId).toBeUndefined();
  });
});
