import { Check, ScrollText } from 'lucide-react';
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
      className="rounded-md border border-border-subtle p-3"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-accent-muted p-2.5">
          <ScrollText className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{t('remote.runtimeOverview')}</h3>
          <p className="mt-1 text-xs text-text-muted">{t('remote.runtimeOverviewDesc')}</p>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {channels.map((channel) => {
          const channelState = getChannelState(channel);
          return (
            <div
              key={channel.type}
              className="flex items-center justify-between gap-3 rounded-md bg-surface-hover p-2.5"
            >
              <div className="flex items-center gap-2.5 text-sm text-text-secondary">
                <ChannelBrandIcon type={channel.type} className="h-7 w-7" />
                {channel.name}
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${CHANNEL_STATE_DOT_CLASS[channelState]}`}
                />
                <span>{t(`remote.channelState.${channelState}`)}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-md border border-dashed border-border p-4 text-xs text-text-muted">
        <Check className="h-4 w-4" />
        {t('remote.fullLogsPending')}
      </div>
    </section>
  );
}
