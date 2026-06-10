import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';

interface GlassListEditorProps<T> {
  items: T[];
  renderRow: (item: T, index: number, onChange: (item: T) => void) => ReactNode;
  createDefault: () => T;
  onChange: (items: T[]) => void;
  getKey?: (item: T, index: number) => string;
  addLabel?: string;
  emptyText?: string;
}

export function GlassListEditor<T>({
  items,
  renderRow,
  createDefault,
  onChange,
  getKey,
  addLabel = '添加',
  emptyText = '暂无条目',
}: GlassListEditorProps<T>) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) => t(`formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  function updateItem(index: number, item: T) {
    onChange(items.map((existing, i) => (i === index ? item : existing)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function addItem() {
    onChange([...items, createDefault()]);
  }

  return (
    <div className="space-y-1.5">
      {items.length === 0 ? (
        <div className="py-4 text-center text-[12px] text-text-muted">{emptyText}</div>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div
              key={getKey ? getKey(item, i) : i}
              className="group/item relative rounded-lg border border-border-muted bg-background/42 p-2.5"
            >
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-error group-hover/item:opacity-100"
                title={tr('remove', '删除')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="pr-6">{renderRow(item, i, (updated) => updateItem(i, updated))}</div>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={addItem}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border-muted bg-background/42 px-2 text-[11px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors"
      >
        <Plus className="h-3 w-3" />
        {addLabel}
      </button>
    </div>
  );
}
