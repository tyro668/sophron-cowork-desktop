import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Clock3, Layers, Package, Plus, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassDropdownMenu } from '../GlassDropdownMenu';
import { Button } from '../ui';

interface SidebarCollapsedRailProps {
  isMac: boolean;
  forceCollapsed: boolean;
  titlebarBrandSlot: HTMLElement | null;
  renderBrand: (compact: boolean, showLogo?: boolean) => ReactNode;
  isDataPageActive: boolean;
  isSkillsPageActive: boolean;
  isAutomationPageActive: boolean;
  authenticated: boolean;
  authMenuOpen: boolean;
  isAuthBusy: boolean;
  isLoginBusy: boolean;
  isLogoutBusy: boolean;
  isConfigured: boolean;
  themeIcon: ReactNode;
  authAccountMenu: ReactNode;
  edgeHandle: ReactNode;
  renderAuthAvatar: (containerClassName: string, iconClassName: string) => ReactNode;
  onNewSession: () => void;
  onDataPage: () => void;
  onSkillsPage: () => void;
  onAutomationPage: () => void;
  onToggleSidebar: () => void;
  onAuthMenuOpenChange: (open: boolean) => void;
  onLoginEntryClick: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export function SidebarCollapsedRail({
  isMac,
  forceCollapsed,
  titlebarBrandSlot,
  renderBrand,
  isDataPageActive,
  isSkillsPageActive,
  isAutomationPageActive,
  authenticated,
  authMenuOpen,
  isAuthBusy,
  isLoginBusy,
  isLogoutBusy,
  isConfigured,
  themeIcon,
  authAccountMenu,
  edgeHandle,
  renderAuthAvatar,
  onNewSession,
  onDataPage,
  onSkillsPage,
  onAutomationPage,
  onToggleSidebar,
  onAuthMenuOpenChange,
  onLoginEntryClick,
  onToggleTheme,
  onOpenSettings,
}: SidebarCollapsedRailProps) {
  const { t } = useTranslation();

  return (
    <aside className="relative flex h-full w-[4.25rem] shrink-0 flex-col border-r border-border-subtle bg-background-secondary">
      {/* macOS traffic lights overlay the top of the rail — keep the strip clear + draggable */}
      {isMac && (
        <div
          data-testid="mac-sidebar-titlebar-row"
          className="titlebar-drag h-12 shrink-0 border-b border-border-subtle"
        />
      )}
      {!isMac && titlebarBrandSlot && createPortal(renderBrand(true), titlebarBrandSlot)}
      <div className="px-2.5 pt-3 pb-3 flex flex-col items-center gap-2 border-b border-border-subtle">
        <Button
          variant="primary"
          size="icon"
          onClick={onNewSession}
          className="rounded-xl shadow-soft"
          title={t('sidebar.newTask')}
          aria-label={t('sidebar.newTask')}
        >
          <Plus className="w-4 h-4" />
        </Button>
        <button
          onClick={onDataPage}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
            isDataPageActive
              ? 'bg-accent-muted text-accent'
              : 'text-text-secondary hover:bg-surface-hover'
          }`}
          title={t('mainNav.data')}
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          onClick={onSkillsPage}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
            isSkillsPageActive
              ? 'bg-accent-muted text-accent'
              : 'text-text-secondary hover:bg-surface-hover'
          }`}
          title={t('mainNav.skills')}
        >
          <Package className="w-4 h-4" />
        </button>
        <button
          onClick={onAutomationPage}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
            isAutomationPageActive
              ? 'bg-accent-muted text-accent'
              : 'text-text-secondary hover:bg-surface-hover'
          }`}
          title={t('mainNav.automation')}
        >
          <Clock3 className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-3 py-4">
        {!forceCollapsed && (
          <button
            onClick={onToggleSidebar}
            className="rounded-2xl px-2 py-3 text-[11px] leading-4 text-center text-text-muted hover:bg-surface-hover transition-colors"
            title={t('sidebar.expandToView')}
          >
            {t('sidebar.expandToView')}
          </button>
        )}
      </div>

      <div className="border-t border-border-subtle py-2 flex flex-col items-center gap-2">
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
                className="relative flex h-9 w-full items-center justify-center text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
                title={t('sidebar.accountMenu')}
              >
                {renderAuthAvatar('h-5 w-5', 'h-4 w-4')}
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-success" />
              </button>
            }
          >
            {authAccountMenu}
          </GlassDropdownMenu>
        ) : (
          <button
            onClick={onLoginEntryClick}
            disabled={isAuthBusy && !isLoginBusy}
            className="relative flex h-9 w-full items-center justify-center text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
            title={isLoginBusy ? t('sidebar.cancelLogin') : t('sidebar.login')}
          >
            {renderAuthAvatar('h-5 w-5 border-0 bg-transparent', 'h-4 w-4')}
          </button>
        )}
        <button
          onClick={onToggleTheme}
          className="w-full h-9 flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
          title={t('sidebar.themeToggle')}
        >
          {themeIcon}
        </button>
        <button
          onClick={onOpenSettings}
          className="w-full h-9 flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary relative"
          title={t('sidebar.settings')}
        >
          <Settings className="w-4 h-4" />
          {!isConfigured && (
            <span className="absolute right-2 top-2 w-1.5 h-1.5 rounded-full bg-accent" />
          )}
        </button>
      </div>
      {edgeHandle}
    </aside>
  );
}
