/**
 * 数据 → 云连接：布局对齐「云空间」——左侧标题 + 连接状态徽标 + ⋮ 菜单，右侧为选中分组 / 表的配置。
 * 连接配置在「设置 → 云连接」；未导入配置时显示跳转到设置的空状态。
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Loader2, Settings2 } from 'lucide-react';

import type { CloudConnectionState, CloudConnectionStatus } from '../../../shared/contracts';
import { useCloudConnection } from '../../features/cloud-connection/hooks/use-cloud-connection';
import { useAppStore } from '../../store';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type BadgeTone,
} from '../ui';
import { DatasourceManager } from './cloud-connection-datasource';
import { formatDateTime } from './shared';

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

/** 标题后的状态徽标：已连接绿、连接中黄、未连接灰、连接失败红，对齐云空间 Badge 样式。 */
export function connectionStatusBadge(state: CloudConnectionState): {
  tone: BadgeTone;
  labelKey: string;
} {
  const status: CloudConnectionStatus = state.status;
  if (status === 'connected') return { tone: 'success', labelKey: 'connected' };
  if (status === 'connecting') return { tone: 'warning', labelKey: 'connecting' };
  if (status === 'reconnecting') return { tone: 'warning', labelKey: 'reconnecting' };
  if (state.lastError || status === 'offline') {
    return { tone: 'error', labelKey: state.lastError ? 'failed' : 'offline' };
  }
  return { tone: 'default', labelKey: 'idle' };
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
  const [logOpen, setLogOpen] = useState(false);

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
      <div
        className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent"
        data-testid="cloud-connection-panel"
      >
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-5">
          <div className="flex w-full max-w-[340px] flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-muted text-accent-text">
              <Link2 className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-[16px] font-semibold leading-tight text-text-primary">
              {t('cloudConnection.emptyConfig')}
            </h3>
            <p className="mt-1.5 text-[13px] leading-6 text-text-secondary">
              {t('cloudConnection.emptyConfigDesc')}
            </p>
            <div className="mt-6 flex w-full flex-col gap-2.5">
              <button
                type="button"
                data-testid="cloud-connection-open-settings"
                onClick={openSettings}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-foreground shadow-soft transition-colors hover:bg-accent-hover"
              >
                <Settings2 className="h-4 w-4" />
                {t('cloudConnection.actions.goToSettings')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const badge = connectionStatusBadge(state);

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent"
      data-testid="cloud-connection-panel"
    >
      <DatasourceManager
        state={state}
        busy={busy}
        run={run}
        statusBadge={
          <Badge
            tone={badge.tone}
            data-testid="cloud-connection-status"
            title={state.lastError ?? undefined}
          >
            {(state.status === 'connecting' || state.status === 'reconnecting') && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {t(`cloudConnection.status.${badge.labelKey}`)}
          </Badge>
        }
        onOpenSettings={openSettings}
        onOpenLog={() => setLogOpen(true)}
      />

      <Dialog
        open={logOpen}
        onOpenChange={setLogOpen}
        className="w-[min(640px,92vw)]"
        ariaLabel={t('cloudConnection.actions.activityLog')}
      >
        <DialogHeader>
          <DialogTitle>{t('cloudConnection.actions.activityLog')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[70vh] overflow-auto" data-testid="cloud-connection-runtime">
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
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => setLogOpen(false)}>{t('cloudConnection.actions.close')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
