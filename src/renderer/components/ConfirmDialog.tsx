import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { Button, Dialog, DialogDescription, DialogFooter, DialogTitle } from './ui';

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
      <ConfirmDialogOverlay dialog={activeDialog} onClose={close} />
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

/** Like useConfirmDialog, but returns null outside a provider (embedded / test renders). */
export function useOptionalConfirmDialog() {
  return useContext(ConfirmDialogContext);
}

function ConfirmDialogOverlay({
  dialog,
  onClose,
}: {
  dialog: ActiveConfirmDialog | null;
  onClose: (confirmed: boolean) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const isDanger = dialog?.tone === 'danger';
  const Icon = isDanger ? Trash2 : AlertTriangle;

  return (
    <Dialog
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open) onClose(false);
      }}
      closeOnOverlayClick
      overlayClassName="px-4"
      className="max-w-[24rem] gap-0 overflow-hidden rounded-xl p-0"
      ariaLabelledBy={dialog ? titleId : undefined}
      ariaDescribedBy={dialog ? descriptionId : undefined}
    >
      {dialog ? (
        <>
          <div className="flex h-11 items-center justify-between gap-2 border-b border-border-subtle px-3">
            <DialogTitle id={titleId} className="flex items-center gap-2 text-[14px] leading-6">
              <Icon className={`h-4 w-4 ${isDanger ? 'text-error' : 'text-accent'}`} />
              {dialog.title ?? t('common.confirmTitle', '确认操作？')}
            </DialogTitle>
            <button
              type="button"
              onClick={() => onClose(false)}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
              aria-label={t('common.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="ui-dialog-pad p-3">
            <section className="ui-group bg-surface">
              <DialogDescription
                id={descriptionId}
                className="px-3 py-2.5 text-[13px] leading-5 text-text-secondary"
              >
                {dialog.message}
              </DialogDescription>
              {isDanger && (
                <div className="flex items-center gap-1.5 border-t border-border-subtle bg-error/5 px-3 py-1.5 text-xs text-error">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t('common.irreversible', '删除后无法恢复')}
                </div>
              )}
            </section>
          </div>

          <DialogFooter className="mt-0 grid grid-cols-2 gap-0 border-t border-border-subtle p-0">
            <Button
              size="sm"
              variant="ghost"
              data-autofocus
              className="h-10 rounded-none"
              onClick={() => onClose(false)}
            >
              {dialog.cancelLabel ?? t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant={isDanger ? 'danger' : 'primary'}
              className="h-10 rounded-none font-semibold"
              onClick={() => onClose(true)}
            >
              {dialog.confirmLabel ?? t('common.yes')}
            </Button>
          </DialogFooter>
        </>
      ) : null}
    </Dialog>
  );
}
