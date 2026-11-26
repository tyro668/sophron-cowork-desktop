import type { ReactNode } from 'react';
import { ChevronDown, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';

type ThemeMode = 'light' | 'dark' | 'system';

interface SidebarFooterProps {
  authenticated: boolean;
  isDisconnected: boolean;
  authMenuOpen: boolean;
  isAuthBusy: boolean;
  isLoginBusy: boolean;
  isLogoutBusy: boolean;
  authDisplayName: string;
  authSecondaryText: string;
  authAccountMenu: ReactNode;
  theme: ThemeMode;
  isConfigured: boolean;
  renderAuthAvatar: (containerClassName: string, iconClassName: string) => ReactNode;
  onAuthMenuOpenChange: (open: boolean) => void;
  onLoginEntryClick: () => void;
  onSelectTheme: (theme: ThemeMode) => void;
  onOpenSettings: () => void;
}

export function SidebarFooter({
  authenticated,
  isDisconnected,
  authMenuOpen,
  isAuthBusy,
  isLoginBusy,
  isLogoutBusy,
  authDisplayName,
  authSecondaryText,
  authAccountMenu,
  theme,
  isConfigured,
  renderAuthAvatar,
  onAuthMenuOpenChange,
  onLoginEntryClick,
  onSelectTheme,
  onOpenSettings,
}: SidebarFooterProps) {
  const { t } = useTranslation();

  return (
    <div className="border-t border-border-subtle">
      <div className="flex h-12 w-full items-center items-stretch pl-3.5">
        {authenticated ? (
          <GlassDropdownMenu
            open={authMenuOpen}
            onOpenChange={onAuthMenuOpenChange}
            align="start"
            side="top"
            sideOffset={6}
            contentClassName="p-0"
            trigger={
              <button
                disabled={isLogoutBusy}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-2 text-left text-text-secondary transition-colors hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
                title={t('sidebar.accountMenu')}
              >
                {renderAuthAvatar('h-8 w-8', 'h-4 w-4')}
                <span
                  className={`flex min-w-0 flex-1 ${isDisconnected ? 'flex-col' : 'items-center gap-3'}`}
                >
                  <span className="min-w-0 truncate text-[13px] font-medium text-text-primary">
                    {authDisplayName || t('sidebar.loggedIn')}
                  </span>
                  <span className="text-[12px] font-medium text-text-muted">
                    {authSecondaryText}
                  </span>
                </span>
              </button>
            }
          >
            {authAccountMenu}
          </GlassDropdownMenu>
        ) : (
          <button
            onClick={onLoginEntryClick}
            disabled={isAuthBusy && !isLoginBusy}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-2 text-left text-text-secondary transition-colors hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
            title={isLoginBusy ? t('sidebar.cancelLogin') : t('sidebar.login')}
          >
            {renderAuthAvatar('h-8 w-8', 'h-4 w-4')}
            <span className="min-w-0 flex-shrink-0 text-[13px] font-medium text-text-primary">
              {isLoginBusy ? t('sidebar.cancelLogin') : t('sidebar.login')}
            </span>
            <span className="min-w-0 truncate text-[12px] font-medium text-text-muted">
              {authSecondaryText}
            </span>
          </button>
        )}

        <GlassDropdownMenu
          align="end"
          side="top"
          sideOffset={6}
          trigger={
            <button
              className="inline-flex flex-shrink-0 items-center gap-1 px-2 text-[12px] text-text-secondary h-full px-3 transition-colors hover:bg-surface-hover hover:text-text-primary"
              title={t('sidebar.themeToggle')}
            >
              {theme === 'dark' ? (
                <Moon className="h-3.5 w-3.5" />
              ) : theme === 'light' ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Monitor className="h-3.5 w-3.5" />
              )}
              {theme === 'dark'
                ? t('general.themeDark')
                : theme === 'light'
                  ? t('general.themeLight')
                  : t('general.themeSystem')}
              <ChevronDown className="h-3 w-3 text-text-muted" />
            </button>
          }
        >
          {(
            [
              ['light', t('general.themeLight'), Sun],
              ['dark', t('general.themeDark'), Moon],
              ['system', t('general.themeSystem'), Monitor],
            ] as const
          ).map(([value, label, Icon]) => (
            <GlassMenuItem
              key={value}
              icon={<Icon className="h-3.5 w-3.5" />}
              selected={theme === value}
              onSelect={() => onSelectTheme(value)}
            >
              {label}
            </GlassMenuItem>
          ))}
        </GlassDropdownMenu>
        <button
          onClick={onOpenSettings}
          className="relative flex flex-shrink-0 items-center justify-center text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary h-full w-10"
          title={t('sidebar.settings')}
        >
          <Settings className="h-4 w-4" />
          {!isConfigured && (
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />
          )}
        </button>
      </div>
    </div>
  );
}
