/**
 * Multi-channel remote control settings shell.
 *
 * Feishu and DingTalk are wired to the remote backend. WeCom remains a
 * configuration preview until its channel driver and IPC APIs are implemented.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, CheckCircle2, Info, Loader2, Save, ScrollText } from 'lucide-react';
import { AdvancedConfigStep } from './remote/AdvancedConfigStep';
import { AuthorizedUsersSection } from './remote/AuthorizedUsersSection';
import { ChannelDetailPanel } from './remote/ChannelDetailPanel';
import { ChannelList } from './remote/ChannelList';
import { ChannelBrandIcon } from './remote/ChannelBrandIcon';
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

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function RemoteControlPanel({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();

  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [pairedUsers, setPairedUsers] = useState<PairedUser[]>([]);
  const [pendingPairings, setPendingPairings] = useState<PairingRequest[]>([]);
  const [isTogglingGateway, setIsTogglingGateway] = useState(false);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const [activeSection, setActiveSection] = useState<RemoteSection>('channels');
  const [selectedChannel, setSelectedChannel] = useState<RemoteChannelType>('feishu');

  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuDmPolicy, setFeishuDmPolicy] = useState('pairing');
  const [dingtalkAppKey, setDingtalkAppKey] = useState('');
  const [dingtalkAppSecret, setDingtalkAppSecret] = useState('');
  const [dingtalkRobotCode, setDingtalkRobotCode] = useState('');
  const [dingtalkDmPolicy, setDingtalkDmPolicy] = useState('pairing');
  const [dingtalkRequireMention, setDingtalkRequireMention] = useState(true);
  const [dingtalkReceiveMode, setDingtalkReceiveMode] = useState<'stream' | 'webhook'>('stream');
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

    setGatewayPort(configResult.gateway?.port || 18789);
    setDefaultWorkingDirectory(configResult.gateway?.defaultWorkingDirectory || '');
    setAutoApproveSafeTools(configResult.gateway?.autoApproveSafeTools !== false);
    setTunnelEnabled(configResult.gateway?.tunnel?.enabled || false);
    setNgrokAuthToken(configResult.gateway?.tunnel?.ngrok?.authToken || '');

    if (configResult.channels?.feishu) {
      setFeishuAppId(configResult.channels.feishu.appId || '');
      setFeishuAppSecret(configResult.channels.feishu.appSecret || '');
      setFeishuDmPolicy(configResult.channels.feishu.dm?.policy || 'pairing');
      setUseLongConnection(configResult.channels.feishu.useWebSocket !== false);
    }
    if (configResult.channels?.dingtalk) {
      setDingtalkAppKey(configResult.channels.dingtalk.appKey || '');
      setDingtalkAppSecret(configResult.channels.dingtalk.appSecret || '');
      setDingtalkRobotCode(configResult.channels.dingtalk.robotCode || '');
      setDingtalkReceiveMode(configResult.channels.dingtalk.receiveMode || 'stream');
      setDingtalkDmPolicy(configResult.channels.dingtalk.dm?.policy || 'pairing');
      setDingtalkRequireMention(
        configResult.channels.dingtalk.defaultGroupSettings?.requireMention !== false
      );
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!isElectron) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
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
    } catch (loadError) {
      console.error('Failed to load remote config:', loadError);
      setError({ key: 'remote.loadFailed' });
    } finally {
      setIsLoading(false);
    }
  }, [applyConfig]);

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
      await window.electronAPI.remote.setEnabled(newEnabled);
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
      await window.electronAPI.remote.updateFeishuConfig({
        type: 'feishu',
        appId: feishuAppId,
        appSecret: feishuAppSecret,
        useWebSocket: useLongConnection,
        dm: { policy: feishuDmPolicy as 'open' | 'pairing' | 'allowlist' },
      });
      showSuccess({ key: 'remote.configSaved' });
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
  const configuredChannelCount = Number(isFeishuConfigured) + Number(isDingtalkConfigured);
  const connectedChannelCount = Number(isFeishuConnected) + Number(isDingtalkConnected);
  const isPairingEnabled = feishuDmPolicy === 'pairing' || dingtalkDmPolicy === 'pairing';

  const channels = useMemo<RemoteChannelViewModel[]>(
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
        connected: isFeishuConnected,
        backendAvailable: true,
        authorizedUsers: pairedUsers.filter((user) => user.channelType === 'feishu').length,
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
        connected: isDingtalkConnected,
        backendAvailable: true,
        authorizedUsers: pairedUsers.filter((user) => user.channelType === 'dingtalk').length,
      },
      {
        type: 'wecom',
        name: t('remote.channelName.wecom'),
        description: t('remote.channelDesc.wecom'),
        configured: false,
        connected: false,
        backendAvailable: false,
        authorizedUsers: 0,
      },
    ],
    [
      isDingtalkConfigured,
      isDingtalkConnected,
      dingtalkReceiveMode,
      isFeishuConfigured,
      isFeishuConnected,
      pairedUsers,
      t,
      useLongConnection,
    ]
  );

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
    <div className="w-full overflow-hidden rounded-[2rem] border border-border-subtle bg-background/18 shadow-card">
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
          pairedUsers={pairedUsers}
          pendingPairings={pendingPairings}
          isTogglingGateway={isTogglingGateway}
          configuredChannels={configuredChannelCount}
          connectedChannels={connectedChannelCount}
          totalChannels={channels.length}
          canStartService={configuredChannelCount > 0}
          onToggle={toggleGateway}
        />
      </div>

      <RemoteSectionNav
        activeSection={activeSection}
        pendingPairings={pendingPairings.length}
        onSectionChange={setActiveSection}
      />

      <div className="p-4 sm:p-5">
        {activeSection === 'channels' && (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(300px,0.78fr)_minmax(520px,1.5fr)]">
            <ChannelList
              channels={channels}
              selectedChannel={selectedChannel}
              onSelect={setSelectedChannel}
            />
            <ChannelDetailPanel
              channel={selectedChannelModel}
              feishuAppId={feishuAppId}
              feishuAppSecret={feishuAppSecret}
              feishuDmPolicy={feishuDmPolicy}
              dingtalkAppKey={dingtalkAppKey}
              dingtalkAppSecret={dingtalkAppSecret}
              dingtalkRobotCode={dingtalkRobotCode}
              dingtalkDmPolicy={dingtalkDmPolicy}
              dingtalkRequireMention={dingtalkRequireMention}
              dingtalkReceiveMode={dingtalkReceiveMode}
              useLongConnection={useLongConnection}
              gatewayPort={gatewayPort}
              tunnelEnabled={tunnelEnabled}
              ngrokAuthToken={ngrokAuthToken}
              tunnelStatus={tunnelStatus}
              webhookUrl={webhookUrl}
              isSaving={isSaving}
              onFeishuAppIdChange={setFeishuAppId}
              onFeishuAppSecretChange={setFeishuAppSecret}
              onFeishuDmPolicyChange={setFeishuDmPolicy}
              onDingtalkAppKeyChange={setDingtalkAppKey}
              onDingtalkAppSecretChange={setDingtalkAppSecret}
              onDingtalkRobotCodeChange={setDingtalkRobotCode}
              onDingtalkDmPolicyChange={setDingtalkDmPolicy}
              onDingtalkRequireMentionChange={setDingtalkRequireMention}
              onDingtalkReceiveModeChange={setDingtalkReceiveMode}
              onLongConnectionChange={setUseLongConnection}
              onTunnelEnabledChange={setTunnelEnabled}
              onNgrokAuthTokenChange={setNgrokAuthToken}
              onCopy={copyToClipboard}
              onSaveFeishu={saveFeishuConfig}
              onSaveDingtalk={saveDingtalkConfig}
            />
          </div>
        )}

        {activeSection === 'users' && (
          <div className="space-y-4">
            {status?.running && isPairingEnabled && <PairingGuideCard />}
            <PairingRequestsSection
              pendingPairings={pendingPairings}
              showEmpty={status?.running && isPairingEnabled}
              onApprove={approvePairing}
              onReject={rejectPairing}
            />
            <AuthorizedUsersSection pairedUsers={pairedUsers} onRevoke={revokePairing} />
          </div>
        )}

        {activeSection === 'global' && (
          <section className="glass-card overflow-hidden rounded-2xl border border-border-subtle shadow-card">
            <div className="p-4 sm:p-5">
              <AdvancedConfigStep
                defaultWorkingDirectory={defaultWorkingDirectory}
                gatewayPort={gatewayPort}
                autoApproveSafeTools={autoApproveSafeTools}
                onWorkingDirectoryChange={setDefaultWorkingDirectory}
                onGatewayPortChange={setGatewayPort}
                onAutoApproveChange={setAutoApproveSafeTools}
              />
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs leading-5 text-text-secondary">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                {t('remote.globalSettingsHint')}
              </div>
            </div>
            <div className="flex justify-end border-t border-border-subtle p-4">
              <button
                type="button"
                onClick={saveGatewayConfig}
                disabled={isSaving}
                className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
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
          <section className="glass-card rounded-2xl border border-border-subtle p-5 shadow-card">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-accent/10 p-2.5">
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
              {channels.map((channel) => (
                <div
                  key={channel.type}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-background/34 p-3"
                >
                  <div className="flex items-center gap-2.5 text-sm text-text-secondary">
                    <ChannelBrandIcon type={channel.type} className="h-7 w-7" />
                    {channel.name}
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${channel.connected ? 'bg-success' : 'bg-text-muted'}`}
                    />
                    <span>
                      {channel.backendAvailable
                        ? t(
                            channel.connected
                              ? 'remote.channelState.connected'
                              : channel.configured
                                ? 'remote.channelState.stopped'
                                : 'remote.channelState.unconfigured'
                          )
                        : t('remote.channelState.preview')}
                    </span>
                  </span>
                </div>
              ))}
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
