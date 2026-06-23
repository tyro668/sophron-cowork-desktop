import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Trash2, X } from 'lucide-react';

type ConfirmTone = 'default' | 'danger';

export interface ConfirmDialogOptions {
  title?: ReactNode;
  message: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  tone?: ConfirmTone;
}

interface ConfirmDialogContextValue {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  confirmDelete: (options: ConfirmDialogOptions) => Promise<boolean>;
}

interface ActiveConfirmDialog extends ConfirmDialogOptions {
  tone: ConfirmTone;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [activeDialog, setActiveDialog] = useState<ActiveConfirmDialog | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const close = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setActiveDialog(null);
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setActiveDialog({ ...options, tone: options.tone ?? 'default' });
    });
  }, []);

  const confirmDelete = useCallback(
    (options: ConfirmDialogOptions) =>
      confirm({
        title: t('common.confirmDeleteTitle', '确认删除？'),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        ...options,
        tone: 'danger',
      }),
    [confirm, t]
  );

  const value = useMemo<ConfirmDialogContextValue>(
    () => ({ confirm, confirmDelete }),
    [confirm, confirmDelete]
  );

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      {activeDialog ? <ConfirmDialogOverlay dialog={activeDialog} onClose={close} /> : null}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const context = useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error('useConfirmDialog must be used within ConfirmDialogProvider');
  }
  return context;
}

function ConfirmDialogOverlay({
  dialog,
  onClose,
}: {
  dialog: ActiveConfirmDialog;
  onClose: (confirmed: boolean) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const isDanger = dialog.tone === 'danger';
  const Icon = isDanger ? Trash2 : AlertTriangle;

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/24 px-4 backdrop-blur-[2px]"
      onMouseDown={() => onClose(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="glass-card w-full max-w-[24rem] rounded-xl border border-border-muted bg-background/95 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.22)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
              isDanger ? 'bg-error/10 text-error' : 'bg-accent/10 text-accent'
            }`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 id={titleId} className="text-[15px] font-semibold leading-6 text-text-primary">
                {dialog.title ?? t('common.confirmTitle', '确认操作？')}
              </h2>
              <button
                type="button"
                onClick={() => onClose(false)}
                className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div id={descriptionId} className="mt-1.5 text-[13px] leading-5 text-text-secondary">
              {dialog.message}
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={() => onClose(false)}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border-muted bg-background/70 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
          >
            {dialog.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onClose(true)}
            className={`inline-flex h-8 items-center justify-center rounded-lg px-3 text-xs font-semibold text-white shadow-soft transition-colors focus:outline-none focus-visible:ring-2 ${
              isDanger
                ? 'bg-error hover:bg-error/90 focus-visible:ring-error/25'
                : 'bg-accent hover:bg-accent-hover focus-visible:ring-accent/25'
            }`}
          >
            {dialog.confirmLabel ?? t('common.yes')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
