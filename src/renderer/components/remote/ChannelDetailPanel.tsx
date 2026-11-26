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
import { Badge, Button, Switch } from '../ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { underlineTabTriggerClass } from '../data-view/shared';
import { cn } from '../ui/cn';
import { ChannelBrandIcon } from './ChannelBrandIcon';
import { ChannelSetupGuide } from './ChannelSetupGuide';
import { getChannelState, type RemoteChannelState } from './channel-state';
import type { ChannelConfigTab, RemoteChannelViewModel, TunnelStatus } from './types';

const CHANNEL_STATE_BADGE_TONE: Record<
  RemoteChannelState,
  'success' | 'error' | 'warning' | 'default'
> = {
  connected: 'success',
  error: 'error',
  disabled: 'default',
  preview: 'warning',
  unconfigured: 'default',
  stopped: 'warning',
};

interface Props {
  channel: RemoteChannelViewModel & { type: 'feishu' | 'dingtalk' | 'wecom' };
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
    <section className="bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-muted">
            <ChannelBrandIcon type={channel.type} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[13px] font-semibold text-text-primary">
                {channel.name}
              </h3>
              <Badge tone={CHANNEL_STATE_BADGE_TONE[channelState]}>
                {t(`remote.channelState.${channelState}`)}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-[11.5px] text-text-muted">{channel.description}</p>
          </div>
        </div>
        {channel.backendAvailable && (
          <div className="inline-flex items-center gap-2 text-[12px] font-medium text-text-secondary">
            <Switch
              size="sm"
              checked={channel.enabled}
              onCheckedChange={onToggleChannel}
              disabled={!channel.configured || isTogglingChannel}
              aria-label={t(channel.enabled ? 'remote.disableChannel' : 'remote.enableChannel')}
            />
            <span>{t(channel.enabled ? 'remote.enableChannel' : 'remote.disableChannel')}</span>
            {isTogglingChannel && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden />
            )}
          </div>
        )}
      </header>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ChannelConfigTab)}
        className="contents"
      >
        <TabsList className="flex h-9 w-full items-stretch gap-0 overflow-x-auto rounded-none border-0 border-b border-border-subtle bg-surface-muted/35 p-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className={cn(
                underlineTabTriggerClass,
                'flex h-full shrink-0 items-center gap-1.5 px-3 text-[12px]'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div>
          {!channel.backendAvailable && (
            <div className="flex items-start gap-2 border-b border-border-subtle bg-warning/8 px-4 py-2.5 text-[12px] text-text-secondary">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>{t('remote.previewOnlyNotice')}</span>
            </div>
          )}
          {channel.error && (
            <div className="flex items-start gap-2 border-b border-border-subtle bg-error/8 px-4 py-2.5 text-[12px] text-error">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{channel.error}</span>
            </div>
          )}

          <TabsContent value="basic" className="contents">
            <div className="ui-form-flush">
              <div className="ui-group-title">{t('remote.credentialsTitle')}</div>

              {channel.type === 'feishu' && (
                <>
                  <CredentialRow
                    id="feishu-app-id"
                    label="App ID"
                    value={feishuAppId}
                    placeholder="cli_xxxxxxxxxxxxxxxx"
                    onChange={onFeishuAppIdChange}
                  />
                  <CredentialRow
                    id="feishu-app-secret"
                    label="App Secret"
                    value={feishuAppSecret}
                    placeholder="••••••••••••••••"
                    type="password"
                    onChange={onFeishuAppSecretChange}
                  />
                </>
              )}

              {channel.type === 'dingtalk' && (
                <>
                  <CredentialRow
                    id="dingtalk-client-id"
                    label="Client ID"
                    value={dingtalkAppKey}
                    placeholder="dingxxxxxxxxxxxxxxxx"
                    onChange={onDingtalkAppKeyChange}
                  />
                  <CredentialRow
                    id="dingtalk-client-secret"
                    label="Client Secret"
                    value={dingtalkAppSecret}
                    placeholder="••••••••••••••••"
                    type="password"
                    onChange={onDingtalkAppSecretChange}
                  />
                  <CredentialRow
                    id="dingtalk-robot-code"
                    label="RobotCode"
                    value={dingtalkRobotCode}
                    placeholder={t('remote.optional')}
                    onChange={onDingtalkRobotCodeChange}
                  />
                </>
              )}

              {channel.type === 'wecom' && wecomReceiveMode === 'websocket' && (
                <>
                  <CredentialRow
                    id="wecom-bot-id"
                    label="Bot ID"
                    value={wecomBotId}
                    placeholder="aibxxxxxxxxxxxxxxxx"
                    onChange={onWecomBotIdChange}
                  />
                  <CredentialRow
                    id="wecom-bot-secret"
                    label="Secret"
                    value={wecomSecret}
                    placeholder="••••••••••••••••"
                    type="password"
                    onChange={onWecomSecretChange}
                  />
                </>
              )}

              {channel.type === 'wecom' && wecomReceiveMode === 'webhook' && (
                <>
                  <CredentialRow
                    id="wecom-webhook-token"
                    label="Token"
                    value={wecomWebhookToken}
                    placeholder="Token"
                    type="password"
                    onChange={onWecomWebhookTokenChange}
                  />
                  <CredentialRow
                    id="wecom-webhook-aes-key"
                    label="EncodingAESKey"
                    value={wecomWebhookEncodingAESKey}
                    placeholder="43 characters"
                    type="password"
                    onChange={onWecomWebhookEncodingAESKeyChange}
                  />
                </>
              )}

              <div className="ui-group-title border-t border-border-subtle">
                {t('remote.receiveMode')}
              </div>

              <div className="grid divide-y divide-border-subtle sm:grid-cols-2 sm:divide-x sm:divide-y-0">
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

              {channelUsesWebhook && (
                <div className="border-t border-border-subtle">
                  <div className="ui-form-row">
                    <span className="ui-form-label items-center">
                      {t('remote.localWebhookUrl')}
                    </span>
                    <div className="ui-form-value !flex-row items-center">
                      <code className="ui-flush-text min-w-0 flex-1 truncate font-mono text-text-primary">
                        http://127.0.0.1:{gatewayPort}/webhook/{channel.type}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          onCopy(`http://127.0.0.1:${gatewayPort}/webhook/${channel.type}`)
                        }
                        className="flex h-9 w-9 shrink-0 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                        title={t('remote.copied')}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="ui-form-row">
                    <span className="ui-form-label items-center">
                      {t('remote.useBuiltInNgrok')}
                    </span>
                    <div className="ui-form-value !flex-row items-center justify-between px-[10px]">
                      <span className="truncate text-[12px] text-text-muted">
                        {t('remote.ngrokChannelHint')}
                      </span>
                      <Switch
                        size="sm"
                        checked={tunnelEnabled}
                        onCheckedChange={onTunnelEnabledChange}
                        aria-label={t('remote.useBuiltInNgrok')}
                      />
                    </div>
                  </div>
                  {tunnelEnabled && (
                    <div className="ui-form-row">
                      <span className="ui-form-label items-center">ngrok Token</span>
                      <div className="ui-form-value">
                        <input
                          type="password"
                          value={ngrokAuthToken}
                          onChange={(event) => onNgrokAuthTokenChange(event.target.value)}
                          className="font-mono text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
                          placeholder="ngrok authtoken"
                        />
                      </div>
                    </div>
                  )}
                  {tunnelStatus?.connected && activeWebhookUrl && (
                    <div className="border-t border-border-subtle bg-success/8 px-3 py-2 text-[12px] text-success">
                      {t('remote.tunnelConnected')}: {activeWebhookUrl}
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="access" className="contents">
            <div className="ui-form-flush">
              <div className="ui-group-title">{t('remote.dmPolicy')}</div>
              <div className="divide-y divide-border-subtle">
                {policies.map(({ value, label, desc, icon: Icon }) => {
                  const selected = dmPolicy === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDmPolicy(value)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        selected ? 'bg-accent-muted/75' : 'hover:bg-surface-hover/60'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          selected ? 'text-accent' : 'text-text-muted'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium text-text-primary">{label}</div>
                        <div className="mt-0.5 text-[11.5px] text-text-muted">{desc}</div>
                      </div>
                      {selected && <Check className="h-4 w-4 shrink-0 text-accent" />}
                    </button>
                  );
                })}
              </div>

              <div className="ui-form-row border-t border-border-subtle">
                <span className="ui-form-label items-center">{t('remote.requireMention')}</span>
                <div className="ui-form-value !flex-row items-center justify-between gap-3 px-[10px]">
                  <span className="text-[12px] text-text-muted">
                    {t('remote.requireMentionDesc')}
                  </span>
                  <Switch
                    size="sm"
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
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="contents">
            <div className="p-4">
              <ChannelSetupGuide
                channelType={channel.type}
                useLongConnection={channelUsesLongConnection}
                webhookUrl={activeWebhookUrl}
                onCopy={onCopy}
              />
            </div>
          </TabsContent>
        </div>
      </Tabs>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-surface-muted/40 px-4 py-2.5">
        <p className="text-[11.5px] text-text-muted">
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
        <Button
          variant="primary"
          size="md"
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
          className="h-8 px-3.5 text-[12.5px]"
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : channel.backendAvailable ? (
            <Save className="h-3.5 w-3.5" />
          ) : (
            <LockKeyhole className="h-3.5 w-3.5" />
          )}
          {channel.backendAvailable ? t('remote.saveConfig') : t('remote.backendPending')}
        </Button>
      </footer>
    </section>
  );
}

interface CredentialRowProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  type?: 'text' | 'password';
  onChange: (value: string) => void;
}

function CredentialRow({
  id,
  label,
  value,
  placeholder,
  type = 'text',
  onChange,
}: CredentialRowProps) {
  return (
    <div className="ui-form-row">
      <label className="ui-form-label items-center" htmlFor={id}>
        {label}
      </label>
      <div className="ui-form-value">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="font-mono text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
        />
      </div>
    </div>
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
      className={`flex flex-col px-3.5 py-2.5 text-left transition-colors ${
        selected ? 'bg-accent-muted/75' : 'hover:bg-surface-hover/60'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 ${selected ? 'text-accent' : 'text-text-muted'}`} />
          <span className="text-[12.5px] font-medium text-text-primary">{title}</span>
          {recommended && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent">
              {t('remote.recommended')}
            </span>
          )}
        </span>
        {selected && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
      </div>
      <p className="mt-1 text-[11.5px] leading-4 text-text-muted">{description}</p>
    </button>
  );
}
