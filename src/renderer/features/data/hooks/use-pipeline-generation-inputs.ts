import { useEffect, useState } from 'react';
import { dataClient } from '../api/data-client';

/** Load all selectable input tables, independently of workspace filters/pages. */
export function usePipelineGenerationInputs(enabled: boolean) {
  const [tables, setTables] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !dataClient.has('getDashboard')) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      const result: Array<{ id: string; name: string }> = [];
      for (;;) {
        const page = await dataClient.getDashboard({
          includeSummary: false,
          includePipelines: false,
          includeRawTables: true,
          includeResultTables: false,
          rawTableLimit: 200,
          rawTableOffset: result.length,
        });
        if (cancelled) return;
        result.push(...page.rawTables);
        if (page.rawTables.length < 200) break;
      }
      setTables(result);
    };
    void load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return { tables, loading, error };
}
