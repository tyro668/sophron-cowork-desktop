import { useCallback } from 'react';
import { GlassOptionSingleSelect } from '../shared/GlassOptionSingleSelect';
import { GlassFormTextInput } from '../shared/GlassFormTextInput';
import { isTemporalDataFieldType } from '@/shared/data-field-types';
import type { CalculationRow } from '../shared/calculate-field';
import {
  FRAME_TYPE_OPTIONS,
  FRAME_PRESETS,
  EXCLUDE_OPTIONS,
  INTERVAL_UNIT_OPTIONS,
  parseBound,
  formatBoundFromType,
  parseIntervalUnit,
  frameTypeUnitLabel,
  getBoundOptions,
} from './index';

interface Props {
  item: CalculationRow;
  index: number;
  updateItem: (index: number, patch: Partial<CalculationRow>) => void;
  tr: (key: string, fallback: string) => string;
  columnTypes: Record<string, string>;
}

export function GlassWindowFrameConfig({ item, index, updateItem, tr, columnTypes }: Props) {
  const currentFt = item.frameType || 'rows';
  const currentKey = `${item.frameStart ?? 'unbounded preceding'}|${item.frameEnd ?? 'unbounded following'}`;
  const isCustom = !FRAME_PRESETS.filter((p) => p.value !== 'custom').some(
    (p) => p.value === currentKey
  );
  const startInfo = parseBound(item.frameStart);
  const endInfo = parseBound(item.frameEnd);
  const unitLabel = frameTypeUnitLabel(currentFt, tr);
  const boundOptions = getBoundOptions(currentFt, tr);
  const orderByCol = item.orderBy?.[0]?.field;
  const isRangeDate =
    currentFt === 'range' && !!orderByCol && isTemporalDataFieldType(columnTypes[orderByCol]);
  const startIntervalUnit = parseIntervalUnit(item.frameStart);
  const endIntervalUnit = parseIntervalUnit(item.frameEnd);
  const effectiveStartUnit = startIntervalUnit || 'day';
  const effectiveEndUnit = endIntervalUnit || 'day';

  const updateFrame = useCallback(
    (patch: Partial<CalculationRow>) => updateItem(index, patch),
    [updateItem, index]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
          {tr('calcFieldFrameType', '窗口类型')}
        </span>
        <GlassOptionSingleSelect
          value={item.frameType || 'rows'}
          groups={[
            {
              key: 'frameTypes',
              items: FRAME_TYPE_OPTIONS.map((opt) => ({
                value: opt.value,
                label: tr(opt.key, opt.label),
              })),
            },
          ]}
          onChange={(v) => {
            const prevFt = item.frameType || 'rows';
            if (v === prevFt) return;
            const key = `${item.frameStart ?? 'unbounded preceding'}|${item.frameEnd ?? 'unbounded following'}`;
            const existsInNew = FRAME_PRESETS.some((p) => p.value !== 'custom' && p.value === key);
            updateFrame({
              frameType: v as 'rows' | 'range' | 'groups',
              ...(existsInNew
                ? {}
                : { frameStart: 'unbounded preceding', frameEnd: 'unbounded following' }),
            });
          }}
          className="h-7 text-[12px] w-28"
        />
        <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
          {tr('calcFieldFrame', '窗口范围')}
        </span>
        <GlassOptionSingleSelect
          value={isCustom ? 'custom' : currentKey}
          groups={[
            {
              key: 'frame',
              items: FRAME_PRESETS.map((p) => ({ value: p.value, label: tr(p.key, p.label) })),
            },
          ]}
          onChange={(v) => {
            if (v === 'custom') {
              updateFrame({ frameStart: '1 preceding', frameEnd: 'current row' });
              return;
            }
            const [frameStart, frameEnd] = v.split('|');
            updateFrame({ frameStart, frameEnd });
          }}
          className="h-7 text-[12px] text-center w-28"
        />
        {item.frameStart && item.orderBy?.length && (
          <>
            <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
              {tr('calcFieldFrameExclude', '排除方式')}
            </span>
            <GlassOptionSingleSelect
              value={item.frameExclude || 'no others'}
              groups={[
                {
                  key: 'exclude',
                  items: EXCLUDE_OPTIONS.map((o) => ({
                    value: o.value,
                    label: tr(o.key, o.label),
                  })),
                },
              ]}
              onChange={(v) => updateFrame({ frameExclude: v as CalculationRow['frameExclude'] })}
              className="h-7 text-[12px] w-36"
            />
          </>
        )}
      </div>

      {isCustom && (
        <div className="flex items-center gap-2 text-[12px] text-text-muted flex-wrap">
          <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
            {tr('calcFieldFrameConfig', '窗口配置')}
          </span>
          <div className="flex items-center gap-1">
            <span className="shrink-0">{tr('calcFieldBoundStart', '起始')}</span>
            <GlassOptionSingleSelect
              value={startInfo.type}
              groups={[{ key: 'bound', items: boundOptions }]}
              onChange={(v) => {
                const unit = isRangeDate ? effectiveStartUnit : undefined;
                updateFrame({
                  frameStart: formatBoundFromType(v, startInfo.value, currentFt, unit),
                });
              }}
              className="h-7 text-[12px] w-24"
            />
            {(startInfo.type === 'n_preceding' || startInfo.type === 'n_following') && (
              <>
                <GlassFormTextInput
                  inputMode="numeric"
                  value={String(startInfo.value ?? 1)}
                  onChange={(v) => {
                    const val = parseInt(v, 10);
                    if (isNaN(val) || val < 0) return;
                    const unit = isRangeDate ? effectiveStartUnit : undefined;
                    updateFrame({
                      frameStart: formatBoundFromType(startInfo.type, val, currentFt, unit),
                    });
                  }}
                  textCenter
                  className="h-6 w-14 rounded-md px-1 text-[12px]"
                />
                {isRangeDate ? (
                  <GlassOptionSingleSelect
                    value={effectiveStartUnit}
                    groups={[{ key: 'interval', items: INTERVAL_UNIT_OPTIONS }]}
                    onChange={(v) => {
                      updateFrame({
                        frameStart: formatBoundFromType(
                          startInfo.type,
                          startInfo.value ?? 1,
                          currentFt,
                          v
                        ),
                      });
                    }}
                    className="h-7 text-[12px] w-16"
                  />
                ) : (
                  <span className="shrink-0 w-6">{unitLabel}</span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="shrink-0">{tr('calcFieldBoundEnd', '结束')}</span>
            <GlassOptionSingleSelect
              value={endInfo.type}
              groups={[{ key: 'bound', items: boundOptions }]}
              onChange={(v) => {
                const unit = isRangeDate ? effectiveEndUnit : undefined;
                updateFrame({ frameEnd: formatBoundFromType(v, endInfo.value, currentFt, unit) });
              }}
              className="h-7 text-[12px] w-24"
            />
            {(endInfo.type === 'n_preceding' || endInfo.type === 'n_following') && (
              <>
                <GlassFormTextInput
                  inputMode="numeric"
                  value={String(endInfo.value ?? 1)}
                  onChange={(v) => {
                    const val = parseInt(v, 10);
                    if (isNaN(val) || val < 0) return;
                    const unit = isRangeDate ? effectiveEndUnit : undefined;
                    updateFrame({
                      frameEnd: formatBoundFromType(endInfo.type, val, currentFt, unit),
                    });
                  }}
                  textCenter
                  className="h-6 w-14 rounded-md px-1 text-[12px]"
                />
                {isRangeDate ? (
                  <GlassOptionSingleSelect
                    value={effectiveEndUnit}
                    groups={[{ key: 'interval', items: INTERVAL_UNIT_OPTIONS }]}
                    onChange={(v) => {
                      updateFrame({
                        frameEnd: formatBoundFromType(
                          endInfo.type,
                          endInfo.value ?? 1,
                          currentFt,
                          v
                        ),
                      });
                    }}
                    className="h-7 text-[12px] w-16"
                  />
                ) : (
                  <span className="shrink-0 w-6">{unitLabel}</span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
