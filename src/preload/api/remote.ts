import { ipcRenderer } from 'electron';
import type {
  ChannelType,
  ControllableChannelType,
  DingtalkChannelConfig,
  FeishuChannelConfig,
  GatewayConfig,
  PairedUser,
  PairingRequest,
  RemoteChannelToggleResult,
  RemoteConfig,
  RemoteSessionMapping,
  WecomChannelConfig,
} from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createRemoteApi(): ElectronApi['remote'] {
  return {
    beginQrSetup: (id, channel) => ipcRenderer.invoke('remote.beginQrSetup', id, channel),
    getQrSetup: (id) => ipcRenderer.invoke('remote.getQrSetup', id),
    submitQrSetupCode: (id, code) => ipcRenderer.invoke('remote.submitQrSetupCode', id, code),
    cancelQrSetup: (id) => ipcRenderer.invoke('remote.cancelQrSetup', id),
    getConfig: (): Promise<RemoteConfig> => ipcRenderer.invoke('remote.getConfig'),
    getStatus: (): Promise<{
      running: boolean;
      port?: number;
      publicUrl?: string;
      channels: Array<{ type: string; enabled: boolean; connected: boolean; error?: string }>;
      activeSessions: number;
      pendingPairings: number;
    }> => ipcRenderer.invoke('remote.getStatus'),
    setEnabled: (enabled: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.setEnabled', enabled),
    setChannelEnabled: (
      type: ControllableChannelType,
      enabled: boolean
    ): Promise<RemoteChannelToggleResult> =>
      ipcRenderer.invoke('remote.setChannelEnabled', type, enabled),
    updateGatewayConfig: (
      config: Partial<GatewayConfig>
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateGatewayConfig', config),
    updateFeishuConfig: (
      config: FeishuChannelConfig
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateFeishuConfig', config),
    updateDingtalkConfig: (
      config: DingtalkChannelConfig,
      gatewayConfig?: Partial<GatewayConfig>
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateDingtalkConfig', config, gatewayConfig),
    updateWecomConfig: (
      config: WecomChannelConfig,
      gatewayConfig?: Partial<GatewayConfig>
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateWecomConfig', config, gatewayConfig),
    getPairedUsers: (): Promise<PairedUser[]> => ipcRenderer.invoke('remote.getPairedUsers'),
    getPendingPairings: (): Promise<PairingRequest[]> =>
      ipcRenderer.invoke('remote.getPendingPairings'),
    approvePairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.approvePairing', channelType, userId),
    revokePairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.revokePairing', channelType, userId),
    rejectPairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.rejectPairing', channelType, userId),
    getRemoteSessions: (): Promise<RemoteSessionMapping[]> =>
      ipcRenderer.invoke('remote.getRemoteSessions'),
    clearRemoteSession: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.clearRemoteSession', sessionId),
    getTunnelStatus: (): Promise<{
      connected: boolean;
      url: string | null;
      provider: string;
      error?: string;
    }> => ipcRenderer.invoke('remote.getTunnelStatus'),
    getWebhookUrl: (channelType?: ChannelType): Promise<string | null> =>
      ipcRenderer.invoke('remote.getWebhookUrl', channelType),
    restart: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.restart'),
  };
}
