import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

// Shared trigger-button styling for glass dropdown/picker triggers
// (GlassDateTimePicker, GlassTimePicker, …). Append a per-instance triggerClassName after it.
export const glassTriggerButtonClass =
  'inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border-muted bg-background/42 px-3 text-left text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors hover:border-accent/25 hover:bg-surface-hover focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-55';

interface GlassDropdownMenuProps {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: DropdownMenu.DropdownMenuContentProps['align'];
  side?: DropdownMenu.DropdownMenuContentProps['side'];
  sideOffset?: number;
  contentClassName?: string;
}

export function GlassDropdownMenu({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'end',
  side = 'bottom',
  sideOffset = 8,
  contentClassName,
}: GlassDropdownMenuProps) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={12}
          className={cx(
            'z-50 overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] p-1 shadow-elevated backdrop-blur-xl',
            contentClassName
          )}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface GlassMenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  description?: ReactNode;
  className?: string;
  closeOnSelect?: boolean;
}

export function GlassMenuItem({
  children,
  onSelect,
  selected = false,
  danger = false,
  disabled = false,
  icon,
  description,
  className,
  closeOnSelect = true,
}: GlassMenuItemProps) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={(event) => {
        if (!closeOnSelect) {
          event.preventDefault();
        }
        onSelect?.();
      }}
      className={cx(
        'flex min-h-8 w-full cursor-default select-none gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium outline-none transition-colors disabled:pointer-events-none disabled:opacity-45',
        description ? 'items-start' : 'items-center',
        selected
          ? 'bg-accent/10 text-text-primary ring-1 ring-inset ring-accent/20'
          : danger
            ? 'text-error hover:bg-error/10 focus:bg-error/10'
            : 'text-text-secondary hover:bg-background/58 hover:text-text-primary focus:bg-background/58 focus:text-text-primary',
        className
      )}
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">{children}</span>
        {description && (
          <span className="truncate text-[12px] font-normal text-text-muted">{description}</span>
        )}
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-accent" />}
    </DropdownMenu.Item>
  );
}
