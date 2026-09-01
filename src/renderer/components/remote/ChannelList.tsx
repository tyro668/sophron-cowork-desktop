import { Plus, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChannelBrandIcon } from './ChannelBrandIcon';
import { getChannelState, type RemoteChannelState } from './channel-state';
import type { RemoteChannelType, RemoteChannelViewModel } from './types';

const CHANNEL_STATE_BADGE_CLASS = {
  connected: 'bg-success/10 text-success',
  error: 'bg-error/10 text-error',
  stopped: 'bg-warning/10 text-warning',
  disabled: 'bg-surface-active text-text-muted',
  unconfigured: 'bg-surface-active text-text-muted',
  preview: 'bg-surface-active text-text-muted',
} satisfies Record<RemoteChannelState, string>;

const CHANNEL_STATE_DOT_CLASS = {
  connected: 'bg-success',
  error: 'bg-error',
  stopped: 'bg-warning',
  disabled: 'bg-text-muted',
  unconfigured: 'bg-text-muted',
  preview: 'bg-text-muted',
} satisfies Record<RemoteChannelState, string>;

interface Props {
  channels: RemoteChannelViewModel[];
  selectedChannel: RemoteChannelType;
  onSelect: (channel: RemoteChannelType) => void;
}

export function ChannelList({ channels, selectedChannel, onSelect }: Props) {
  const { t } = useTranslation();

  return (
    <section className="glass-card overflow-hidden rounded-2xl border border-border-subtle shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle p-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t('remote.channelListTitle')}
          </h3>
          <p className="mt-1 text-xs text-text-muted">{t('remote.channelListDesc')}</p>
        </div>
        <button
          type="button"
          disabled
          className="flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-white opacity-55"
          title={t('remote.channelAddHint')}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('remote.addChannel')}
        </button>
      </div>

      <div className="space-y-1.5 p-2">
        {channels.map((channel) => {
          const isSelected = selectedChannel === channel.type;
          const state = getChannelState(channel);

          return (
            <button
              key={channel.type}
              type="button"
              onClick={() => onSelect(channel.type)}
              className={`grid w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                isSelected
                  ? 'border-accent/50 bg-accent/10 shadow-soft'
                  : 'border-transparent hover:border-border-subtle hover:bg-surface-hover/60'
              }`}
            >
              <ChannelBrandIcon type={channel.type} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text-primary">
                  {channel.name}
                </span>
                <span className="mt-1 block truncate text-xs text-text-muted">
                  {channel.error || channel.description}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${CHANNEL_STATE_BADGE_CLASS[state]}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${CHANNEL_STATE_DOT_CLASS[state]}`} />
                  {t(`remote.channelState.${state}`)}
                </span>
                <ChevronRight
                  className={`h-4 w-4 ${isSelected ? 'text-accent' : 'text-text-muted'}`}
                />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
