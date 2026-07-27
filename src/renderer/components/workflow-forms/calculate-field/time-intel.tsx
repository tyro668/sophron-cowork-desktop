import { useCallback, useEffect, useState } from 'react';
import { GlassFieldSingleSelect } from '../shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from '../shared/GlassOptionSingleSelect';
import { GlassFormTextInput } from '../shared/GlassFormTextInput';
import { isTemporalDataFieldType } from '@/shared/data-field-types';
import { TIME_WINDOW_DEFS } from '../shared/calculate-field';
import type { CalculationRow } from '../shared/calculate-field';
import { TIME_WINDOW_OPTIONS, TIME_AGG_OPTIONS } from './index';

interface Props {
  item: CalculationRow;
  index: number;
  updateItem: (index: number, patch: Partial<CalculationRow>) => void;
  tr: (key: string, fallback: string) => string;
  fieldCompletions: string[];
  columnTypes: Record<string, string>;
  currentTimeWindow: string;
  currentTimeAgg: string;
  timeDef: { hasParam: boolean } | undefined;
  timeFieldValue: string;
}

export function GlassTimeIntelConfig({
  item,
  index,
  updateItem,
  tr,
  fieldCompletions,
  columnTypes,
  currentTimeWindow,
  currentTimeAgg,
  timeDef,
  timeFieldValue,
}: Props) {
  const updateTime = useCallback(
    (patch: Partial<CalculationRow>) => updateItem(index, patch),
    [updateItem, index]
  );
  const [windowSizeDraft, setWindowSizeDraft] = useState(item.fnArg2 || '1');
  const [fiscalMonthDraft, setFiscalMonthDraft] = useState(String(item.fiscalStartMonth ?? 1));

  useEffect(() => {
    setWindowSizeDraft(item.fnArg2 || '1');
  }, [item.fnArg2]);

  useEffect(() => {
    setFiscalMonthDraft(String(item.fiscalStartMonth ?? 1));
  }, [item.fiscalStartMonth]);

  const timeDateOptions = fieldCompletions.filter((c) => isTemporalDataFieldType(columnTypes[c]));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
            {tr('calcFieldDateColumn', '时间字段')}
          </span>
          <GlassFieldSingleSelect
            value={timeFieldValue}
            options={timeDateOptions}
            columnTypes={columnTypes}
            onChange={(v) =>
              updateTime({ orderBy: v ? [{ field: v, direction: 'asc' }] : undefined })
            }
            placeholder={tr('calcFieldDatePlaceholder', '选择日期字段')}
            className="h-7 w-28 text-[12px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
            {tr('calcFieldTimeWindow', '时间窗口')}
          </span>
          <GlassOptionSingleSelect
            value={currentTimeWindow}
            groups={[
              {
                key: 'timeWindow',
                items: TIME_WINDOW_OPTIONS.map((o) => ({
                  value: o.value,
                  label: tr(o.key, o.label),
                })),
              },
            ]}
            onChange={(v) => {
              const fn = `${v}_${currentTimeAgg}`;
              const patch: Partial<CalculationRow> = { fn };
              if (TIME_WINDOW_DEFS[v]?.hasParam && !item.fnArg2) patch.fnArg2 = '1';
              updateTime(patch);
            }}
            className="h-7 text-[12px] w-28"
          />
          {timeDef?.hasParam && (
            <GlassFormTextInput
              inputMode="numeric"
              value={windowSizeDraft}
              onChange={(v) => {
                if (!/^\d*$/.test(v)) return;
                setWindowSizeDraft(v);
                const val = parseInt(v, 10);
                if (isNaN(val) || val < 1) return;
                updateTime({ fnArg2: String(val) });
              }}
              onBlur={() => setWindowSizeDraft(item.fnArg2 || '1')}
              textCenter
              className="h-7 w-14 rounded-md px-1 text-[12px]"
            />
          )}
          {!timeDef?.hasParam && currentTimeWindow === 'ytd' && (
            <>
              <span className="text-[12px] text-text-muted shrink-0 leading-7">
                {tr('calcFieldFiscalStart', '年度起始月')}
              </span>
              <GlassFormTextInput
                inputMode="numeric"
                value={fiscalMonthDraft}
                onChange={(v) => {
                  if (!/^\d*$/.test(v)) return;
                  setFiscalMonthDraft(v);
                  const val = parseInt(v, 10);
                  if (isNaN(val) || val < 1 || val > 12) return;
                  updateTime({ fiscalStartMonth: val });
                }}
                onBlur={() => setFiscalMonthDraft(String(item.fiscalStartMonth ?? 1))}
                textCenter
                className="h-7 w-14 rounded-md px-1 text-[12px]"
              />
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
            {tr('calcFieldTimeAgg', '聚合函数')}
          </span>
          <GlassOptionSingleSelect
            value={currentTimeAgg}
            groups={[
              {
                key: 'timeAgg',
                items: TIME_AGG_OPTIONS.map((o) => ({ value: o.value, label: tr(o.key, o.label) })),
              },
            ]}
            onChange={(v) => updateTime({ fn: `${currentTimeWindow}_${v}` })}
            className="h-7 text-[12px] w-28"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
            {tr('calcFieldFnArg', '参数字段')}
          </span>
          <div className="w-36">
            <GlassFieldSingleSelect
              value={item.fnArg ?? ''}
              options={fieldCompletions}
              columnTypes={columnTypes}
              onChange={(v) => updateTime({ fnArg: v } as Partial<CalculationRow>)}
              placeholder={tr('calcFieldFnArgPlaceholder', '选择字段')}
              className="h-7 w-full text-[12px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
