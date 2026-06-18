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
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
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
    <div className="space-y-2">
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-muted/70 py-6 text-center">
          <Plus className="h-5 w-5 text-text-muted/50" />
          <span className="text-[12px] text-text-muted">{emptyText}</span>
        </div>
      ) : (
        <>
          {items.map((item, i) => (
            <div
              key={getKey ? getKey(item, i) : i}
              className="group/item relative rounded-lg border border-border-muted/60 bg-background/28 p-2.5 hover:border-border-muted transition-colors"
            >
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-text-muted/50 opacity-0 transition-all hover:bg-error/10 hover:text-error group-hover/item:opacity-100"
                title={tr('remove', '删除')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="pr-6">{renderRow(item, i, (updated) => updateItem(i, updated))}</div>
            </div>
          ))}
        </>
      )}
      <button
        type="button"
        onClick={addItem}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-muted/70 py-2 text-[12px] text-text-muted hover:border-accent/40 hover:text-accent transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </button>
    </div>
  );
}
