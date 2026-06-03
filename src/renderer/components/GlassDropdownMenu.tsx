import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

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
        'flex min-h-8 w-full cursor-default select-none items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium outline-none transition-colors disabled:pointer-events-none disabled:opacity-45',
        selected
          ? 'bg-accent/10 text-text-primary ring-1 ring-inset ring-accent/20'
          : danger
            ? 'text-error hover:bg-error/10 focus:bg-error/10'
            : 'text-text-secondary hover:bg-background/58 hover:text-text-primary focus:bg-background/58 focus:text-text-primary',
        className
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check className="h-4 w-4 shrink-0 text-accent" />}
    </DropdownMenu.Item>
  );
}
