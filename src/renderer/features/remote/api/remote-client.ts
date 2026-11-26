/**
 * Typed IPC adapter for the Remote Control feature — centralizes all
 * `window.electronAPI.remote` calls with availability checks.
 */
import type { ElectronApi } from '../../../../shared/contracts/electron-api';

type RemoteApi = ElectronApi['remote'];

function api(): RemoteApi {
  const bridge = window.electronAPI?.remote;
  if (!bridge) throw new Error('Remote IPC bridge is unavailable');
  return bridge;
}

export const remoteClient = {
  isAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.electronAPI?.remote);
  },
  getConfig: () => api().getConfig(),
  getStatus: () => api().getStatus(),
  getPairedUsers: () => api().getPairedUsers(),
  getPendingPairings: () => api().getPendingPairings(),
  getTunnelStatus: () => api().getTunnelStatus(),
  getWebhookUrl: () => api().getWebhookUrl(),
  setEnabled: (enabled: boolean) => api().setEnabled(enabled),
  updateGatewayConfig: (...args: Parameters<RemoteApi['updateGatewayConfig']>) =>
    api().updateGatewayConfig(...args),
  updateFeishuConfig: (...args: Parameters<RemoteApi['updateFeishuConfig']>) =>
    api().updateFeishuConfig(...args),
  updateDingtalkConfig: (...args: Parameters<RemoteApi['updateDingtalkConfig']>) =>
    api().updateDingtalkConfig(...args),
  updateWecomConfig: (...args: Parameters<RemoteApi['updateWecomConfig']>) =>
    api().updateWecomConfig(...args),
  approvePairing: (...args: Parameters<RemoteApi['approvePairing']>) =>
    api().approvePairing(...args),
  rejectPairing: (...args: Parameters<RemoteApi['rejectPairing']>) => api().rejectPairing(...args),
  revokePairing: (...args: Parameters<RemoteApi['revokePairing']>) => api().revokePairing(...args),
  setChannelEnabled: (...args: Parameters<RemoteApi['setChannelEnabled']>) =>
    api().setChannelEnabled(...args),
};
