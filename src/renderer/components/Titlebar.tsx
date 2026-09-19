import { Minus, Square, X, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';

export function Titlebar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = () => {
    window.electronAPI?.window.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.window.maximize();
    setIsMaximized(!isMaximized);
  };

  const handleClose = () => {
    window.electronAPI?.window.close();
  };

  return (
    <div className="titlebar-drag flex h-10 shrink-0 items-center justify-end border-b border-border-subtle bg-[var(--glass-panel)]">
      {/* Window Controls (for Windows/Linux - macOS uses native traffic lights over the sidebar) */}
      {!isMac && (
        <div className="flex items-center titlebar-no-drag h-full">
          <button
            onClick={handleMinimize}
            className="w-12 h-full flex items-center justify-center hover:bg-surface-hover transition-colors"
            title={t('window.minimize')}
          >
            <Minus className="w-4 h-4 text-text-secondary" />
          </button>
          <button
            onClick={handleMaximize}
            className="w-12 h-full flex items-center justify-center hover:bg-surface-hover transition-colors"
            title={isMaximized ? t('window.restore') : t('window.maximize')}
          >
            {isMaximized ? (
              <Copy className="w-3.5 h-3.5 text-text-secondary" />
            ) : (
              <Square className="w-3.5 h-3.5 text-text-secondary" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="w-12 h-full flex items-center justify-center hover:bg-red-500 transition-colors group"
            title={t('window.close')}
          >
            <X className="w-4 h-4 text-text-secondary group-hover:text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
