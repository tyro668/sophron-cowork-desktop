/**
 * Editor state for the data workspace: which pipeline / raw-table draft /
 * rawTable / output table is being edited, the focused items injected by
 * deep-link navigation, the cloud-upload dialog target, and the output
 * editor's raw-table choices. No dashboard data ownership — lists are
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
import type { DataPipeline, DataRawTable, DataResultTable } from '../../../types';
import { RESULT_TABLE_INPUT_CHOICES_LIMIT } from '../../../components/data-view/shared';
import { dataClient } from '../api/data-client';
import type { RawTableDraft } from '../model/types';

export function useDataViewEditors(deps: {
  pipelines: DataPipeline[];
  rawTables: DataRawTable[];
  resultTables: DataResultTable[];
  drafts: RawTableDraft[];
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const { pipelines, rawTables, resultTables, drafts, setError } = deps;
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(null);
  const [focusedPipeline, setFocusedPipeline] = useState<DataPipeline | null>(null);
  // Set by pipeline-creation flows so the editor opens with the title already in
  // edit mode (focus + select). Read once on PipelineEditor mount.
  const [pipelineNameEditRequested, setPipelineNameEditRequested] = useState(false);
  const [editingRawTableDraftId, setEditingRawTableDraftId] = useState<string | null>(null);
  const [editingRawTableId, setEditingRawTableId] = useState<string | null>(null);
  const [focusedRawTable, setFocusedRawTable] = useState<DataRawTable | null>(null);
  const [editingResultTableId, setEditingResultTableId] = useState<string | null>(null);
  const [focusedResultTable, setFocusedResultTable] = useState<DataResultTable | null>(null);
  const [outputEditorRawTables, setOutputEditorRawTables] = useState<DataRawTable[]>([]);
  const [outputEditorRawTablesLoading, setOutputEditorRawTablesLoading] = useState(false);

  const editingPipeline = useMemo(
    () =>
      pipelines.find((pipeline) => pipeline.id === editingPipelineId) ??
      (focusedPipeline?.id === editingPipelineId ? focusedPipeline : null),
    [pipelines, editingPipelineId, focusedPipeline]
  );
  const editingRawTableDraft = useMemo(
    () => drafts.find((draft) => draft.id === editingRawTableDraftId) ?? null,
    [editingRawTableDraftId, drafts]
  );
  const editingRawTable = useMemo(
    () =>
      rawTables.find((rawTable) => rawTable.id === editingRawTableId) ??
      (focusedRawTable?.id === editingRawTableId ? focusedRawTable : null),
    [editingRawTableId, focusedRawTable, rawTables]
  );
  const editingResultTable = useMemo(
    () =>
      resultTables.find((resultTable) => resultTable.id === editingResultTableId) ??
      (focusedResultTable?.id === editingResultTableId ? focusedResultTable : null),
    [resultTables, editingResultTableId, focusedResultTable]
  );

  /** Clears every editor/dialog target — used when deep-linking elsewhere. */
  const resetWorkspace = useCallback(() => {
    setEditingPipelineId(null);
    setPipelineNameEditRequested(false);
    setEditingRawTableDraftId(null);
    setEditingRawTableId(null);
    setEditingResultTableId(null);
  }, []);

  // Load the raw-table choices the output editor binds from, once per
  // edited output table.
  useEffect(() => {
    if (!editingResultTableId || !dataClient.has('getDashboard')) {
      setOutputEditorRawTables([]);
      setOutputEditorRawTablesLoading(false);
      return undefined;
    }

    let cancelled = false;
    setOutputEditorRawTablesLoading(true);
    void dataClient
      .getDashboard({
        includeSummary: false,
        includePipelines: false,
        includeRawTables: true,
        includeResultTables: false,
        rawTableOffset: 0,
        rawTableLimit: RESULT_TABLE_INPUT_CHOICES_LIMIT,
        rawTableSourceKind: 'all',
      })
      .then((nextDashboard) => {
        if (!cancelled) {
          setOutputEditorRawTables(nextDashboard.rawTables);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setOutputEditorRawTables([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOutputEditorRawTablesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editingResultTableId, setError]);

  return {
    editingPipeline,
    editingRawTableDraft,
    editingRawTable,
    editingResultTable,
    editingPipelineId,
    editingRawTableDraftId,
    editingRawTableId,
    editingResultTableId,
    outputEditorRawTables,
    outputEditorRawTablesLoading,
    pipelineNameEditRequested,
    setPipelineNameEditRequested,
    setEditingPipelineId,
    setFocusedPipeline,
    setEditingRawTableDraftId,
    setEditingRawTableId,
    setFocusedRawTable,
    setEditingResultTableId,
    setFocusedResultTable,
    resetWorkspace,
  };
}

export type DataViewEditors = ReturnType<typeof useDataViewEditors>;
