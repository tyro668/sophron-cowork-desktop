import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
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

  const commitMappings = useCallback(
    (next: MappingEntry[]) => {
      updateConfig((cfg) => ({ ...cfg, mappings: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  const displayMappings = useMemo(() => {
    return mappings.length > 0 ? mappings : [{ ...DEFAULT_MAPPING }];
  }, [mappings]);

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
      const next = displayMappings.map((m, i) => (i === index ? { ...m, ...patch } : m));
      commitMappings(next);
    },
    [displayMappings, commitMappings]
  );

  const addMappingAfter = useCallback(
    (index: number) => {
      const next = [...displayMappings];
      next.splice(index + 1, 0, { ...DEFAULT_MAPPING });
      commitMappings(next);
    },
    [displayMappings, commitMappings]
  );

  const removeMapping = useCallback(
    (index: number) => {
      if (displayMappings.length <= 1) {
        commitMappings([]);
        return;
      }
      commitMappings(displayMappings.filter((_, i) => i !== index));
    },
    [displayMappings, commitMappings]
  );

  // Drag reorder state
  const dragIndexRef = useRef<number | null>(null);
  const [sortedMappings, setSortedMappings] = useState<MappingEntry[] | null>(null);

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setSortedMappings([...displayMappings]);
    },
    [displayMappings]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
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
    setSortedMappings(null);
  }, [sortedMappings, commitMappings]);

  const activeMappings = sortedMappings ?? displayMappings;

  const usedFields = useMemo(() => {
    const used = new Set<string>();
    for (const m of activeMappings) {
      if (m.source) used.add(m.source);
    }
    return used;
  }, [activeMappings]);

  const realMappings = useMemo(() => activeMappings.filter((m) => m.source), [activeMappings]);

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
                className="flex-1 min-w-0"
              />
              <ArrowRight className="w-5 flex-shrink-0 text-text-muted" />
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
                className={`h-6 px-1.5 text-[12px] w-full ${err ? 'border-warning/70' : ''}`}
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
    <div className="grid h-full grid-cols-[7fr_3fr] overflow-hidden">
      <div className="flex min-h-0 flex-col overflow-hidden border-r border-border-muted">
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
