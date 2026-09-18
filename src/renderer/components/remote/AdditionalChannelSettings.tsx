import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
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
  const [error, setError] = useState(false);
  async function save() {
    setSaving(true);
    setError(false);
    try {
      const result = await window.electronAPI.remote.updateFeishuConfig({
        ...larkConfig,
        type: 'lark',
        appId: appId.trim(),
        appSecret: appSecret.trim(),
        useWebSocket: true,
        enabled: larkConfig?.enabled ?? true,
        dm: larkConfig?.dm || { policy: 'pairing' },
      });
      if (!result.success) setError(true);
      else onSaved();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      {channel.configured && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">
            {t(
              `remote.channelState.${channel.connected ? 'connected' : channel.enabled ? 'stopped' : 'disabled'}`
            )}
          </span>
          <Switch
            checked={channel.enabled}
            disabled={toggling || saving}
            onCheckedChange={onToggle}
            aria-label={t(channel.enabled ? 'remote.disableChannel' : 'remote.enableChannel')}
          />
        </div>
      )}
      {channel.type === 'lark' && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>{t('remote.qr.appId')}</span>
            <Input value={appId} onChange={(e) => setAppId(e.target.value)} autoComplete="off" />
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t('remote.qr.appSecret')}</span>
            <Input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              autoComplete="off"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-error">
              {t('remote.saveFailed')}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={!appId.trim() || !appSecret.trim()}
          >
            {t('common.save')}
          </Button>
        </form>
      )}
      {channel.type === 'wechat' && (
        <p className="text-sm text-text-secondary">{t('remote.qr.wechatTextOnly')}</p>
      )}
      <Button disabled={saving} onClick={onScan}>
        {t('remote.qr.scanSetup')}
      </Button>
    </div>
  );
}
