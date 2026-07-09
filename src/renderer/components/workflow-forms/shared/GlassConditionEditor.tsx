import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { GlassFieldCombo } from './GlassFieldCombo';
import { GlassOperatorSelect } from './GlassOperatorSelect';

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
}

const DEFAULT_CONDITION: ConditionEntry = { left: '', operator: '=', right: '' };

const OPERATOR_KEYS = [
  { value: '=', key: 'operatorEq', fallback: '等于' },
  { value: '!=', key: 'operatorNeq', fallback: '不等于' },
  { value: '<', key: 'operatorLt', fallback: '小于' },
  { value: '<=', key: 'operatorLte', fallback: '小于等于' },
  { value: '>', key: 'operatorGt', fallback: '大于' },
  { value: '>=', key: 'operatorGte', fallback: '大于等于' },
];

export function GlassConditionEditor({
  conditions,
  leftFieldCompletions,
  rightFieldCompletions,
  onChange,
  leftLabel,
  rightLabel,
}: GlassConditionEditorProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const resolvedLeftLabel = leftLabel ?? tr('leftField', '[左表字段]');
  const resolvedRightLabel = rightLabel ?? tr('rightField', '[右表字段]');

  const operators = OPERATOR_KEYS.map((op) => ({
    value: op.value,
    label: tr(op.key, op.fallback),
  }));

  const [pending, setPending] = useState<ConditionEntry>({ ...DEFAULT_CONDITION });
  const isEmpty = conditions.length === 0;
  const displayConditions = isEmpty ? [pending] : conditions;

  function handleChange(index: number, patch: Partial<ConditionEntry>) {
    if (isEmpty) {
      const next = { ...pending, ...patch };
      setPending(next);
      if (next.left || next.right) {
        setPending({ ...DEFAULT_CONDITION });
        onChange([next]);
      }
    } else {
      onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    }
  }

  function handleRemove(index: number) {
    if (isEmpty) {
      setPending({ ...DEFAULT_CONDITION });
    } else {
      onChange(conditions.filter((_, i) => i !== index));
    }
  }

  function handleAdd(index: number) {
    if (isEmpty) {
      if (!pending.left && !pending.right) return;
      onChange([pending, { ...DEFAULT_CONDITION }]);
      setPending({ ...DEFAULT_CONDITION });
    } else {
      const next = [...conditions];
      next.splice(index + 1, 0, { ...DEFAULT_CONDITION });
      onChange(next);
    }
  }

  return (
    <div className="space-y-1">
      {displayConditions.map((cond, i) => (
        <div key={i} className="flex items-center gap-1">
          <GlassFieldCombo
            value={cond.left}
            options={leftFieldCompletions}
            onChange={(v) => handleChange(i, { left: v })}
            placeholder={resolvedLeftLabel}
            className="h-7 w-0 flex-[1_1_0] min-w-[100px] text-[12px]"
          />
          <GlassOperatorSelect
            value={cond.operator}
            groups={[{ key: 'op', items: operators }]}
            onChange={(v) => handleChange(i, { operator: v })}
            className="h-7 w-[72px] shrink-0 text-[12px] [&>span]:text-center"
          />
          <GlassFieldCombo
            value={cond.right}
            options={rightFieldCompletions}
            onChange={(v) => handleChange(i, { right: v })}
            placeholder={resolvedRightLabel}
            className="h-7 w-0 flex-[1_1_0] min-w-[100px] text-[12px]"
          />
          <button
            type="button"
            onClick={() => handleAdd(i)}
            className="h-6 w-6 flex shrink-0 items-center justify-center rounded text-text-muted/40 hover:text-accent transition-colors"
            title={tr('addCondition', '添加条件')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleRemove(i)}
            className="h-6 w-6 flex shrink-0 items-center justify-center rounded text-text-muted/40 hover:text-error transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
