import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  AlertTriangle,
  Copy,
  Info,
  Link2,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Radio,
  Save,
  Settings2,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import { Switch } from '../ui/switch';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { ChannelBrandIcon } from './ChannelBrandIcon';
import { ChannelSetupGuide } from './ChannelSetupGuide';
import { getChannelState, type RemoteChannelState } from './channel-state';
import type { ChannelConfigTab, RemoteChannelViewModel, TunnelStatus } from './types';

const channelTabTriggerClass =
  'flex shrink-0 items-center gap-1.5 rounded-t-lg rounded-b-none px-3 py-2 ' +
  'shadow-none data-[state=active]:bg-accent-muted data-[state=active]:text-accent ' +
  'data-[state=active]:shadow-none';

const CHANNEL_STATE_BADGE_CLASS = {
  connected: 'bg-success/10 text-success',
  error: 'bg-error/10 text-error',
  disabled: 'bg-surface-active text-text-muted',
  preview: 'bg-warning/10 text-warning',
  unconfigured: 'bg-warning/10 text-warning',
  stopped: 'bg-warning/10 text-warning',
} satisfies Record<RemoteChannelState, string>;

interface Props {
  channel: RemoteChannelViewModel;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuDmPolicy: string;
  dingtalkAppKey: string;
  dingtalkAppSecret: string;
  dingtalkRobotCode: string;
  dingtalkDmPolicy: string;
  dingtalkRequireMention: boolean;
  dingtalkReceiveMode: 'stream' | 'webhook';
  wecomBotId: string;
  wecomSecret: string;
  wecomWebhookToken: string;
  wecomWebhookEncodingAESKey: string;
  wecomReceiveMode: 'websocket' | 'webhook';
  wecomDmPolicy: string;
  wecomRequireMention: boolean;
  useLongConnection: boolean;
  gatewayPort: number;
  tunnelEnabled: boolean;
  ngrokAuthToken: string;
  tunnelStatus: TunnelStatus | null;
  webhookUrl: string | null;
  isSaving: boolean;
  isTogglingChannel: boolean;
  onFeishuAppIdChange: (value: string) => void;
  onFeishuAppSecretChange: (value: string) => void;
  onFeishuDmPolicyChange: (value: string) => void;
  onDingtalkAppKeyChange: (value: string) => void;
  onDingtalkAppSecretChange: (value: string) => void;
  onDingtalkRobotCodeChange: (value: string) => void;
  onDingtalkDmPolicyChange: (value: string) => void;
  onDingtalkRequireMentionChange: (value: boolean) => void;
  onDingtalkReceiveModeChange: (value: 'stream' | 'webhook') => void;
  onWecomBotIdChange: (value: string) => void;
  onWecomSecretChange: (value: string) => void;
  onWecomWebhookTokenChange: (value: string) => void;
  onWecomWebhookEncodingAESKeyChange: (value: string) => void;
  onWecomReceiveModeChange: (value: 'websocket' | 'webhook') => void;
  onWecomDmPolicyChange: (value: string) => void;
  onWecomRequireMentionChange: (value: boolean) => void;
  onLongConnectionChange: (value: boolean) => void;
  onTunnelEnabledChange: (value: boolean) => void;
  onNgrokAuthTokenChange: (value: string) => void;
  onCopy: (value: string) => void;
  onSaveFeishu: () => void;
  onSaveDingtalk: () => void;
  onSaveWecom: () => void;
  onToggleChannel: () => void;
}

