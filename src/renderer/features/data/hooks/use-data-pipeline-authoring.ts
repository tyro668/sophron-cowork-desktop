import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DataGeneratePipelineFromRequirementInput,
  DataGeneratePipelineFromRequirementResult,
} from '../../../../shared/contracts';
import {
  findDataPipelineCompletion,
  type DataPipelineAuthoringCompletion,
  type DataPipelineAuthoringRequest,
  type DataPipelineAuthoringSession,
} from '../../../../shared/data-pipeline-authoring';
import { getInitialSessionTitle } from '../../../../shared/session-title';
import { useIPC } from '../../../hooks/useIPC';
import { useAppStore } from '../../../store';

/** All consumers match the same persisted success event and consume it once. */
export function useDataPipelineAuthoringCompletion(
  pending: DataPipelineAuthoringSession | null,
  onCompleted?: (completion: DataPipelineAuthoringCompletion) => void | Promise<void>
) {
  const sessionId = pending?.sessionId;
  const requestId = pending?.requestId;
  const { getSessionMessages } = useIPC();
  const [saved, setSaved] = useState<{
    sessionId: string;
    requestId: string;
    completion: DataPipelineAuthoringCompletion | undefined;
  }>();
  const live = useAppStore((state) =>
    sessionId && requestId
      ? findDataPipelineCompletion(state.sessionStates[sessionId]?.messages ?? [], requestId)
      : undefined
  );
  useEffect(() => {
    if (!sessionId || !requestId) return;
    let cancelled = false;
    // Restored automation drafts can reference a chat that is not open in memory.
    void getSessionMessages(sessionId)
      .then((messages) => {
        if (!cancelled)
          setSaved({
            sessionId,
            requestId,
            completion: findDataPipelineCompletion(messages, requestId),
          });
      })
      .catch((error) => {
        if (!cancelled) reportAuthoringError(`${sessionId}:${requestId}`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [getSessionMessages, requestId, sessionId]);
  const completion =
    live ??
    (saved?.sessionId === sessionId && saved?.requestId === requestId
      ? saved?.completion
      : undefined);
  const consumed = useRef<string>();
  useEffect(() => {
    if (!completion || !onCompleted) return;
    const key = `${sessionId}:${requestId}`;
    if (consumed.current === key) return;
    consumed.current = key;
    const reportError = (error: unknown) => reportAuthoringError(key, error);
    try {
      void Promise.resolve(onCompleted(completion)).catch(reportError);
    } catch (error) {
      reportError(error);
    }
  }, [completion, onCompleted, requestId, sessionId]);
}

function reportAuthoringError(key: string, error: unknown) {
  useAppStore.getState().setGlobalNotice({
    id: `pipeline-refresh-${key}`,
    type: 'error',
    message: String(error),
  });
}

export function useDataPipelineAuthoring({
  pipelineId,
  workingDirectory,
  onApplied,
}: {
  pipelineId?: string;
  workingDirectory?: string;
  onApplied?: (
    result: DataGeneratePipelineFromRequirementResult,
    input: DataGeneratePipelineFromRequirementInput
  ) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const workingDir = useAppStore((state) => state.workingDir);
  const { startSession } = useIPC();
  const [pending, setPending] = useState<
    | (DataPipelineAuthoringSession & {
        input: DataGeneratePipelineFromRequirementInput;
      })
    | null
  >(null);
  useDataPipelineAuthoringCompletion(pending, (completion) => {
    if (!pending) return;
    setPending(null);
    if (pending.input.reusePipelineId && pending.input.reusePipelineId !== pipelineId) return;
    return onApplied?.(completion.result, pending.input);
  });

  const startAuthoring = async (
    input: DataGeneratePipelineFromRequirementInput,
    anchorLabel?: string
  ) => {
    const { source, output, reusePipelineId, startFromNodeId, workflow } = input;
    const request: DataPipelineAuthoringRequest = {
      id: crypto.randomUUID(),
      source,
      output,
      reusePipelineId,
      startFromNodeId,
      workflow,
    };
    const outputClause =
      output.writeMode === 'replace'
        ? t('data.aiPipelineChatOutputReplace', {
            name: output.tableName ?? '',
            id: output.targetTableId ?? output.localResultTableId ?? '',
          })
        : t('data.aiPipelineChatOutputCreate', {
            nameClause: output.tableName
              ? t('data.aiPipelineChatOutputNamed', { name: output.tableName })
              : '',
          });
    const prompt = t(
      reusePipelineId ? 'data.aiPipelineChatEditPrompt' : 'data.aiPipelineChatPrompt',
      {
        pipelineId: reusePipelineId,
        inputName: source.tableName || source.tableId,
        inputId: source.tableId,
        outputClause,
        anchorClause: startFromNodeId
          ? t('data.aiPipelineChatAnchorClause', { label: anchorLabel, id: startFromNodeId })
          : '',
        requirement: input.processRequirement,
      }
    );
    const session = await startSession(
      getInitialSessionTitle(input.processRequirement, source.tableName ?? null),
      [
        { type: 'text', text: prompt },
        { type: 'data_pipeline_request', request },
      ],
      workingDirectory || workingDir || undefined
    );
    if (!session) return null;
    setPending({ sessionId: session.id, requestId: request.id, input });
    return { sessionId: session.id, request };
  };
  return { startAuthoring };
}
