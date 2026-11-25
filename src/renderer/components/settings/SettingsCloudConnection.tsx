/**
 * 设置 → 云连接：导入 / 重新导入 config.yaml、连接 / 断开、自动连接、清除配置与连接状态。
 * 与「云空间」一样，这里只管理连接本身；分组和表的数据源管理在「数据 → 云连接」。
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp, Link2, Loader2, PlugZap, Unplug } from 'lucide-react';

import { cloudConnectionClient } from '../../features/cloud-connection/api/cloud-connection-client';
import {
  isLiveStatus,
  useCloudConnection,
} from '../../features/cloud-connection/hooks/use-cloud-connection';
import { CLOUD_CONNECTION_STATUS_TONE } from '../data-view/cloud-connection-preview';
import { Badge, Button, Switch } from '../ui';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-form-row">
      <span className="ui-form-label items-center">{label}</span>
      <div className="ui-form-value text-[13px] text-text-primary">{children}</div>
    </div>
  );
}

export function SettingsCloudConnection() {
  const { t } = useTranslation();
  const { state, busy, run } = useCloudConnection();

  if (!state) {
    return (
      <div className="flex min-h-[8rem] items-center justify-center text-xs text-text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </div>
    );
  }

  const config = state.config;
  const live = isLiveStatus(state);
  const serverText = config
    ? `${config.protocol}://${config.host}:${config.port}${config.path ?? ''}`
    : '';

  return (
    <div className="space-y-4" data-testid="settings-cloud-connection">
      <section className="ui-group bg-surface">
        <div className="flex items-center gap-3 border-b border-border-subtle px-3 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
            <Link2 className="h-4 w-4" />
          </div>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-primary">
            {t('cloudConnection.sections.config')}
          </span>
          <Badge
            tone={CLOUD_CONNECTION_STATUS_TONE[state.status]}
            data-testid="cloud-connection-status"
          >
            {(state.status === 'connecting' || state.status === 'reconnecting') && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {t(`cloudConnection.status.${state.status}`)}
          </Badge>
        </div>
        {config ? (
          <>
            <Row label={t('cloudConnection.fields.configFile')}>
              <span className="truncate">{config.fileName ?? 'config.yaml'}</span>
            </Row>
            <Row label={t('cloudConnection.fields.agentId')}>
              <span className="font-mono text-[12px]">{config.agentIdMasked}</span>
            </Row>
            <Row label={t('cloudConnection.fields.server')}>
              <span className="truncate font-mono text-[12px]">{serverText}</span>
            </Row>
            <Row label={t('cloudConnection.fields.token')}>
              <span>
                {config.hasToken
                  ? t('cloudConnection.tokenSaved')
                  : t('cloudConnection.tokenMissing')}
              </span>
            </Row>
            <Row label={t('cloudConnection.fields.autoConnect')}>
              <Switch
                size="sm"
                checked={state.autoConnect}
                disabled={busy !== null}
                onCheckedChange={(v) =>
                  void run('auto', () => cloudConnectionClient.setAutoConnect(v))
                }
              />
            </Row>
            {state.lastError && (
              <Row label={t('cloudConnection.fields.lastError')}>
                <span className="text-error">{state.lastError}</span>
              </Row>
            )}
            <div className="flex items-center justify-end gap-2 px-3 py-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void run('clear', cloudConnectionClient.clearConfig)}
              >
                {t('cloudConnection.actions.clearConfig')}
              </Button>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => void run('import', cloudConnectionClient.importConfig)}
              >
                <FileUp className="h-3.5 w-3.5" />
                {t('cloudConnection.actions.reimportConfig')}
              </Button>
              {live ? (
                <Button
                  size="sm"
                  variant="danger-outline"
                  disabled={busy !== null}
                  onClick={() => void run('disconnect', cloudConnectionClient.disconnect)}
                >
                  <Unplug className="h-3.5 w-3.5" />
                  {t('cloudConnection.actions.disconnect')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy !== null}
                  loading={busy === 'connect'}
                  onClick={() => void run('connect', cloudConnectionClient.connect)}
                >
                  <PlugZap className="h-3.5 w-3.5" />
                  {t('cloudConnection.actions.connect')}
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-11 items-center justify-between px-3 text-[13px] text-text-muted">
            <span>{t('cloudConnection.notConfigured')}</span>
            <Button
              size="sm"
              variant="primary"
              disabled={busy !== null}
              data-testid="cloud-connection-import"
              onClick={() => void run('import', cloudConnectionClient.importConfig)}
            >
              <FileUp className="h-3.5 w-3.5" />
              {t('cloudConnection.actions.importConfig')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
