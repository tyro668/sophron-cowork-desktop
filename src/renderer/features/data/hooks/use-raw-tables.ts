/**
 * Server state for the raw-tables tab: the rawTables page, total count,
 * loading flag, and `loadRawTables` with its own request-sequence guard.
 * Local drafts are separate — see use-raw-table-drafts.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { DataRawTable, DataGroup } from '../../../types';
import { getTablePageCount, TABLE_PAGE_SIZE } from '../../../components/data-view/shared';
import { buildGroupSections } from '../../../components/data-view/group-ui';
import { dataClient } from '../api/data-client';
import type { DataTab } from '../model/types';

export interface LoadRawTablesOptions {
  preserveError?: boolean;
  page?: number;
  query?: string;
  groupId?: string | null;
  groupPage?: number;
}

export function useRawTables(deps: {
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
  const [rawTables, setRawTables] = useState<DataRawTable[]>([]);
  const [totalRawTables, setTotalRawTables] = useState(0);
  const [rawTableGroupCounts, setRawTableGroupCounts] = useState<Record<string, number>>({});
  const [rawTablesLoading, setRawTablesLoading] = useState(false);
  const [rawTablePage, setRawTablePage] = useState(1);
  const [rawTableGroupPages, setRawTableGroupPages] = useState<Record<string, number>>({});
  const rawTablesRequestSeq = useRef(0);

  const loadRawTables = useCallback(
    async (options: LoadRawTablesOptions = {}) => {
      if (!dataClient.isAvailable()) return;
      const requestSeq = rawTablesRequestSeq.current + 1;
      rawTablesRequestSeq.current = requestSeq;
      setRawTablesLoading(true);
      setLoadingTab('raw_tables');
      if (!options.preserveError) {
        setError(null);
      }
      try {
        const isGroupPage = options.groupId !== undefined;
        const groupPage = Math.max(1, options.groupPage ?? 1);
        const nextDashboard = await dataClient.getDashboard({
          query: options.query ?? searchQuery,
          includeSummary: false,
          includePipelines: false,
          includeRawTables: true,
          includeResultTables: false,
          pipelineLimit: 0,
          rawTablePerGroupLimit: isGroupPage ? 0 : TABLE_PAGE_SIZE,
          rawTableGroupId: isGroupPage ? options.groupId : undefined,
          rawTableOffset: isGroupPage ? (groupPage - 1) * TABLE_PAGE_SIZE : undefined,
          rawTableLimit: isGroupPage ? TABLE_PAGE_SIZE : undefined,
          rawTableSourceKind: 'all',
          outputLimit: 0,
        });
        if (requestSeq === rawTablesRequestSeq.current) {
          setRawTables((current) =>
            isGroupPage
              ? buildGroupSections(
                  [
                    ...current.filter((item) => item.groupId !== (options.groupId ?? null)),
                    ...nextDashboard.rawTables,
                  ],
                  nextDashboard.groups,
                  (item) => item.groupId
                ).flatMap((section) => section.rows)
              : nextDashboard.rawTables
          );
          setTotalRawTables(nextDashboard.totalRawTables);
          setRawTableGroupCounts((current) => ({
            ...current,
            ...nextDashboard.rawTableGroupCounts,
          }));
          setGroups?.(nextDashboard.groups);
        }
      } catch (err) {
        if (requestSeq === rawTablesRequestSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (requestSeq === rawTablesRequestSeq.current) {
          setPendingNavigationTab((current) => (current === 'raw_tables' ? null : current));
          setLoadingTab((current) => (current === 'raw_tables' ? null : current));
          setRawTablesLoading(false);
        }
      }
    },
    [searchQuery, setError, setGroups, setLoadingTab, setPendingNavigationTab]
  );

  const setRawTableGroupPage = useCallback(
    async (groupKey: string, page: number) => {
      if (!dataClient.isAvailable()) return;
      const groupId =
        groupKey === 'ungrouped' ? null : groupKey.startsWith('g:') ? groupKey.slice(2) : groupKey;
      setRawTableGroupPages((current) => ({ ...current, [groupKey]: page }));
      await loadRawTables({ query: searchQuery, groupId, groupPage: page });
    },
    [loadRawTables, searchQuery]
  );

  /** Inserts or replaces a rawTable row and bumps the total once. */
  const upsertRawTable = useCallback((rawTable: DataRawTable, bumpTotal: boolean) => {
    setRawTables((current) => [rawTable, ...current.filter((item) => item.id !== rawTable.id)]);
    if (bumpTotal) {
      setTotalRawTables((current) => current + 1);
    }
  }, []);

  const updateRawTableRow = useCallback((rawTable: DataRawTable) => {
    setRawTables((current) => current.map((item) => (item.id === rawTable.id ? rawTable : item)));
  }, []);

  const removeRawTable = useCallback((id: string) => {
    setRawTables((current) => current.filter((item) => item.id !== id));
    setTotalRawTables((current) => Math.max(0, current - 1));
  }, []);

  useEffect(() => {
    const pageCount = getTablePageCount(totalRawTables + draftsCount);
    if (rawTablePage > pageCount) {
      setRawTablePage(pageCount);
    }
  }, [rawTablePage, draftsCount, totalRawTables]);

  return {
    rawTables,
    totalRawTables,
    rawTableGroupCounts,
    rawTablesLoading,
    rawTablePage,
    rawTableGroupPages,
    loadRawTables,
    setRawTableGroupPage,
    upsertRawTable,
    updateRawTableRow,
    removeRawTable,
    setRawTablesLoading,
    setRawTablePage,
    setTotalRawTables,
  };
}

export type RawTablesState = ReturnType<typeof useRawTables>;
