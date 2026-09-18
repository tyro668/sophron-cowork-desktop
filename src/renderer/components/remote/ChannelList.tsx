import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { ChannelBrandIcon } from './ChannelBrandIcon';
import { getChannelState } from './channel-state';
import type { RemoteChannelType, RemoteChannelViewModel } from './types';

interface Props {
  channels: RemoteChannelViewModel[];
  onSelect: (channel: RemoteChannelType) => void;
  onManage: (channel: RemoteChannelType) => void;
}

export function ChannelList({ channels, onSelect, onManage }: Props) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('remote.channelListTitle')} className="space-y-3">
      {channels.map((channel) => {
        const state = getChannelState(channel);
        return (
          <div
            key={channel.type}
            className="flex items-center gap-3 rounded-xl border border-border-muted bg-surface p-4"
          >
            <div className="rounded-xl bg-surface-active p-2">
              <ChannelBrandIcon type={channel.type} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-text-primary">{channel.name}</h3>
                {channel.configured && (
                  <span
                    className={state === 'error' ? 'text-xs text-error' : 'text-xs text-text-muted'}
                  >
                    {t(`remote.channelState.${state}`)}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-text-secondary break-words">
                {channel.error || t('remote.channelSummary', { channel: channel.name })}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
              {channel.configured && (
                <Button variant="ghost" onClick={() => onManage(channel.type)}>
                  {t('remote.manageChannel')}
                </Button>
              )}
              <Button variant="primary" onClick={() => onSelect(channel.type)}>
                {t('remote.configureChannel')}
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
