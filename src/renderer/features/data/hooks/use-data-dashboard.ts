/**
 * Server state for the data dashboard: pipelines, output tables, summary counts,
 * run stats, and their pagination. Owns `loadDashboard` and the request
 * sequence guard that drops stale responses.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  DataPipeline,
  DataDashboard,
  DataGroup,
  DataResultTable,
  WorkflowNodeRunStat,
} from '../../../types';
import { getTablePageCount } from '../../../components/data-view/shared';
import { TABLE_PAGE_SIZE } from '../../../components/data-view/shared';
import { buildGroupSections } from '../../../components/data-view/group-ui';
import { dataClient } from '../api/data-client';
import { EMPTY_DASHBOARD, type DataTab } from '../model/types';

export interface LoadDashboardOptions {
  preserveError?: boolean;
  query?: string;
  /** @deprecated Pagination removed; groups are loaded with a per-group limit. */
  pipelinePage?: number;
  /** @deprecated Pagination removed; groups are loaded with a per-group limit. */
  outputPage?: number;
  tab?: DataTab;
  pipelineGroupId?: string | null;
  outputGroupId?: string | null;
  pipelineGroupPage?: number;
  outputGroupPage?: number;
}

/** Failure from the most recent run — rendered as a structured card by the pipeline editor. */
export interface DataRunFailure {
  message: string;
  at: number;
  /** Temporary (preview) runs never persist node stats — samples/stat lookups are stale. */
  temporary?: boolean;
}

