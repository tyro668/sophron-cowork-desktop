import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';

export interface ConditionEntry {
  left: string;
  operator: string;
  right: string;
}

interface GlassConditionEditorProps {
  conditions: ConditionEntry[];
  leftFieldCompletions: string[];
  rightFieldCompletions: string[];
  onChange: (conditions: ConditionEntry[]) => void;
  leftLabel?: string;
  rightLabel?: string;
  operators?: { value: string; label: string }[];
}

const DEFAULT_CONDITION: ConditionEntry = { left: '', operator: '=', right: '' };

const DEFAULT_OPERATORS = [{ value: '=', label: '=' }];

export function GlassConditionEditor({
  conditions,
  leftFieldCompletions,
  rightFieldCompletions,
  onChange,
  leftLabel,
  rightLabel,
  operators = DEFAULT_OPERATORS,
}: GlassConditionEditorProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const resolvedLeftLabel = leftLabel ?? tr('leftField', '[左字段]');
  const resolvedRightLabel = rightLabel ?? tr('rightField', '[右表].[字段]');

  function updateCondition(index: number, patch: Partial<ConditionEntry>) {
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function removeCondition(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  function addCondition() {
    onChange([...conditions, { ...DEFAULT_CONDITION }]);
  }

  return (
    <div className="space-y-1.5">
      {conditions.length === 0 ? (
        <div className="py-4 text-center text-[12px] text-text-muted">
          {tr('noConditions', '暂无连接条件')}
        </div>
      ) : (
        conditions.map((cond, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select
              value={cond.left}
              onChange={(e) => updateCondition(i, { left: e.target.value })}
              className="h-7 flex-1 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent"
            >
              <option value="" disabled>
                {resolvedLeftLabel}
              </option>
              {leftFieldCompletions.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
            <select
              value={cond.operator}
              onChange={(e) => updateCondition(i, { operator: e.target.value })}
              className="h-7 w-14 shrink-0 rounded-md border border-border-muted bg-background/42 px-1 text-center text-[12px] text-text-secondary outline-none focus:border-accent"
            >
              {operators.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            <select
              value={cond.right}
              onChange={(e) => updateCondition(i, { right: e.target.value })}
              className="h-7 flex-1 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent"
            >
              <option value="" disabled>
                {resolvedRightLabel}
              </option>
              {rightFieldCompletions.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeCondition(i)}
              className="h-7 w-7 flex shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-error transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={addCondition}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border-muted bg-background/42 px-2 text-[11px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors"
      >
        <Plus className="h-3 w-3" />
        {tr('addCondition', '添加条件')}
      </button>
    </div>
  );
}
