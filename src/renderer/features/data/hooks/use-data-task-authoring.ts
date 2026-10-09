import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DataGenerateTaskFromRequirementInput,
  DataGenerateTaskFromRequirementResult,
} from '../../../../shared/contracts';
import {
  findDataTaskCompletion,
  type DataTaskAuthoringCompletion,
  type DataTaskAuthoringRequest,
  type DataTaskAuthoringSession,
} from '../../../../shared/data-task-authoring';
import { getInitialSessionTitle } from '../../../../shared/session-title';
import { useIPC } from '../../../hooks/useIPC';
import { useAppStore } from '../../../store';

/** All consumers match the same persisted success event and consume it once. */
export function useDataTaskAuthoringCompletion(
  pending: DataTaskAuthoringSession | null,
  onCompleted?: (completion: DataTaskAuthoringCompletion) => void | Promise<void>
) {
  const sessionId = pending?.sessionId;
  const requestId = pending?.requestId;
  const { getSessionMessages } = useIPC();
  const [saved, setSaved] = useState<{
    sessionId: string;
    requestId: string;
    completion: DataTaskAuthoringCompletion | undefined;
  }>();
  const live = useAppStore((state) =>
    sessionId && requestId
      ? findDataTaskCompletion(state.sessionStates[sessionId]?.messages ?? [], requestId)
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
            completion: findDataTaskCompletion(messages, requestId),
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
    id: `task-refresh-${key}`,
    type: 'error',
    message: String(error),
  });
}

export function useDataTaskAuthoring({
  taskId,
  workingDirectory,
  onApplied,
}: {
  taskId?: string;
  workingDirectory?: string;
  onApplied?: (
    result: DataGenerateTaskFromRequirementResult,
    input: DataGenerateTaskFromRequirementInput
  ) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const workingDir = useAppStore((state) => state.workingDir);
  const { startSession } = useIPC();
  const [pending, setPending] = useState<
    | (DataTaskAuthoringSession & {
        input: DataGenerateTaskFromRequirementInput;
      })
    | null
  >(null);
  useDataTaskAuthoringCompletion(pending, (completion) => {
    if (!pending) return;
    setPending(null);
    if (pending.input.reuseTaskId && pending.input.reuseTaskId !== taskId) return;
    return onApplied?.(completion.result, pending.input);
  });

  const startAuthoring = async (
    input: DataGenerateTaskFromRequirementInput,
    anchorLabel?: string
  ) => {
    const { source, output, reuseTaskId, startFromNodeId, workflow } = input;
    const request: DataTaskAuthoringRequest = {
      id: crypto.randomUUID(),
      source,
      output,
      reuseTaskId,
      startFromNodeId,
      workflow,
    };
    const outputClause =
      output.writeMode === 'replace'
        ? t('data.aiTaskChatOutputReplace', {
            name: output.tableName ?? '',
            id: output.targetTableId ?? output.localOutputTableId ?? '',
          })
        : t('data.aiTaskChatOutputCreate', {
            nameClause: output.tableName
              ? t('data.aiTaskChatOutputNamed', { name: output.tableName })
              : '',
          });
    const prompt = t(reuseTaskId ? 'data.aiTaskChatEditPrompt' : 'data.aiTaskChatPrompt', {
      taskId: reuseTaskId,
      inputName: source.tableName || source.tableId,
      inputId: source.tableId,
      outputClause,
      anchorClause: startFromNodeId
        ? t('data.aiTaskChatAnchorClause', { label: anchorLabel, id: startFromNodeId })
        : '',
      requirement: input.processRequirement,
    });
    const session = await startSession(
      getInitialSessionTitle(input.processRequirement, source.tableName ?? null),
      [
        { type: 'text', text: prompt },
        { type: 'data_task_request', request },
      ],
      workingDirectory || workingDir || undefined
    );
    if (!session) return null;
    setPending({ sessionId: session.id, requestId: request.id, input });
    return { sessionId: session.id, request };
  };
  return { startAuthoring };
}
