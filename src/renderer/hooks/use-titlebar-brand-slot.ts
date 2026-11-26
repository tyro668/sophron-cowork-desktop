import { useSyncExternalStore } from 'react';

let slot: HTMLElement | null = null;
const subscribers = new Set<() => void>();

export function registerTitlebarBrandSlot(element: HTMLElement | null) {
  if (slot === element) return;
  slot = element;
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

export function useTitlebarBrandSlot() {
  return useSyncExternalStore(
    subscribe,
    () => slot,
    () => null
  );
}
