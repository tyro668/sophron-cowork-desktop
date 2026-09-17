import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './cn';

/**
 * Canonical class strings for select surfaces — shared by the thin wrappers
 * below and by compatibility adapters (e.g. GlassSelect) that compose Radix
 * parts with custom trigger/item content. Solid surfaces, no blur.
 */
export const selectTriggerClass =
  'flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-border-muted bg-surface px-2.5 text-[13px] text-text-primary transition-colors ' +
  'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-text-muted [&>span]:truncate';

export const selectContentClass =
  'z-[10000] max-h-80 min-w-[8rem] overflow-hidden rounded-lg border border-border-subtle bg-surface text-text-primary shadow-elevated';

export const selectItemClass =
  'relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-2 pr-7 text-[13px] text-text-primary outline-none transition-colors ' +
  'data-[highlighted]:bg-accent-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectIcon = SelectPrimitive.Icon;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...rest }, ref) => (
  <SelectPrimitive.Trigger ref={ref} className={cn(selectTriggerClass, className)} {...rest}>
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', sideOffset = 4, ...rest }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={sideOffset}
      className={cn(
        selectContentClass,
        position === 'popper' && 'w-[var(--radix-select-trigger-width)]',
        className
      )}
      {...rest}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...rest }, ref) => (
  <SelectPrimitive.Item ref={ref} className={cn(selectItemClass, className)} {...rest}>
    <SelectPrimitive.ItemIndicator className="absolute right-1.5 flex items-center text-accent-text">
      <Check className="h-3.5 w-3.5" aria-hidden />
    </SelectPrimitive.ItemIndicator>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';
