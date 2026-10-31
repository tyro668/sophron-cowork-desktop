import { useEffect, useRef } from 'react';

/**
 * 离开前确认: an editor with unsaved work registers itself; the back button and the sidebar
 * navigation ask `confirmLeave()` first. Editors can stack (the script editor opens over an
 * automation or a raw table), so every mounted editor is asked, newest first.
 */
type LeaveGuard = { isDirty: () => boolean; ask: () => Promise<boolean> };

const guards: LeaveGuard[] = [];

export async function confirmLeave(): Promise<boolean> {
  for (const guard of [...guards].reverse()) {
    if (guard.isDirty() && !(await guard.ask())) return false;
  }
  return true;
}

export function useLeaveGuard(dirty: boolean, ask: () => Promise<boolean>) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    const guard: LeaveGuard = {
      isDirty: () => dirtyRef.current,
      ask: () => askRef.current(),
    };
    guards.push(guard);
    return () => {
      const index = guards.indexOf(guard);
      if (index >= 0) guards.splice(index, 1);
    };
  }, []);
  /** Asks only this editor (its own back button). */
  return () => (dirtyRef.current ? askRef.current() : Promise.resolve(true));
}
