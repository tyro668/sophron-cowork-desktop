import type { TFunction } from 'i18next';
import type { GatewayStatus, PairedUser, RemoteChannelViewModel, RemoteConfig } from './types';

export interface BuildRemoteChannelModelsInput {
  t: TFunction;
  status: GatewayStatus | null;
  pairedUsers: PairedUser[];
  feishuAppId: string;
  feishuAppSecret: string;
  feishuEnabled: boolean;
  useLongConnection: boolean;
  dingtalkAppKey: string;
  dingtalkAppSecret: string;
  dingtalkEnabled: boolean;
  dingtalkReceiveMode: 'stream' | 'webhook';
  wecomBotId: string;
  wecomSecret: string;
  wecomWebhookToken: string;
  wecomWebhookEncodingAESKey: string;
  wecomEnabled: boolean;
  wecomReceiveMode: 'websocket' | 'webhook';
  additionalConfig: Pick<RemoteConfig['channels'], 'lark' | 'wechat'>;
}

export function buildRemoteChannelViewModels({
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
}: BuildRemoteChannelModelsInput): RemoteChannelViewModel[] {
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

  const feishuCount = pairedUsers.filter((user) => user.channelType === 'feishu').length;
  const dingtalkCount = pairedUsers.filter((user) => user.channelType === 'dingtalk').length;
  const wecomCount = pairedUsers.filter((user) => user.channelType === 'wecom').length;

  const feishuModel: RemoteChannelViewModel = {
    type: 'feishu',
    name: t('remote.channelName.feishu'),
    description: isFeishuConfigured
      ? t('remote.channelDesc.feishuConfigured', {
          mode: useLongConnection ? t('remote.longConnection') : t('remote.webhookMode'),
          count: feishuCount,
        })
      : t('remote.channelDesc.feishu'),
    configured: isFeishuConfigured,
    enabled: feishuEnabled,
    connected: isFeishuConnected,
    backendAvailable: true,
    authorizedUsers: feishuCount,
    error: status?.channels.find((channel) => channel.type === 'feishu')?.error,
  };

  const dingtalkModel: RemoteChannelViewModel = {
    type: 'dingtalk',
    name: t('remote.channelName.dingtalk'),
    description: isDingtalkConfigured
      ? t('remote.channelDesc.dingtalkConfigured', {
          mode:
            dingtalkReceiveMode === 'stream'
              ? t('remote.streamConnection')
              : t('remote.webhookMode'),
          count: dingtalkCount,
        })
      : t('remote.channelDesc.dingtalk'),
    configured: isDingtalkConfigured,
    enabled: dingtalkEnabled,
    connected: isDingtalkConnected,
    backendAvailable: true,
    authorizedUsers: dingtalkCount,
    error: status?.channels.find((channel) => channel.type === 'dingtalk')?.error,
  };

  const wecomModel: RemoteChannelViewModel = {
    type: 'wecom',
    name: t('remote.channelName.wecom'),
    description: isWecomConfigured
      ? t('remote.channelDesc.wecomConfigured', {
          mode:
            wecomReceiveMode === 'websocket' ? t('remote.longConnection') : t('remote.webhookMode'),
          count: wecomCount,
        })
      : t('remote.channelDesc.wecom'),
    configured: isWecomConfigured,
    enabled: wecomEnabled,
    connected: isWecomConnected,
    backendAvailable: true,
    authorizedUsers: wecomCount,
    error: status?.channels.find((channel) => channel.type === 'wecom')?.error,
  };

  const extraConfigured = [
    !!(additionalConfig.lark?.appId && additionalConfig.lark.appSecret),
    !!(additionalConfig.wechat?.botToken && additionalConfig.wechat.botId),
  ];

  const [larkModel, wechatModel] = (['lark', 'wechat'] as const).map(
    (type, index): RemoteChannelViewModel => ({
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

  return [dingtalkModel, feishuModel, larkModel, wechatModel, wecomModel];
}
