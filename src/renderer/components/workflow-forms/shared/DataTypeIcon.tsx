import { memo } from 'react';
import { Calendar, Clock, ToggleLeft } from 'lucide-react';
import {
  isDataFieldType,
  normalizeDataFieldType,
  type DataFieldType,
} from '../../../../shared/data-field-types';
import { useDataFieldTypeLabel } from '../../../hooks/useDataFieldTypeLabel';

interface DataTypeIconProps {
  type: string | null | undefined;
  className?: string;
}

const TEXT_SYMBOLS: Record<DataFieldType, string | null> = {
  text: 'T',
  integer: '#',
  float: '1.2',
  decimal: '.00',
  date: null,
  datetime: null,
  boolean: null,
};

const TEXT_SYMBOL_FONT_SIZE: Record<DataFieldType, string> = {
  text: 'text-[10px]',
  integer: 'text-[11px]',
  float: 'text-[7px]',
  decimal: 'text-[6px]',
  date: '',
  datetime: '',
  boolean: '',
};

export const DataTypeIcon = memo(function DataTypeIcon({ type, className }: DataTypeIconProps) {
  const dataTypeLabel = useDataFieldTypeLabel();
  const label = dataTypeLabel(type);

  if (type == null || String(type).trim() === '' || !isDataFieldType(type)) {
    return (
      <span
        className={`dt-icon inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] border border-dashed border-border-muted bg-transparent text-[9px] font-semibold leading-none text-text-muted ${className ?? ''}`}
        title={label}
        aria-label={label}
      >
        ?
      </span>
    );
  }

  const normalized = normalizeDataFieldType(type);
  const symbol = TEXT_SYMBOLS[normalized];

  return (
    <span
      className={`dt-icon inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] bg-accent-muted font-semibold leading-none text-accent ${className ?? ''}`}
      title={label}
      aria-label={label}
    >
      {symbol !== null ? (
        <span className={TEXT_SYMBOL_FONT_SIZE[normalized]}>{symbol}</span>
      ) : normalized === 'date' ? (
        <Calendar className="h-2.5 w-2.5" strokeWidth={2.5} />
      ) : normalized === 'datetime' ? (
        <Clock className="h-2.5 w-2.5" strokeWidth={2.5} />
      ) : (
        <ToggleLeft className="h-3 w-3" strokeWidth={2.5} />
      )}
    </span>
  );
});
