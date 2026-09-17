import React from 'react';
import { cn } from './cn';

interface TabsContextValue {
  value: string;
  onValueChange?: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  onValueChange?: (value: string) => void;
}

export function Tabs({ value, onValueChange, className, ...rest }: TabsProps) {
  const context = React.useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
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
  ({ value, className, disabled, ...rest }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error('TabsTrigger must be used inside <Tabs>');
    const active = context.value === value;
    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={active}
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
  ({ value, forceMount = false, className, ...rest }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error('TabsContent must be used inside <Tabs>');
    const active = context.value === value;
    if (!active && !forceMount) return null;
    return (
      <div
        ref={ref}
        role="tabpanel"
        hidden={!active}
        data-state={active ? 'active' : 'inactive'}
        className={cn(className)}
        {...rest}
      />
    );
  }
);
TabsContent.displayName = 'TabsContent';
