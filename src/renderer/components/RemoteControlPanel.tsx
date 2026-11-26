/**
 * Multi-channel remote control settings shell.
 *
 * DingTalk, Feishu, Lark, WeChat, and WeCom share QR setup and channel controls.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Loader2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogTitle, DialogBody } from './ui/dialog';
import { QrSetupDialog } from './remote/QrSetupDialog';
import { AdditionalChannelSettings } from './remote/AdditionalChannelSettings';
import { AuthorizedUsersSection } from './remote/AuthorizedUsersSection';
import { buildRemoteChannelViewModels } from './remote/build-channel-models';
import { ChannelDetailPanel } from './remote/ChannelDetailPanel';
import { ChannelList } from './remote/ChannelList';
import { GatewayControlCard } from './remote/GatewayControlCard';
import { showToast } from '../utils/toast';
import { remoteClient } from '../features/remote/api/remote-client';
import { PairingGuideCard } from './remote/PairingGuideCard';
import { PairingRequestsSection } from './remote/PairingRequestsSection';
import { RemoteGlobalSettingsSection } from './remote/RemoteGlobalSettingsSection';
import { RemoteLogsOverviewSection } from './remote/RemoteLogsOverviewSection';
import { RemoteSectionNav } from './remote/RemoteSectionNav';
import type {
  GatewayStatus,
  LocalizedBanner,
  PairedUser,
  PairingRequest,
  RemoteChannelType,
  RemoteConfig,
  RemoteSection,
  TunnelStatus,
} from './remote/types';
import type { RemoteChannelToggleResult } from '../../shared/ipc-types';

const isElectron = remoteClient.isAvailable();

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

  useEffect(() => {
    if (error) {
      showToast('error', error.key ? t(error.key) : (error.text ?? ''));
      setError(null);
    }
  }, [error, t]);

  useEffect(() => {
    if (success) {
      showToast('success', success.key ? t(success.key) : (success.text ?? ''));
      setSuccess(null);
    }
  }, [success, t]);
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
          remoteClient.getConfig(),
          remoteClient.getStatus(),
          remoteClient.getPairedUsers(),
          remoteClient.getPendingPairings(),
          remoteClient.getTunnelStatus(),
          remoteClient.getWebhookUrl(),
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
          remoteClient.getStatus(),
          remoteClient.getPendingPairings(),
          remoteClient.getTunnelStatus(),
          remoteClient.getWebhookUrl(),
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
      const result = await remoteClient.setEnabled(newEnabled);
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
      await remoteClient.updateGatewayConfig(gatewayConfigPatch());
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
      const result = await remoteClient.updateFeishuConfig({
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
      const result = await remoteClient.updateDingtalkConfig(
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
      const result = await remoteClient.updateWecomConfig(
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
      const result = await remoteClient.approvePairing(request.channelType, request.userId);
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
      const result = await remoteClient.rejectPairing(request.channelType, request.userId);
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
      await remoteClient.revokePairing(user.channelType, user.userId);
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
      const result = await remoteClient.setChannelEnabled(type, nextEnabled);
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

  const serviceRunning = !!status?.running;
  const isPairingEnabled =
    (feishuEnabled && feishuDmPolicy === 'pairing') ||
    (dingtalkEnabled && dingtalkDmPolicy === 'pairing') ||
    (wecomEnabled && wecomDmPolicy === 'pairing') ||
    (additionalConfig.lark?.enabled !== false && additionalConfig.lark?.dm.policy === 'pairing');

  const channels = useMemo(
    () =>
      buildRemoteChannelViewModels({
        t,
        status,
        pairedUsers,
        feishuAppId,
        feishuAppSecret,
        feishuEnabled,
        useLongConnection,
        dingtalkAppKey,
        dingtalkAppSecret,
        dingtalkEnabled,
        dingtalkReceiveMode,
        wecomBotId,
        wecomSecret,
        wecomWebhookToken,
        wecomWebhookEncodingAESKey,
        wecomEnabled,
        wecomReceiveMode,
        additionalConfig,
      }),
    [
      additionalConfig,
      dingtalkAppKey,
      dingtalkAppSecret,
      dingtalkEnabled,
      dingtalkReceiveMode,
      feishuAppId,
      feishuAppSecret,
      feishuEnabled,
      pairedUsers,
      status,
      t,
      useLongConnection,
      wecomBotId,
      wecomEnabled,
      wecomReceiveMode,
      wecomSecret,
      wecomWebhookEncodingAESKey,
      wecomWebhookToken,
    ]
  );
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
    <div className="w-full overflow-hidden rounded-md border border-border-subtle bg-surface">
      <GatewayControlCard
        status={status}
        isTogglingGateway={isTogglingGateway}
        onToggle={toggleGateway}
      />

      {pendingPairings.length > 0 && activeSection !== 'users' && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-warning/8 px-4 py-2">
          <span role="status" className="text-[12.5px] font-medium text-text-primary">
            {t('remote.pendingApprovalNotice', { count: pendingPairings.length })}
          </span>
          <Button size="sm" onClick={() => setActiveSection('users')}>
            {t('remote.reviewPairings')}
          </Button>
        </div>
      )}

      <RemoteSectionNav
        activeSection={activeSection}
        pendingPairings={pendingPairings.length}
        onSectionChange={setActiveSection}
      />

      {!serviceRunning && (
        <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-muted/55 px-4 py-2 text-[12px] text-text-secondary">
          <Info className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          {t('remote.startToConfigure')}
        </div>
      )}

      <div
        className={!serviceRunning ? 'opacity-60' : ''}
        aria-disabled={!serviceRunning || undefined}
        {...(!serviceRunning ? { inert: '' } : {})}
      >
        {activeSection === 'channels' && (
          <div id="remote-panel-channels" role="tabpanel" aria-labelledby="remote-nav-tab-channels">
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
              className="max-w-2xl p-0 overflow-hidden"
            >
              <div className="flex h-11 items-center justify-between gap-3 border-b border-border-subtle px-4">
                <DialogTitle id="remote-config-title" className="text-[13px] font-semibold">
                  {t('remote.qr.title', { channel: selectedChannelModel.name })}
                </DialogTitle>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={isSaving}
                  aria-label={t('common.close')}
                  onClick={() => setSetupMode(null)}
                  className="h-7 w-7"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <DialogBody className="mt-0 max-h-[75vh] overflow-y-auto p-0">
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
          <div id="remote-panel-users" role="tabpanel" aria-labelledby="remote-nav-tab-users">
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
          <RemoteGlobalSettingsSection
            defaultWorkingDirectory={defaultWorkingDirectory}
            gatewayPort={gatewayPort}
            autoApproveSafeTools={autoApproveSafeTools}
            isSaving={isSaving}
            onWorkingDirectoryChange={setDefaultWorkingDirectory}
            onGatewayPortChange={setGatewayPort}
            onAutoApproveChange={setAutoApproveSafeTools}
            onSave={() => void saveGatewayConfig()}
          />
        )}

        {activeSection === 'logs' && <RemoteLogsOverviewSection channels={channels} />}
      </div>
    </div>
  );
}
