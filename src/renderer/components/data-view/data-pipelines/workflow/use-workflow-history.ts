import {
  useCallback,
  useState,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { DataPipelineWorkflow } from '../../../../../shared/contracts/data';

export function useWorkflowHistory(
  workflow: DataPipelineWorkflow | null,
  setWorkflow: Dispatch<SetStateAction<DataPipelineWorkflow | null>>
) {
  const historyRef = useRef<{ past: DataPipelineWorkflow[]; future: DataPipelineWorkflow[] }>({
    past: [],
    future: [],
  });
  const lastWorkflowRef = useRef<DataPipelineWorkflow | null>(null);
  const skipHistoryRef = useRef(true);
  const burstOpenRef = useRef(false);
  const burstTimerRef = useRef<number | null>(null);
  const [, setHistoryVersion] = useState(0);
  useEffect(() => {
    const previous = lastWorkflowRef.current;
    lastWorkflowRef.current = workflow;
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    if (!previous || !workflow || previous === workflow) return;
    if (!burstOpenRef.current) {
      historyRef.current.past = [...historyRef.current.past.slice(-49), previous];
      historyRef.current.future = [];
      burstOpenRef.current = true;
      setHistoryVersion((v) => v + 1);
    }
    if (burstTimerRef.current) window.clearTimeout(burstTimerRef.current);
    burstTimerRef.current = window.setTimeout(() => {
      burstOpenRef.current = false;
    }, 400);
  }, [workflow]);
  const resetHistory = useCallback(() => {
    historyRef.current = { past: [], future: [] };
    skipHistoryRef.current = true;
    burstOpenRef.current = false;
    setHistoryVersion((v) => v + 1);
  }, []);
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;
  const undo = useCallback(() => {
    const { past, future } = historyRef.current;
    const previous = past[past.length - 1];
    const current = lastWorkflowRef.current;
    if (!previous || !current) return;
    historyRef.current = { past: past.slice(0, -1), future: [current, ...future] };
    skipHistoryRef.current = true;
    burstOpenRef.current = false;
    setWorkflow(previous);
    setHistoryVersion((v) => v + 1);
  }, [setWorkflow]);
  const redo = useCallback(() => {
    const { past, future } = historyRef.current;
    const next = future[0];
    const current = lastWorkflowRef.current;
    if (!next || !current) return;
    historyRef.current = { past: [...past, current], future: future.slice(1) };
    skipHistoryRef.current = true;
    burstOpenRef.current = false;
    setWorkflow(next);
    setHistoryVersion((v) => v + 1);
  }, [setWorkflow]);
  useEffect(
    () => () => {
      if (burstTimerRef.current !== null) window.clearTimeout(burstTimerRef.current);
    },
    []
  );
  return { canUndo, canRedo, undo, redo, resetHistory };
}
