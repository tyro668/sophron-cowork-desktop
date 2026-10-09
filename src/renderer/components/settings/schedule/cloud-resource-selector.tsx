import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PersonalAnalysisSpace, PersonalAnalysisProject } from '../../../types';
import { dataClient } from '../../../features/data/api/data-client';
import { useAppStore } from '../../../store';
import {
  hasPersonalAnalysisConnection,
  getPersonalAnalysisErrorMessage,
} from '../../../../shared/personal-analysis';
import { Button } from '../../ui/button';
import { FieldStack, SelectLine } from './editor-controls';

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
  const [loginBusy, setLoginBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const appConfig = useAppStore((state) => state.appConfig);
  const auth = useAppStore((state) => state.desktopAuthStatus);
  const setAuth = useAppStore((state) => state.setDesktopAuthStatus);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const connected =
    hasPersonalAnalysisConnection(appConfig?.personalAnalysis) ||
    (auth.authenticated && !!auth.apiOrigin);
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
  }, [connected, t]);
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
  }, [connected, spaceId, t]);
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
  }, [connected, spaceId, projectId, resource, page, create, t]);
  return (
    <>
      {!connected && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={loginBusy}
            onClick={() => {
              setLoginBusy(true);
              void dataClient
                .authLogin()
                .then(setAuth)
                .catch((error) => setError(getPersonalAnalysisErrorMessage(error, t)))
                .finally(() => setLoginBusy(false));
            }}
          >
            {t('schedule.cloudSync.login')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setSettingsTab('personal-analysis');
              setShowSettings(true);
            }}
          >
            {t('schedule.cloudSync.connection')}
          </Button>
        </div>
      )}
      <FieldStack label={t('schedule.cloudSync.space')}>
        <SelectLine
          value={spaceId}
          options={withSavedOption(
            spaces.map((space) => ({ value: space.spaceId, label: space.spaceName })),
            spaceId
          )}
          placeholder={t('schedule.cloudSync.selectSpace')}
          onChange={(spaceId) => onChange({ ...clearTarget, spaceId, projectId: '' })}
        />
      </FieldStack>
      <FieldStack label={t('schedule.cloudSync.project')}>
        <SelectLine
          value={projectId}
          options={withSavedOption(
            projects.map((project) => ({ value: project.projectId, label: project.projectName })),
            projectId
          )}
          placeholder={t('schedule.cloudSync.selectProject')}
          onChange={(projectId) => onChange({ ...clearTarget, projectId })}
        />
      </FieldStack>
      {!create && (
        <FieldStack
          label={t(
            resource === 'drive' ? 'schedule.cloudSync.target' : 'schedule.cloudInput.sourceTable'
          )}
        >
          <div className="space-y-2">
            <SelectLine
              value={targetId}
              options={withSavedOption(targets, targetId, String(config[nameKey] ?? ''))}
              placeholder={t(
                resource === 'drive'
                  ? 'schedule.cloudSync.selectTarget'
                  : 'schedule.cloudInput.selectSource'
              )}
              onChange={(value) => {
                const target = targets.find((item) => item.value === value);
                onChange({
                  [targetKey]: value,
                  [nameKey]: target?.label,
                  version: target?.version,
                });
              }}
            />
            {loading && <span className="text-xs text-text-muted">{t('common.loading')}</span>}
            {hasMore && (
              <Button size="sm" disabled={loading} onClick={() => setPage((page) => page + 1)}>
                {t('schedule.cloudSync.loadMore')}
              </Button>
            )}
          </div>
        </FieldStack>
      )}
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </>
  );
}
