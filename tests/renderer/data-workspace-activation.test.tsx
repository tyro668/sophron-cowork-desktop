// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../src/renderer/store';
import { useDataWorkspaceActivation } from '../../src/renderer/features/data/hooks/use-data-workspace-activation';
afterEach(cleanup);
it('refreshes a kept-alive workspace on return from chat without duplicate initial loads', () => {
  useAppStore.setState({ mainView: 'data' });
  const refresh = vi.fn();
  const { rerender } = renderHook(() => useDataWorkspaceActivation(() => refresh()));
  expect(refresh).not.toHaveBeenCalled();
  act(() => useAppStore.getState().setMainView('chat'));
  act(() => useAppStore.getState().setMainView('data'));
  expect(refresh).toHaveBeenCalledOnce();
  rerender();
  expect(refresh).toHaveBeenCalledOnce();
});
