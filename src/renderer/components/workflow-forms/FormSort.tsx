import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { dataFieldTypeLabel } from '../../../shared/data-field-types';

interface SortKey {
  field: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

const SELECT_CLASS =
  'h-7 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent';

export default function FormSort({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const updateConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  const keys: SortKey[] = (node.config.keys as SortKey[]) ?? [];

  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!taskId || !sourceNode?.id) return;
    const api = window.electronAPI?.data;
    if (!api?.getWorkflowNodeColumnTypes) return;
    api
      .getWorkflowNodeColumnTypes({
        taskId,
        nodeId: sourceNode.id,
        nodeType: sourceNode.type as never,
        nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
      })
      .then((types) => {
        const map: Record<string, string> = {};
        for (const t of types) map[t.name] = t.type;
        setColumnTypes(map);
      })
      .catch(() => setColumnTypes({}));
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

  function updateKey(i: number, patch: Partial<SortKey>) {
    const next = keys.map((k, idx) => (idx === i ? { ...k, ...patch } : k));
    updateConfig((cfg) => ({ ...cfg, keys: next.length > 0 ? next : undefined }));
  }

  function removeKey(i: number) {
    const next = keys.filter((_, idx) => idx !== i);
    updateConfig((cfg) => ({ ...cfg, keys: next.length > 0 ? next : undefined }));
  }

  function addKey() {
    updateConfig((cfg) => ({
      ...cfg,
      keys: [...keys, { field: '', direction: 'asc' as const }],
    }));
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection>
        {keys.length === 0 ? (
          <div className="py-4 text-center text-[12px] text-text-muted">暂未设置排序键</div>
        ) : (
          <div className="space-y-1.5">
            {keys.map((key, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {/* Field + search */}
                <div className="relative flex-1 min-w-0">
                  <select
                    value={key.field}
                    onChange={(e) => updateKey(i, { field: e.target.value })}
                    className={SELECT_CLASS + ' w-full'}
                  >
                    <option value="" disabled>
                      选择字段
                    </option>
                    {fieldCompletions.map((col) => (
                      <option key={col} value={col}>
                        {col}
                        {columnTypes[col] ? ` (${dataFieldTypeLabel(columnTypes[col])})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Direction toggle */}
                <button
                  type="button"
                  onClick={() =>
                    updateKey(i, { direction: key.direction === 'asc' ? 'desc' : 'asc' })
                  }
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    key.direction === 'asc'
                      ? 'border-accent/30 bg-accent/10 text-accent'
                      : 'border-border-muted bg-background/42 text-text-secondary hover:border-accent/30'
                  }`}
                  title={key.direction === 'asc' ? '升序' : '降序'}
                >
                  {key.direction === 'asc' ? (
                    <ArrowUp className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDown className="h-3.5 w-3.5" />
                  )}
                </button>

                {/* Nulls */}
                <select
                  value={key.nulls ?? ''}
                  onChange={(e) =>
                    updateKey(i, {
                      nulls: (e.target.value || undefined) as 'first' | 'last' | undefined,
                    })
                  }
                  className={SELECT_CLASS + ' w-[100px] shrink-0'}
                >
                  <option value="">NULL 默认</option>
                  <option value="first">NULL 在前</option>
                  <option value="last">NULL 在后</option>
                </select>

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => removeKey(i)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-error transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addKey}
          className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-border-muted bg-background/42 px-2 text-[11px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors"
        >
          <Plus className="h-3 w-3" />
          添加排序键
        </button>
      </GlassFormSection>
    </div>
  );
}
