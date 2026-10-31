// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScriptRepairActions } from '../../src/renderer/components/settings/schedule/listPanels';
import { useAppStore } from '../../src/renderer/store';

vi.mock('../../src/renderer/utils/toast', () => ({ showToast: vi.fn() }));

const tr = (_key: string, fallback: string) => fallback;
const nodes = [{ id: 'n1', type: 'script.run', config: { packageId: 'pkg-1' } }] as never;

afterEach(() => cleanup());

describe('run log AI 修复 actions', () => {
  it('opens the repaired version and confirms it in place', async () => {
    const openScriptEditor = vi.fn();
    useAppStore.setState({ openScriptEditor } as never);
    const publish = vi.fn(async () => undefined);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      automation: { scripts: { publish } },
    };
    render(
      <ScriptRepairActions
        error="脚本退出码 1 · AI 已修复为 v3（试运行 12 行），等你确认使用"
        nodes={nodes}
        tr={tr}
      />
    );
    fireEvent.click(screen.getByTestId('run-repair-view'));
    expect(openScriptEditor).toHaveBeenCalledWith({
      packageId: 'pkg-1',
      version: 3,
      step: 'review',
    });
    fireEvent.click(screen.getByTestId('run-repair-publish'));
    await waitFor(() =>
      expect(screen.getByTestId('run-repair-publish').textContent).toBe('使用中')
    );
    expect(publish).toHaveBeenCalledWith('pkg-1', 3);
  });

  it('offers only 查看 when the repair did not pass, and nothing without a repair', () => {
    const { rerender } = render(
      <ScriptRepairActions error="AI 修复的 v2 未通过试运行：x" nodes={nodes} tr={tr} />
    );
    expect(screen.getByTestId('run-repair-view')).toBeTruthy();
    expect(screen.queryByTestId('run-repair-publish')).toBeNull();
    rerender(<ScriptRepairActions error="脚本退出码 1" nodes={nodes} tr={tr} />);
    expect(screen.queryByTestId('run-repair-view')).toBeNull();
  });
});
