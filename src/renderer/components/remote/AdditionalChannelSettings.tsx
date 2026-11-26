import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { remoteClient } from '../../features/remote/api/remote-client';
import { showToast } from '../../utils/toast';
import { Badge, Switch } from '../ui';
import type { FeishuChannelConfig } from '../../../shared/contracts/remote';
import type { RemoteChannelViewModel } from './types';

export function AdditionalChannelSettings({
  channel,
  larkConfig,
  onSaved,
  onToggle,
  toggling,
  onScan,
}: {
  channel: RemoteChannelViewModel;
  larkConfig?: FeishuChannelConfig;
  onSaved: () => void;
  onToggle: () => void;
  toggling: boolean;
  onScan: () => void;
}) {
  const { t } = useTranslation();
  const [appId, setAppId] = useState(larkConfig?.appId || '');
  const [appSecret, setAppSecret] = useState(larkConfig?.appSecret || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const result = await remoteClient.updateFeishuConfig({
        ...larkConfig,
        type: 'lark',
        appId: appId.trim(),
        appSecret: appSecret.trim(),
        useWebSocket: true,
        enabled: larkConfig?.enabled ?? true,
        dm: larkConfig?.dm || { policy: 'pairing' },
      });
      if (!result.success) showToast('error', t('remote.saveFailed'));
      else onSaved();
    } catch {
      showToast('error', t('remote.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const stateKey = channel.connected ? 'connected' : channel.enabled ? 'stopped' : 'disabled';

  return (
    <form
      className="ui-form-flush bg-surface"
      onSubmit={(event) => {
        event.preventDefault();
        if (channel.type === 'lark') void save();
      }}
    >
      {channel.configured && (
        <div className="ui-form-row">
          <span className="ui-form-label items-center">{t('mcp.status')}</span>
          <div className="ui-form-value !flex-row items-center justify-between px-[10px]">
            <Badge tone={channel.connected ? 'success' : 'default'}>
              {t(`remote.channelState.${stateKey}`)}
            </Badge>
            <Switch
              size="sm"
              checked={channel.enabled}
              disabled={toggling || saving}
              onCheckedChange={onToggle}
              aria-label={t(channel.enabled ? 'remote.disableChannel' : 'remote.enableChannel')}
            />
          </div>
        </div>
      )}
      {channel.type === 'lark' && (
        <>
          <div className="ui-form-row">
            <label htmlFor="lark-app-id" className="ui-form-label items-center">
              {t('remote.qr.appId')}
            </label>
            <div className="ui-form-value">
              <input
                id="lark-app-id"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                autoComplete="off"
                className="font-mono text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
              />
            </div>
          </div>
          <div className="ui-form-row">
            <label htmlFor="lark-app-secret" className="ui-form-label items-center">
              {t('remote.qr.appSecret')}
            </label>
            <div className="ui-form-value">
              <input
                id="lark-app-secret"
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                autoComplete="off"
                className="font-mono text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
              />
            </div>
          </div>
        </>
      )}
      {channel.type === 'wechat' && (
        <div className="border-b border-border-subtle px-4 py-3 text-[12.5px] text-text-secondary">
          {t('remote.qr.wechatTextOnly')}
        </div>
      )}
      <div className="ui-form-row">
        <span className="ui-form-label items-center" />
        <div className="ui-form-value !flex-row items-stretch">
          <button
            type="button"
            disabled={saving}
            onClick={onScan}
            className="ui-accent-cell min-w-0 flex-1"
          >
            {t('remote.qr.scanSetup')}
          </button>
          {channel.type === 'lark' && (
            <button
              type="submit"
              disabled={saving || !appId.trim() || !appSecret.trim()}
              className="ui-accent-cell min-w-0 flex-1 border-l border-border-subtle"
            >
              {t('common.save')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
