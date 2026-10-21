import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
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
    <section aria-label={t('remote.channelListTitle')} className="ui-group bg-surface">
      {channels.map((channel) => {
        const state = getChannelState(channel);
        const configured = channel.configured;
        return (
          <div
            key={channel.type}
            className="flex items-center gap-3 border-b border-border-subtle px-3 py-2.5 last:border-b-0"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-active">
              <ChannelBrandIcon type={channel.type} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-text-primary">{channel.name}</h3>
                {configured && (
                  <span
                    className={`inline-flex items-center gap-1 text-xs ${
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
              <p className="mt-0.5 truncate text-xs text-text-secondary">
                {channel.error || channel.description}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {configured ? (
                <Button variant="ghost" size="sm" onClick={() => onManage(channel.type)}>
                  {t('remote.manageChannel')}
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => onSelect(channel.type)}>
                  {t('remote.configureChannel')}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
