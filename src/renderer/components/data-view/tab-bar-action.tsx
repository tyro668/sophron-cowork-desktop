import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * List pages put their "+ 新建…" action at the far right of the top tab bar.
 * The page renders <TabBarActionSlot /> inside the tab bar and wraps its content in
 * the provider; panels render <TabBarAction> which portals into the slot (or renders
 * inline when no slot is present, e.g. isolated tests).
 */
const TabBarActionContext = createContext<HTMLElement | null>(null);

export function useTabBarActionSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return { slot, slotRef: setSlot, Provider: TabBarActionContext.Provider };
}

export function TabBarActionSlot({ slotRef }: { slotRef: (el: HTMLElement | null) => void }) {
  return (
    <div ref={slotRef} data-testid="tab-bar-action-slot" className="ml-auto flex items-stretch" />
  );
}

export function TabBarAction({ children }: { children: ReactNode }) {
  const slot = useContext(TabBarActionContext);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
