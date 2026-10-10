import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn, menuContentClass, menuItemClass } from './ui';

// Shared trigger-button styling for dropdown/picker triggers
// (GlassDateTimePicker, GlassTimePicker, …). Append a per-instance triggerClassName after it.
export const glassTriggerButtonClass =
  'inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border-muted bg-surface px-3 text-left text-xs font-medium text-text-secondary outline-none transition-colors hover:border-border hover:bg-surface-hover hover:text-text-primary focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-55';

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
          className={cn(menuContentClass, contentClassName)}
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
      className={cn(
        menuItemClass({ danger }),
        'min-h-8 w-full gap-2 px-3 py-2 text-left font-medium',
        description ? 'items-start' : 'items-center',
        selected && 'bg-accent-muted text-text-primary',
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

interface GlassMenuSubProps {
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
  contentClassName?: string;
}

export function GlassMenuSub({
  label,
  icon,
  disabled = false,
  children,
  contentClassName,
}: GlassMenuSubProps) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        disabled={disabled}
        className={cn(
          menuItemClass(),
          'min-h-8 w-full items-center gap-2 px-3 py-2 text-left font-medium'
        )}
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{label}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          sideOffset={4}
          collisionPadding={12}
          className={cn(menuContentClass, contentClassName)}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
