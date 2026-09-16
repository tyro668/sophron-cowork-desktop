/**
 * Stored-table preview dialog: open/loading/error/data/page/target state and
 * the preview fetches for input tables and output tables. Dialog-local error
 * state — preview failures don't touch the page error banner.
 */
import { useCallback, useState } from 'react';
import type { DataDataset, DataInputTablePreview, DataOutputTable } from '../../../types';
import { INPUT_TABLE_PREVIEW_PAGE_SIZE } from '../../../components/data-view/shared';
import { dataClient } from '../api/data-client';
import type { StoredPreviewTarget } from '../model/types';

export function useStoredPreview() {
  const [storedPreviewOpen, setStoredPreviewOpen] = useState(false);
  const [storedPreviewLoading, setStoredPreviewLoading] = useState(false);
  const [storedPreviewError, setStoredPreviewError] = useState<string | null>(null);
  const [storedPreviewData, setStoredPreviewData] = useState<DataInputTablePreview | null>(null);
  const [storedPreviewPage, setStoredPreviewPage] = useState(1);
  const [storedPreviewTarget, setStoredPreviewTarget] = useState<StoredPreviewTarget | null>(null);

  const openPreview = useCallback(async (target: StoredPreviewTarget, id: string, page: number) => {
    if (!dataClient.has('previewDataset')) return;
    setStoredPreviewOpen(true);
    setStoredPreviewTarget(target);
    setStoredPreviewLoading(true);
    setStoredPreviewError(null);
    setStoredPreviewPage(page);
    try {
      const preview = await dataClient.previewDataset({
        id,
        limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
        offset: (page - 1) * INPUT_TABLE_PREVIEW_PAGE_SIZE,
      });
      setStoredPreviewData(preview);
    } catch (err) {
      setStoredPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setStoredPreviewLoading(false);
    }
  }, []);

  const previewInputTable = useCallback(
    (dataset: DataDataset, page = 1) => openPreview({ kind: 'input', dataset }, dataset.id, page),
    [openPreview]
  );

  const previewOutputTable = useCallback(
    (outputTable: DataOutputTable, page = 1) =>
      openPreview({ kind: 'output', outputTable }, outputTable.id, page),
    [openPreview]
  );

  const close = useCallback(() => setStoredPreviewOpen(false), []);

  return {
    storedPreviewOpen,
    storedPreviewLoading,
    storedPreviewError,
    storedPreviewData,
    storedPreviewPage,
    storedPreviewTarget,
    previewInputTable,
    previewOutputTable,
    close,
  };
}

export type StoredPreviewState = ReturnType<typeof useStoredPreview>;
