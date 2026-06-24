import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, GripVertical, ArrowRight } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFieldCombo } from './shared/GlassFieldCombo';

interface MappingEntry {
  source: string;
  target: string;
}

const DEFAULT_MAPPING: MappingEntry = { source: '', target: '' };

export default function FormFieldMapping({
  node,
  fieldCompletions,
  onNodeChange,
}: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

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

  const mappings = useMemo<MappingEntry[]>(
    () => (node.config.mappings as MappingEntry[]) ?? [],
    [node.config.mappings]
  );

  const commitMappings = useCallback(
    (next: MappingEntry[]) => {
      updateConfig((cfg) => ({ ...cfg, mappings: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  const displayMappings = useMemo(() => {
    return mappings.length > 0 ? mappings : [{ ...DEFAULT_MAPPING }];
  }, [mappings]);

  const dragIndexRef = useRef<number | null>(null);
  const [dragMappings, setDragMappings] = useState<MappingEntry[] | null>(null);

  useEffect(() => {
    if (dragIndexRef.current === null) setDragMappings(null);
  }, [displayMappings]);

  const activeMappings = dragMappings ?? displayMappings;

  const [selectedIndex, setSelectedIndex] = useState(0);

  const occupiedNames = useMemo(() => {
    const renamed = new Set(mappings.map((m) => m.source));
    return new Set(fieldCompletions.filter((c) => !renamed.has(c)));
  }, [fieldCompletions, mappings]);

  const getTargetError = useCallback(
    (item: MappingEntry, index: number): string | null => {
      const tgt = item.target.trim();
      if (!tgt) return null;
      if (tgt === item.source) return tr('fieldMappingErrSameSource', '不能与原字段名相同');
      if (occupiedNames.has(tgt)) return tr('fieldMappingErrConflict', '与已有字段名冲突');
      if (mappings.some((m, i) => i !== index && m.target.trim() === tgt))
        return tr('fieldMappingErrDuplicate', '目标字段名重复');
      return null;
    },
    [mappings, occupiedNames, tr]
  );

  const updateMapping = useCallback(
    (index: number, patch: Partial<MappingEntry>) => {
      const next = activeMappings.map((m, i) => (i === index ? { ...m, ...patch } : m));
      commitMappings(next);
    },
    [activeMappings, commitMappings]
  );

  const addMappingAfter = useCallback(
    (index: number) => {
      const next = [...activeMappings];
      next.splice(index + 1, 0, { ...DEFAULT_MAPPING });
      commitMappings(next);
      setSelectedIndex(index + 1);
    },
    [activeMappings, commitMappings]
  );

  const removeMapping = useCallback(
    (index: number) => {
      if (activeMappings.length <= 1) {
        commitMappings([]);
        setSelectedIndex(0);
        return;
      }
      commitMappings(activeMappings.filter((_, i) => i !== index));
      setSelectedIndex((prev) => Math.max(0, Math.min(prev, activeMappings.length - 2)));
    },
    [activeMappings, commitMappings]
  );

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setDragMappings([...displayMappings]);
    },
    [displayMappings]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    const from = dragIndexRef.current;
    setDragMappings((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndexRef.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragMappings && dragIndexRef.current !== null) {
      commitMappings(dragMappings);
    }
    dragIndexRef.current = null;
    setDragMappings(null);
  }, [dragMappings, commitMappings]);

  const usedFields = useMemo(() => {
    const used = new Set<string>();
    for (const m of activeMappings) {
      if (m.source) used.add(m.source);
    }
    return used;
  }, [activeMappings]);

  const realMappings = useMemo(() => activeMappings.filter((m) => m.source), [activeMappings]);

  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());

  const toggleErrorExpanded = useCallback((index: number) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  return (
    <div className="grid h-full grid-cols-[7fr_3fr] overflow-hidden">
      <div className="flex min-h-0 flex-col overflow-hidden border-r border-border-muted">
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <div className="flex items-center gap-1 px-1.5 pb-0.5 text-[11px] font-medium text-text-muted">
            <span className="flex h-6 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="flex-[5] min-w-0 text-center">
              {tr('fieldMappingSourceField', '源字段')}
            </span>
            <span className="w-6 flex-shrink-0" aria-hidden="true" />
            <span className="flex-[5] min-w-0 text-center">
              {tr('fieldMappingTargetField', '目标字段名')}
            </span>
            <span className="flex h-6 w-6 flex-shrink-0" aria-hidden="true" />
            <span className="flex h-6 w-6 flex-shrink-0" aria-hidden="true" />
          </div>

          {activeMappings.map((mapping, i) => {
            const disabledFields = new Set(usedFields);
            if (mapping.source) disabledFields.delete(mapping.source);
            const err = getTargetError(mapping, i);
            const isErrorExpanded = expandedErrors.has(i);

            return (
              <div key={i} onDragOver={(e) => handleDragOver(e, i)}>
                <div
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-surface-hover/40 ${
                    dragMappings && dragIndexRef.current === i ? 'opacity-50' : ''
                  } ${selectedIndex === i ? 'bg-surface-hover/30' : ''}`}
                  onClick={() => setSelectedIndex(i)}
                >
                  <div
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragEnd={handleDragEnd}
                    className="flex h-6 w-4 flex-shrink-0 cursor-grab items-center justify-center text-text-muted transition-colors hover:text-text-secondary active:cursor-grabbing"
                    title={tr('dragToReorder', '拖拽排序')}
                    aria-label={tr('dragToReorder', '拖拽排序')}
                  >
                    <GripVertical className="h-4 w-4" />
                  </div>

                  <GlassFieldCombo
                    value={mapping.source}
                    options={fieldCompletions}
                    onChange={(value) => updateMapping(i, { source: value })}
                    placeholder={tr('fieldMappingSelectField', '选择字段')}
                    searchPlaceholder={tr('searchField', '搜索字段')}
                    emptyText={tr('noMatch', '无匹配字段')}
                    disabledOptions={disabledFields}
                    className="flex-[5] min-w-0"
                  />

                  <ArrowRight className="w-6 flex-shrink-0 text-text-muted" />

                  <div className="relative flex-[5] min-w-0">
                    <input
                      value={mapping.target}
                      onChange={(e) => updateMapping(i, { target: e.target.value })}
                      placeholder={tr('fieldMappingTargetPlaceholder', '目标字段名')}
                      className={`h-6 w-full rounded border bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent ${
                        err ? 'border-warning/70' : 'border-border-muted'
                      }`}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      if (err) {
                        e.stopPropagation();
                        toggleErrorExpanded(i);
                      }
                    }}
                    disabled={!err}
                    className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors ${
                      err
                        ? 'cursor-pointer text-warning/70 hover:bg-warning/10'
                        : 'cursor-not-allowed text-text-muted/40'
                    }`}
                    title={err ?? ''}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 5h2v4H7V5zm0 5h2v2H7v-2z" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    onClick={() => addMappingAfter(i)}
                    className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-accent"
                    title={tr('fieldMappingAdd', '添加映射')}
                    aria-label={tr('fieldMappingAdd', '添加映射')}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => removeMapping(i)}
                    className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:text-error hover:bg-error/10"
                    title={tr('fieldMappingRemove', '删除映射')}
                    aria-label={tr('fieldMappingRemove', '删除映射')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {isErrorExpanded && err && (
                  <div className="ml-6 mt-1 mb-1 rounded border border-warning/30 bg-warning/5 p-2">
                    <p className="text-[11px] leading-4 text-warning">{err}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-2 pb-2 pt-1 pl-3">
        <div>
          <h5 className="mb-2 text-[11px] font-medium text-text-muted">
            {tr('fieldMappingCurrentRules', '当前字段映射')}
          </h5>
          {realMappings.length === 0 ? (
            <p className="text-[12px] leading-5 text-text-secondary">
              {tr('fieldMappingNoRules', '未设置字段映射，请在左侧添加。')}
            </p>
          ) : (
            <ol className="space-y-1.5">
              {realMappings.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px]">
                  <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-surface text-[10px] font-medium tabular-nums text-text-muted">
                    {i + 1}
                  </span>
                  <span className="leading-4 text-text-primary">
                    {m.source}
                    <span className="text-text-secondary"> → {m.target || '…'}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-md border border-border-muted bg-background/42 px-2.5 py-2">
          <p className="text-[11px] leading-4 text-text-muted">
            {tr('fieldMappingHint', '提示：拖拽可调整映射顺序。')}
          </p>
        </div>
      </div>
    </div>
  );
}
