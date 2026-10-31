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
  /** Optional 名称 row; when set the dialog renders label rows instead of the bare message. */
  name?: ReactNode;
  /** Optional 影响 row describing what else is affected. */
  impact?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  tone?: ConfirmTone;
  /** Optional checkbox (e.g. 同时删除处理脚本); read its final state from onChange. */
  option?: { label: ReactNode; defaultChecked?: boolean; onChange: (checked: boolean) => void };
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
              {dialog.name != null ? (
                <>
                  <DialogDescription id={descriptionId} className="sr-only">
                    {dialog.message}
                  </DialogDescription>
                  <div className="ui-form-row">
                    <span className="ui-form-label items-center">
                      {t('common.confirmNameLabel', '名称')}
                    </span>
                    <div className="ui-form-value break-all text-[13px] text-text-primary">
                      {dialog.name}
                    </div>
                  </div>
                  {dialog.impact != null && (
                    <div className="ui-form-row">
                      <span className="ui-form-label items-center">
                        {t('common.confirmImpactLabel', '影响')}
                      </span>
                      <div className="ui-form-value text-[12.5px] text-text-muted">
                        {dialog.impact}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <DialogDescription
                  id={descriptionId}
                  className="px-3 py-2.5 text-[13px] leading-5 text-text-secondary"
                >
                  {dialog.message}
                </DialogDescription>
              )}
              {dialog.option ? <ConfirmOption key={titleId} option={dialog.option} /> : null}
              {isDanger && (
                <div className="flex items-center gap-1.5 border-t border-border-subtle bg-error/5 px-3 py-1.5 text-xs text-error">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t('common.irreversible', '删除后无法恢复')}
                </div>
              )}
            </section>

            <DialogFooter className="ui-footer-split">
              <Button
                size="sm"
                variant="ghost"
                data-autofocus

                onClick={() => onClose(false)}
              >
                {dialog.cancelLabel ?? t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant={isDanger ? 'ghost' : 'primary'}
                className={isDanger ? 'font-semibold text-error hover:bg-error/5' : 'font-semibold'}
                onClick={() => onClose(true)}
              >
                {dialog.confirmLabel ?? t('common.yes')}
              </Button>
            </DialogFooter>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

function ConfirmOption({ option }: { option: NonNullable<ConfirmDialogOptions['option']> }) {
  const [checked, setChecked] = useState(Boolean(option.defaultChecked));
  return (
    <label
      className="flex cursor-pointer items-center gap-2 border-t border-border-subtle px-3 py-2 text-[12.5px] text-text-secondary"
      data-testid="confirm-option"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          setChecked(event.target.checked);
          option.onChange(event.target.checked);
        }}
        className="h-3.5 w-3.5 accent-accent"
      />
      {option.label}
    </label>
  );
}
