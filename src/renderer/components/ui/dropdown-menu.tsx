import React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from './cn';

/**
 * Canonical class strings for menu surfaces — shared by the thin wrappers
 * below and by compatibility adapters (e.g. GlassDropdownMenu) that compose
 * Radix parts with richer item content. Solid surfaces, no blur.
 */
export const menuContentClass =
  'z-[10000] min-w-[10rem] overflow-hidden rounded-lg border border-border-subtle bg-surface p-0 text-text-primary shadow-elevated';

export function menuItemClass(options?: { danger?: boolean }): string {
  return cn(
    'relative flex cursor-default select-none items-center rounded-none border-b border-border-subtle px-3 py-1.5 text-[13px] outline-none transition-colors last:border-b-0',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    options?.danger
      ? 'text-error data-[highlighted]:bg-error/10 data-[highlighted]:text-error'
      : 'text-text-primary data-[highlighted]:bg-accent-muted'
  );
}

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...rest }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(menuContentClass, className)}
      {...rest}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export interface DropdownMenuItemProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Item
> {
  /** Danger tone for destructive actions. */
  danger?: boolean;
}

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className, danger = false, ...rest }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(menuItemClass({ danger }), className)}
    {...rest}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...rest }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border-subtle', className)}
    {...rest}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...rest }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-xs text-text-muted', className)}
    {...rest}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';
