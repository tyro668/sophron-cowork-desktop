import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info, X } from 'lucide-react';
import { cn } from './cn';

export type InlineBannerTone = 'info' | 'success' | 'warning' | 'error';

export interface InlineBannerProps {
  tone?: InlineBannerTone;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Raw technical detail, collapsed behind "查看原始信息". */
  detail?: string;
  detailLabel?: string;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const toneClasses: Record<InlineBannerTone, string> = {
  info: 'border-accent/25 bg-accent-muted text-accent-text',
  success: 'border-success/25 bg-success/8 text-success',
  warning: 'border-warning/30 bg-warning/8 text-warning',
  error: 'border-error/30 bg-error/6 text-error',
};

const toneIcons: Record<InlineBannerTone, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

/** Persistent, in-place banner for errors and warnings (replaces transient toasts). */
export function InlineBanner({
  tone = 'error',
  title,
  description,
  detail,
  detailLabel = '查看原始信息',
  actions,
  onDismiss,
  className,
}: InlineBannerProps) {
  const [open, setOpen] = useState(false);
  const Icon = toneIcons[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]',
        toneClasses[tone],
        className
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-text-primary">{title}</div>
        {description && <div className="mt-0.5 leading-5 text-text-secondary">{description}</div>}
        {detail && (
          <div className="mt-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
              onClick={() => setOpen((v) => !v)}
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
              {detailLabel}
            </button>
            {open && (
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-muted p-2 font-mono text-xs text-text-secondary">
                {detail}
              </pre>
            )}
          </div>
        )}
        {actions && <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="关闭"
          className="h-5 w-5 shrink-0 rounded text-text-muted hover:bg-surface-hover hover:text-text-primary"
          onClick={onDismiss}
        >
          <X className="mx-auto h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
