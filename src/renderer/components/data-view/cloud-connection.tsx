import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  FilePlus2,
  FileSpreadsheet,
  FileUp,
  Link2,
  Loader2,
  PlugZap,
  RefreshCw,
  Trash2,
  Unplug,
} from 'lucide-react';
import type {
  CloudConnectionActionResult,
  CloudConnectionFile,
  CloudConnectionFilePreview,
  CloudConnectionState,
  CloudConnectionStatus,
} from '../../../shared/contracts';
import { cloudConnectionClient } from '../../features/cloud-connection/api/cloud-connection-client';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
} from '../ui';
import type { BadgeTone } from '../ui';
import { showToast } from '../../utils/toast';
import { useOptionalConfirmDialog } from '../ConfirmDialog';
import { EmptyState, flatToolbarRowClass, DataToolbarButton, formatDateTime } from './shared';

const STATUS_TONE: Record<CloudConnectionStatus, BadgeTone> = {
  idle: 'default',
  connecting: 'warning',
  connected: 'success',
  reconnecting: 'warning',
  disconnected: 'default',
  offline: 'error',
  stopped: 'default',
};

const REMOTE_ENV_KEYS = [
  'baseUrl',
  'rowcountTimout',
  'contentTimout',
  's3InternalCooldownTime',
  'tableHeartbeatInterval',
  'maxSyncExcelSize',
  'maxColSize',
];

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ui-form-row">
      <span className="ui-form-label items-center">{label}</span>
      <div className="ui-form-value text-[13px] text-text-primary">{children}</div>
    </div>
  );
}

function sheetStats(file: CloudConnectionFile) {
  const sheets = file.sheets ?? [];
  return {
    tables: sheets.length,
    rows: sheets.reduce((sum, s) => sum + s.rowCount, 0),
    columns: sheets.reduce((max, s) => Math.max(max, s.columns.length), 0),
  };
}

