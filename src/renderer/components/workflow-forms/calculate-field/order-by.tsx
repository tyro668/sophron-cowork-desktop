import { useCallback } from 'react';
import { ChevronDown, Trash2, X } from 'lucide-react';
import type { CalculationRow } from '../shared/calculate-field';
import { GlassFieldMultiSelect } from '../shared/GlassFieldMultiSelect';

interface Props {
  item: CalculationRow;
  index: number;
  updateItem: (index: number, patch: Partial<CalculationRow>) => void;
  tr: (key: string, fallback: string) => string;
  fieldCompletions: string[];
  columnTypes: Record<string, string>;
  ordOpen: boolean;
  setOrderOpen: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
}

export function GlassOrderByConfig({
  item,
  index,
  updateItem,
  tr,
  fieldCompletions,
  columnTypes,
  ordOpen,
  setOrderOpen,
}: Props) {
  const updateOrder = useCallback(
    (patch: Partial<CalculationRow>) => updateItem(index, patch),
    [updateItem, index]
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
          {tr('calcFieldOrderBy', '排序字段')}
        </span>
        <div className="w-72 min-w-0 relative">
          <div className="flex min-h-7 items-center rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
            {item.orderBy?.length ? (
              <button
                type="button"
                onClick={() => updateOrder({ orderBy: undefined })}
                className="ml-1 inline-flex flex-shrink-0 items-center justify-center self-stretch rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                title={tr('clearAll', '清空')}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null}
            <div className="flex flex-1 items-center gap-1 px-1.5 min-w-0 overflow-x-auto">
              {item.orderBy?.map((o) => (
                <span
                  key={o.field}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
                >
                  {o.field}
                  <button
                    type="button"
                    onClick={() =>
                      updateOrder({
                        orderBy: item.orderBy?.map((x) =>
                          x.field === o.field
                            ? {
                                ...x,
                                direction:
                                  x.direction === 'desc' ? ('asc' as const) : ('desc' as const),
                              }
                            : x
                        ),
                      })
                    }
                    className="text-[11px] leading-none px-0.5 hover:text-text-primary rounded"
                    title={o.direction === 'asc' ? tr('asc', '升序') : tr('desc', '降序')}
                  >
                    {o.direction === 'asc' ? '↑' : '↓'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateOrder({ orderBy: item.orderBy?.filter((x) => x.field !== o.field) })
                    }
                    className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                readOnly
                placeholder={
                  !item.orderBy?.length ? tr('calcFieldOrderPlaceholder', '选择排序字段') : ''
                }
                onFocus={() => setOrderOpen((o) => ({ ...o, [index]: true }))}
                onBlur={() =>
                  setTimeout(() => setOrderOpen((o) => ({ ...o, [index]: false })), 150)
                }
                className="h-5 min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted cursor-pointer"
              />
            </div>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOrderOpen((o) => ({ ...o, [index]: !ordOpen }))}
              className="flex w-7 flex-shrink-0 items-center justify-center self-stretch border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${ordOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
          {ordOpen && (
            <div className="absolute z-10 left-0 right-0 mt-0.5">
              <GlassFieldMultiSelect
                columns={fieldCompletions}
                selected={item.orderBy?.map((o) => o.field) ?? []}
                onChange={(v) =>
                  updateOrder({
                    orderBy:
                      v.length > 0
                        ? v.map((f) => ({
                            field: f,
                            direction:
                              item.orderBy?.find((x) => x.field === f)?.direction ??
                              ('asc' as const),
                          }))
                        : undefined,
                  })
                }
                columnTypes={columnTypes}
                maxHeight="160px"
                variant="glass"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
