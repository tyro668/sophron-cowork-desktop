import type { RemoteQrChannel } from '../../../shared/contracts/remote/qr-setup';
import { RemoteQrSetupService } from '../../remote/qr-setup-service';
import type {
  GatewayConfig,
  FeishuChannelConfig,
  DingtalkChannelConfig,
  WecomChannelConfig,
  ChannelType,
  ControllableChannelType,
  ControllableChannelState,
} from '../../../shared/contracts/remote';
import { handleIpc } from '../../ipc-handle';
import { remoteConfigStore } from '../../remote/remote-config-store';
import { remoteManager } from '../../remote/remote-manager';
import { logError } from '../../utils/logger';

export function registerRemoteIpc(): void {
  const qrSetup = new RemoteQrSetupService((config) => {
    switch (config.type) {
      case 'wechat':
        return remoteManager.updateWechatConfig(config);
      case 'dingtalk':
        return remoteManager.updateDingtalkConfig(config);
      case 'wecom':
        return remoteManager.updateWecomConfig(config);
      default:
        return remoteManager.updateFeishuConfig(config);
    }
  });
  const setupOwners = new Set<number>();
  handleIpc('remote.beginQrSetup', (event, id: string, channel: RemoteQrChannel) => {
    const owner = event.sender.id;
    if (!setupOwners.has(owner)) {
      setupOwners.add(owner);
      event.sender.on('did-start-navigation', (_navigation, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) qrSetup.cancel(owner);
      });
      event.sender.once('destroyed', () => {
        qrSetup.cancel(owner);
        setupOwners.delete(owner);
      });
    }
    return qrSetup.begin(owner, id, channel);
  });
  handleIpc('remote.getQrSetup', (event, id: string) => qrSetup.get(event.sender.id, id));
  handleIpc('remote.submitQrSetupCode', (event, id: string, code: string) =>
    qrSetup.submitCode(event.sender.id, id, code)
  );
  handleIpc('remote.cancelQrSetup', (event, id: string) => qrSetup.cancel(event.sender.id, id));

  // ============================================================================
  // 远程控制 IPC 处理
  // ============================================================================

  handleIpc('remote.getConfig', () => {
    try {
      return remoteConfigStore.getAll();
    } catch (error) {
      logError('[Remote] Error getting config:', error);
      return null;
    }
  });

  handleIpc('remote.getStatus', () => {
    try {
      return remoteManager.getStatus();
    } catch (error) {
      logError('[Remote] Error getting status:', error);
      return { running: false, channels: [], activeSessions: 0, pendingPairings: 0 };
    }
  });

  handleIpc('remote.setEnabled', async (_event, enabled: boolean) => {
    try {
      remoteConfigStore.setEnabled(enabled);

      if (enabled) {
        await remoteManager.start();
      } else {
        await remoteManager.stop();
      }

      return { success: true };
    } catch (error) {
      logError('[Remote] Error setting enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('remote.setChannelEnabled', async (_event, type: unknown, enabled: unknown) => {
    try {
      if (
        type !== 'feishu' &&
        type !== 'dingtalk' &&
        type !== 'wecom' &&
        type !== 'lark' &&
        type !== 'wechat'
      ) {
        throw new Error('Unsupported remote channel type');
      }
      if (typeof enabled !== 'boolean') {
        throw new Error('Channel enabled state must be a boolean');
      }
      const state = await remoteManager.setChannelEnabled(type as ControllableChannelType, enabled);
      return { success: true, ...state };
    } catch (error) {
      logError('[Remote] Error setting channel enabled state:', error);
      let state: ControllableChannelState | undefined;
      if (
        type === 'feishu' ||
        type === 'dingtalk' ||
        type === 'wecom' ||
        type === 'lark' ||
        type === 'wechat'
      ) {
        try {
          state = remoteManager.getChannelControlState(type);
        } catch {
          // Invalid or unavailable configuration has no authoritative state to return.
        }
      }
      return {
        success: false,
        ...state,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  handleIpc('remote.updateGatewayConfig', async (_event, config: Partial<GatewayConfig>) => {
    try {
      await remoteManager.updateGatewayConfig(config);
      return { success: true };
    } catch (error) {
      logError('[Remote] Error updating gateway config:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('remote.updateFeishuConfig', async (_event, config: FeishuChannelConfig) => {
    try {
      await remoteManager.updateFeishuConfig(config);
      return { success: true };
    } catch (error) {
      logError('[Remote] Error updating Feishu config:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc(
    'remote.updateDingtalkConfig',
    async (_event, config: DingtalkChannelConfig, gatewayConfig?: Partial<GatewayConfig>) => {
      try {
        await remoteManager.updateDingtalkConfig(config, gatewayConfig);
        return { success: true };
      } catch (error) {
        logError('[Remote] Error updating DingTalk config:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  handleIpc(
    'remote.updateWecomConfig',
    async (_event, config: WecomChannelConfig, gatewayConfig?: Partial<GatewayConfig>) => {
      try {
        await remoteManager.updateWecomConfig(config, gatewayConfig);
        return { success: true };
      } catch (error) {
        logError('[Remote] Error updating WeCom config:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  handleIpc('remote.getPairedUsers', () => {
    try {
      return remoteManager.getPairedUsers();
    } catch (error) {
      logError('[Remote] Error getting paired users:', error);
      return [];
    }
  });

  handleIpc('remote.getPendingPairings', () => {
    try {
      return remoteManager.getPendingPairings();
    } catch (error) {
      logError('[Remote] Error getting pending pairings:', error);
      return [];
    }
  });

  handleIpc('remote.approvePairing', (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.approvePairing(channelType, userId);
      return { success };
    } catch (error) {
      logError('[Remote] Error approving pairing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('remote.revokePairing', (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.revokePairing(channelType, userId);
      return { success };
    } catch (error) {
      logError('[Remote] Error revoking pairing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('remote.rejectPairing', (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.rejectPairing(channelType, userId);
      return { success };
    } catch (error) {
      logError('[Remote] Error rejecting pairing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('remote.getRemoteSessions', () => {
    try {
      return remoteManager.getRemoteSessions();
    } catch (error) {
      logError('[Remote] Error getting remote sessions:', error);
      return [];
    }
  });

  handleIpc('remote.clearRemoteSession', (_event, sessionId: string) => {
    try {
      const success = remoteManager.clearRemoteSession(sessionId);
      return { success };
    } catch (error) {
      logError('[Remote] Error clearing remote session:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('remote.getTunnelStatus', () => {
    try {
      return remoteManager.getTunnelStatus();
    } catch (error) {
      logError('[Remote] Error getting tunnel status:', error);
      return { connected: false, url: null, provider: 'none' };
    }
  });

  handleIpc('remote.getWebhookUrl', (_event, channelType?: ChannelType) => {
    try {
      return remoteManager.getWebhookUrl(channelType);
    } catch (error) {
      logError('[Remote] Error getting webhook URL:', error);
      return null;
    }
  });

  handleIpc('remote.restart', async () => {
    try {
      await remoteManager.restart();
      return { success: true };
    } catch (error) {
      logError('[Remote] Error restarting:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
