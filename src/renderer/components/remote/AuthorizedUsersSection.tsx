/**
 * AuthorizedUsersSection — flush list of paired users with revoke option
 */

import { useTranslation } from 'react-i18next';
import { Users, Trash2, UserRoundCheck } from 'lucide-react';
import { formatAppDate } from '../../utils/i18n-format';
import type { PairedUser } from './types';

interface Props {
  pairedUsers: PairedUser[];
  onRevoke: (user: PairedUser) => void;
}

export function AuthorizedUsersSection({ pairedUsers, onRevoke }: Props) {
  const { t } = useTranslation();

  return (
    <section className="bg-surface">
      <div className="ui-group-title justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-text-muted" />
          {t('remote.authorizedUsersTitle', { count: pairedUsers.length })}
        </span>
        {pairedUsers.length > 0 && (
          <span role="status" className="text-[11.5px] font-medium text-success">
            {t('remote.authorizedUsersReady')}
          </span>
        )}
      </div>

      {pairedUsers.length === 0 ? (
        <div className="flex min-h-36 flex-col items-center justify-center px-4 py-8 text-center">
          <UserRoundCheck className="h-6 w-6 text-text-muted" />
          <p className="mt-2.5 text-[13px] font-medium text-text-secondary">
            {t('remote.noAuthorizedUsers')}
          </p>
          <p className="mt-1 text-[12px] text-text-muted">{t('remote.noAuthorizedUsersDesc')}</p>
        </div>
      ) : (
        <div className="divide-y divide-border-subtle">
          {pairedUsers.map((user) => (
            <div
              key={`${user.channelType}-${user.userId}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover/50"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-muted text-accent">
                  <Users className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-text-primary">
                      {user.userName || user.userId.slice(0, 12) + '...'}
                    </span>
                    <span className="shrink-0 rounded bg-accent-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-accent">
                      {user.channelType}
                    </span>
                  </div>
                  <div className="text-[11.5px] text-text-muted">
                    {formatAppDate(user.lastActiveAt)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRevoke(user)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-error/10 hover:text-error"
                title={t('remote.revokeAccess')}
                aria-label={t('remote.revokeAccess')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
