import { Plus, Trash2 } from 'lucide-react';

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
  function updateKey(index: number, patch: Partial<SortKeyEntry>) {
    onChange(keys.map((k, i) => (i === index ? { ...k, ...patch } : k)));
  }

  function removeKey(index: number) {
    onChange(keys.filter((_, i) => i !== index));
  }

  function addKey() {
    onChange([...keys, { ...DEFAULT_KEY }]);
  }

  return (
    <div className="space-y-1.5">
      {keys.length === 0 ? (
        <div className="py-3 text-center text-[12px] text-text-muted">暂无排序键</div>
      ) : (
        keys.map((key, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select
              value={key.field}
              onChange={(e) => updateKey(i, { field: e.target.value })}
              className="h-7 flex-1 rounded-md border border-border-muted bg-background/42 px-2 text-[12px] text-text-primary outline-none focus:border-accent"
            >
              <option value="" disabled>
                选择字段
              </option>
              {fieldCompletions.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => updateKey(i, { direction: key.direction === 'asc' ? 'desc' : 'asc' })}
              className={`h-7 shrink-0 rounded-md border px-2 text-[11px] font-medium transition-colors ${
                key.direction === 'asc'
                  ? 'border-accent/30 bg-accent/10 text-accent'
                  : 'border-border-muted bg-background/42 text-text-secondary'
              }`}
            >
              {key.direction === 'asc' ? '升序' : '降序'}
            </button>
            <select
              value={key.nulls ?? ''}
              onChange={(e) =>
                updateKey(i, {
                  nulls: (e.target.value || undefined) as 'first' | 'last' | undefined,
                })
              }
              className="h-7 w-16 rounded-md border border-border-muted bg-background/42 px-1 text-[11px] text-text-secondary outline-none focus:border-accent"
            >
              <option value="">默认</option>
              <option value="first">NULL 在前</option>
              <option value="last">NULL 在后</option>
            </select>
            <button
              type="button"
              onClick={() => removeKey(i)}
              className="h-7 w-7 flex shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-error transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={addKey}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border-muted bg-background/42 px-2 text-[11px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors"
      >
        <Plus className="h-3 w-3" />
        添加排序键
      </button>
    </div>
  );
}
