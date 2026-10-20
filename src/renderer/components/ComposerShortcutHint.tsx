import { useTranslation } from 'react-i18next';

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border-subtle bg-surface px-1 font-sans text-[10.5px] leading-4 text-text-secondary">
      {children}
    </kbd>
  );
}

/** "Enter 发送 · Ctrl + Enter 换行" hint shown under prompt composers. */
export function ComposerShortcutHint({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex select-none items-center justify-end gap-1 text-xs text-text-muted ${className}`}
    >
      <Kbd>Enter</Kbd>
      <span>{t('composer.shortcutSend')}</span>
      <span className="mx-0.5">·</span>
      <Kbd>Ctrl</Kbd>
      <span>+</span>
      <Kbd>Enter</Kbd>
      <span>{t('composer.shortcutNewline')}</span>
    </div>
  );
}
