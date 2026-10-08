// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import { EMPTY_DASHBOARD } from '../../src/renderer/features/data/model/types';
import { ConfirmDialogProvider } from '../../src/renderer/components/ConfirmDialog';
import { DataViewPage } from '../../src/renderer/features/data/pages/DataViewPage';

function setupBridge() {
  const passthrough = (name: string) =>
    vi.fn(async () => {
      if (name === 'getDashboard') return EMPTY_DASHBOARD;
      if (name === 'getAppConfig') return {};
      return [];
    });
  const data = new Proxy(
    {},
    {
      get: (_target, prop: string) => passthrough(prop),
      has: () => true,
    }
  );
  (window as { electronAPI?: unknown }).electronAPI = { data };
}

describe('DataViewPage', () => {
  beforeEach(async () => {
    setupBridge();
    await i18n.changeLanguage('zh');
  });

  it('renders the workspace without crashing', async () => {
    const { container } = render(
      <ConfirmDialogProvider>
        <DataViewPage />
      </ConfirmDialogProvider>
    );
    await vi.waitFor(() => expect(container.textContent).toContain('数据任务'));
    expect(container.textContent).toContain('输入表');
  });
});
