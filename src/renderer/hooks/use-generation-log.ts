import { useCallback, useEffect, useRef, useState } from 'react';
import type { NormalizerGenerationLog } from '../components/data-view/raw-table-normalizer-utils';

export function useGenerationLog(delayMs: number) {
  const [generationLog, setGenerationLog] = useState<NormalizerGenerationLog | null>(null);
  const logRef = useRef<NormalizerGenerationLog | null>(null);
  const timer = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const log = logRef.current;
    setGenerationLog(log && { ...log, steps: log.steps.map((step) => ({ ...step })) });
  }, []);
  const start = useCallback(
    (log: NormalizerGenerationLog | null) => {
      logRef.current = log;
      flush();
    },
    [flush]
  );
  const schedule = useCallback(() => {
    if (timer.current === null) timer.current = window.setTimeout(flush, delayMs);
  }, [flush, delayMs]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  return { generationLog, logRef, start, flush, schedule };
}
