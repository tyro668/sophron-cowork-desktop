import { useState } from 'react';
import { FunctionSquare, List } from 'lucide-react';
import { GlassFieldSingleSelect } from './GlassFieldSingleSelect';
import { GlassExpressionInput } from './GlassExpressionInput';
import { useFormTranslation } from '../../../hooks/useFormTranslation';

/** `[field]` → `field`; anything else (expressions, `*`) → null. */
export function plainFieldOf(expression: string): string | null {
  const match = /^\[([^[\]]+)\]$/.exec(expression.trim());
  return match ? match[1] : null;
}

/** Auto output name for a metric, e.g. `销售额_sum`; count(*) → `行数`. */
export function autoMetricAlias(fn: string, expression: string, rowsLabel: string): string {
  const field = plainFieldOf(expression);
  if (field) return `${field}_${fn}`;
  if (fn === 'count' && (!expression.trim() || expression.trim() === '*')) return rowsLabel;
  return '';
}

interface MetricExpressionCellProps {
  value: string;
  onChange: (value: string) => void;
  fieldCompletions: string[];
  columnTypes?: Record<string, string>;
  /** count may run without a field (count rows). */
  allowAllRows?: boolean;
  placeholder?: string;
}

/**
 * Dropdown-first metric input: pick a field (stored as `[field]`); the ƒx toggle
 * switches to a free expression for the rare computed-metric case.
 */
export function MetricExpressionCell({
  value,
  onChange,
  fieldCompletions,
  columnTypes,
  allowAllRows,
  placeholder,
}: MetricExpressionCellProps) {
  const tr = useFormTranslation('metricInput');
  const trimmed = value.trim();
  const isPlain = !trimmed || trimmed === '*' || plainFieldOf(trimmed) !== null;
  const [expressionMode, setExpressionMode] = useState(!isPlain);
  const toggleClass =
    'inline-flex h-full items-center justify-center text-text-muted hover:text-accent';
  // Grid cells stretch direct child buttons; pin the toggle to an icon-sized slot.
  const toggleStyle = { flex: '0 0 28px', width: 28, padding: 0 } as const;

  if (expressionMode) {
    return (
      <div className="flex h-full w-full items-center">
        <div className="min-w-0 flex-1">
          <GlassExpressionInput
            value={value}
            onChange={onChange}
            fieldCompletions={fieldCompletions}
            columnTypes={columnTypes}
            placeholder={placeholder ?? tr('expressionPlaceholder')}
          />
        </div>
        <button
          type="button"
          className={toggleClass}
          style={toggleStyle}
          title={tr('useField')}
          aria-label={tr('useField')}
          data-testid="metric-use-field"
          onClick={() => {
            if (!isPlain) onChange('');
            setExpressionMode(false);
          }}
        >
          <List className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const allRows = tr('allRows');
  const options = allowAllRows ? [allRows, ...fieldCompletions] : fieldCompletions;
  const selected = trimmed === '*' ? allRows : (plainFieldOf(trimmed) ?? '');
  return (
    <div className="flex h-full w-full items-center">
      <div className="min-w-0 flex-1">
        <GlassFieldSingleSelect
          value={selected}
          options={options}
          columnTypes={columnTypes}
          onChange={(field) => onChange(field === allRows ? '*' : `[${field}]`)}
          placeholder={allowAllRows ? allRows : tr('selectField')}
          className="w-full"
        />
      </div>
      <button
        type="button"
        className={toggleClass}
        style={toggleStyle}
        title={tr('useExpression')}
        aria-label={tr('useExpression')}
        data-testid="metric-use-expression"
        onClick={() => setExpressionMode(true)}
      >
        <FunctionSquare className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
