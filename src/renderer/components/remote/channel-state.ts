import type { RemoteChannelViewModel } from './types';

export type RemoteChannelState =
  | 'preview'
  | 'unconfigured'
  | 'disabled'
  | 'error'
  | 'connected'
  | 'stopped';

/** Resolve the single user-visible state shared by every remote-channel view. */
export function getChannelState(channel: RemoteChannelViewModel): RemoteChannelState {
  if (!channel.backendAvailable) return 'preview';
  if (!channel.configured) return 'unconfigured';
  if (!channel.enabled) return 'disabled';
  if (channel.error) return 'error';
  if (channel.connected) return 'connected';
  return 'stopped';
}

/** Status dot color per channel state — semantic colors stay stable across themes. */
export const CHANNEL_STATE_DOT_CLASS = {
  connected: 'bg-success',
  error: 'bg-error',
  stopped: 'bg-text-muted',
  disabled: 'bg-text-muted',
  unconfigured: 'bg-text-muted',
  preview: 'bg-text-muted',
} satisfies Record<RemoteChannelState, string>;
