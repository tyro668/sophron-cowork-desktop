import { useTranslation } from 'react-i18next';

const SHORTCUTS: Array<{ keys: string[][]; labelKey: string }> = [
  { keys: [['Enter']], labelKey: 'settings.shortcutList.send' },
  { keys: [['Ctrl', 'Enter']], labelKey: 'settings.shortcutList.newline' },
  { keys: [['Ctrl', 'Z']], labelKey: 'settings.shortcutList.undo' },
  {
    keys: [
      ['Ctrl', 'Y'],
      ['Ctrl', 'Shift', 'Z'],
    ],
    labelKey: 'settings.shortcutList.redo',
  },
  { keys: [['Delete']], labelKey: 'settings.shortcutList.deleteNode' },
  { keys: [['Esc']], labelKey: 'settings.shortcutList.escape' },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border-muted bg-surface px-1.5 font-sans text-xs text-text-secondary">
      {children}
    </kbd>
  );
}

/** Read-only keyboard shortcut reference (settings › 快捷键). */
export function SettingsShortcuts() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary">{t('settings.shortcuts')}</h2>
        <p className="mt-1 text-[13px] text-text-muted">{t('settings.shortcutList.description')}</p>
      </div>
      <div className="overflow-hidden rounded-[10px] border border-border-muted bg-surface">
        {SHORTCUTS.map((item) => (
          <div
            key={item.labelKey}
            className="flex h-12 items-center justify-between border-b border-border-subtle px-4 last:border-b-0"
          >
            <span className="text-[13px] text-text-primary">{t(item.labelKey)}</span>
            <span className="flex items-center gap-2 text-xs text-text-muted">
              {item.keys.map((combo, index) => (
                <span key={combo.join('+')} className="flex items-center gap-1">
                  {index > 0 && <span className="mr-1">/</span>}
                  {combo.map((key, keyIndex) => (
                    <span key={key} className="flex items-center gap-1">
                      {keyIndex > 0 && <span>+</span>}
                      <Kbd>{key}</Kbd>
                    </span>
                  ))}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