export function ChannelDetailPanel({
  channel,
  feishuAppId,
  feishuAppSecret,
  feishuDmPolicy,
  dingtalkAppKey,
  dingtalkAppSecret,
  dingtalkRobotCode,
  dingtalkDmPolicy,
  dingtalkRequireMention,
  dingtalkReceiveMode,
  wecomBotId,
  wecomSecret,
  wecomWebhookToken,
  wecomWebhookEncodingAESKey,
  wecomReceiveMode,
  wecomDmPolicy,
  wecomRequireMention,
  useLongConnection,
  gatewayPort,
  tunnelEnabled,
  ngrokAuthToken,
  tunnelStatus,
  webhookUrl,
  isSaving,
  isTogglingChannel,
  onFeishuAppIdChange,
  onFeishuAppSecretChange,
  onFeishuDmPolicyChange,
  onDingtalkAppKeyChange,
  onDingtalkAppSecretChange,
  onDingtalkRobotCodeChange,
  onDingtalkDmPolicyChange,
  onDingtalkRequireMentionChange,
  onDingtalkReceiveModeChange,
  onWecomBotIdChange,
  onWecomSecretChange,
  onWecomWebhookTokenChange,
  onWecomWebhookEncodingAESKeyChange,
  onWecomReceiveModeChange,
  onWecomDmPolicyChange,
  onWecomRequireMentionChange,
  onLongConnectionChange,
  onTunnelEnabledChange,
  onNgrokAuthTokenChange,
  onCopy,
  onSaveFeishu,
  onSaveDingtalk,
  onSaveWecom,
  onToggleChannel,
}: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ChannelConfigTab>('basic');
  const [requireMention, setRequireMention] = useState(true);

  useEffect(() => {
    setActiveTab('basic');
  }, [channel.type]);

  const dmPolicy =
    channel.type === 'feishu'
      ? feishuDmPolicy
      : channel.type === 'dingtalk'
        ? dingtalkDmPolicy
        : wecomDmPolicy;
  const setDmPolicy =
    channel.type === 'feishu'
      ? onFeishuDmPolicyChange
      : channel.type === 'dingtalk'
        ? onDingtalkDmPolicyChange
        : onWecomDmPolicyChange;
  const activeRequireMention =
    channel.type === 'dingtalk'
      ? dingtalkRequireMention
      : channel.type === 'wecom'
        ? wecomRequireMention
        : requireMention;
  const channelUsesLongConnection =
    channel.type === 'feishu'
      ? useLongConnection
      : channel.type === 'dingtalk'
        ? dingtalkReceiveMode === 'stream'
        : wecomReceiveMode === 'websocket';
  const channelUsesWebhook = channel.backendAvailable && !channelUsesLongConnection;
  const activeWebhookUrl = tunnelStatus?.url
    ? `${tunnelStatus.url.replace(/\/$/, '')}/webhook/${channel.type}`
    : channel.type === 'feishu'
      ? webhookUrl
      : null;

  const tabs = [
    { id: 'basic' as const, label: t('remote.channelTabBasic'), icon: Settings2 },
    { id: 'access' as const, label: t('remote.channelTabAccess'), icon: ShieldCheck },
    { id: 'advanced' as const, label: t('remote.channelTabAdvanced'), icon: Radio },
  ];

  const policies = [
    {
      value: 'pairing',
      label: t('remote.policyPairing'),
      desc: t('remote.policyPairingDesc'),
      icon: LockKeyhole,
    },
    {
      value: 'allowlist',
      label: t('remote.policyAllowlist'),
      desc: t('remote.policyAllowlistDesc'),
      icon: Users,
    },
    {
      value: 'open',
      label: t('remote.policyOpen'),
      desc: t('remote.policyOpenDesc'),
      icon: MessageSquareText,
    },
  ];
  const channelState = getChannelState(channel);

  return (
    <section className="glass-card overflow-hidden rounded-2xl border border-border-subtle shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle p-4">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelBrandIcon type={channel.type} className="h-11 w-11" />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-text-primary">{channel.name}</h3>
            <p className="mt-0.5 truncate text-xs text-text-muted">{channel.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CHANNEL_STATE_BADGE_CLASS[channelState]}`}
          >
            {t(`remote.channelState.${channelState}`)}
          </span>
          {channel.backendAvailable && (
            <div className="group inline-flex items-center gap-2.5 rounded-lg px-1 py-1 text-sm font-medium text-text-secondary">
              <Switch
                checked={channel.enabled}
                onCheckedChange={onToggleChannel}
                disabled={!channel.configured || isTogglingChannel}
                aria-label={t(channel.enabled ? 'remote.disableChannel' : 'remote.enableChannel')}
                className="data-[state=checked]:border-success data-[state=checked]:bg-success"
              />
              <span>{t(channel.enabled ? 'remote.enableChannel' : 'remote.disableChannel')}</span>
              {isTogglingChannel && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden />
              )}
            </div>
          )}
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ChannelConfigTab)}>
        <TabsList className="flex w-full gap-1 overflow-x-auto rounded-none border-0 border-b border-border-subtle bg-transparent px-3 pt-2">
          {tabs.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className={channelTabTriggerClass}>
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="min-h-[410px] p-4">
        {!channel.backendAvailable && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 p-3 text-xs leading-5 text-text-secondary">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>{t('remote.previewOnlyNotice')}</span>
          </div>
        )}
        {channel.error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-error/25 bg-error/5 p-3 text-xs leading-5 text-error">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{channel.error}</span>
          </div>
        )}

        {activeTab === 'basic' && (
          <div className="space-y-5">
            <div>
              <h4 className="text-sm font-semibold text-text-primary">
                {t('remote.credentialsTitle')}
              </h4>
              <p className="mt-1 text-xs text-text-muted">
                {t(`remote.credentialsDesc.${channel.type}`)}
              </p>
            </div>

            {channel.type === 'feishu' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <CredentialField
                  id="feishu-app-id"
                  label="App ID"
                  value={feishuAppId}
                  placeholder="cli_xxxxxxxxxxxxxxxx"
                  onChange={onFeishuAppIdChange}
                />
                <CredentialField
                  id="feishu-app-secret"
                  label="App Secret"
                  value={feishuAppSecret}
                  placeholder="••••••••••••••••"
                  type="password"
                  onChange={onFeishuAppSecretChange}
                />
              </div>
            )}

            {channel.type === 'dingtalk' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <CredentialField
                  id="dingtalk-client-id"
                  label="Client ID / AppKey"
                  value={dingtalkAppKey}
                  placeholder="dingxxxxxxxxxxxxxxxx"
                  onChange={onDingtalkAppKeyChange}
                />
                <CredentialField
                  id="dingtalk-client-secret"
                  label="Client Secret / AppSecret"
                  value={dingtalkAppSecret}
                  placeholder="••••••••••••••••"
                  type="password"
                  onChange={onDingtalkAppSecretChange}
                />
                <CredentialField
                  id="dingtalk-robot-code"
                  label="RobotCode"
                  value={dingtalkRobotCode}
                  placeholder={t('remote.optional')}
                  onChange={onDingtalkRobotCodeChange}
                />
              </div>
            )}

            {channel.type === 'wecom' && wecomReceiveMode === 'websocket' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <CredentialField
                  id="wecom-bot-id"
                  label="Bot ID"
                  value={wecomBotId}
                  placeholder="aibxxxxxxxxxxxxxxxx"
                  onChange={onWecomBotIdChange}
                />
                <CredentialField
                  id="wecom-bot-secret"
                  label="Secret"
                  value={wecomSecret}
                  placeholder="••••••••••••••••"
                  type="password"
                  onChange={onWecomSecretChange}
                />
              </div>
            )}

            {channel.type === 'wecom' && wecomReceiveMode === 'webhook' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <CredentialField
                  id="wecom-webhook-token"
                  label="Token"
                  value={wecomWebhookToken}
                  placeholder="Token"
                  type="password"
                  onChange={onWecomWebhookTokenChange}
                />
                <CredentialField
                  id="wecom-webhook-aes-key"
                  label="EncodingAESKey"
                  value={wecomWebhookEncodingAESKey}
                  placeholder="43 characters"
                  type="password"
                  onChange={onWecomWebhookEncodingAESKeyChange}
                />
              </div>
            )}

            <div>
              <h4 className="mb-2 text-sm font-semibold text-text-primary">
                {t('remote.receiveMode')}
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <ConnectionOption
                  selected={channelUsesLongConnection}
                  title={
                    channel.type === 'dingtalk'
                      ? t('remote.streamConnection')
                      : t('remote.longConnection')
                  }
                  description={t(`remote.longConnectionChannelDesc.${channel.type}`)}
                  recommended
                  icon={Zap}
                  onClick={() => {
                    if (channel.type === 'feishu') onLongConnectionChange(true);
                    if (channel.type === 'dingtalk') onDingtalkReceiveModeChange('stream');
                    if (channel.type === 'wecom') onWecomReceiveModeChange('websocket');
                  }}
                />
                <ConnectionOption
                  selected={channelUsesWebhook}
                  title={t('remote.webhookMode')}
                  description={t(
                    channel.type === 'wecom'
                      ? 'remote.wecomWebhookChannelDesc'
                      : 'remote.webhookChannelDesc'
                  )}
                  disabled={!channel.backendAvailable}
                  icon={Link2}
                  onClick={() => {
                    if (channel.type === 'feishu') onLongConnectionChange(false);
                    if (channel.type === 'dingtalk') onDingtalkReceiveModeChange('webhook');
                    if (channel.type === 'wecom') onWecomReceiveModeChange('webhook');
                  }}
                />
              </div>
            </div>

            {channelUsesWebhook && (
              <div className="space-y-3 rounded-xl border border-border-subtle bg-surface p-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                    {t('remote.localWebhookUrl')}
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-hover px-3 py-2 text-xs text-text-secondary">
                      http://127.0.0.1:{gatewayPort}/webhook/{channel.type}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        onCopy(`http://127.0.0.1:${gatewayPort}/webhook/${channel.type}`)
                      }
                      className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-active hover:text-text-primary"
                      title={t('remote.copied')}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-text-primary">
                      {t('remote.useBuiltInNgrok')}
                    </div>
                    <p className="mt-1 text-[11px] text-text-muted">
                      {t('remote.ngrokChannelHint')}
                    </p>
                  </div>
                  <Switch
                    checked={tunnelEnabled}
                    onCheckedChange={onTunnelEnabledChange}
                    aria-label={t('remote.useBuiltInNgrok')}
                  />
                </div>
                {tunnelEnabled && (
                  <input
                    type="password"
                    value={ngrokAuthToken}
                    onChange={(event) => onNgrokAuthTokenChange(event.target.value)}
                    className="w-full rounded-xl border border-border bg-surface-hover/55 px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                    placeholder="ngrok authtoken"
                  />
                )}
                {tunnelStatus?.connected && activeWebhookUrl && (
                  <div className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                    {t('remote.tunnelConnected')}: {activeWebhookUrl}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'access' && (
          <div className="space-y-5">
            <div>
              <h4 className="text-sm font-semibold text-text-primary">{t('remote.dmPolicy')}</h4>
              <p className="mt-1 text-xs text-text-muted">{t('remote.accessPolicyDesc')}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {policies.map(({ value, label, desc, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDmPolicy(value)}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    dmPolicy === value
                      ? 'border-accent/60 bg-accent-muted'
                      : 'border-border-subtle hover:border-accent/30 hover:bg-surface-hover/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Icon
                      className={`h-4 w-4 ${dmPolicy === value ? 'text-accent' : 'text-text-muted'}`}
                    />
                    {dmPolicy === value && <Check className="h-4 w-4 text-accent" />}
                  </div>
                  <div className="mt-3 text-xs font-semibold text-text-primary">{label}</div>
                  <div className="mt-1 text-[11px] leading-4 text-text-muted">{desc}</div>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-border-subtle bg-surface p-3">
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {t('remote.requireMention')}
                </div>
                <p className="mt-1 text-xs text-text-muted">{t('remote.requireMentionDesc')}</p>
              </div>
              <Switch
                checked={activeRequireMention}
                onCheckedChange={(checked) => {
                  if (channel.type === 'dingtalk') {
                    onDingtalkRequireMentionChange(checked);
                  } else if (channel.type === 'wecom') {
                    onWecomRequireMentionChange(checked);
                  } else {
                    setRequireMention(checked);
                  }
                }}
                aria-label={t('remote.requireMention')}
              />
            </div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <ChannelSetupGuide
            channelType={channel.type}
            useLongConnection={channelUsesLongConnection}
            webhookUrl={activeWebhookUrl}
            onCopy={onCopy}
          />
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle p-4">
        <p className="text-[11px] text-text-muted">
          {channel.backendAvailable
            ? t(
                channel.type === 'dingtalk'
                  ? 'remote.dingtalkSaveHint'
                  : channel.type === 'wecom'
                    ? 'remote.wecomSaveHint'
                    : 'remote.feishuSaveHint',
                {
                  mode:
                    channel.type === 'wecom'
                      ? wecomReceiveMode === 'websocket'
                        ? t('remote.longConnection')
                        : t('remote.webhookMode')
                      : dingtalkReceiveMode === 'stream'
                        ? t('remote.streamConnection')
                        : t('remote.webhookMode'),
                }
              )
            : t('remote.previewSaveHint')}
        </p>
        <button
          type="button"
          onClick={
            channel.backendAvailable
              ? channel.type === 'dingtalk'
                ? onSaveDingtalk
                : channel.type === 'wecom'
                  ? onSaveWecom
                  : onSaveFeishu
              : undefined
          }
          disabled={!channel.backendAvailable || isSaving}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : channel.backendAvailable ? (
            <Save className="h-4 w-4" />
          ) : (
            <LockKeyhole className="h-4 w-4" />
          )}
          {channel.backendAvailable ? t('remote.saveConfig') : t('remote.backendPending')}
        </button>
      </footer>
    </section>
  );
}

interface CredentialFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  type?: 'text' | 'password';
  onChange: (value: string) => void;
}

function CredentialField({
  id,
  label,
  value,
  placeholder,
  type = 'text',
  onChange,
}: CredentialFieldProps) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-surface-hover/55 px-3 py-2.5 text-sm text-text-primary outline-none transition-all placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/15"
      />
    </label>
  );
}

interface ConnectionOptionProps {
  selected: boolean;
  title: string;
  description: string;
  recommended?: boolean;
  disabled?: boolean;
  icon: typeof Zap;
  onClick: () => void;
}

function ConnectionOption({
  selected,
  title,
  description,
  recommended = false,
  disabled = false,
  icon: Icon,
  onClick,
}: ConnectionOptionProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition-all ${
        selected
          ? 'border-accent/60 bg-accent-muted'
          : 'border-border-subtle hover:border-accent/30 hover:bg-surface-hover/50'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${selected ? 'text-accent' : 'text-text-muted'}`} />
          <span className="text-xs font-semibold text-text-primary">{title}</span>
        </span>
        {selected && <Check className="h-4 w-4 text-accent" />}
      </div>
      {recommended && (
        <span className="mt-2 inline-block rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
          {t('remote.recommended')}
        </span>
      )}
      <p className="mt-2 text-[11px] leading-4 text-text-muted">{description}</p>
    </button>
  );
}
