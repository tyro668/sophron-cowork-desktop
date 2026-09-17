import React from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export interface DialogProps {
  open: boolean;
  /** Called when the dialog requests to close (Esc, overlay click, or consumer button). */
  onOpenChange?: (open: boolean) => void;
  /** While busy, Esc and overlay clicks are ignored (e.g. a destructive op in flight). */
  busy?: boolean;
  /** Whether clicking the overlay requests a close. Defaults to false (modals confirm explicitly). */
  closeOnOverlayClick?: boolean;
  className?: string;
  overlayClassName?: string;
  /** aria-label when no DialogTitle is rendered. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  children?: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Lightweight modal dialog primitive: portal, dimmed overlay, Esc-to-close,
 * Tab/Shift+Tab focus trap, initial focus (`[data-autofocus]` inside the panel,
 * else the panel itself) and focus restoration on close.
 */
export function Dialog({
  open,
  onOpenChange,
  busy = false,
  closeOnOverlayClick = false,
  className,
  overlayClassName,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  children,
}: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  // Latest-close ref keeps the open-lifecycle effect stable: changing the
  // consumer's onOpenChange identity must not re-run focus initialization.
  const requestCloseRef = React.useRef<() => void>(() => {});
  requestCloseRef.current = () => {
    if (!busy) onOpenChange?.(false);
  };

  React.useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // The panel itself counts as "outside" — Tab must move focus into items.
      const focusOutside = !active || active === panel || !panel.contains(active);
      if (event.shiftKey) {
        if (focusOutside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (focusOutside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    const panel = panelRef.current;
    const autofocus = panel?.querySelector<HTMLElement>('[data-autofocus]');
    (autofocus ?? panel)?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex items-center justify-center bg-black/40',
        overlayClassName
      )}
      onMouseDown={(event) => {
        if (closeOnOverlayClick && event.target === event.currentTarget) requestCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        className={cn(
          'mx-4 flex w-full max-w-md flex-col gap-3 rounded-2xl border border-border-subtle bg-surface p-5 text-text-primary shadow-elevated outline-none',
          className
        )}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export function DialogTitle({ className, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('text-[15px] font-semibold leading-snug text-text-primary', className)}
      {...rest}
    />
  );
}

export function DialogDescription({
  className,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-[13px] leading-relaxed text-text-secondary', className)} {...rest} />
  );
}

export function DialogFooter({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex justify-end gap-2 pt-1', className)} {...rest} />;
}
