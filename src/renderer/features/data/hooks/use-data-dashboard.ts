/**
 * Server state for the data dashboard: tasks, output tables, summary counts,
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
  DataCleaningTask,
  DataDashboard,
  DataGroup,
  DataOutputTable,
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
  taskPage?: number;
  /** @deprecated Pagination removed; groups are loaded with a per-group limit. */
  outputPage?: number;
  tab?: DataTab;
  taskGroupId?: string | null;
  outputGroupId?: string | null;
  taskGroupPage?: number;
  outputGroupPage?: number;
}

/** Failure from the most recent run — rendered as a structured card by the task editor. */
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
  const [taskPage, setTaskPage] = useState(1);
  const [outputPage, setOutputPage] = useState(1);
  const [taskGroupPages, setTaskGroupPages] = useState<Record<string, number>>({});
  const [outputGroupPages, setOutputGroupPages] = useState<Record<string, number>>({});
  const dashboardRequestSeq = useRef(0);
  const hasLoadedDashboardSummary = useRef(false);

  const loadDashboard = useCallback(
    async (options: LoadDashboardOptions = {}) => {
      if (!dataClient.isAvailable()) return;
      const requestSeq = dashboardRequestSeq.current + 1;
      dashboardRequestSeq.current = requestSeq;
      const targetTab = options.tab ?? activeTab;
      const shouldLoadTasks = targetTab === 'tasks';
      const shouldLoadOutputTables = targetTab === 'output_tables';
      const shouldLoadSummary = shouldLoadTasks || !hasLoadedDashboardSummary.current;
      setLoadingTab(targetTab);
      if (!options.preserveError) {
        setError(null);
      }
      try {
        const isTaskGroupPage = options.taskGroupId !== undefined;
        const isOutputGroupPage = options.outputGroupId !== undefined;
        const taskGroupPage = Math.max(1, options.taskGroupPage ?? 1);
        const outputGroupPage = Math.max(1, options.outputGroupPage ?? 1);
        const nextDashboard = await dataClient.getDashboard({
          query: options.query ?? (shouldLoadTasks || shouldLoadOutputTables ? searchQuery : ''),
          includeSummary: shouldLoadSummary,
          includeTasks: shouldLoadTasks,
          includeDatasets: false,
          includeOutputTables: shouldLoadOutputTables,
          taskPerGroupLimit: shouldLoadTasks && !isTaskGroupPage ? TABLE_PAGE_SIZE : 0,
          taskGroupId: isTaskGroupPage ? options.taskGroupId : undefined,
          taskOffset: isTaskGroupPage ? (taskGroupPage - 1) * TABLE_PAGE_SIZE : undefined,
          taskLimit: isTaskGroupPage ? TABLE_PAGE_SIZE : undefined,
          datasetOffset: 0,
          datasetLimit: 0,
          outputPerGroupLimit: shouldLoadOutputTables && !isOutputGroupPage ? TABLE_PAGE_SIZE : 0,
          outputGroupId: isOutputGroupPage ? options.outputGroupId : undefined,
          outputOffset: isOutputGroupPage ? (outputGroupPage - 1) * TABLE_PAGE_SIZE : undefined,
          outputLimit: isOutputGroupPage ? TABLE_PAGE_SIZE : undefined,
          datasetSourceKind: 'all',
        });
        if (requestSeq === dashboardRequestSeq.current) {
          if (shouldLoadSummary) {
            hasLoadedDashboardSummary.current = true;
          }
          setDashboard((current) => {
            const tasks = isTaskGroupPage
              ? mergeGroupRows(
                  current.tasks,
                  options.taskGroupId ?? null,
                  nextDashboard.tasks,
                  nextDashboard.groups
                )
              : shouldLoadTasks
                ? nextDashboard.tasks
                : current.tasks;
            const outputTables = isOutputGroupPage
              ? mergeGroupRows(
                  current.outputTables,
                  options.outputGroupId ?? null,
                  nextDashboard.outputTables,
                  nextDashboard.groups
                )
              : shouldLoadOutputTables
                ? nextDashboard.outputTables
                : current.outputTables;
            return {
              summary: shouldLoadSummary ? nextDashboard.summary : current.summary,
              tasks,
              outputTables,
              datasets: current.datasets,
              groups: nextDashboard.groups,
              totalTasks:
                shouldLoadTasks || shouldLoadSummary
                  ? nextDashboard.totalTasks
                  : current.totalTasks,
              totalDatasets: current.totalDatasets,
              totalOutputTables: shouldLoadOutputTables
                ? nextDashboard.totalOutputTables
                : current.totalOutputTables,
              taskGroupCounts: shouldLoadTasks
                ? { ...current.taskGroupCounts, ...nextDashboard.taskGroupCounts }
                : current.taskGroupCounts,
              datasetGroupCounts: current.datasetGroupCounts,
              outputGroupCounts: shouldLoadOutputTables
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

  const setTaskGroupPage = useCallback(
    async (groupKey: string, page: number) => {
      if (!dataClient.isAvailable()) return;
      const groupId =
        groupKey === 'ungrouped' ? null : groupKey.startsWith('g:') ? groupKey.slice(2) : groupKey;
      setTaskGroupPages((current) => ({ ...current, [groupKey]: page }));
      await loadDashboard({ tab: 'tasks', taskGroupId: groupId, taskGroupPage: page });
    },
    [loadDashboard]
  );

  const setOutputGroupPage = useCallback(
    async (groupKey: string, page: number) => {
      if (!dataClient.isAvailable()) return;
      const groupId =
        groupKey === 'ungrouped' ? null : groupKey.startsWith('g:') ? groupKey.slice(2) : groupKey;
      setOutputGroupPages((current) => ({ ...current, [groupKey]: page }));
      await loadDashboard({ tab: 'output_tables', outputGroupId: groupId, outputGroupPage: page });
    },
    [loadDashboard]
  );

  const prependTask = useCallback((task: DataCleaningTask) => {
    setDashboard((current) => ({
      ...current,
      tasks: [task, ...current.tasks.filter((item) => item.id !== task.id)],
      totalTasks: Math.max(current.totalTasks, current.tasks.length + 1),
    }));
  }, []);

  const prependOutputTable = useCallback((outputTable: DataOutputTable) => {
    setDashboard((current) => ({
      ...current,
      outputTables: [
        outputTable,
        ...current.outputTables.filter((item) => item.id !== outputTable.id),
      ],
      totalOutputTables: Math.max(current.totalOutputTables, current.outputTables.length + 1),
    }));
  }, []);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalTasks);
    if (taskPage > pageCount) {
      setTaskPage(pageCount);
    }
  }, [dashboard.totalTasks, taskPage]);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalOutputTables);
    if (outputPage > pageCount) {
      setOutputPage(pageCount);
    }
  }, [dashboard.totalOutputTables, outputPage]);

  return {
    dashboard,
    runNodeStats,
    lastRunFailure,
    taskPage,
    outputPage,
    taskGroupPages,
    outputGroupPages,
    loadDashboard,
    invalidateRequests,
    setGroups,
    setTaskGroupPage,
    setOutputGroupPage,
    prependTask,
    prependOutputTable,
    setLastRunFailure,
    setRunNodeStats,
    setTaskPage,
    setOutputPage,
  };
}

export type DataDashboardState = ReturnType<typeof useDataDashboard>;
