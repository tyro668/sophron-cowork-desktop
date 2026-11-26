import { useTranslation } from 'react-i18next';
import { Dialog, DialogTitle } from '../ui/dialog';

interface SidebarLoginDialogProps {
  open: boolean;
  apiOrigin?: string;
  onHide: () => void;
  onCancelLogin: () => void;
}

export function SidebarLoginDialog({
  open,
  apiOrigin,
  onHide,
  onCancelLogin,
}: SidebarLoginDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onHide();
      }}
      closeOnOverlayClick
      ariaLabelledBy="login-waiting-title"
      className="max-w-[400px] gap-0 overflow-hidden p-0"
    >
      <div className="flex h-11 items-center border-b border-border-subtle px-3">
        <DialogTitle id="login-waiting-title" className="text-[14px]">
          {t('sidebar.login')}
        </DialogTitle>
      </div>
      <div className="pb-3">
        <section className="ui-group bg-surface">
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{t('sidebar.loginMethodLabel')}</div>
            <div className="ui-form-value text-[13px]">{t('sidebar.loginMethodBrowser')}</div>
          </div>
          {apiOrigin && (
            <div className="ui-form-row">
              <div className="ui-form-label items-center">{t('sidebar.loginAddressLabel')}</div>
              <div
                className="ui-form-value truncate font-mono text-[12px] text-text-secondary"
                title={apiOrigin}
              >
                <span className="truncate">{apiOrigin}</span>
              </div>
            </div>
          )}
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{t('sidebar.loginStatusLabel')}</div>
            <div className="ui-form-value">
              <span className="flex items-center gap-2 text-[13px] text-text-secondary">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                {t('sidebar.loginWaitingBrowser')}
              </span>
            </div>
          </div>
        </section>
      </div>
      <div className="grid h-11 grid-cols-2 border-t border-border-subtle text-[13px] font-medium">
        <button
          type="button"
          onClick={onHide}
          className="border-r border-border-subtle text-text-secondary transition-colors hover:bg-surface-hover"
        >
          {t('sidebar.loginHideDialog')}
        </button>
        <button
          type="button"
          onClick={onCancelLogin}
          className="text-error transition-colors hover:bg-error/10"
        >
          {t('sidebar.cancelLogin')}
        </button>
      </div>
    </Dialog>
  );
}
