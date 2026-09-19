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
  DataOutputTable,
  WorkflowNodeRunStat,
} from '../../../types';
import { getTablePageCount } from '../../../components/data-view/shared';
import { TABLE_PAGE_SIZE } from '../../../components/data-view/shared';
import { dataClient } from '../api/data-client';
import { EMPTY_DASHBOARD, type DataTab } from '../model/types';

export interface LoadDashboardOptions {
  preserveError?: boolean;
  query?: string;
  taskPage?: number;
  outputPage?: number;
  tab?: DataTab;
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
  const dashboardRequestSeq = useRef(0);
  const hasLoadedDashboardSummary = useRef(false);

  const loadDashboard = useCallback(
    async (options: LoadDashboardOptions = {}) => {
      if (!dataClient.isAvailable()) return;
      const requestSeq = dashboardRequestSeq.current + 1;
      dashboardRequestSeq.current = requestSeq;
      const targetTab = options.tab ?? activeTab;
      const requestedTaskPage = Math.max(1, options.taskPage ?? taskPage);
      const requestedOutputPage = Math.max(1, options.outputPage ?? outputPage);
      const shouldLoadTasks = targetTab === 'tasks';
      const shouldLoadOutputTables = targetTab === 'output_tables';
      const shouldLoadSummary = shouldLoadTasks || !hasLoadedDashboardSummary.current;
      setLoadingTab(targetTab);
      if (!options.preserveError) {
        setError(null);
      }
      try {
        const nextDashboard = await dataClient.getDashboard({
          query: options.query ?? (shouldLoadTasks || shouldLoadOutputTables ? searchQuery : ''),
          includeSummary: shouldLoadSummary,
          includeTasks: shouldLoadTasks,
          includeDatasets: false,
          includeOutputTables: shouldLoadOutputTables,
          taskOffset: (requestedTaskPage - 1) * TABLE_PAGE_SIZE,
          taskLimit: shouldLoadTasks ? TABLE_PAGE_SIZE : 0,
          datasetOffset: 0,
          datasetLimit: 0,
          outputOffset: (requestedOutputPage - 1) * TABLE_PAGE_SIZE,
          outputLimit: shouldLoadOutputTables ? TABLE_PAGE_SIZE : 0,
          datasetSourceKind: 'all',
        });
        if (requestSeq === dashboardRequestSeq.current) {
          if (shouldLoadSummary) {
            hasLoadedDashboardSummary.current = true;
          }
          setDashboard((current) => ({
            summary: shouldLoadSummary ? nextDashboard.summary : current.summary,
            tasks: shouldLoadTasks ? nextDashboard.tasks : current.tasks,
            outputTables: shouldLoadOutputTables
              ? nextDashboard.outputTables
              : current.outputTables,
            datasets: current.datasets,
            totalTasks:
              shouldLoadTasks || shouldLoadSummary ? nextDashboard.totalTasks : current.totalTasks,
            totalDatasets: current.totalDatasets,
            totalOutputTables: shouldLoadOutputTables
              ? nextDashboard.totalOutputTables
              : current.totalOutputTables,
          }));
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
    [activeTab, outputPage, searchQuery, taskPage, setError, setLoadingTab, setPendingNavigationTab]
  );

  /** Drops any in-flight dashboard response (used on tab switches). */
  const invalidateRequests = useCallback(() => {
    dashboardRequestSeq.current += 1;
  }, []);

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
    loadDashboard,
    invalidateRequests,
    prependTask,
    prependOutputTable,
    setLastRunFailure,
    setRunNodeStats,
    setTaskPage,
    setOutputPage,
  };
}

export type DataDashboardState = ReturnType<typeof useDataDashboard>;