export function useDataDashboard(deps: {
  activeTab: DataTab;
  searchQuery: string;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadingTab: Dispatch<SetStateAction<DataTab | null>>;
  setPendingNavigationTab: Dispatch<SetStateAction<DataTab | null>>;
}) {
  const { activeTab, searchQuery, setError, setLoadingTab, setPendingNavigationTab } = deps;
  const [dashboard, setDashboard] = useState<DataDashboard>(EMPTY_DASHBOARD);
  const [runNodeStats, setRunNodeStats] = useState<WorkflowNodeRunStat[]>([]);
  const [lastRunFailure, setLastRunFailure] = useState<DataRunFailure | null>(null);
  const [pipelinePage, setPipelinePage] = useState(1);
  const [outputPage, setOutputPage] = useState(1);
  const [pipelineGroupPages, setPipelineGroupPages] = useState<Record<string, number>>({});
  const [outputGroupPages, setOutputGroupPages] = useState<Record<string, number>>({});
  const dashboardRequestSeq = useRef(0);
  const hasLoadedDashboardSummary = useRef(false);

  const loadDashboard = useCallback(
    async (options: LoadDashboardOptions = {}) => {
      if (!dataClient.isAvailable()) return;
      const requestSeq = dashboardRequestSeq.current + 1;
      dashboardRequestSeq.current = requestSeq;
      const targetTab = options.tab ?? activeTab;
      const shouldLoadPipelines = targetTab === 'pipelines';
      const shouldLoadResultTables = targetTab === 'result_tables';
      const shouldLoadSummary = shouldLoadPipelines || !hasLoadedDashboardSummary.current;
      setLoadingTab(targetTab);
      if (!options.preserveError) {
        setError(null);
      }
      try {
        const isPipelineGroupPage = options.pipelineGroupId !== undefined;
        const isOutputGroupPage = options.outputGroupId !== undefined;
        const pipelineGroupPage = Math.max(1, options.pipelineGroupPage ?? 1);
        const outputGroupPage = Math.max(1, options.outputGroupPage ?? 1);
        const nextDashboard = await dataClient.getDashboard({
          query:
            options.query ?? (shouldLoadPipelines || shouldLoadResultTables ? searchQuery : ''),
          includeSummary: shouldLoadSummary,
          includePipelines: shouldLoadPipelines,
          includeRawTables: false,
          includeResultTables: shouldLoadResultTables,
          pipelinePerGroupLimit: shouldLoadPipelines && !isPipelineGroupPage ? TABLE_PAGE_SIZE : 0,
          pipelineGroupId: isPipelineGroupPage ? options.pipelineGroupId : undefined,
          pipelineOffset: isPipelineGroupPage
            ? (pipelineGroupPage - 1) * TABLE_PAGE_SIZE
            : undefined,
          pipelineLimit: isPipelineGroupPage ? TABLE_PAGE_SIZE : undefined,
          rawTableOffset: 0,
          rawTableLimit: 0,
          outputPerGroupLimit: shouldLoadResultTables && !isOutputGroupPage ? TABLE_PAGE_SIZE : 0,
          outputGroupId: isOutputGroupPage ? options.outputGroupId : undefined,
          outputOffset: isOutputGroupPage ? (outputGroupPage - 1) * TABLE_PAGE_SIZE : undefined,
          outputLimit: isOutputGroupPage ? TABLE_PAGE_SIZE : undefined,
          rawTableSourceKind: 'all',
        });
        if (requestSeq === dashboardRequestSeq.current) {
          if (shouldLoadSummary) {
            hasLoadedDashboardSummary.current = true;
          }
          setDashboard((current) => {
            const pipelines = isPipelineGroupPage
              ? mergeGroupRows(
                  current.pipelines,
                  options.pipelineGroupId ?? null,
                  nextDashboard.pipelines,
                  nextDashboard.groups
                )
              : shouldLoadPipelines
                ? nextDashboard.pipelines
                : current.pipelines;
            const resultTables = isOutputGroupPage
              ? mergeGroupRows(
                  current.resultTables,
                  options.outputGroupId ?? null,
                  nextDashboard.resultTables,
                  nextDashboard.groups
                )
              : shouldLoadResultTables
                ? nextDashboard.resultTables
                : current.resultTables;
            return {
              summary: shouldLoadSummary ? nextDashboard.summary : current.summary,
              pipelines,
              resultTables,
              rawTables: current.rawTables,
              groups: nextDashboard.groups,
              totalPipelines:
                shouldLoadPipelines || shouldLoadSummary
                  ? nextDashboard.totalPipelines
                  : current.totalPipelines,
              totalRawTables: current.totalRawTables,
              totalResultTables: shouldLoadResultTables
                ? nextDashboard.totalResultTables
                : current.totalResultTables,
              pipelineGroupCounts: shouldLoadPipelines
                ? { ...current.pipelineGroupCounts, ...nextDashboard.pipelineGroupCounts }
                : current.pipelineGroupCounts,
              rawTableGroupCounts: current.rawTableGroupCounts,
              outputGroupCounts: shouldLoadResultTables
                ? { ...current.outputGroupCounts, ...nextDashboard.outputGroupCounts }
                : current.outputGroupCounts,
            };
          });
        }
      } catch (err) {
        if (requestSeq === dashboardRequestSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (requestSeq === dashboardRequestSeq.current) {
          setPendingNavigationTab((current) => (current === targetTab ? null : current));
          setLoadingTab((current) => (current === targetTab ? null : current));
        }
      }
    },
    [activeTab, searchQuery, setError, setLoadingTab, setPendingNavigationTab]
  );

  /** Drops any in-flight dashboard response (used on tab switches). */
  const invalidateRequests = useCallback(() => {
    dashboardRequestSeq.current += 1;
  }, []);

  /** Replaces the group list — shared by every list tab's reload path. */
  const setGroups = useCallback((groups: DataGroup[]) => {
    setDashboard((current) => ({ ...current, groups }));
  }, []);

  const mergeGroupRows = <T extends { groupId: string | null }>(
    currentRows: T[],
    groupId: string | null,
    loadedRows: T[],
    groups: DataGroup[]
  ): T[] => {
    const combined = [...currentRows.filter((row) => row.groupId !== groupId), ...loadedRows];
    return buildGroupSections(combined, groups, (row) => row.groupId).flatMap(
      (section) => section.rows
    );
  };

  const setPipelineGroupPage = useCallback(
    async (groupKey: string, page: number) => {
      if (!dataClient.isAvailable()) return;
      const groupId =
        groupKey === 'ungrouped' ? null : groupKey.startsWith('g:') ? groupKey.slice(2) : groupKey;
      setPipelineGroupPages((current) => ({ ...current, [groupKey]: page }));
      await loadDashboard({ tab: 'pipelines', pipelineGroupId: groupId, pipelineGroupPage: page });
    },
    [loadDashboard]
  );

  const setOutputGroupPage = useCallback(
    async (groupKey: string, page: number) => {
      if (!dataClient.isAvailable()) return;
      const groupId =
        groupKey === 'ungrouped' ? null : groupKey.startsWith('g:') ? groupKey.slice(2) : groupKey;
      setOutputGroupPages((current) => ({ ...current, [groupKey]: page }));
      await loadDashboard({ tab: 'result_tables', outputGroupId: groupId, outputGroupPage: page });
    },
    [loadDashboard]
  );

  const prependPipeline = useCallback((pipeline: DataPipeline) => {
    setDashboard((current) => ({
      ...current,
      pipelines: [pipeline, ...current.pipelines.filter((item) => item.id !== pipeline.id)],
      totalPipelines: Math.max(current.totalPipelines, current.pipelines.length + 1),
    }));
  }, []);

  const prependResultTable = useCallback((resultTable: DataResultTable) => {
    setDashboard((current) => ({
      ...current,
      resultTables: [
        resultTable,
        ...current.resultTables.filter((item) => item.id !== resultTable.id),
      ],
      totalResultTables: Math.max(current.totalResultTables, current.resultTables.length + 1),
    }));
  }, []);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalPipelines);
    if (pipelinePage > pageCount) {
      setPipelinePage(pageCount);
    }
  }, [dashboard.totalPipelines, pipelinePage]);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalResultTables);
    if (outputPage > pageCount) {
      setOutputPage(pageCount);
    }
  }, [dashboard.totalResultTables, outputPage]);

  return {
    dashboard,
    runNodeStats,
    lastRunFailure,
    pipelinePage,
    outputPage,
    pipelineGroupPages,
    outputGroupPages,
    loadDashboard,
    invalidateRequests,
    setGroups,
    setPipelineGroupPage,
    setOutputGroupPage,
    prependPipeline,
    prependResultTable,
    setLastRunFailure,
    setRunNodeStats,
    setPipelinePage,
    setOutputPage,
  };
}

export type DataDashboardState = ReturnType<typeof useDataDashboard>;
