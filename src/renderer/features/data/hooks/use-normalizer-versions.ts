import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataRawTableNormalizerArtifactVersion } from '../../../../shared/contracts/data';
import { formatIpcError } from '../../../utils/ipc-error';
import { dataClient } from '../api/data-client';

export function useNormalizerVersions(
  artifactId: string | undefined,
  reportError: (message: string) => void
) {
  const [normalizerVersions, setVersions] = useState<DataRawTableNormalizerArtifactVersion[]>([]);
  const [normalizerVersionsLoading, setLoading] = useState(false);
  const latest = useRef(0);
  const refreshNormalizerVersions = useCallback(
    async (id: string | undefined) => {
      const request = ++latest.current;
      setLoading(Boolean(id));
      if (!id) {
        setVersions([]);
        return;
      }
      try {
        const { versions } = await dataClient.listRawTableNormalizerVersions({ artifactId: id });
        if (request === latest.current) setVersions(versions);
      } catch (error) {
        if (request === latest.current) reportError(formatIpcError(error, String(error)));
      } finally {
        if (request === latest.current) setLoading(false);
      }
    },
    [reportError]
  );
  const cancelPending = useCallback(() => {
    latest.current++;
  }, []);
  useEffect(() => {
    setVersions([]);
    void refreshNormalizerVersions(artifactId);
    return cancelPending;
  }, [artifactId, refreshNormalizerVersions, cancelPending]);
  return { normalizerVersions, normalizerVersionsLoading, refreshNormalizerVersions };
}
