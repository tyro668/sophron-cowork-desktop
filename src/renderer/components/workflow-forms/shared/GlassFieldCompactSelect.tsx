import { memo } from 'react';
import type { ReactNode } from 'react';
import { GlassFieldMultiSelect } from './GlassFieldMultiSelect';

export interface GlassFieldCompactSelectProps {
  columns: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  columnTypes?: Record<string, string>;
  maxHeight?: string;
  itemExtras?: (column: string) => ReactNode;
  columnLabel?: (column: string) => string;
}

export const GlassFieldCompactSelect = memo(function GlassFieldCompactSelect(
  props: GlassFieldCompactSelectProps
) {
  return (
    <GlassFieldMultiSelect
      {...props}
      selectionMode="multi"
      variant="flat"
      borderless
      searchBordered
      className="flex-1"
    />
  );
});
