import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { GlobalNotice, GlobalNoticeAction } from '../store';

interface Props {
  notice: GlobalNotice | null;
  onDismiss: () => void;
  onAction: (action: GlobalNoticeAction) => void;
}

const noticeToneClass: Record<GlobalNotice['type'], { border: string; text: string }> = {
  info: { border: 'border-border', text: 'text-text-primary' },
  warning: { border: 'border-warning/50', text: 'text-warning' },
  error: { border: 'border-error/50', text: 'text-error' },
  success: { border: 'border-success/50', text: 'text-success' },
};

export function GlobalNoticeToast({ notice, onDismiss, onAction }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => {
      onDismiss();
    }, 6000);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) {
    return null;
  }

  const tone = noticeToneClass[notice.type];
  const message = notice.messageKey ? t(notice.messageKey, notice.messageValues) : notice.message;
  const actionLabel =
    notice.actionLabel ||
    (notice.action === 'open_api_settings' ? t('api.openSettingsAction') : '');
  const noticeAction = notice.action;

  const handleActionClick = () => {
    if (notice.onAction) {
      notice.onAction();
      onDismiss();
      return;
    }
    if (noticeAction) {
      onAction(noticeAction);
    }
  };

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[10001] w-max max-w-[calc(100vw-2rem)]"
      role={notice.type === 'error' || notice.type === 'warning' ? 'alert' : 'status'}
      aria-live={notice.type === 'error' || notice.type === 'warning' ? 'assertive' : 'polite'}
    >
      <div className={`max-w-sm rounded-lg border bg-background shadow-elevated ${tone.border}`}>
        <div className="flex items-start gap-3 px-4 py-3">
          <div className={`flex-1 text-sm leading-relaxed ${tone.text}`}>{message}</div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-text-muted hover:text-text-primary transition-colors"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {(noticeAction || notice.onAction) && actionLabel && (
          <div className="px-4 pb-3">
            <button
              type="button"
              onClick={handleActionClick}
              className="w-full rounded-lg border border-accent/40 bg-accent-muted px-3 py-2.5 text-sm font-medium text-accent hover:bg-accent-muted transition-colors"
            >
              {actionLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
