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
