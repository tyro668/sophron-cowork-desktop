// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useScriptPackageVersions } from '../../src/renderer/features/automation/hooks/use-script-package-versions';
import { automationClient } from '../../src/renderer/features/automation/api/automation-client';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('discards late errors from a previous version and selects a file from the current one', async () => {
  let failFirst!: (reason: Error) => void;
  const versionDetail = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failFirst = reject;
        })
    )
    .mockResolvedValueOnce({
      version: 2,
      entry: 'main.py',
      files: [{ path: 'notes.txt' }, { path: 'main.py' }],
    });
  vi.spyOn(automationClient, 'scripts', 'get').mockReturnValue({
    versionDetail,
  } as unknown as typeof automationClient.scripts);
  const onError = vi.fn();
  const { result } = renderHook(() => useScriptPackageVersions('package', 1, onError));
  act(() => result.current.setViewVersion(2));
  await waitFor(() => expect(result.current.selectedPath).toBe('main.py'));
  await act(async () => failFirst(new Error('Previous version unavailable')));
  expect(onError).not.toHaveBeenCalled();
  expect(result.current.detail?.version).toBe(2);
});
