import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogHeader, DialogTitle, Input } from '../ui';

interface SidebarRenameDialogProps {
  open: boolean;
  title: string;
  onTitleChange: (title: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function SidebarRenameDialog({
  open,
  title,
  onTitleChange,
  onClose,
  onSubmit,
}: SidebarRenameDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      ariaLabel={t('sidebar.renameTaskTitle')}
      className="ui-dialog-pad max-w-sm"
    >
      <DialogHeader>
        <DialogTitle>{t('sidebar.renameTaskTitle')}</DialogTitle>
      </DialogHeader>
      <div className="ui-group bg-surface">
        <div className="ui-form-row">
          <span className="ui-form-label items-center">{t('sidebar.taskNameLabel')}</span>
          <div className="ui-form-value">
            <Input
              data-autofocus
              aria-label={t('sidebar.taskNameLabel')}
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              className="h-8 text-[13px]"
            />
          </div>
        </div>
      </div>
      <div className="ui-footer-split">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={!title.trim()} onClick={onSubmit}>
          {t('common.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
