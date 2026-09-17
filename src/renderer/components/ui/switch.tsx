import React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from './cn';

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...rest }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'relative inline-flex h-7 w-[52px] flex-shrink-0 cursor-pointer items-center rounded-full border p-[3px] outline-none transition-colors duration-150 ease-out',
      'focus-visible:ring-2 focus-visible:ring-accent/25',
      'disabled:cursor-not-allowed disabled:opacity-55',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=unchecked]:border-border data-[state=unchecked]:bg-surface-active',
      className
    )}
    {...rest}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'block h-[22px] w-[22px] transform-gpu rounded-full bg-white shadow-soft ring-1 transition-transform duration-150 ease-out will-change-transform',
        'data-[state=checked]:translate-x-6 data-[state=checked]:ring-white/70 data-[state=unchecked]:translate-x-0 data-[state=unchecked]:ring-border-muted'
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';
