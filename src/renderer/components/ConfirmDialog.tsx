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
      className="max-w-[24rem] rounded-xl p-4"
      ariaLabelledBy={dialog ? titleId : undefined}
      ariaDescribedBy={dialog ? descriptionId : undefined}
    >
      {dialog ? (
        <>
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                isDanger ? 'bg-error/10 text-error' : 'bg-accent-muted text-accent'
              }`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <DialogTitle id={titleId} className="leading-6">
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
              <DialogDescription id={descriptionId} className="mt-1.5 leading-5">
                {dialog.message}
              </DialogDescription>
            </div>
          </div>

          <DialogFooter className="mt-4 pt-0">
            <Button size="sm" data-autofocus onClick={() => onClose(false)}>
              {dialog.cancelLabel ?? t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant={isDanger ? 'danger' : 'primary'}
              className="font-semibold"
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
