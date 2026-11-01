import { useEffect, useRef } from 'react';

/**
 * 离开前确认: an editor with unsaved work registers itself; the back button and the sidebar
 * navigation ask `confirmLeave()` first. Editors can stack (the script editor opens over an
 * automation or a raw table), so every mounted editor is asked, newest first.
 *
 * Main views stay mounted while hidden (keep-alive), so an editor on a page the user already
 * left must not be asked again: it passes `active: false` while its page is hidden. When the
 * user agrees to leave, `onDiscard` drops the unsaved work so it does not come back later.
 */
type LeaveGuard = {
  isDirty: () => boolean;
  ask: () => Promise<boolean>;
  discard: () => void;
};

export type LeaveGuardOptions = {
  /** False while the editor's page is hidden; a hidden editor is never asked. */
  active?: boolean;
  /** Called after the user agreed to leave without saving. */
  onDiscard?: () => void;
};

const guards: LeaveGuard[] = [];

export async function confirmLeave(): Promise<boolean> {
  const agreed: LeaveGuard[] = [];
  for (const guard of [...guards].reverse()) {
    if (!guard.isDirty()) continue;
    if (!(await guard.ask())) return false;
    agreed.push(guard);
  }
  for (const guard of agreed) guard.discard();
  return true;
}

export function useLeaveGuard(
  dirty: boolean,
  ask: () => Promise<boolean>,
  options: LeaveGuardOptions = {}
) {
  const active = options.active ?? true;
  const dirtyRef = useRef(dirty && active);
  dirtyRef.current = dirty && active;
  const ownDirtyRef = useRef(dirty);
  ownDirtyRef.current = dirty;
  const askRef = useRef(ask);
  askRef.current = ask;
  const discardRef = useRef(options.onDiscard);
  discardRef.current = options.onDiscard;
  useEffect(() => {
    const guard: LeaveGuard = {
      isDirty: () => dirtyRef.current,
      ask: () => askRef.current(),
      discard: () => discardRef.current?.(),
    };
    guards.push(guard);
    return () => {
      const index = guards.indexOf(guard);
      if (index >= 0) guards.splice(index, 1);
    };
  }, []);
  /** Asks only this editor (its own back button). */
  return () => (ownDirtyRef.current ? askRef.current() : Promise.resolve(true));
}
