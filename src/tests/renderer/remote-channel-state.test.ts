import { describe, expect, it } from 'vitest';
import {
  getChannelState,
  type RemoteChannelState,
} from '../../renderer/components/remote/channel-state';
import type { RemoteChannelViewModel } from '../../renderer/components/remote/types';

const baseChannel: RemoteChannelViewModel = {
  type: 'feishu',
  name: 'Feishu',
  description: 'Test channel',
  configured: true,
  enabled: true,
  connected: false,
  backendAvailable: true,
  authorizedUsers: 0,
};

describe('getChannelState', () => {
  it.each<{
    name: string;
    overrides: Partial<RemoteChannelViewModel>;
    expected: RemoteChannelState;
  }>([
    {
      name: 'preview takes precedence over runtime state',
      overrides: { backendAvailable: false, connected: true, error: 'stale error' },
      expected: 'preview',
    },
    {
      name: 'unconfigured takes precedence over stale runtime state',
      overrides: { configured: false, enabled: false, connected: true, error: 'stale error' },
      expected: 'unconfigured',
    },
    {
      name: 'disabled takes precedence over stale connection and error state',
      overrides: { enabled: false, connected: true, error: 'stale error' },
      expected: 'disabled',
    },
    {
      name: 'error takes precedence over connected',
      overrides: { connected: true, error: 'connection failed' },
      expected: 'error',
    },
    {
      name: 'connected is shown for a healthy active channel',
      overrides: { connected: true },
      expected: 'connected',
    },
    {
      name: 'stopped is the configured enabled fallback',
      overrides: {},
      expected: 'stopped',
    },
  ])('$name', ({ overrides, expected }) => {
    expect(getChannelState({ ...baseChannel, ...overrides })).toBe(expected);
  });
});
