import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useIPC } from '../hooks/useIPC';
import type { SudoPasswordRequest } from '../types';
import { Shield, X, Play } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input } from './ui/input';

interface SudoPasswordDialogProps {
  request: SudoPasswordRequest;
}

export function SudoPasswordDialog({ request }: SudoPasswordDialogProps) {
  const { t } = useTranslation();
  const { respondToSudoPassword } = useIPC();
  // Use ref so the password never lives in React state / re-render cycle
  const passwordRef = useRef<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Capture ref values for safe use in cleanup
    const inputEl = inputRef.current;
    // Clear the password from memory when the dialog unmounts
    return () => {
      passwordRef.current = '';
      if (inputEl) {
        inputEl.value = '';
      }
    };
  }, []);

  const handleSubmit = () => {
    const pwd = passwordRef.current;
    if (!pwd) return;
    respondToSudoPassword(request.toolUseId, pwd);
    // Wipe immediately after sending
    passwordRef.current = '';
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleCancel = () => {
    respondToSudoPassword(request.toolUseId, null);
    passwordRef.current = '';
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={handleCancel}
      ariaLabelledBy="sudo-dialog-title"
      overlayClassName="animate-fade-in bg-black/20"
      className="animate-slide-up gap-0 p-6"
    >
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-warning/10">
          <Shield className="w-6 h-6 text-warning" />
        </div>

        <div className="flex-1">
          <h2 id="sudo-dialog-title" className="text-lg font-semibold text-text-primary">
            {t('sudo.title')}
          </h2>
          <p className="text-sm text-text-secondary mt-1">{t('sudo.description')}</p>
        </div>
      </div>

      <div className="ui-dialog-pad mt-4">
        <section className="ui-group bg-surface">
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{t('sudo.commandLabel')}</div>
            <div className="ui-form-value py-2">
              <pre className="text-xs code-block max-h-32 overflow-auto whitespace-pre-wrap break-all">
                {request.command}
              </pre>
            </div>
          </div>
          <div className="ui-form-row">
            <label htmlFor="sudo-password" className="ui-form-label items-center">
              {t('sudo.passwordLabel')}
            </label>
            <div className="ui-form-value">
              <Input
                id="sudo-password"
                ref={inputRef}
                type="password"
                data-autofocus
                onChange={(e) => {
                  passwordRef.current = e.target.value;
                }}
                onKeyDown={handleKeyDown}
                placeholder={t('sudo.passwordPlaceholder')}
                className="h-8 px-2.5"
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="border-t border-border-subtle bg-warning/10 px-3 py-2">
            <p className="text-xs text-warning">{t('sudo.warning')}</p>
          </div>
        </section>
      </div>

      {/* Actions */}
      <div className="mt-6 flex items-center gap-3">
        <Button variant="secondary" onClick={handleCancel} className="flex-1">
          <X className="w-4 h-4" />
          {t('sudo.cancel')}
        </Button>

        <Button variant="primary" onClick={handleSubmit} className="flex-1">
          <Play className="w-4 h-4" />
          {t('sudo.execute')}
        </Button>
      </div>
    </Dialog>
  );
}
