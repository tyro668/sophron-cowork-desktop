/**
 * 设置 → 云连接：导入 / 重新导入 config.yaml、连接 / 断开、自动连接、清除配置与连接状态。
 * 与「云空间」一样，这里只管理连接本身；分组和表的数据源管理在「数据 → 云连接」。
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp, Loader2, PlugZap, Unplug } from 'lucide-react';

import { cloudConnectionClient } from '../../features/cloud-connection/api/cloud-connection-client';
import {
  isLiveStatus,
  useCloudConnection,
} from '../../features/cloud-connection/hooks/use-cloud-connection';
import { CLOUD_CONNECTION_STATUS_TONE } from '../data-view/cloud-connection-preview';
import { Badge, Switch } from '../ui';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-form-row">
      <span className="ui-form-label items-center">{label}</span>
      <div className="ui-form-value">{children}</div>
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
    <div data-testid="settings-cloud-connection">
      <section className="ui-group ui-form-flush bg-surface">
        <div className="ui-group-title justify-between gap-2">
          <span className="truncate">{t('cloudConnection.sections.config')}</span>
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
              <span className="ui-flush-text truncate">{config.fileName ?? 'config.yaml'}</span>
            </Row>
            <Row label={t('cloudConnection.fields.agentId')}>
              <span className="ui-flush-text font-mono">{config.agentIdMasked}</span>
            </Row>
            <Row label={t('cloudConnection.fields.server')}>
              <span className="ui-flush-text truncate font-mono">{serverText}</span>
            </Row>
            <Row label={t('cloudConnection.fields.token')}>
              <span className="ui-flush-text">
                {config.hasToken
                  ? t('cloudConnection.tokenSaved')
                  : t('cloudConnection.tokenMissing')}
              </span>
            </Row>
            <Row label={t('cloudConnection.fields.autoConnect')}>
              <div className="flex min-h-[35px] items-center px-[10px]">
                <Switch
                  size="sm"
                  checked={state.autoConnect}
                  disabled={busy !== null}
                  onCheckedChange={(v) =>
                    void run('auto', () => cloudConnectionClient.setAutoConnect(v))
                  }
                />
              </div>
            </Row>
            {state.lastError && (
              <Row label={t('cloudConnection.fields.lastError')}>
                <span className="ui-flush-text text-error">{state.lastError}</span>
              </Row>
            )}
            <div className="ui-form-row">
              <span className="ui-form-label items-center"></span>
              <div className="ui-form-value !flex-row items-stretch">
                <button
                  type="button"
                  disabled={busy !== null}
                  className="ui-accent-cell min-w-0 flex-1"
                  onClick={() => void run('clear', cloudConnectionClient.clearConfig)}
                >
                  {t('cloudConnection.actions.clearConfig')}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  className="ui-accent-cell min-w-0 flex-1 border-l border-border-subtle"
                  onClick={() => void run('import', cloudConnectionClient.importConfig)}
                >
                  <FileUp className="h-3.5 w-3.5" />
                  {t('cloudConnection.actions.reimportConfig')}
                </button>
                {live ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    onClick={() => void run('disconnect', cloudConnectionClient.disconnect)}
                  >
                    <Unplug className="h-3.5 w-3.5" />
                    {t('cloudConnection.actions.disconnect')}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    className="ui-accent-cell min-w-0 flex-1 border-l border-border-subtle"
                    onClick={() => void run('connect', cloudConnectionClient.connect)}
                  >
                    {busy === 'connect' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PlugZap className="h-3.5 w-3.5" />
                    )}
                    {t('cloudConnection.actions.connect')}
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="ui-form-row">
            <span className="ui-form-label items-center">
              {t('cloudConnection.fields.configFile')}
            </span>
            <div className="ui-form-value !flex-row items-stretch">
              <span className="ui-flush-text min-w-0 flex-1">
                {t('cloudConnection.notConfigured')}
              </span>
              <button
                type="button"
                disabled={busy !== null}
                data-testid="cloud-connection-import"
                className="ui-accent-cell w-[140px] flex-shrink-0 border-l border-border-subtle"
                onClick={() => void run('import', cloudConnectionClient.importConfig)}
              >
                <FileUp className="h-3.5 w-3.5" />
                {t('cloudConnection.actions.importConfig')}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
