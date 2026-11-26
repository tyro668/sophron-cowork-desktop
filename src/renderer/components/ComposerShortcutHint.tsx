import { useTranslation } from 'react-i18next';
import { Kbd } from './ui';

/** "Enter 发送 · Ctrl + Enter 换行" hint shown under prompt composers. */
export function ComposerShortcutHint({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex select-none items-center justify-end gap-1 text-xs text-text-muted ${className}`}
    >
      <Kbd size="xs">Enter</Kbd>
      <span>{t('composer.shortcutSend')}</span>
      <span className="mx-0.5">·</span>
      <Kbd size="xs">Ctrl</Kbd>
      <span>+</span>
      <Kbd size="xs">Enter</Kbd>
      <span>{t('composer.shortcutNewline')}</span>
    </div>
  );
}
