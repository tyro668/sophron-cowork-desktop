/**
 * Shared types for RemoteControlPanel sub-components
 */

export interface GatewayStatus {
  running: boolean;
  port?: number;
  publicUrl?: string;
  channels: Array<{ type: string; enabled: boolean; connected: boolean; error?: string }>;
  activeSessions: number;
  pendingPairings: number;
}

export interface PairedUser {
  userId: string;
  userName?: string;
  channelType: string;
  pairedAt: number;
  lastActiveAt: number;
}

export interface PairingRequest {
  code: string;
  channelType: string;
  userId: string;
  userName?: string;
  createdAt: number;
  expiresAt: number;
}

export type { RemoteConfig } from '../../../shared/contracts/remote';

export interface TunnelStatus {
  connected: boolean;
  url: string | null;
  provider: string;
  error?: string;
}

export type RemoteSection = 'channels' | 'users' | 'global' | 'logs';

export type ManualRemoteChannelType = 'feishu' | 'dingtalk' | 'wecom';
export type RemoteChannelType = ManualRemoteChannelType | 'lark' | 'wechat';

export type ChannelConfigTab = 'basic' | 'access' | 'advanced';

/** @deprecated Kept for the legacy step navigation component. */
export type ConfigStep = 'feishu' | 'connection' | 'advanced';

export interface RemoteChannelViewModel {
  type: RemoteChannelType;
  name: string;
  description: string;
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  backendAvailable: boolean;
  authorizedUsers: number;
  error?: string;
}

export type LocalizedBanner = { key?: string; text?: string | null };
