import React from 'react';
import { cn } from './cn';

const EMPTY_PANELS: ReadonlySet<string> = new Set();

interface TabsContextValue {
  value: string;
  onValueChange?: (value: string) => void;
  /** Base id used to derive tab/panel DOM ids for aria wiring. */
  baseId: string;
  /** Values whose TabsContent panel is currently mounted. */
  panels: ReadonlySet<string>;
  registerPanel: (value: string) => void;
  unregisterPanel: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

/**
 * Tab/panel DOM ids derived from the Tabs instance's base id.
 * Useful for wiring panels that live outside `<TabsContent>`
 * (e.g. a shared panel whose content depends on the active tab).
 */
export function useTabsIds() {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('useTabsIds must be used inside <Tabs>');
  const { baseId } = context;
  return React.useMemo(
    () => ({
      tabId: (value: string) => `${baseId}-tab-${value}`,
      panelId: (value: string) => `${baseId}-panel-${value}`,
    }),
    [baseId]
  );
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  onValueChange?: (value: string) => void;
}

export function Tabs({ value, onValueChange, className, ...rest }: TabsProps) {
  const reactId = React.useId();
  const baseId = React.useMemo(() => `tabs-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId]);
  const [panels, setPanels] = React.useState<ReadonlySet<string>>(EMPTY_PANELS);
  const registerPanel = React.useCallback((panelValue: string) => {
    setPanels((prev) => (prev.has(panelValue) ? prev : new Set(prev).add(panelValue)));
  }, []);
  const unregisterPanel = React.useCallback((panelValue: string) => {
    setPanels((prev) => {
      if (!prev.has(panelValue)) return prev;
      const next = new Set(prev);
      next.delete(panelValue);
      return next;
    });
  }, []);
  const context = React.useMemo(
    () => ({ value, onValueChange, baseId, panels, registerPanel, unregisterPanel }),
    [value, onValueChange, baseId, panels, registerPanel, unregisterPanel]
  );
  return (
    <TabsContext.Provider value={context}>
      <div className={className} {...rest} />
    </TabsContext.Provider>
  );
}

/** Roving-tabindex tab list: Left/Right arrows move focus between tabs. */
export const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, onKeyDown, ...rest }, ref) => {
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const list = event.currentTarget;
      const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'));
      const index = tabs.indexOf(document.activeElement as HTMLElement);
      if (index === -1) return;
      event.preventDefault();
      const next =
        event.key === 'ArrowRight'
          ? tabs[(index + 1) % tabs.length]
          : tabs[(index - 1 + tabs.length) % tabs.length];
      next.focus();
    };
    return (
      <div
        ref={ref}
        role="tablist"
        onKeyDown={handleKeyDown}
        className={cn(
          'inline-flex items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-muted p-0.5',
          className
        )}
        {...rest}
      />
    );
  }
);
TabsList.displayName = 'TabsList';

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ value, className, disabled, id, ...rest }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error('TabsTrigger must be used inside <Tabs>');
    const active = context.value === value;
    const triggerId = id ?? `${context.baseId}-tab-${value}`;
    // aria-controls only points at a panel that actually exists — a mounted
    // TabsContent with this value, or an explicit aria-controls override.
    const controls = context.panels.has(value) ? `${context.baseId}-panel-${value}` : undefined;
    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        id={triggerId}
        aria-selected={active}
        aria-controls={controls}
        tabIndex={active ? 0 : -1}
        disabled={disabled}
        data-state={active ? 'active' : 'inactive'}
        onClick={() => context.onValueChange?.(value)}
        className={cn(
          'inline-flex h-7 select-none items-center justify-center whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
          'disabled:pointer-events-none disabled:opacity-50',
          active
            ? 'bg-surface text-text-primary shadow-soft'
            : 'text-text-secondary hover:text-text-primary',
          className
        )}
        {...rest}
      />
    );
  }
);
TabsTrigger.displayName = 'TabsTrigger';

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  /** Keep the panel mounted (hidden) when inactive. Defaults to false. */
  forceMount?: boolean;
}

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ value, forceMount = false, className, id, ...rest }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error('TabsContent must be used inside <Tabs>');
    const active = context.value === value;
    const panelId = id ?? `${context.baseId}-panel-${value}`;
    const { registerPanel, unregisterPanel } = context;
    React.useEffect(() => {
      // Only register while the panel is actually in the DOM — an unmounted
      // panel must not leave a dangling aria-controls reference on its tab.
      if (!active && !forceMount) return;
      registerPanel(value);
      return () => unregisterPanel(value);
    }, [registerPanel, unregisterPanel, value, active, forceMount]);
    if (!active && !forceMount) return null;
    return (
      <div
        ref={ref}
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${context.baseId}-tab-${value}`}
        tabIndex={0}
        hidden={!active}
        data-state={active ? 'active' : 'inactive'}
        className={cn(className)}
        {...rest}
      />
    );
  }
);
TabsContent.displayName = 'TabsContent';
