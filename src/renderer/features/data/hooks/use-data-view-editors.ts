/**
 * Editor state for the data workspace: which task / input-table draft /
 * dataset / output table is being edited, the focused items injected by
 * deep-link navigation, the cloud-upload dialog target, and the output
 * editor's input-table choices. No dashboard data ownership — lists are
 * injected and the hooks only resolve "which one is being edited".
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { DataCleaningTask, DataDataset, DataOutputTable } from '../../../types';
import { OUTPUT_TABLE_INPUT_CHOICES_LIMIT } from '../../../components/data-view/shared';
import { dataClient } from '../api/data-client';
import type { InputTableDraft } from '../model/types';

export function useDataViewEditors(deps: {
  tasks: DataCleaningTask[];
  inputTableDatasets: DataDataset[];
  outputTables: DataOutputTable[];
  drafts: InputTableDraft[];
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const { tasks, inputTableDatasets, outputTables, drafts, setError } = deps;
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [focusedTask, setFocusedTask] = useState<DataCleaningTask | null>(null);
  const [editingInputTableDraftId, setEditingInputTableDraftId] = useState<string | null>(null);
  const [editingInputTableDatasetId, setEditingInputTableDatasetId] = useState<string | null>(null);
  const [focusedInputTable, setFocusedInputTable] = useState<DataDataset | null>(null);
  const [editingOutputTableId, setEditingOutputTableId] = useState<string | null>(null);
  const [focusedOutputTable, setFocusedOutputTable] = useState<DataOutputTable | null>(null);
  const [uploadCloudOutputTable, setUploadCloudOutputTable] = useState<DataOutputTable | null>(
    null
  );
  const [outputEditorInputTables, setOutputEditorInputTables] = useState<DataDataset[]>([]);
  const [outputEditorInputTablesLoading, setOutputEditorInputTablesLoading] = useState(false);

  const editingTask = useMemo(
    () =>
      tasks.find((task) => task.id === editingTaskId) ??
      (focusedTask?.id === editingTaskId ? focusedTask : null),
    [tasks, editingTaskId, focusedTask]
  );
  const editingInputTableDraft = useMemo(
    () => drafts.find((draft) => draft.id === editingInputTableDraftId) ?? null,
    [editingInputTableDraftId, drafts]
  );
  const editingInputTableDataset = useMemo(
    () =>
      inputTableDatasets.find((dataset) => dataset.id === editingInputTableDatasetId) ??
      (focusedInputTable?.id === editingInputTableDatasetId ? focusedInputTable : null),
    [editingInputTableDatasetId, focusedInputTable, inputTableDatasets]
  );
  const editingOutputTable = useMemo(
    () =>
      outputTables.find((outputTable) => outputTable.id === editingOutputTableId) ??
      (focusedOutputTable?.id === editingOutputTableId ? focusedOutputTable : null),
    [outputTables, editingOutputTableId, focusedOutputTable]
  );

  /** Clears every editor/dialog target — used when deep-linking elsewhere. */
  const resetWorkspace = useCallback(() => {
    setEditingTaskId(null);
    setEditingInputTableDraftId(null);
    setEditingInputTableDatasetId(null);
    setEditingOutputTableId(null);
    setUploadCloudOutputTable(null);
  }, []);

  // Load the input-table choices the output editor binds from, once per
  // edited output table.
  useEffect(() => {
    if (!editingOutputTableId || !dataClient.has('getDashboard')) {
      setOutputEditorInputTables([]);
      setOutputEditorInputTablesLoading(false);
      return undefined;
    }

    let cancelled = false;
    setOutputEditorInputTablesLoading(true);
    void dataClient
      .getDashboard({
        includeSummary: false,
        includeTasks: false,
        includeDatasets: true,
        includeOutputTables: false,
        datasetOffset: 0,
        datasetLimit: OUTPUT_TABLE_INPUT_CHOICES_LIMIT,
        datasetSourceKind: 'all',
      })
      .then((nextDashboard) => {
        if (!cancelled) {
          setOutputEditorInputTables(nextDashboard.datasets);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setOutputEditorInputTables([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOutputEditorInputTablesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editingOutputTableId, setError]);

  return {
    editingTask,
    editingInputTableDraft,
    editingInputTableDataset,
    editingOutputTable,
    editingTaskId,
    editingInputTableDraftId,
    editingInputTableDatasetId,
    editingOutputTableId,
    uploadCloudOutputTable,
    outputEditorInputTables,
    outputEditorInputTablesLoading,
    setEditingTaskId,
    setFocusedTask,
    setEditingInputTableDraftId,
    setEditingInputTableDatasetId,
    setFocusedInputTable,
    setEditingOutputTableId,
    setFocusedOutputTable,
    setUploadCloudOutputTable,
    resetWorkspace,
  };
}

export type DataViewEditors = ReturnType<typeof useDataViewEditors>;
