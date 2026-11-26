import { useCallback, useEffect, useRef, useState } from 'react';
import { automationClient } from '../api/automation-client';
import type {
  ScriptPackageSummary,
  ScriptPackageVersion,
  ScriptPackageVersionDetail,
} from '../../../../shared/automation/script-package';
import { formatIpcError } from '../../../utils/ipc-error';

export function useScriptPackageVersions(
  packageId: string | undefined,
  initialVersion: number | undefined,
  reportError: (error: string) => void
) {
  const api = automationClient.scripts;
  const latestRefresh = useRef(0);
  const [summary, setSummary] = useState<ScriptPackageSummary | null>(null);
  const [versions, setVersions] = useState<ScriptPackageVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(initialVersion ?? null);
  const [detail, setDetail] = useState<ScriptPackageVersionDetail | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const refresh = useCallback(
    async (id = packageId) => {
      if (!id) return null;
      const request = ++latestRefresh.current;
      setVersionsLoading(true);
      try {
        const [nextSummary, nextVersions] = await Promise.all([api.get(id), api.versions(id)]);
        if (request !== latestRefresh.current) return null;
        setSummary(nextSummary);
        setVersions(nextVersions);
        return { summary: nextSummary, versions: nextVersions };
      } finally {
        if (request === latestRefresh.current) setVersionsLoading(false);
      }
    },
    [api, packageId]
  );

  useEffect(() => {
    if (!packageId || viewVersion == null || summary?.missing) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void api
      .versionDetail(packageId, viewVersion)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setSelectedPath((current) =>
          next.files.some((file) => file.path === current)
            ? current
            : (next.files.find((file) => file.path === next.entry)?.path ??
              next.files[0]?.path ??
              '')
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) reportError(formatIpcError(err, String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [api, packageId, viewVersion, versions, summary?.missing, reportError]);

  return {
    summary,
    setSummary,
    versions,
    versionsLoading,
    viewVersion,
    setViewVersion,
    detail,
    selectedPath,
    setSelectedPath,
    refresh,
  };
}
