/**
 * Multi-channel remote control settings shell.
 *
 * DingTalk, Feishu, Lark, WeChat, and WeCom share QR setup and channel controls.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, CheckCircle2, Info, Loader2, Save, ScrollText } from 'lucide-react';
import { X } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogTitle, DialogBody } from './ui/dialog';
import { QrSetupDialog } from './remote/QrSetupDialog';
import { AdditionalChannelSettings } from './remote/AdditionalChannelSettings';
import { AdvancedConfigStep } from './remote/AdvancedConfigStep';
import { AuthorizedUsersSection } from './remote/AuthorizedUsersSection';
import { ChannelDetailPanel } from './remote/ChannelDetailPanel';
import { ChannelList } from './remote/ChannelList';
import { ChannelBrandIcon } from './remote/ChannelBrandIcon';
import { CHANNEL_STATE_DOT_CLASS, getChannelState } from './remote/channel-state';
import { GatewayControlCard } from './remote/GatewayControlCard';
import { PairingGuideCard } from './remote/PairingGuideCard';
import { PairingRequestsSection } from './remote/PairingRequestsSection';
import { RemoteSectionNav } from './remote/RemoteSectionNav';
import type {
  GatewayStatus,
  LocalizedBanner,
  PairedUser,
  PairingRequest,
  RemoteChannelType,
  RemoteChannelViewModel,
  RemoteConfig,
  RemoteSection,
  TunnelStatus,
} from './remote/types';
import type { RemoteChannelToggleResult } from '../../shared/ipc-types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

interface LoadDataOptions {
  showLoading?: boolean;
  reportError?: boolean;
}

export function RemoteControlPanel({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();

  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [pairedUsers, setPairedUsers] = useState<PairedUser[]>([]);
  const [pendingPairings, setPendingPairings] = useState<PairingRequest[]>([]);
  const [isTogglingGateway, setIsTogglingGateway] = useState(false);
  const [togglingChannel, setTogglingChannel] = useState<RemoteChannelType | null>(null);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const [activeSection, setActiveSection] = useState<RemoteSection>('channels');
  const [setupMode, setSetupMode] = useState<'scan' | 'manual' | null>(null);
  const [additionalConfig, setAdditionalConfig] = useState<
    Pick<RemoteConfig['channels'], 'lark' | 'wechat'>
  >({});
  const [selectedChannel, setSelectedChannel] = useState<RemoteChannelType>('feishu');

  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuEnabled, setFeishuEnabled] = useState(true);
  const [feishuDmPolicy, setFeishuDmPolicy] = useState('pairing');
  const [dingtalkAppKey, setDingtalkAppKey] = useState('');
  const [dingtalkAppSecret, setDingtalkAppSecret] = useState('');
  const [dingtalkRobotCode, setDingtalkRobotCode] = useState('');
  const [dingtalkEnabled, setDingtalkEnabled] = useState(true);
  const [dingtalkDmPolicy, setDingtalkDmPolicy] = useState('pairing');
  const [dingtalkRequireMention, setDingtalkRequireMention] = useState(true);
  const [dingtalkReceiveMode, setDingtalkReceiveMode] = useState<'stream' | 'webhook'>('stream');
  const [wecomBotId, setWecomBotId] = useState('');
  const [wecomSecret, setWecomSecret] = useState('');
  const [wecomWebhookToken, setWecomWebhookToken] = useState('');
  const [wecomWebhookEncodingAESKey, setWecomWebhookEncodingAESKey] = useState('');
  const [wecomEnabled, setWecomEnabled] = useState(true);
  const [wecomReceiveMode, setWecomReceiveMode] = useState<'websocket' | 'webhook'>('websocket');
  const [wecomDmPolicy, setWecomDmPolicy] = useState('pairing');
  const [wecomRequireMention, setWecomRequireMention] = useState(true);
  const [gatewayPort, setGatewayPort] = useState(18789);
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState('');
  const [autoApproveSafeTools, setAutoApproveSafeTools] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [useLongConnection, setUseLongConnection] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [ngrokAuthToken, setNgrokAuthToken] = useState('');
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  const applyConfig = useCallback((configResult: RemoteConfig | null) => {
    if (!configResult) return;
    setAdditionalConfig({ lark: configResult.channels.lark, wechat: configResult.channels.wechat });

    setGatewayPort(configResult.gateway?.port || 18789);
    setDefaultWorkingDirectory(configResult.gateway?.defaultWorkingDirectory || '');
    setAutoApproveSafeTools(configResult.gateway?.autoApproveSafeTools !== false);
    setTunnelEnabled(configResult.gateway?.tunnel?.enabled || false);
    setNgrokAuthToken(configResult.gateway?.tunnel?.ngrok?.authToken || '');

    if (configResult.channels?.feishu) {
      setFeishuEnabled(configResult.channels.feishu.enabled !== false);
      setFeishuAppId(configResult.channels.feishu.appId || '');
      setFeishuAppSecret(configResult.channels.feishu.appSecret || '');
      setFeishuDmPolicy(configResult.channels.feishu.dm?.policy || 'pairing');
      setUseLongConnection(configResult.channels.feishu.useWebSocket !== false);
    }
    if (configResult.channels?.dingtalk) {
      setDingtalkEnabled(configResult.channels.dingtalk.enabled !== false);
      setDingtalkAppKey(configResult.channels.dingtalk.appKey || '');
      setDingtalkAppSecret(configResult.channels.dingtalk.appSecret || '');
      setDingtalkRobotCode(configResult.channels.dingtalk.robotCode || '');
      setDingtalkReceiveMode(configResult.channels.dingtalk.receiveMode || 'stream');
      setDingtalkDmPolicy(configResult.channels.dingtalk.dm?.policy || 'pairing');
      setDingtalkRequireMention(
        configResult.channels.dingtalk.defaultGroupSettings?.requireMention !== false
      );
    }
    if (configResult.channels?.wecom) {
      setWecomEnabled(configResult.channels.wecom.enabled !== false);
      setWecomBotId(configResult.channels.wecom.botId || '');
      setWecomSecret(configResult.channels.wecom.secret || '');
      setWecomWebhookToken(configResult.channels.wecom.webhookToken || '');
      setWecomWebhookEncodingAESKey(configResult.channels.wecom.webhookEncodingAESKey || '');
      setWecomReceiveMode(configResult.channels.wecom.receiveMode || 'websocket');
      setWecomDmPolicy(configResult.channels.wecom.dm?.policy || 'pairing');
      setWecomRequireMention(
        configResult.channels.wecom.defaultGroupSettings?.requireMention !== false
      );
    }
  }, []);

  const loadData = useCallback(
    async (options: LoadDataOptions = {}): Promise<boolean> => {
      const { showLoading = true, reportError = true } = options;
      if (!isElectron) {
        if (showLoading) setIsLoading(false);
        return true;
      }

      if (showLoading) setIsLoading(true);
      try {
        const [
          configResult,
          statusResult,
          usersResult,
          pairingsResult,
          tunnelStatusResult,
          webhookUrlResult,
        ] = await Promise.all([
          window.electronAPI.remote.getConfig(),
          window.electronAPI.remote.getStatus(),
          window.electronAPI.remote.getPairedUsers(),
          window.electronAPI.remote.getPendingPairings(),
          window.electronAPI.remote.getTunnelStatus(),
          window.electronAPI.remote.getWebhookUrl(),
        ]);

        setStatus(statusResult);
        setPairedUsers(usersResult);
        setPendingPairings(pairingsResult);
        setTunnelStatus(tunnelStatusResult);
        setWebhookUrl(webhookUrlResult);
        applyConfig(configResult);
        return true;
      } catch (loadError) {
        console.error('Failed to load remote config:', loadError);
        if (reportError) setError({ key: 'remote.loadFailed' });
        return false;
      } finally {
        if (showLoading) setIsLoading(false);
      }
    },
    [applyConfig]
  );

  useEffect(() => {
    if (!isActive) setSetupMode(null);
  }, [isActive]);

  // A stopped gateway cannot accept configuration — close any open setup dialog.
  useEffect(() => {
    if (status?.running === false) setSetupMode(null);
  }, [status?.running]);

  const refreshStatus = useCallback(async () => {
    if (!isElectron) return;
    try {
      const [statusResult, pairingsResult, tunnelStatusResult, webhookUrlResult] =
        await Promise.all([
          window.electronAPI.remote.getStatus(),
          window.electronAPI.remote.getPendingPairings(),
          window.electronAPI.remote.getTunnelStatus(),
          window.electronAPI.remote.getWebhookUrl(),
        ]);
      setStatus(statusResult);
      setPendingPairings(pairingsResult);
      setTunnelStatus(tunnelStatusResult);
      setWebhookUrl(webhookUrlResult);
    } catch (refreshError) {
      console.error('Failed to refresh status:', refreshError);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void loadData();
    const interval = setInterval(() => void refreshStatus(), 5000);
    return () => clearInterval(interval);
  }, [isActive, loadData, refreshStatus]);

  async function toggleGateway() {
    if (!isElectron || isTogglingGateway) return;
    setIsTogglingGateway(true);
    setError(null);
    try {
      const newEnabled = !status?.running;
      const result = await window.electronAPI.remote.setEnabled(newEnabled);
      if (!result.success) {
        setError({ key: 'remote.actionFailed' });
        return;
      }
      await refreshStatus();
      showSuccess({ key: newEnabled ? 'remote.started' : 'remote.stopped' });
    } catch (toggleError) {
      console.error('Failed to toggle remote gateway:', toggleError);
      setError({ key: 'remote.actionFailed' });
    } finally {
      setIsTogglingGateway(false);
    }
  }

  function gatewayConfigPatch() {
    return {
      port: gatewayPort,
      defaultWorkingDirectory: defaultWorkingDirectory || undefined,
      autoApproveSafeTools,
      tunnel:
        tunnelEnabled && ngrokAuthToken
          ? {
              enabled: true as const,
              type: 'ngrok' as const,
              ngrok: { authToken: ngrokAuthToken, region: 'us' },
            }
          : { enabled: false as const, type: 'ngrok' as const },
    };
  }

  async function saveGatewayConfig() {
    if (!isElectron) return;
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.remote.updateGatewayConfig(gatewayConfigPatch());
      showSuccess({ key: 'remote.configSaved' });
      await loadData();
    } catch (saveError) {
      console.error('Failed to save gateway config:', saveError);
      setError({ key: 'remote.saveFailed' });
    } finally {
      setIsSaving(false);
    }
  }

  async function saveFeishuConfig() {
    if (!isElectron) return;
    if (!feishuAppId || !feishuAppSecret) {
      setError({ key: 'remote.feishuCredentialsRequired' });
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.remote.updateFeishuConfig({
        type: 'feishu',
        enabled: feishuEnabled,
        appId: feishuAppId,
        appSecret: feishuAppSecret,
        useWebSocket: useLongConnection,
        dm: { policy: feishuDmPolicy as 'open' | 'pairing' | 'allowlist' },
      });
      if (!result.success) {
        setError({ key: 'remote.saveFailed' });
        return;
      }
      showSuccess({ key: 'remote.configSaved' });
      setSetupMode(null);
      await loadData();
    } catch (saveError) {
      console.error('Failed to save Feishu config:', saveError);
      setError({ key: 'remote.saveFailed' });
    } finally {
      setIsSaving(false);
    }
  }

  async function saveDingtalkConfig() {
    if (!isElectron) return;
    if (!dingtalkAppKey || !dingtalkAppSecret) {
      setError({ key: 'remote.dingtalkCredentialsRequired' });
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.remote.updateDingtalkConfig(
        {
          type: 'dingtalk',
          enabled: dingtalkEnabled,
          receiveMode: dingtalkReceiveMode,
          appKey: dingtalkAppKey,
          appSecret: dingtalkAppSecret,
          robotCode: dingtalkRobotCode || undefined,
          dm: { policy: dingtalkDmPolicy as 'open' | 'pairing' | 'allowlist' },
          defaultGroupSettings: { requireMention: dingtalkRequireMention },
        },
        dingtalkReceiveMode === 'webhook' ? gatewayConfigPatch() : undefined
      );
      if (!result.success) {
        setError(result.error ? { text: result.error } : { key: 'remote.saveFailed' });
        return;
      }
      showSuccess({ key: 'remote.configSaved' });
      await loadData();
    } catch (saveError) {
      console.error('Failed to save DingTalk config:', saveError);
      setError({ key: 'remote.saveFailed' });
    } finally {
      setIsSaving(false);
    }
  }

  async function saveWecomConfig() {
    if (!isElectron) return;
    if (wecomReceiveMode === 'websocket' && (!wecomBotId || !wecomSecret)) {
      setError({ key: 'remote.wecomCredentialsRequired' });
      return;
    }
    if (wecomReceiveMode === 'webhook' && (!wecomWebhookToken || !wecomWebhookEncodingAESKey)) {
      setError({ key: 'remote.wecomWebhookCredentialsRequired' });
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.remote.updateWecomConfig(
        {
          type: 'wecom',
          enabled: wecomEnabled,
          receiveMode: wecomReceiveMode,
          botId: wecomBotId.trim(),
          secret: wecomSecret.trim(),
          webhookToken: wecomWebhookToken.trim() || undefined,
          webhookEncodingAESKey: wecomWebhookEncodingAESKey.trim() || undefined,
          dm: { policy: wecomDmPolicy as 'open' | 'pairing' | 'allowlist' },
          defaultGroupSettings: { requireMention: wecomRequireMention },
        },
        wecomReceiveMode === 'webhook' ? gatewayConfigPatch() : undefined
      );
      if (!result.success) {
        setError(result.error ? { text: result.error } : { key: 'remote.saveFailed' });
        return;
      }
      showSuccess({ key: 'remote.configSaved' });
      await loadData();
    } catch (saveError) {
      console.error('Failed to save WeCom config:', saveError);
      setError({ key: 'remote.saveFailed' });
    } finally {
      setIsSaving(false);
    }
  }

  async function approvePairing(request: PairingRequest) {
    if (!isElectron) return;
    try {
      const result = await window.electronAPI.remote.approvePairing(
        request.channelType,
        request.userId
      );
      if (!result.success) {
        setError(result.error ? { text: result.error } : { key: 'remote.approveFailed' });
        return;
      }
      showSuccess({ key: 'remote.pairingApproved' });
      await loadData();
    } catch (approveError) {
      console.error('Failed to approve pairing:', approveError);
      setError({ key: 'remote.approveFailed' });
    }
  }

  async function rejectPairing(request: PairingRequest) {
    if (!isElectron) return;
    try {
      const result = await window.electronAPI.remote.rejectPairing(
        request.channelType,
        request.userId
      );
      if (!result.success) {
        setError(result.error ? { text: result.error } : { key: 'remote.rejectFailed' });
        return;
      }
      showSuccess({ key: 'remote.pairingRejected' });
      await loadData();
    } catch (rejectError) {
      console.error('Failed to reject pairing:', rejectError);
      setError({ key: 'remote.rejectFailed' });
    }
  }

  async function revokePairing(user: PairedUser) {
    if (!isElectron) return;
    try {
      await window.electronAPI.remote.revokePairing(user.channelType, user.userId);
      showSuccess({ key: 'remote.userRemoved' });
      await loadData();
    } catch (revokeError) {
      console.error('Failed to revoke pairing:', revokeError);
      setError({ key: 'remote.revokeFailed' });
    }
  }

  function applyChannelToggleResult(
    type: RemoteChannelType,
    result: RemoteChannelToggleResult
  ): void {
    if (typeof result.desiredEnabled === 'boolean') {
      if (type === 'feishu') setFeishuEnabled(result.desiredEnabled);
      if (type === 'dingtalk') setDingtalkEnabled(result.desiredEnabled);
      if (type === 'wecom') setWecomEnabled(result.desiredEnabled);
      if (type === 'lark' || type === 'wechat')
        setAdditionalConfig((current) => ({
          ...current,
          [type]: { ...current[type], enabled: result.desiredEnabled },
        }));
    }

    const connected = result.connected;
    if (typeof connected !== 'boolean') return;
    setStatus((current) => {
      if (!current) return current;
      return {
        ...current,
        channels: current.channels.map((channel) =>
          channel.type === type
            ? {
                ...channel,
                enabled: result.desiredEnabled ?? channel.enabled,
                connected,
                error: result.channelError,
              }
            : channel
        ),
      };
    });
  }

  async function toggleChannel(type: RemoteChannelType) {
    if (!isElectron || togglingChannel) return;
    const currentlyEnabled =
      type === 'lark' || type === 'wechat'
        ? additionalConfig[type]?.enabled !== false
        : type === 'feishu'
          ? feishuEnabled
          : type === 'dingtalk'
            ? dingtalkEnabled
            : wecomEnabled;
    const nextEnabled = !currentlyEnabled;

    setTogglingChannel(type);
    setError(null);
    try {
      const result = await window.electronAPI.remote.setChannelEnabled(type, nextEnabled);
      applyChannelToggleResult(type, result);
      if (!result.success) {
        setError(result.error ? { text: result.error } : { key: 'remote.channelToggleFailed' });
        await loadData({ showLoading: false, reportError: false });
        return;
      }
      showSuccess({
        key:
          (result.desiredEnabled ?? nextEnabled)
            ? 'remote.channelEnabledSuccess'
            : 'remote.channelDisabledSuccess',
      });
      const refreshed = await loadData({ showLoading: false, reportError: false });
      if (!refreshed) setError({ key: 'remote.loadFailed' });
    } catch (toggleError) {
      console.error('Failed to toggle remote channel:', toggleError);
      setError({ key: 'remote.channelToggleFailed' });
      await loadData({ showLoading: false, reportError: false });
    } finally {
      setTogglingChannel(null);
    }
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
    showSuccess({ key: 'remote.copied' }, 2000);
  }

  function showSuccess(message: LocalizedBanner, duration = 3000) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), duration);
  }

  const isFeishuConfigured = !!(feishuAppId && feishuAppSecret);
  const isFeishuConnected =
    status?.channels.some((channel) => channel.type === 'feishu' && channel.connected) ?? false;
  const isDingtalkConfigured = !!(dingtalkAppKey && dingtalkAppSecret);
  const isDingtalkConnected =
    status?.channels.some((channel) => channel.type === 'dingtalk' && channel.connected) ?? false;
  const isWecomConfigured =
    wecomReceiveMode === 'webhook'
      ? !!(wecomWebhookToken && wecomWebhookEncodingAESKey)
      : !!(wecomBotId && wecomSecret);
  const isWecomConnected =
    status?.channels.some((channel) => channel.type === 'wecom' && channel.connected) ?? false;
  const extraConfigured = [
    !!(additionalConfig.lark?.appId && additionalConfig.lark.appSecret),
    !!(additionalConfig.wechat?.botToken && additionalConfig.wechat.botId),
  ];
  const serviceRunning = !!status?.running;
  const isPairingEnabled =
    (feishuEnabled && feishuDmPolicy === 'pairing') ||
    (dingtalkEnabled && dingtalkDmPolicy === 'pairing') ||
    (wecomEnabled && wecomDmPolicy === 'pairing') ||
    (additionalConfig.lark?.enabled !== false && additionalConfig.lark?.dm.policy === 'pairing');

  const baseChannels = useMemo<RemoteChannelViewModel[]>(
    () => [
      {
        type: 'feishu',
        name: t('remote.channelName.feishu'),
        description: isFeishuConfigured
          ? t('remote.channelDesc.feishuConfigured', {
              mode: useLongConnection ? t('remote.longConnection') : t('remote.webhookMode'),
              count: pairedUsers.filter((user) => user.channelType === 'feishu').length,
            })
          : t('remote.channelDesc.feishu'),
        configured: isFeishuConfigured,
        enabled: feishuEnabled,
        connected: isFeishuConnected,
        backendAvailable: true,
        authorizedUsers: pairedUsers.filter((user) => user.channelType === 'feishu').length,
        error: status?.channels.find((channel) => channel.type === 'feishu')?.error,
      },
      {
        type: 'dingtalk',
        name: t('remote.channelName.dingtalk'),
        description: isDingtalkConfigured
          ? t('remote.channelDesc.dingtalkConfigured', {
              mode:
                dingtalkReceiveMode === 'stream'
                  ? t('remote.streamConnection')
                  : t('remote.webhookMode'),
              count: pairedUsers.filter((user) => user.channelType === 'dingtalk').length,
            })
          : t('remote.channelDesc.dingtalk'),
        configured: isDingtalkConfigured,
        enabled: dingtalkEnabled,
        connected: isDingtalkConnected,
        backendAvailable: true,
        authorizedUsers: pairedUsers.filter((user) => user.channelType === 'dingtalk').length,
        error: status?.channels.find((channel) => channel.type === 'dingtalk')?.error,
      },
      {
        type: 'wecom',
        name: t('remote.channelName.wecom'),
        description: isWecomConfigured
          ? t('remote.channelDesc.wecomConfigured', {
              mode:
                wecomReceiveMode === 'websocket'
                  ? t('remote.longConnection')
                  : t('remote.webhookMode'),
              count: pairedUsers.filter((user) => user.channelType === 'wecom').length,
            })
          : t('remote.channelDesc.wecom'),
        configured: isWecomConfigured,
        enabled: wecomEnabled,
        connected: isWecomConnected,
        backendAvailable: true,
        authorizedUsers: pairedUsers.filter((user) => user.channelType === 'wecom').length,
        error: status?.channels.find((channel) => channel.type === 'wecom')?.error,
      },
    ],
    [
      isDingtalkConfigured,
      isDingtalkConnected,
      dingtalkReceiveMode,
      dingtalkEnabled,
      feishuEnabled,
      isFeishuConfigured,
      isFeishuConnected,
      pairedUsers,
      t,
      useLongConnection,
      wecomEnabled,
      isWecomConfigured,
      isWecomConnected,
      wecomReceiveMode,
      status?.channels,
    ]
  );

  const extraChannels: RemoteChannelViewModel[] = (['lark', 'wechat'] as const).map(
    (type, index) => ({
      type,
      name: t(`remote.channelName.${type}`),
      description: t('remote.channelSummary', { channel: t(`remote.channelName.${type}`) }),
      configured: extraConfigured[index],
      enabled: additionalConfig[type]?.enabled !== false,
      connected:
        status?.channels.some((channel) => channel.type === type && channel.connected) || false,
      backendAvailable: true,
      authorizedUsers: pairedUsers.filter((user) => user.channelType === type).length,
      error: status?.channels.find((channel) => channel.type === type)?.error,
    })
  );
  const channels = [
    baseChannels[1],
    baseChannels[0],
    extraChannels[0],
    extraChannels[1],
    baseChannels[2],
  ];
  const openSetup = (type: RemoteChannelType, manual = false) => {
    setError(null);
    setSelectedChannel(type);
    setSetupMode(manual ? 'manual' : 'scan');
  };

  const selectedChannelModel =
    channels.find((channel) => channel.type === selectedChannel) ?? channels[0];

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <div className="space-y-3 p-4 sm:p-5">
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-error/30 bg-error/10 p-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-error" />
            <span className="text-sm text-error">{error.key ? t(error.key) : error.text}</span>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
            <span className="text-sm text-success">
              {success.key ? t(success.key) : success.text}
            </span>
          </div>
        )}

        <GatewayControlCard
          status={status}
          isTogglingGateway={isTogglingGateway}
          onToggle={toggleGateway}
        />
        {pendingPairings.length > 0 && activeSection !== 'users' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
            <span role="status" className="text-sm text-text-primary">
              {t('remote.pendingApprovalNotice', { count: pendingPairings.length })}
            </span>
            <Button onClick={() => setActiveSection('users')}>{t('remote.reviewPairings')}</Button>
          </div>
        )}
      </div>

      <RemoteSectionNav
        activeSection={activeSection}
        pendingPairings={pendingPairings.length}
        onSectionChange={setActiveSection}
      />

      {!serviceRunning && (
        <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover/50 px-4 py-2.5 text-xs text-text-secondary sm:px-5">
          <Info className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          {t('remote.startToConfigure')}
        </div>
      )}

      <div
        className={`p-4 sm:p-5 ${!serviceRunning ? 'opacity-60' : ''}`}
        aria-disabled={!serviceRunning || undefined}
        {...(!serviceRunning ? { inert: '' } : {})}
      >
        {activeSection === 'channels' && (
          <div
            id="remote-panel-channels"
            role="tabpanel"
            aria-labelledby="remote-nav-tab-channels"
            className="space-y-3"
          >
            <ChannelList
              channels={channels}
              onSelect={(type) => openSetup(type)}
              onManage={(type) => openSetup(type, true)}
            />
            {setupMode === 'scan' && (
              <QrSetupDialog
                channel={selectedChannel}
                onClose={() => setSetupMode(null)}
                onManual={() => setSetupMode('manual')}
                onCompleted={() => {
                  void loadData({ showLoading: false });
                }}
              />
            )}
            <Dialog
              open={setupMode === 'manual'}
              busy={isSaving}
              onOpenChange={(open) => {
                if (!open) setSetupMode(null);
              }}
              ariaLabelledBy="remote-config-title"
              className="max-w-2xl"
            >
              <div className="flex items-center justify-between gap-3">
                <DialogTitle id="remote-config-title">
                  {t('remote.qr.title', { channel: selectedChannelModel.name })}
                </DialogTitle>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={isSaving}
                  aria-label={t('common.close')}
                  onClick={() => setSetupMode(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <DialogBody>
                {error && (
                  <p role="alert" className="mb-3 text-sm text-error">
                    {error.key ? t(error.key) : error.text}
                  </p>
                )}
                {selectedChannel === 'lark' || selectedChannel === 'wechat' ? (
                  <AdditionalChannelSettings
                    key={selectedChannel}
                    channel={selectedChannelModel}
                    larkConfig={additionalConfig.lark}
                    onSaved={() => {
                      setSetupMode(null);
                      void loadData({ showLoading: false });
                    }}
                    onToggle={() => void toggleChannel(selectedChannel)}
                    toggling={togglingChannel === selectedChannel}
                    onScan={() => setSetupMode('scan')}
                  />
                ) : (
                  <ChannelDetailPanel
                    channel={{ ...selectedChannelModel, type: selectedChannel }}
                    feishuAppId={feishuAppId}
                    feishuAppSecret={feishuAppSecret}
                    feishuDmPolicy={feishuDmPolicy}
                    dingtalkAppKey={dingtalkAppKey}
                    dingtalkAppSecret={dingtalkAppSecret}
                    dingtalkRobotCode={dingtalkRobotCode}
                    dingtalkDmPolicy={dingtalkDmPolicy}
                    dingtalkRequireMention={dingtalkRequireMention}
                    dingtalkReceiveMode={dingtalkReceiveMode}
                    wecomBotId={wecomBotId}
                    wecomSecret={wecomSecret}
                    wecomWebhookToken={wecomWebhookToken}
                    wecomWebhookEncodingAESKey={wecomWebhookEncodingAESKey}
                    wecomReceiveMode={wecomReceiveMode}
                    wecomDmPolicy={wecomDmPolicy}
                    wecomRequireMention={wecomRequireMention}
                    useLongConnection={useLongConnection}
                    gatewayPort={gatewayPort}
                    tunnelEnabled={tunnelEnabled}
                    ngrokAuthToken={ngrokAuthToken}
                    tunnelStatus={tunnelStatus}
                    webhookUrl={webhookUrl}
                    isSaving={isSaving}
                    isTogglingChannel={togglingChannel === selectedChannel}
                    onFeishuAppIdChange={setFeishuAppId}
                    onFeishuAppSecretChange={setFeishuAppSecret}
                    onFeishuDmPolicyChange={setFeishuDmPolicy}
                    onDingtalkAppKeyChange={setDingtalkAppKey}
                    onDingtalkAppSecretChange={setDingtalkAppSecret}
                    onDingtalkRobotCodeChange={setDingtalkRobotCode}
                    onDingtalkDmPolicyChange={setDingtalkDmPolicy}
                    onDingtalkRequireMentionChange={setDingtalkRequireMention}
                    onDingtalkReceiveModeChange={setDingtalkReceiveMode}
                    onWecomBotIdChange={setWecomBotId}
                    onWecomSecretChange={setWecomSecret}
                    onWecomWebhookTokenChange={setWecomWebhookToken}
                    onWecomWebhookEncodingAESKeyChange={setWecomWebhookEncodingAESKey}
                    onWecomReceiveModeChange={setWecomReceiveMode}
                    onWecomDmPolicyChange={setWecomDmPolicy}
                    onWecomRequireMentionChange={setWecomRequireMention}
                    onLongConnectionChange={setUseLongConnection}
                    onTunnelEnabledChange={setTunnelEnabled}
                    onNgrokAuthTokenChange={setNgrokAuthToken}
                    onCopy={copyToClipboard}
                    onSaveFeishu={saveFeishuConfig}
                    onSaveDingtalk={saveDingtalkConfig}
                    onSaveWecom={saveWecomConfig}
                    onToggleChannel={() => void toggleChannel(selectedChannel)}
                  />
                )}
              </DialogBody>
            </Dialog>
          </div>
        )}

        {activeSection === 'users' && (
          <div
            id="remote-panel-users"
            role="tabpanel"
            aria-labelledby="remote-nav-tab-users"
            className="space-y-4"
          >
            {status?.running &&
              isPairingEnabled &&
              pendingPairings.length === 0 &&
              pairedUsers.length === 0 && <PairingGuideCard />}
            <PairingRequestsSection
              pendingPairings={pendingPairings}
              showEmpty={status?.running && isPairingEnabled && pairedUsers.length === 0}
              onApprove={approvePairing}
              onReject={rejectPairing}
            />
            <AuthorizedUsersSection pairedUsers={pairedUsers} onRevoke={revokePairing} />
          </div>
        )}

        {activeSection === 'global' && (
          <section
            id="remote-panel-global"
            role="tabpanel"
            aria-labelledby="remote-nav-tab-global"
            className="overflow-hidden rounded-2xl border border-border-subtle"
          >
            <div className="p-4 sm:p-5">
              <AdvancedConfigStep
                defaultWorkingDirectory={defaultWorkingDirectory}
                gatewayPort={gatewayPort}
                autoApproveSafeTools={autoApproveSafeTools}
                onWorkingDirectoryChange={setDefaultWorkingDirectory}
                onGatewayPortChange={setGatewayPort}
                onAutoApproveChange={setAutoApproveSafeTools}
              />
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent/20 bg-accent-muted p-3 text-xs leading-5 text-text-secondary">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                {t('remote.globalSettingsHint')}
              </div>
            </div>
            <div className="flex justify-end border-t border-border-subtle p-4">
              <button
                type="button"
                onClick={saveGatewayConfig}
                disabled={isSaving}
                className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t('remote.saveGlobalSettings')}
              </button>
            </div>
          </section>
        )}

        {activeSection === 'logs' && (
          <section
            id="remote-panel-logs"
            role="tabpanel"
            aria-labelledby="remote-nav-tab-logs"
            className="rounded-2xl border border-border-subtle p-5"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-accent-muted p-2.5">
                <ScrollText className="h-5 w-5 text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  {t('remote.runtimeOverview')}
                </h3>
                <p className="mt-1 text-xs text-text-muted">{t('remote.runtimeOverviewDesc')}</p>
              </div>
            </div>
            <div className="mt-5 space-y-2">
              {channels.map((channel) => {
                const channelState = getChannelState(channel);
                return (
                  <div
                    key={channel.type}
                    className="flex items-center justify-between gap-3 rounded-xl bg-surface-hover p-3"
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
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border p-4 text-xs text-text-muted">
              <Check className="h-4 w-4" />
              {t('remote.fullLogsPending')}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
