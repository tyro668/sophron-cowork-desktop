import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassRowList, type GlassRowListColumn } from './shared/GlassRowList';

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

  // Auto-initialize with one empty row
  useEffect(() => {
    if (mappings.length === 0) {
      commitMappings([{ ...DEFAULT_MAPPING }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitMappings = useCallback(
    (next: MappingEntry[]) => {
      updateConfig((cfg) => ({ ...cfg, mappings: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  // ── Drag-to-reorder state ──
  const dragIndexRef = useRef<number | null>(null);
  const dropTargetRef = useRef<number | null>(null);
  const [sortedMappings, setSortedMappings] = useState<MappingEntry[] | null>(null);

  const activeMappings = sortedMappings ?? mappings;

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setSortedMappings([...activeMappings]);
    },
    [activeMappings]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dropTargetRef.current = index;
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    const from = dragIndexRef.current;
    setSortedMappings((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndexRef.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (sortedMappings && dragIndexRef.current !== null) {
      commitMappings(sortedMappings);
    }
    dragIndexRef.current = null;
    dropTargetRef.current = null;
    setSortedMappings(null);
  }, [sortedMappings, commitMappings]);

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
      const hasEmpty = activeMappings.some((m) => !m.source);
      if (hasEmpty || activeMappings.length >= fieldCompletions.length) return;
      const next = [...activeMappings];
      next.splice(index + 1, 0, { ...DEFAULT_MAPPING });
      commitMappings(next);
    },
    [activeMappings, fieldCompletions.length, commitMappings]
  );

  const removeMapping = useCallback(
    (index: number) => {
      if (activeMappings.length <= 1) {
        commitMappings([{ ...DEFAULT_MAPPING }]);
        return;
      }
      commitMappings(activeMappings.filter((_, i) => i !== index));
    },
    [activeMappings, commitMappings]
  );

  const usedFields = useMemo(() => {
    const used = new Set<string>();
    for (const m of activeMappings) {
      if (m.source) used.add(m.source);
    }
    return used;
  }, [activeMappings]);

  const columns = useMemo<GlassRowListColumn<MappingEntry>[]>(
    () => [
      {
        flex: 'flex-[5]',
        header: tr('fieldMappingSourceField', '源字段'),
        render: (item, i) => {
          const disabledFields = new Set(usedFields);
          if (item.source) disabledFields.delete(item.source);
          return (
            <div className="flex items-center gap-1">
              <GlassFieldCombo
                value={item.source}
                options={fieldCompletions}
                onChange={(value) => updateMapping(i, { source: value })}
                placeholder={tr('fieldMappingSelectField', '选择字段')}
                searchPlaceholder={tr('searchField', '搜索字段')}
                emptyText={tr('noMatch', '无匹配字段')}
                disabledOptions={disabledFields}
                className="flex-1 min-w-0 h-7"
              />
              <div className="flex items-center gap-0.5 w-5 flex-shrink-0 justify-center">
                <div className="h-[2px] w-[10px] bg-text-muted rounded-full" />
                <div className="h-0 w-0 border-l-[6px] border-l-text-muted border-y-[4.5px] border-y-transparent" />
              </div>
            </div>
          );
        },
      },
      {
        flex: 'flex-[5]',
        header: tr('fieldMappingTargetField', '目标字段名'),
        render: (item, i) => {
          const err = getTargetError(item, i);
          return (
            <div className="flex items-center gap-1">
              <GlassFormTextInput
                value={item.target}
                onChange={(value) => updateMapping(i, { target: value })}
                placeholder={tr('fieldMappingTargetPlaceholder', '目标字段名')}
                className={`h-7 px-2 text-[12px] w-full ${err ? 'border-warning/70' : ''}`}
              />
              {err && (
                <span
                  className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center"
                  title={err}
                >
                  <svg
                    className="h-3.5 w-3.5 text-warning/70"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 5h2v4H7V5zm0 5h2v2H7v-2z" />
                  </svg>
                </span>
              )}
            </div>
          );
        },
      },
    ],
    [fieldCompletions, usedFields, tr, getTargetError, updateMapping]
  );

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <GlassRowList
            items={activeMappings}
            columns={columns}
            onAdd={addMappingAfter}
            onRemove={removeMapping}
            addTitle={tr('fieldMappingAdd', '添加映射')}
            removeTitle={tr('fieldMappingRemove', '删除映射')}
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            getRowOpacity={(i) => !!(sortedMappings && dragIndexRef.current === i)}
            dragTitle={tr('dragToReorder', '拖拽排序')}
          />
        </div>
      </div>
    </div>
  );
}
