import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { GlassDirectionToggle } from './GlassDirectionToggle';
import { GlassNullsSelect } from './GlassNullsSelect';

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
        <div className="py-3 text-center text-[12px] text-text-muted">
          {tr('sortNoKeys', '暂未设置排序键')}
        </div>
      ) : (
        keys.map((key, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select
              value={key.field}
              onChange={(e) => updateKey(i, { field: e.target.value })}
              className="h-7 flex-1 rounded-md border border-border-muted bg-background/42 px-2 text-[12px] text-text-primary outline-none focus:border-accent"
            >
              <option value="" disabled>
                {tr('sortSelectField', '选择字段')}
              </option>
              {fieldCompletions.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
            <GlassDirectionToggle
              value={key.direction}
              onChange={(v) => updateKey(i, { direction: v })}
              className="h-7 shrink-0 rounded-md px-3 text-[11px] font-medium"
            />
            <GlassNullsSelect
              value={key.nulls}
              onChange={(v) => updateKey(i, { nulls: v })}
              className="h-7 w-28 rounded-md border border-border-muted bg-background/42 px-1 text-[11px] text-text-secondary outline-none focus:border-accent"
            />
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
        {tr('sortAddKey', '添加排序键')}
      </button>
    </div>
  );
}
