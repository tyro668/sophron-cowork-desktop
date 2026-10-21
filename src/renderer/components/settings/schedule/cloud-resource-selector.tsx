import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PersonalAnalysisSpace, PersonalAnalysisProject } from '../../../types';
import { dataClient } from '../../../features/data/api/data-client';
import { useAppStore } from '../../../store';
import {
  hasPersonalAnalysisConnection,
  getPersonalAnalysisErrorMessage,
} from '../../../../shared/personal-analysis';
import { CircleAlert, LogIn, RotateCcw, Settings } from 'lucide-react';
import { FormRow, FlushSelect, RequiredLabel } from './editor-controls';

/** Whether a cloud (personal analysis) connection is available. */
export function useCloudConnected(): boolean {
  const appConfig = useAppStore((state) => state.appConfig);
  const auth = useAppStore((state) => state.desktopAuthStatus);
  return (
    hasPersonalAnalysisConnection(appConfig?.personalAnalysis) ||
    (auth.authenticated && !!auth.apiOrigin)
  );
}

/** c13/c14 note row: only rendered while not connected. */
/** c13/c14 note row; `compact` (c22): amber note with one inline 登录云空间 action. */
export function CloudConnectionRow({ compact = false }: { compact?: boolean } = {}) {
  const { t } = useTranslation();
  const connected = useCloudConnected();
  const setAuth = useAppStore((state) => state.setDesktopAuthStatus);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (connected) return null;
  return (
    <FormRow label={t('schedule.cloudSync.cloudLabel')}>
      <div className="flex min-h-[35px] flex-1 items-stretch" data-testid="cloud-not-connected">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 bg-warning/10 px-[10px] text-[12.5px] font-medium text-warning">
          <CircleAlert className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{error || t('schedule.cloudSync.notConnected')}</span>
        </span>
        <button
          type="button"
          disabled={busy}
          data-testid="cloud-login"
          className={
            compact
              ? 'ui-accent-cell flex-shrink-0 bg-warning/10'
              : 'ui-accent-cell min-w-0 flex-1 border-l border-border-subtle'
          }
          onClick={() => {
            setBusy(true);
            setError('');
            void dataClient
              .authLogin()
              .then(setAuth)
              .catch((err) => setError(getPersonalAnalysisErrorMessage(err, t)))
              .finally(() => setBusy(false));
          }}
        >
          <LogIn className="h-3.5 w-3.5" />
          {t('schedule.cloudSync.login')}
        </button>
        {compact ? null : (
          <button
            type="button"
            className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle"
            onClick={() => {
              setSettingsTab('personal-analysis');
              setShowSettings(true);
            }}
          >
            <Settings className="h-3.5 w-3.5" />
            {t('schedule.cloudSync.connection')}
          </button>
        )}
      </div>
    </FormRow>
  );
}

export function withSavedOption(
  options: Array<{ value: string; label: string }>,
  value: string,
  label?: string
) {
  return value && !options.some((option) => option.value === value)
    ? [{ value, label: label || value }, ...options]
    : options;
}

