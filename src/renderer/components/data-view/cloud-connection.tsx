/**
 * 数据 → 云连接：导入配置后在此管理数据源（分组目录树、手动表表单、预览），并查看运行状态与云端请求。
 * 连接配置（导入 config.yaml、连接 / 断开、自动连接）在「设置 → 云连接」；未导入时只显示跳转到设置的空状态。
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Loader2, PlugZap, Settings2, Unplug } from 'lucide-react';

import { cloudConnectionClient } from '../../features/cloud-connection/api/cloud-connection-client';
import {
  isLiveStatus,
  useCloudConnection,
} from '../../features/cloud-connection/hooks/use-cloud-connection';
import { useAppStore } from '../../store';
import { Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger } from '../ui';
import { DatasourceManager } from './cloud-connection-datasource';
import { CLOUD_CONNECTION_STATUS_TONE } from './cloud-connection-preview';
import {
  DataToolbarButton,
  EmptyState,
  flatToolbarRowClass,
  formatDateTime,
  underlineTabBarClass,
  underlineTabListClass,
  underlineTabTriggerClass,
} from './shared';

export const CLOUD_CONNECTION_SETTINGS_TAB = 'cloud-connection';

const REMOTE_ENV_KEYS = [
  'baseUrl',
  'rowcountTimout',
  'contentTimout',
  's3InternalCooldownTime',
  'tableHeartbeatInterval',
  'maxSyncExcelSize',
  'maxColSize',
];

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-form-row">
      <span className="ui-form-label items-center">{label}</span>
      <div className="ui-form-value text-[13px] text-text-primary">{children}</div>
    </div>
  );
}

/** 打开「设置 → 云连接」。 */
export function useOpenCloudConnectionSettings() {
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  return useCallback(() => {
    setSettingsTab(CLOUD_CONNECTION_SETTINGS_TAB);
    setShowSettings(true);
  }, [setSettingsTab, setShowSettings]);
}

export function CloudConnectionPanel() {
  const { t, i18n } = useTranslation();
  const { state, busy, run } = useCloudConnection();
  const openSettings = useOpenCloudConnectionSettings();
  const [tab, setTab] = useState('sources');

  const remoteEnvEntries = useMemo(
    () =>
      state?.remoteEnv
        ? REMOTE_ENV_KEYS.filter((k) => state.remoteEnv?.[k] !== undefined).map(
            (k) => [k, String(state.remoteEnv?.[k])] as const
          )
        : [],
    [state?.remoteEnv]
  );

  if (!state) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-text-muted">
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
      </div>
    );
  }

  if (!state.configured) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-connection-panel">
        <EmptyState
          label={t('cloudConnection.emptyConfig')}
          icon={<Link2 className="h-5 w-5" />}
          action={
            <Button
              size="sm"
              variant="primary"
              data-testid="cloud-connection-open-settings"
              onClick={openSettings}
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t('cloudConnection.actions.goToSettings')}
            </Button>
          }
        />
      </div>
    );
  }

  const live = isLiveStatus(state);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-connection-panel">
      <div className={flatToolbarRowClass}>
        <div className="min-w-0 flex-1 px-3">
          <div className="flex h-full min-w-0 items-center gap-2">
            <Link2 className="h-4 w-4 flex-shrink-0 text-accent" />
            <span className="truncate text-[13px] font-semibold text-text-primary">
              {t('cloudConnection.title')}
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
        </div>
        <div className="flex">
          <DataToolbarButton
            icon={<Settings2 className="h-3.5 w-3.5" />}
            label={t('cloudConnection.actions.openSettings')}
            onClick={openSettings}
          />
          {live ? (
            <DataToolbarButton
              icon={<Unplug className="h-3.5 w-3.5" />}
              label={t('cloudConnection.actions.disconnect')}
              danger
              disabled={busy !== null}
              onClick={() => void run('disconnect', cloudConnectionClient.disconnect)}
            />
          ) : (
            <DataToolbarButton
              icon={<PlugZap className="h-3.5 w-3.5" />}
              label={t('cloudConnection.actions.connect')}
              active
              disabled={busy !== null}
              onClick={() => void run('connect', cloudConnectionClient.connect)}
            />
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col"
        data-testid="cloud-connection-tabs"
      >
        <div className={underlineTabBarClass}>
          <TabsList className={underlineTabListClass}>
            <TabsTrigger
              value="sources"
              className={underlineTabTriggerClass}
              data-testid="cloud-connection-tab-sources"
            >
              {t('cloudConnection.ds.title')}
            </TabsTrigger>
            <TabsTrigger
              value="runtime"
              className={underlineTabTriggerClass}
              data-testid="cloud-connection-tab-runtime"
            >
              {t('cloudConnection.sections.runtime')}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="sources" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <DatasourceManager state={state} busy={busy} run={run} />
        </TabsContent>
        <TabsContent
          value="runtime"
          className="mt-0 min-h-0 flex-1 overflow-y-auto"
          data-testid="cloud-connection-runtime"
        >
          <section className="ui-group bg-surface">
            <h4 className="ui-group-title">{t('cloudConnection.sections.status')}</h4>
            <FormRow label={t('cloudConnection.fields.agentId')}>
              <span className="font-mono text-[12px]">{state.config?.agentIdMasked}</span>
            </FormRow>
            <FormRow label={t('cloudConnection.fields.connectedAt')}>
              <span>
                {state.connectedAt ? formatDateTime(state.connectedAt) : t('cloudConnection.none')}
              </span>
            </FormRow>
            <FormRow label={t('cloudConnection.fields.remoteEnv')}>
              {remoteEnvEntries.length > 0 ? (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-1 font-mono text-[12px]">
                  {remoteEnvEntries.map(([k, v]) => (
                    <div key={k} className="contents">
                      <span className="text-text-muted">{k}</span>
                      <span className="truncate">{v}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-text-muted">{t('cloudConnection.none')}</span>
              )}
            </FormRow>
            <FormRow label={t('cloudConnection.fields.lastError')}>
              <span className={state.lastError ? 'text-error' : 'text-text-muted'}>
                {state.lastError ?? t('cloudConnection.none')}
              </span>
            </FormRow>
          </section>

          <section className="ui-group bg-surface" data-testid="cloud-connection-activity">
            <h4 className="ui-group-title">{t('cloudConnection.sections.activity')}</h4>
            {state.activities.length === 0 ? (
              <div className="flex h-10 items-center px-3 text-[13px] text-text-muted">
                {t('cloudConnection.emptyActivity')}
              </div>
            ) : (
              <ul className="max-h-60 overflow-y-auto font-mono text-[12px]">
                {state.activities.map((a, i) => (
                  <li
                    key={`${a.at}-${i}`}
                    className="flex h-8 items-center gap-3 border-b border-border-subtle px-3 last:border-b-0"
                  >
                    <span className="w-[72px] flex-shrink-0 text-text-muted">
                      {new Date(a.at).toLocaleTimeString(i18n.language, { hour12: false })}
                    </span>
                    <span
                      className={
                        a.type === 'error'
                          ? 'w-16 flex-shrink-0 text-error'
                          : 'w-16 flex-shrink-0 text-text-secondary'
                      }
                    >
                      {a.type}
                    </span>
                    <span className="flex-shrink-0 text-text-primary">{a.event}</span>
                    <span className="min-w-0 truncate text-text-muted" title={a.detail}>
                      {[a.tableName, a.detail].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
