import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassFieldCombo } from './GlassFieldCombo';
import { GlassDirectionToggle } from './GlassDirectionToggle';
import { GlassNullsSelect } from './GlassNullsSelect';
import { GlassRowList, type GlassRowListColumn } from './GlassRowList';

export interface SortKeyEntry {
  field: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

interface GlassSortKeyEditorProps {
  keys: SortKeyEntry[];
  fieldCompletions: string[];
  onChange: (keys: SortKeyEntry[]) => void;
}

const DEFAULT_KEY: SortKeyEntry = { field: '', direction: 'asc' };

export function GlassSortKeyEditor({ keys, fieldCompletions, onChange }: GlassSortKeyEditorProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const displayKeys = useMemo<SortKeyEntry[]>(
    () => (keys.length > 0 ? keys : [{ ...DEFAULT_KEY }]),
    [keys]
  );

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragKeys, setDragKeys] = useState<SortKeyEntry[] | null>(null);

  const activeKeys = dragKeys ?? displayKeys;

  const commitKeys = useCallback(
    (next: SortKeyEntry[]) => {
      onChange(next);
    },
    [onChange]
  );

  const updateKey = useCallback(
    (index: number, patch: Partial<SortKeyEntry>) => {
      if ('field' in patch && patch.field) {
        const existing = activeKeys.findIndex((k, i) => i !== index && k.field === patch.field);
        if (existing !== -1) {
          const next = activeKeys.map((k, i) => {
            if (i === index) return { ...k, ...patch };
            if (i === existing) return { ...k, field: '' };
            return k;
          });
          commitKeys(next);
          return;
        }
      }
      const next = activeKeys.map((k, i) => (i === index ? { ...k, ...patch } : k));
      commitKeys(next);
    },
    [activeKeys, commitKeys]
  );

  const addKeyAfter = useCallback(
    (index: number) => {
      const next = [...activeKeys];
      next.splice(index + 1, 0, { ...DEFAULT_KEY });
      commitKeys(next);
    },
    [activeKeys, commitKeys]
  );

  const removeKey = useCallback(
    (index: number) => {
      if (activeKeys.length <= 1) {
        commitKeys([]);
        return;
      }
      commitKeys(activeKeys.filter((_, i) => i !== index));
    },
    [activeKeys, commitKeys]
  );

  const handleDragStart = useCallback(
    (index: number) => {
      setDragIndex(index);
      setDragKeys([...displayKeys]);
    },
    [displayKeys]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === index) return;
      const from = dragIndex;
      setDragKeys((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(index, 0, moved);
        return next;
      });
      setDragIndex(index);
    },
    [dragIndex]
  );

  const handleDragEnd = useCallback(() => {
    if (dragKeys && dragIndex !== null) {
      commitKeys(dragKeys);
    }
    setDragIndex(null);
    setDragKeys(null);
  }, [dragKeys, dragIndex, commitKeys]);

  const usedFields = useMemo(() => {
    const used = new Set<string>();
    for (const k of activeKeys) {
      if (k.field) used.add(k.field);
    }
    return used;
  }, [activeKeys]);

  const columns = useMemo<GlassRowListColumn<SortKeyEntry>[]>(
    () => [
      {
        flex: 'flex-[4]',
        header: tr('sortFieldHeader', '排序字段'),
        render: (key, i) => {
          const disabledOptions = new Set(usedFields);
          if (key.field) disabledOptions.delete(key.field);
          return (
            <GlassFieldCombo
              value={key.field}
              options={fieldCompletions}
              onChange={(value) => updateKey(i, { field: value })}
              placeholder={tr('sortSelectField', '选择字段')}
              searchPlaceholder={tr('searchField', '搜索字段')}
              emptyText={tr('noMatch', '无匹配字段')}
              disabledOptions={disabledOptions}
              className="w-full"
            />
          );
        },
      },
      {
        flex: 'flex-[2]',
        header: tr('sortDirectionHeader', '排序方式'),
        render: (key, i) => (
          <GlassDirectionToggle
            value={key.direction}
            onChange={(v) => updateKey(i, { direction: v })}
            className="h-6 w-full px-1.5 text-[12px]"
          />
        ),
      },
      {
        flex: 'flex-[3]',
        header: tr('sortNullsHeader', '空值处理'),
        render: (key, i) => (
          <GlassNullsSelect
            value={key.nulls}
            onChange={(v) => updateKey(i, { nulls: v })}
            className="h-6 w-full rounded border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
          />
        ),
      },
    ],
    [fieldCompletions, usedFields, tr, updateKey]
  );

  return (
    <GlassRowList
      items={activeKeys}
      columns={columns}
      onAdd={addKeyAfter}
      onRemove={removeKey}
      addTitle={tr('sortAddKey', '添加排序键')}
      removeTitle={tr('sortRemoveKey', '删除排序键')}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      getRowOpacity={(i) => dragIndex === i}
      dragTitle={tr('dragToReorder', '拖拽排序')}
    />
  );
}
