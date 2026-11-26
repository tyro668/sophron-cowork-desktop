import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { ChannelBrandIcon } from './ChannelBrandIcon';
import { CHANNEL_STATE_DOT_CLASS, getChannelState } from './channel-state';
import type { RemoteChannelType, RemoteChannelViewModel } from './types';

interface Props {
  channels: RemoteChannelViewModel[];
  onSelect: (channel: RemoteChannelType) => void;
  onManage: (channel: RemoteChannelType) => void;
}

export function ChannelList({ channels, onSelect, onManage }: Props) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('remote.channelListTitle')}
      className="divide-y divide-border-subtle bg-surface"
    >
      {channels.map((channel) => {
        const state = getChannelState(channel);
        const configured = channel.configured;
        return (
          <div
            key={channel.type}
            className="flex min-h-[52px] items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-hover/50"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-muted">
              <ChannelBrandIcon type={channel.type} className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-medium text-text-primary">{channel.name}</h3>
                {configured && (
                  <span
                    className={`inline-flex items-center gap-1 text-[11.5px] ${
                      state === 'error' ? 'text-error' : 'text-text-muted'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${CHANNEL_STATE_DOT_CLASS[state]}`}
                    />
                    {t(`remote.channelState.${state}`)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[12px] text-text-muted">
                {channel.error || channel.description}
              </p>
            </div>
            <div className="flex shrink-0 items-center">
              {configured ? (
                <button
                  type="button"
                  onClick={() => onManage(channel.type)}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-active hover:text-text-primary"
                >
                  {t('remote.manageChannel')}
                  <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(channel.type)}
                  className="ui-accent-cell h-7 rounded-md px-2.5"
                >
                  {t('remote.configureChannel')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
