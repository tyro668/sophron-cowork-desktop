/**
 * Server state for the input-tables tab: the datasets page, total count,
 * loading flag, and `loadInputTables` with its own request-sequence guard.
 * Local drafts are separate — see use-input-table-drafts.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { DataDataset, DataGroup } from '../../../types';
import { getTablePageCount, TABLE_PAGE_SIZE } from '../../../components/data-view/shared';
import { buildGroupSections } from '../../../components/data-view/group-ui';
import { dataClient } from '../api/data-client';
import type { DataTab } from '../model/types';

export interface LoadInputTablesOptions {
  preserveError?: boolean;
  page?: number;
  query?: string;
  groupId?: string | null;
  groupPage?: number;
}

export function useInputTables(deps: {
  searchQuery: string;
  draftsCount: number;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadingTab: Dispatch<SetStateAction<DataTab | null>>;
  setPendingNavigationTab: Dispatch<SetStateAction<DataTab | null>>;
  /** Keeps the shared group list fresh — every dashboard payload carries it. */
  setGroups?: (groups: DataGroup[]) => void;
}) {
  const { searchQuery, draftsCount, setError, setLoadingTab, setPendingNavigationTab, setGroups } =
    deps;
  const [inputTableDatasets, setInputTableDatasets] = useState<DataDataset[]>([]);
  const [totalInputTableDatasets, setTotalInputTableDatasets] = useState(0);
  const [inputTableGroupCounts, setInputTableGroupCounts] = useState<Record<string, number>>({});
  const [inputTablesLoading, setInputTablesLoading] = useState(false);
  const [datasetPage, setDatasetPage] = useState(1);
  const [datasetGroupPages, setDatasetGroupPages] = useState<Record<string, number>>({});
  const inputTablesRequestSeq = useRef(0);

  const loadInputTables = useCallback(
    async (options: LoadInputTablesOptions = {}) => {
      if (!dataClient.isAvailable()) return;
      const requestSeq = inputTablesRequestSeq.current + 1;
      inputTablesRequestSeq.current = requestSeq;
      setInputTablesLoading(true);
      setLoadingTab('input_tables');
      if (!options.preserveError) {
        setError(null);
      }
      try {
        const isGroupPage = options.groupId !== undefined;
        const groupPage = Math.max(1, options.groupPage ?? 1);
        const nextDashboard = await dataClient.getDashboard({
          query: options.query ?? searchQuery,
          includeSummary: false,
          includeTasks: false,
          includeDatasets: true,
          includeOutputTables: false,
          taskLimit: 0,
          datasetPerGroupLimit: isGroupPage ? 0 : TABLE_PAGE_SIZE,
          datasetGroupId: isGroupPage ? options.groupId : undefined,
          datasetOffset: isGroupPage ? (groupPage - 1) * TABLE_PAGE_SIZE : undefined,
          datasetLimit: isGroupPage ? TABLE_PAGE_SIZE : undefined,
          datasetSourceKind: 'all',
          outputLimit: 0,
        });
        if (requestSeq === inputTablesRequestSeq.current) {
          setInputTableDatasets((current) =>
            isGroupPage
              ? buildGroupSections(
                  [
                    ...current.filter((item) => item.groupId !== (options.groupId ?? null)),
                    ...nextDashboard.datasets,
                  ],
                  nextDashboard.groups,
                  (item) => item.groupId
                ).flatMap((section) => section.rows)
              : nextDashboard.datasets
          );
          setTotalInputTableDatasets(nextDashboard.totalDatasets);
          setInputTableGroupCounts((current) => ({
            ...current,
            ...nextDashboard.datasetGroupCounts,
          }));
          setGroups?.(nextDashboard.groups);
        }
      } catch (err) {
        if (requestSeq === inputTablesRequestSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (requestSeq === inputTablesRequestSeq.current) {
          setPendingNavigationTab((current) => (current === 'input_tables' ? null : current));
          setLoadingTab((current) => (current === 'input_tables' ? null : current));
          setInputTablesLoading(false);
        }
      }
    },
    [searchQuery, setError, setGroups, setLoadingTab, setPendingNavigationTab]
  );

  const setDatasetGroupPage = useCallback(
    async (groupKey: string, page: number) => {
      if (!dataClient.isAvailable()) return;
      const groupId =
        groupKey === 'ungrouped' ? null : groupKey.startsWith('g:') ? groupKey.slice(2) : groupKey;
      setDatasetGroupPages((current) => ({ ...current, [groupKey]: page }));
      await loadInputTables({ query: searchQuery, groupId, groupPage: page });
    },
    [loadInputTables, searchQuery]
  );

  /** Inserts or replaces a dataset row and bumps the total once. */
  const upsertDataset = useCallback((dataset: DataDataset, bumpTotal: boolean) => {
    setInputTableDatasets((current) => [
      dataset,
      ...current.filter((item) => item.id !== dataset.id),
    ]);
    if (bumpTotal) {
      setTotalInputTableDatasets((current) => current + 1);
    }
  }, []);

  const updateDatasetRow = useCallback((dataset: DataDataset) => {
    setInputTableDatasets((current) =>
      current.map((item) => (item.id === dataset.id ? dataset : item))
    );
  }, []);

  const removeDataset = useCallback((id: string) => {
    setInputTableDatasets((current) => current.filter((item) => item.id !== id));
    setTotalInputTableDatasets((current) => Math.max(0, current - 1));
  }, []);

  useEffect(() => {
    const pageCount = getTablePageCount(totalInputTableDatasets + draftsCount);
    if (datasetPage > pageCount) {
      setDatasetPage(pageCount);
    }
  }, [datasetPage, draftsCount, totalInputTableDatasets]);

  return {
    inputTableDatasets,
    totalInputTableDatasets,
    inputTableGroupCounts,
    inputTablesLoading,
    datasetPage,
    datasetGroupPages,
    loadInputTables,
    setDatasetGroupPage,
    upsertDataset,
    updateDatasetRow,
    removeDataset,
    setInputTablesLoading,
    setDatasetPage,
    setTotalInputTableDatasets,
  };
}

export type InputTablesState = ReturnType<typeof useInputTables>;
