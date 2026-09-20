import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../renderer/store';
beforeEach(() => useAppStore.setState(useAppStore.getInitialState()));
const request = (id: string) => ({ sessionId: id, toolUseId: id, toolName: 'bash', input: {} });

describe('permission dialog queue', () => {
  it('retains every request and ignores duplicate response/dismiss events', () => {
    const store = useAppStore.getState();
    store.setPendingPermission(request('a'));
    store.setPendingPermission(request('b'));
    store.setPendingPermission(request('c'));
    store.setPendingPermission(request('a'));
    expect(useAppStore.getState().pendingPermission?.toolUseId).toBe('a');
    expect(useAppStore.getState().pendingPermissionQueue.map((p) => p.toolUseId)).toEqual([
      'b',
      'c',
    ]);
    store.dismissPermission('b'); // Cancel a task whose request is queued.
    store.dismissPermission('a'); // User response.
    store.dismissPermission('a'); // Matching main-process acknowledgement.
    expect(useAppStore.getState().pendingPermission?.toolUseId).toBe('c');
    store.dismissPermission('c');
    expect(useAppStore.getState().pendingPermission).toBeNull();
  });
});
