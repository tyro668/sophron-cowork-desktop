import { ChartNoAxesCombined, CircleDollarSign, Loader2, LogIn, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassMenuItem } from '../GlassDropdownMenu';

export interface SidebarAuthAvatarProps {
  authenticated: boolean;
  isAuthBusy: boolean;
  canUseAuthAvatar: boolean;
  authAvatarUrl: string;
  containerClassName: string;
  iconClassName: string;
  onAvatarError: (avatarUrl: string) => void;
}

export function SidebarAuthAvatar({
  authenticated,
  isAuthBusy,
  canUseAuthAvatar,
  authAvatarUrl,
  containerClassName,
  iconClassName,
  onAvatarError,
}: SidebarAuthAvatarProps) {
  const { t } = useTranslation();
  const showAnalyticsAvatar = authenticated && !canUseAuthAvatar && !isAuthBusy;

  return (
    <span
      className={`flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full border ${
        showAnalyticsAvatar
          ? 'border-accent/25 bg-accent-muted text-accent shadow-soft'
          : 'border-border-subtle bg-background text-text-secondary'
      } ${containerClassName}`}
    >
      {isAuthBusy ? (
        <Loader2 className={`${iconClassName} animate-spin`} />
      ) : canUseAuthAvatar ? (
        <img
          src={authAvatarUrl}
          alt={t('sidebar.accountAvatar')}
          className="h-full w-full object-cover"
          onError={() => onAvatarError(authAvatarUrl)}
        />
      ) : authenticated ? (
        <span className="relative flex h-full w-full items-center justify-center">
          <span className="absolute inset-0 bg-accent-muted" />
          <span className="absolute left-[18%] top-[22%] h-1.5 w-1.5 rounded-full bg-accent/35" />
          <span className="absolute bottom-[20%] right-[18%] h-2 w-2 rounded-full bg-accent-muted" />
          <ChartNoAxesCombined className={`relative z-10 ${iconClassName}`} />
        </span>
      ) : (
        <LogIn className={iconClassName} />
      )}
    </span>
  );
}

interface SidebarAuthAccountMenuProps {
  authenticated: boolean;
  isDisconnected: boolean;
  isAuthBusy: boolean;
  isLogoutBusy: boolean;
  canUseAuthAvatar: boolean;
  authAvatarUrl: string;
  authDisplayName: string;
  authSecondaryText: string;
  authCreditsLabel: string;
  authCreditsText: string;
  onAvatarError: (avatarUrl: string) => void;
  onLogout: () => void;
}

export function SidebarAuthAccountMenu({
  authenticated,
  isDisconnected,
  isAuthBusy,
  isLogoutBusy,
  canUseAuthAvatar,
  authAvatarUrl,
  authDisplayName,
  authSecondaryText,
  authCreditsLabel,
  authCreditsText,
  onAvatarError,
  onLogout,
}: SidebarAuthAccountMenuProps) {
  const { t } = useTranslation();

  return (
    <div className="w-64 p-1.5">
      <div className="flex items-center gap-3 rounded-lg px-2.5 py-2">
        <SidebarAuthAvatar
          authenticated={authenticated}
          isAuthBusy={isAuthBusy}
          canUseAuthAvatar={canUseAuthAvatar}
          authAvatarUrl={authAvatarUrl}
          containerClassName="h-9 w-9"
          iconClassName="h-4 w-4"
          onAvatarError={onAvatarError}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-5 text-text-primary">
            {authDisplayName || t('sidebar.loggedIn')}
          </div>
          {isDisconnected && <div className="text-xs text-text-muted">{authSecondaryText}</div>}
        </div>
      </div>
      <div className="mx-1 my-1 h-px bg-border-subtle" />
      <div className="mx-1 mb-1 flex items-center justify-between gap-3 rounded-lg bg-surface px-2.5 py-2 text-[12px]">
        <span className="flex min-w-0 items-center gap-2 font-medium text-text-secondary">
          <CircleDollarSign className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
          <span className="truncate">{authCreditsLabel}</span>
        </span>
        <span className="flex-shrink-0 font-semibold text-text-primary">{authCreditsText}</span>
      </div>
      <GlassMenuItem
        danger
        disabled={isLogoutBusy}
        icon={<LogOut className="h-3.5 w-3.5" />}
        onSelect={onLogout}
      >
        {t('sidebar.logout')}
      </GlassMenuItem>
    </div>
  );
}
