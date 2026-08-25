/**
 * Shared types for RemoteControlPanel sub-components
 */

export interface GatewayStatus {
  running: boolean;
  port?: number;
  publicUrl?: string;
  channels: Array<{ type: string; connected: boolean; error?: string }>;
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

export interface RemoteConfig {
  gateway: {
    enabled: boolean;
    port: number;
    bind: string;
    defaultWorkingDirectory?: string;
    autoApproveSafeTools?: boolean;
    tunnel?: {
      enabled: boolean;
      type: 'ngrok' | 'cloudflare' | 'frp';
      ngrok?: {
        authToken: string;
        region?: string;
      };
    };
    auth: {
      mode: string;
      token?: string;
      requirePairing?: boolean;
    };
  };
  channels: {
    feishu?: {
      appId: string;
      appSecret: string;
      useWebSocket?: boolean;
      dm: {
        policy: string;
      };
    };
    dingtalk?: {
      appKey: string;
      appSecret: string;
      robotCode?: string;
      receiveMode?: 'stream' | 'webhook';
      dm: {
        policy: string;
      };
      defaultGroupSettings?: {
        requireMention: boolean;
      };
    };
    wecom?: {
      receiveMode?: 'websocket' | 'webhook';
      botId: string;
      secret: string;
      wsUrl?: string;
      webhookToken?: string;
      webhookEncodingAESKey?: string;
      dm: {
        policy: string;
      };
      defaultGroupSettings?: {
        requireMention: boolean;
      };
    };
    slack?: {
      botToken: string;
      appToken?: string;
      useSocketMode?: boolean;
      dm: {
        policy: string;
      };
    };
  };
}

export interface TunnelStatus {
  connected: boolean;
  url: string | null;
  provider: string;
  error?: string;
}

export type RemoteSection = 'channels' | 'users' | 'global' | 'logs';

export type RemoteChannelType = 'feishu' | 'dingtalk' | 'wecom';

export type ChannelConfigTab = 'basic' | 'access' | 'advanced';

/** @deprecated Kept for the legacy step navigation component. */
export type ConfigStep = 'feishu' | 'connection' | 'advanced';

export interface RemoteChannelViewModel {
  type: RemoteChannelType;
  name: string;
  description: string;
  configured: boolean;
  connected: boolean;
  backendAvailable: boolean;
  authorizedUsers: number;
  error?: string;
}

export type LocalizedBanner = { key?: string; text?: string | null };