/** Both directions use the same space/project hierarchy, with disjoint resources. */
export function CloudResourceSelector({
  config,
  resource,
  create,
  onChange,
}: {
  config: Record<string, unknown>;
  resource: 'drive' | 'analysis' | 'base';
  create?: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const spaceId = String(config.spaceId ?? '');
  const projectId = String(config.projectId ?? '');
  const targetKey = resource === 'drive' ? 'fileId' : 'tableId';
  const nameKey = resource === 'drive' ? 'fileName' : 'tableName';
  const targetId = String(config[targetKey] ?? '');
  const [spaces, setSpaces] = useState<PersonalAnalysisSpace[]>([]);
  const [projects, setProjects] = useState<PersonalAnalysisProject[]>([]);
  const [targets, setTargets] = useState<Array<{ value: string; label: string; version?: number }>>(
    []
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const connected = useCloudConnected();
  const clearTarget = { [targetKey]: undefined, [nameKey]: undefined, version: undefined };
  useEffect(() => {
    let active = true;
    setSpaces([]);
    if (connected)
      void dataClient
        .listCloudSpaces()
        .then((result) => {
          if (active) setSpaces(result.spaces);
        })
        .catch((error) => {
          if (active) setError(getPersonalAnalysisErrorMessage(error, t));
        });
    return () => {
      active = false;
    };
  }, [connected, reloadKey, t]);
  useEffect(() => {
    let active = true;
    setProjects([]);
    if (connected && spaceId)
      void dataClient
        .listCloudProjects({ spaceId })
        .then((result) => {
          if (active) setProjects(result.projects);
        })
        .catch((error) => {
          if (active) setError(getPersonalAnalysisErrorMessage(error, t));
        });
    return () => {
      active = false;
    };
  }, [connected, spaceId, reloadKey, t]);
  useEffect(() => {
    setPage(1);
    setTargets([]);
  }, [spaceId, projectId, resource, create]);
  useEffect(() => {
    let active = true;
    setLoading(false);
    setHasMore(false);
    if (!connected || !spaceId || !projectId || create) return;
    setLoading(true);
    setError('');
    const params = { spaceId, projectId, page, pageSize: 50 };
    const request =
      resource === 'drive'
        ? dataClient.listCloudDriveFiles({ ...params, fileType: 'csv' }).then((result) => ({
            items: result.files
              .filter((file) => file.fileType === 'csv' && file.writable !== false)
              .map((file) => ({ value: file.fileId, label: file.fileName, version: file.version })),
            hasMore: result.hasMore,
          }))
        : dataClient.listCloudTables(params).then((result) => ({
            items: result.tables
              .filter((table) => table.kind === resource)
              .map((table) => ({ value: table.tableId, label: table.tableName })),
            hasMore: result.hasMore,
          }));
    void request
      .then((result) => {
        if (active) {
          setTargets((previous) => (page === 1 ? result.items : [...previous, ...result.items]));
          setHasMore(result.hasMore);
        }
      })
      .catch((error) => {
        if (active) setError(getPersonalAnalysisErrorMessage(error, t));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connected, spaceId, projectId, resource, page, create, reloadKey, t]);
  const targetLabel = t(
    resource === 'drive' ? 'schedule.cloudSync.target' : 'schedule.cloudInput.sourceTable'
  );
  return (
    <>
      <FormRow label={<RequiredLabel>{t('schedule.cloudSync.space')}</RequiredLabel>}>
        <FlushSelect
          ariaLabel={t('schedule.cloudSync.space')}
          disabled={!connected}
          value={spaceId}
          options={withSavedOption(
            spaces.map((space) => ({ value: space.spaceId, label: space.spaceName })),
            spaceId,
            String(config.spaceName ?? '')
          )}
          placeholder={t('schedule.cloudSync.selectSpace')}
          onChange={(spaceId) =>
            onChange({
              ...clearTarget,
              spaceId,
              spaceName: spaces.find((space) => space.spaceId === spaceId)?.spaceName,
              projectId: '',
              projectName: undefined,
            })
          }
        />
      </FormRow>
      <FormRow label={<RequiredLabel>{t('schedule.cloudSync.project')}</RequiredLabel>}>
        <FlushSelect
          ariaLabel={t('schedule.cloudSync.project')}
          disabled={!connected || !spaceId}
          value={projectId}
          options={withSavedOption(
            projects.map((project) => ({ value: project.projectId, label: project.projectName })),
            projectId,
            String(config.projectName ?? '')
          )}
          placeholder={t('schedule.cloudSync.selectProject')}
          onChange={(projectId) =>
            onChange({
              ...clearTarget,
              projectId,
              projectName: projects.find((project) => project.projectId === projectId)?.projectName,
            })
          }
        />
      </FormRow>
      {!create && (
        <FormRow label={<RequiredLabel>{targetLabel}</RequiredLabel>}>
          <FlushSelect
            ariaLabel={targetLabel}
            disabled={!connected || !projectId}
            loading={loading}
            value={targetId}
            options={withSavedOption(targets, targetId, String(config[nameKey] ?? ''))}
            placeholder={
              loading && !targetId
                ? t('schedule.cloudSync.loadingTargets')
                : t(
                    resource === 'drive'
                      ? 'schedule.cloudSync.selectTarget'
                      : 'schedule.cloudInput.selectSource'
                  )
            }
            onChange={(value) => {
              const target = targets.find((item) => item.value === value);
              onChange({
                [targetKey]: value,
                [nameKey]: target?.label,
                version: target?.version,
              });
            }}
            footer={
              hasMore ? (
                <button
                  type="button"
                  disabled={loading}
                  data-testid="cloud-load-more"
                  onClick={() => setPage((page) => page + 1)}
                  className="ui-accent-cell h-8 w-full"
                >
                  {t('schedule.cloudSync.loadMore')}
                </button>
              ) : undefined
            }
          />
        </FormRow>
      )}
      {error && (
        <FormRow label="">
          <div
            className="flex min-h-[35px] flex-1 items-stretch"
            role="alert"
            data-testid="cloud-error-row"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5 bg-error/10 px-[10px] text-[12.5px] font-medium text-error">
              <CircleAlert className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate" title={error}>
                {error}
              </span>
            </span>
            <button
              type="button"
              data-testid="cloud-retry"
              aria-label={t('schedule.cloudSync.retry')}
              title={t('schedule.cloudSync.retry')}
              onClick={() => {
                setError('');
                setReloadKey((key) => key + 1);
              }}
              className="ui-accent-cell w-10 flex-shrink-0 !px-0 border-l border-border-subtle"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </FormRow>
      )}
    </>
  );
}