export function CloudConnectionPanel() {
  const { t, i18n } = useTranslation();
  const confirmDialog = useOptionalConfirmDialog();
  const [state, setState] = useState<CloudConnectionState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [preview, setPreview] = useState<CloudConnectionFilePreview | null>(null);
  const [previewSheet, setPreviewSheet] = useState(0);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudConnectionClient.isAvailable()) return undefined;
    let active = true;
    void cloudConnectionClient.getState().then((s) => {
      if (active) setState(s);
    });
    const off = cloudConnectionClient.onState((s) => setState(s));
    return () => {
      active = false;
      off();
    };
  }, []);

  useEffect(() => {
    if (state) setSourceName(state.sourceName);
  }, [state?.sourceName]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(
    async (key: string, action: () => Promise<CloudConnectionActionResult>) => {
      setBusy(key);
      try {
        const result = await action();
        setState(result.state);
        if (!result.success && result.error) showToast('error', result.error);
      } catch (error) {
        showToast('error', error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const openPreview = useCallback(async (file: CloudConnectionFile) => {
    setPreviewLoading(file.path);
    try {
      const result = await cloudConnectionClient.previewFile(file.path);
      setPreviewSheet(0);
      setPreview(result);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(null);
    }
  }, []);

  const isLive = state ? ['connecting', 'connected', 'reconnecting'].includes(state.status) : false;
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

  const config = state.config;
  const serverText = config
    ? `${config.protocol}://${config.host}:${config.port}${config.path ?? ''}`
    : '';

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-connection-panel">
      <div className={flatToolbarRowClass}>
        <div className="min-w-0 flex-1 px-3">
          <div className="flex h-full min-w-0 items-center gap-2">
            <Link2 className="h-4 w-4 flex-shrink-0 text-accent" />
            <span className="truncate text-[13px] font-semibold text-text-primary">
              {t('cloudConnection.title')}
            </span>
            <Badge tone={STATUS_TONE[state.status]} data-testid="cloud-connection-status">
              {(state.status === 'connecting' || state.status === 'reconnecting') && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {t(`cloudConnection.status.${state.status}`)}
            </Badge>
          </div>
        </div>
        <div className="flex">
          <DataToolbarButton
            icon={<FileUp className="h-3.5 w-3.5" />}
            label={
              config
                ? t('cloudConnection.actions.reimportConfig')
                : t('cloudConnection.actions.importConfig')
            }
            disabled={busy !== null}
            onClick={() => void run('import', cloudConnectionClient.importConfig)}
          />
          {isLive ? (
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
              disabled={busy !== null || !config}
              onClick={() => void run('connect', cloudConnectionClient.connect)}
            />
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="ui-group bg-surface">
          <h4 className="ui-group-title">{t('cloudConnection.sections.config')}</h4>
          {config ? (
            <>
              <FormRow label={t('cloudConnection.fields.configFile')}>
                <span className="truncate">{config.fileName ?? 'config.yaml'}</span>
              </FormRow>
              <FormRow label={t('cloudConnection.fields.agentId')}>
                <span className="font-mono text-[12px]">{config.agentIdMasked}</span>
              </FormRow>
              <FormRow label={t('cloudConnection.fields.server')}>
                <span className="truncate font-mono text-[12px]">{serverText}</span>
              </FormRow>
              <FormRow label={t('cloudConnection.fields.token')}>
                <span>
                  {config.hasToken
                    ? t('cloudConnection.tokenSaved')
                    : t('cloudConnection.tokenMissing')}
                </span>
              </FormRow>
              <FormRow label={t('cloudConnection.fields.autoConnect')}>
                <div className="flex items-center justify-between gap-2">
                  <Switch
                    size="sm"
                    checked={state.autoConnect}
                    disabled={busy !== null}
                    onCheckedChange={(v) =>
                      void run('auto', () => cloudConnectionClient.setAutoConnect(v))
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void run('clear', cloudConnectionClient.clearConfig)}
                  >
                    {t('cloudConnection.actions.clearConfig')}
                  </Button>
                </div>
              </FormRow>
            </>
          ) : (
            <div className="flex h-10 items-center justify-between px-3 text-[13px] text-text-muted">
              <span>{t('cloudConnection.notConfigured')}</span>
              <Button
                size="sm"
                variant="primary"
                disabled={busy !== null}
                onClick={() => void run('import', cloudConnectionClient.importConfig)}
              >
                <FileUp className="h-3.5 w-3.5" />
                {t('cloudConnection.actions.importConfig')}
              </Button>
            </div>
          )}
        </section>

        <section className="ui-group bg-surface">
          <h4 className="ui-group-title">{t('cloudConnection.sections.status')}</h4>
          <FormRow label={t('cloudConnection.fields.state')}>
            <span>{t(`cloudConnection.status.${state.status}`)}</span>
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

        <section className="ui-group bg-surface">
          <div className="ui-group-title justify-between">
            <span>{t('cloudConnection.sections.files')}</span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null || state.files.length === 0}
                onClick={() => void run('refresh', cloudConnectionClient.refreshFiles)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('cloudConnection.actions.refresh')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-accent"
                disabled={busy !== null}
                onClick={() => void run('add', cloudConnectionClient.addFiles)}
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                {t('cloudConnection.actions.addFiles')}
              </Button>
            </div>
          </div>
          <FormRow label={t('cloudConnection.fields.sourceName')}>
            <Input
              value={sourceName}
              disabled={isLive || busy !== null}
              title={isLive ? t('cloudConnection.sourceNameLocked') : undefined}
              onChange={(e) => setSourceName(e.target.value)}
              onBlur={() => {
                if (sourceName.trim() && sourceName.trim() !== state.sourceName)
                  void run('source', () => cloudConnectionClient.setSourceName(sourceName.trim()));
              }}
              className="h-7 border-0 bg-transparent px-1 shadow-none"
            />
          </FormRow>
          {state.files.length === 0 ? (
            <EmptyState
              label={t('cloudConnection.emptyFiles')}
              icon={<FileSpreadsheet className="h-5 w-5" />}
              action={
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy !== null}
                  onClick={() => void run('add', cloudConnectionClient.addFiles)}
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  {t('cloudConnection.actions.addFiles')}
                </Button>
              }
            />
          ) : (
            <table className="w-full table-fixed text-[13px]">
              <thead>
                <tr className="h-8 border-b border-border-subtle bg-surface-muted text-left text-xs text-text-secondary">
                  <th className="px-3 font-medium">{t('cloudConnection.fileColumns.name')}</th>
                  <th className="w-24 px-2 font-medium">
                    {t('cloudConnection.fileColumns.status')}
                  </th>
                  <th className="w-14 px-2 text-right font-medium">
                    {t('cloudConnection.fileColumns.tables')}
                  </th>
                  <th className="w-20 px-2 text-right font-medium">
                    {t('cloudConnection.fileColumns.rows')}
                  </th>
                  <th className="w-14 px-2 text-right font-medium">
                    {t('cloudConnection.fileColumns.columns')}
                  </th>
                  <th className="w-[148px] px-2 font-medium">
                    {t('cloudConnection.fileColumns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.files.map((file) => {
                  const stats = sheetStats(file);
                  const tone: BadgeTone =
                    file.status === 'ready'
                      ? 'success'
                      : file.status === 'error'
                        ? 'error'
                        : 'default';
                  return (
                    <tr
                      key={file.path}
                      className="h-10 border-b border-border-subtle last:border-b-0 hover:bg-surface-hover/60"
                    >
                      <td className="px-3">
                        <div className="truncate text-text-primary" title={file.path}>
                          {file.name}
                        </div>
                        <div className="truncate text-[11px] text-text-muted" title={file.path}>
                          {file.error ?? file.path}
                        </div>
                      </td>
                      <td className="px-2">
                        <Badge tone={tone}>{t(`cloudConnection.fileStatus.${file.status}`)}</Badge>
                      </td>
                      <td className="px-2 text-right tabular-nums">
                        {file.sheets ? stats.tables : '-'}
                      </td>
                      <td className="px-2 text-right tabular-nums">
                        {file.sheets ? stats.rows : '-'}
                      </td>
                      <td className="px-2 text-right tabular-nums">
                        {file.sheets ? stats.columns : '-'}
                      </td>
                      <td className="px-2">
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={file.status !== 'ready' || previewLoading !== null}
                            loading={previewLoading === file.path}
                            onClick={() => void openPreview(file)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            {t('cloudConnection.actions.preview')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="hover:text-error"
                            disabled={busy !== null}
                            onClick={async () => {
                              const ok = confirmDialog
                                ? await confirmDialog.confirmDelete({
                                    message: t('cloudConnection.removeConfirm'),
                                  })
                                : true;
                              if (ok)
                                void run('remove', () =>
                                  cloudConnectionClient.removeFile(file.path)
                                );
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('cloudConnection.actions.remove')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="ui-group bg-surface">
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
      </div>

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        className="w-[min(960px,92vw)]"
        ariaLabel={t('cloudConnection.previewTitle')}
      >
        {preview && (
          <>
            <DialogHeader>
              <DialogTitle>
                {t('cloudConnection.previewTitle')} · {preview.name}
              </DialogTitle>
            </DialogHeader>
            <DialogBody className="max-h-[70vh] overflow-auto">
              {preview.sheets.length > 1 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {preview.sheets.map((s, i) => (
                    <Button
                      key={s.tableId}
                      size="sm"
                      variant={i === previewSheet ? 'primary' : 'secondary'}
                      onClick={() => setPreviewSheet(i)}
                    >
                      {s.sheetName ?? preview.name}
                    </Button>
                  ))}
                </div>
              )}
              {(() => {
                const sheet = preview.sheets[previewSheet];
                if (!sheet) return null;
                return (
                  <div className="overflow-hidden rounded-md border border-border-subtle">
                    <div className="flex h-8 items-center gap-3 border-b border-border-subtle bg-surface-muted px-3 text-xs text-text-secondary">
                      <span className="font-mono">{sheet.tableId}</span>
                      <span>{t('cloudConnection.rowCount', { count: sheet.rowCount })}</span>
                      <span>
                        {t('cloudConnection.previewRows', { count: sheet.sampleRows.length })}
                      </span>
                    </div>
                    <div className="overflow-auto">
                      <table className="min-w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-border-subtle bg-surface-muted text-left">
                            {sheet.columns.map((c, i) => (
                              <th
                                key={`${c}-${i}`}
                                className="whitespace-nowrap px-2 py-1 font-medium"
                              >
                                <div className="text-text-primary">{c}</div>
                                <div className="text-[11px] font-normal text-text-muted">
                                  {t(`cloudConnection.columnTypes.${sheet.columnTypes[i]}`, {
                                    defaultValue: String(sheet.columnTypes[i]),
                                  })}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.sampleRows.map((row, r) => (
                            <tr key={r} className="border-b border-border-subtle last:border-b-0">
                              {row.map((v, c) => (
                                <td
                                  key={c}
                                  className="max-w-[240px] truncate whitespace-nowrap px-2 py-1"
                                >
                                  {v ?? ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => setPreview(null)}>{t('cloudConnection.actions.close')}</Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </div>
  );
}
