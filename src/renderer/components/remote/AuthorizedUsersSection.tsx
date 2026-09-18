/**
 * AuthorizedUsersSection — list of paired users with revoke option
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
    <div className="rounded-2xl border border-border-subtle p-4">
      <h3 className="font-medium text-text-primary mb-3 flex items-center gap-2">
        <Users className="w-4 h-4" />
        {t('remote.authorizedUsersTitle', { count: pairedUsers.length })}
      </h3>
      {pairedUsers.length > 0 && (
        <p role="status" className="mb-3 text-sm text-success">
          {t('remote.authorizedUsersReady')}
        </p>
      )}
      {pairedUsers.length === 0 ? (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center">
          <UserRoundCheck className="h-7 w-7 text-text-muted" />
          <p className="mt-3 text-sm font-medium text-text-secondary">
            {t('remote.noAuthorizedUsers')}
          </p>
          <p className="mt-1 text-xs text-text-muted">{t('remote.noAuthorizedUsersDesc')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pairedUsers.map((user) => (
            <div
              key={`${user.channelType}-${user.userId}`}
              className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface p-3 shadow-soft"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-accent-muted flex items-center justify-center">
                  <Users className="w-4 h-4 text-accent" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary text-sm">
                      {user.userName || user.userId.slice(0, 12) + '...'}
                    </span>
                    <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-medium capitalize text-accent">
                      {user.channelType}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted">{formatAppDate(user.lastActiveAt)}</div>
                </div>
              </div>
              <button
                onClick={() => onRevoke(user)}
                className="p-2 rounded-lg hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                title={t('remote.revokeAccess')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
