import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChannelBrandIcon } from './ChannelBrandIcon';
import { CHANNEL_STATE_DOT_CLASS, getChannelState } from './channel-state';
import type { RemoteChannelViewModel } from './types';

interface RemoteLogsOverviewSectionProps {
  channels: RemoteChannelViewModel[];
}

export function RemoteLogsOverviewSection({ channels }: RemoteLogsOverviewSectionProps) {
  const { t } = useTranslation();

  return (
    <section
      id="remote-panel-logs"
      role="tabpanel"
      aria-labelledby="remote-nav-tab-logs"
      className="bg-surface"
    >
      <div className="ui-group-title justify-between gap-2">
        <span>{t('remote.runtimeOverview')}</span>
        <span className="text-[11px] font-normal text-text-muted">
          {t('remote.runtimeOverviewDesc')}
        </span>
      </div>

      <div className="divide-y divide-border-subtle">
        {channels.map((channel) => {
          const channelState = getChannelState(channel);
          return (
            <div
              key={channel.type}
              className="flex h-10 items-center justify-between gap-3 px-4 transition-colors hover:bg-surface-hover/50"
            >
              <div className="flex items-center gap-2.5 text-[13px] font-medium text-text-primary">
                <ChannelBrandIcon type={channel.type} className="h-5 w-5" />
                {channel.name}
              </div>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-muted">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${CHANNEL_STATE_DOT_CLASS[channelState]}`}
                />
                <span>{t(`remote.channelState.${channelState}`)}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-border-subtle bg-surface-muted/35 px-4 py-2.5 text-[12px] text-text-muted">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span>{t('remote.fullLogsPending')}</span>
      </div>
    </section>
  );
}
