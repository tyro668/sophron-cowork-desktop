// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../src/renderer/i18n/config';
import {
  formatScriptRepair,
  ScriptRepairActions,
} from '../../src/renderer/components/settings/schedule/listPanels';
import { useAppStore } from '../../src/renderer/store';

vi.mock('../../src/renderer/utils/toast', () => ({ showToast: vi.fn() }));

const tr = (_key: string, fallback?: string) => fallback ?? _key;

afterEach(() => cleanup());

describe('run log AI 修复 actions', () => {
  it('renders the same recorded failure in either language and preserves the underlying reason', async () => {
    const failure = { status: 'failed', packageId: 'pkg-1', reason: 'Connection reset' } as const;
    const language = i18n.language;
    try {
      await i18n.changeLanguage('en');
      expect(formatScriptRepair(failure)).toBe('AI repair failed: Connection reset');
      const unchanged = { ...failure, reasonKey: 'noChanges' as const, reason: 'original locale' };
      expect(formatScriptRepair(unchanged)).toContain(
        i18n.t('schedule.scriptRunMessages.noChanges')
      );
      await i18n.changeLanguage('zh');
      expect(formatScriptRepair(unchanged)).toContain(
        i18n.t('schedule.scriptRunMessages.noChanges')
      );
      expect(formatScriptRepair(failure)).toBe(
        i18n.t('schedule.repair.status.failed', { reason: failure.reason })
      );
      expect(formatScriptRepair(failure)).not.toContain('AI repair failed');
    } finally {
      await i18n.changeLanguage(language);
    }
  });

  it('opens the repaired version and confirms it in place', async () => {
    const openScriptEditor = vi.fn();
    useAppStore.setState({ openScriptEditor } as never);
    const publish = vi.fn(async () => undefined);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      automation: { scripts: { publish } },
    };
    render(
      <ScriptRepairActions
        repair={{ status: 'ready', packageId: 'pkg-1', version: 3, rows: 12 }}
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
      expect(screen.getByTestId('run-repair-publish').textContent).toBe('schedule.repair.inUse')
    );
    expect(publish).toHaveBeenCalledWith('pkg-1', 3);
  });

  it('offers only 查看 when the repair did not pass, and nothing without a repair', () => {
    const { rerender } = render(
      <ScriptRepairActions
        repair={{ status: 'trialFailed', packageId: 'pkg-1', version: 2, reason: 'x' }}
        tr={tr}
      />
    );
    expect(screen.getByTestId('run-repair-view')).toBeTruthy();
    expect(screen.queryByTestId('run-repair-publish')).toBeNull();
    rerender(<ScriptRepairActions repair={{ status: 'pending', packageId: 'pkg-1' }} tr={tr} />);
    expect(screen.queryByTestId('run-repair-view')).toBeNull();
  });
});
