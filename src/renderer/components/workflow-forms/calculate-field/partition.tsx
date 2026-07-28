import { useCallback } from 'react';
import { GlassOptionSingleSelect } from '../shared/GlassOptionSingleSelect';
import { GlassTagBar } from '../shared/GlassTagBar';
import { GlassFieldMultiSelect } from '../shared/GlassFieldMultiSelect';
import type { CalculationRow } from '../shared/calculate-field';

interface Props {
  item: CalculationRow;
  index: number;
  updateItem: (index: number, patch: Partial<CalculationRow>) => void;
  tr: (key: string) => string;
  fieldCompletions: string[];
  columnTypes: Record<string, string>;
  scenario: string;
  isPartition: boolean;
  partitionOpen: Record<number, boolean>;
  setPartitionOpen: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  lastPartitionByRef: React.MutableRefObject<Record<string, string[] | undefined>>;
}

export function GlassPartitionConfig({
  item,
  index,
  updateItem,
  tr,
  fieldCompletions,
  columnTypes,
  scenario,
  isPartition,
  partitionOpen,
  setPartitionOpen,
  lastPartitionByRef,
}: Props) {
  const updatePartition = useCallback(
    (patch: Partial<CalculationRow>) => updateItem(index, patch),
    [updateItem, index]
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
          {tr('calcFieldPartitionRange')}
        </span>
        <GlassOptionSingleSelect
          value={isPartition ? 'partition' : 'all'}
          groups={[
            {
              key: 'partitionMode',
              items: [
                { value: 'all', label: tr('calcFieldPartitionAll') },
                { value: 'partition', label: tr('calcFieldPartitionSelect') },
              ],
            },
          ]}
          onChange={(v) => {
            const cacheKey = `${scenario}_${index}`;
            if (v === 'all') {
              lastPartitionByRef.current[cacheKey] = item.partitionBy;
              updatePartition({ partitionBy: undefined });
            } else {
              updatePartition({ partitionBy: lastPartitionByRef.current[cacheKey] ?? [] });
              setPartitionOpen((o) => ({ ...o, [index]: true }));
            }
          }}
          className="h-7 text-[12px] w-28"
        />
      </div>
      {isPartition && (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
            {tr('calcFieldPartitionBy')}
          </span>
          <div className="w-72 min-w-0 relative">
            <GlassTagBar
              items={item.partitionBy ?? []}
              onRemove={(col) =>
                updatePartition({ partitionBy: item.partitionBy?.filter((c) => c !== col) })
              }
              onClear={() => updatePartition({ partitionBy: [] })}
              open={!!partitionOpen[index]}
              onToggle={() => setPartitionOpen((o) => ({ ...o, [index]: !o[index] }))}
              toggleStyle="chevron"
              density="compact"
              className="min-h-7"
              placeholder={tr('calcFieldPartitionPlaceholder')}
            />
            {!!partitionOpen[index] && (
              <div className="absolute z-10 left-0 right-0 mt-0.5">
                <GlassFieldMultiSelect
                  columns={fieldCompletions}
                  selected={item.partitionBy ?? []}
                  onChange={(v) => updatePartition({ partitionBy: v.length > 0 ? v : undefined })}
                  columnTypes={columnTypes}
                  maxHeight="160px"
                  variant="glass"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
