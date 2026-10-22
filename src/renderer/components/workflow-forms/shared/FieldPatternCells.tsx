import { useMemo, useState } from 'react';
import { Cell } from './FormGrid';
import { GlassOptionSingleSelect } from './GlassOptionSingleSelect';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { matchFields, type FieldTypeFilter } from '../../../../shared/field-pattern';

/**
 * Rule-based selection cells: type dropdown + name pattern (glob / regex /
 * substring) with an inline "add matches" action. Rendered inside a FormGrid row.
 */
export function FieldPatternCells({
  fields,
  columnTypes,
  onApply,
  typeSpan = 1,
  patternSpan = 1,
}: {
  fields: string[];
  columnTypes?: Record<string, string>;
  onApply: (matched: string[]) => void;
  typeSpan?: number;
  patternSpan?: number;
}) {
  const tr = useFormTranslation('fieldPattern');
  const [type, setType] = useState<FieldTypeFilter>('');
  const [pattern, setPattern] = useState('');
  const matched = useMemo(
    () => matchFields(fields, columnTypes, { type, pattern }),
    [fields, columnTypes, type, pattern]
  );
  const active = Boolean(type || pattern.trim());
  return (
    <>
      <Cell span={typeSpan} v={['ctl']}>
        <GlassOptionSingleSelect
          value={type}
          onChange={(value) => setType(value as FieldTypeFilter)}
          groups={[
            {
              key: 'types',
              items: [
                { value: '', label: tr('anyType') },
                { value: 'text', label: tr('text') },
                { value: 'number', label: tr('number') },
                { value: 'temporal', label: tr('temporal') },
                { value: 'boolean', label: tr('boolean') },
              ],
            },
          ]}
          className="w-full"
        />
      </Cell>
      <Cell span={patternSpan} v={['ctl']}>
        <div className="flex min-w-0 flex-1 items-center">
          <input
            type="text"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            placeholder={tr('patternPlaceholder')}
            aria-label={tr('patternLabel')}
            data-testid="field-pattern-input"
            className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-[13px] text-text-primary outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            disabled={!active || matched.length === 0}
            onClick={() => onApply(matched)}
            data-testid="field-pattern-apply"
            style={{ flex: '0 0 auto', width: 'auto' }}
            className="h-full shrink-0 border-l border-border-subtle px-3 text-[12.5px] text-accent hover:bg-accent-muted disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent"
          >
            {tr('apply', { count: active ? matched.length : 0 })}
          </button>
        </div>
      </Cell>
    </>
  );
}
