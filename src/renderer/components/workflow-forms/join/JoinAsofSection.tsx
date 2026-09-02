import { useMemo } from 'react';
import { GlassFormTextInput } from '../shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from '../shared/GlassFieldSingleSelect';
import { GlassFormLabel } from '../shared/GlassFormLabel';
import { GlassOptionSingleSelect } from '../shared/GlassOptionSingleSelect';
import { GlassRowList } from '../shared/GlassRowList';
import { canAppendRow } from '../shared/rowListOperations';
import { isTemporalDataFieldType } from '@/shared/data-field-types';
import { parseDuration } from '@/shared/operator-schemas/join';
import { MAX_JOIN_CONDITION_COUNT, type DurationParts } from '@/shared/operator-schemas';
import {
  qualifyJoinField,
  updateJoinDurationPart,
  type JoinAsofUi,
} from '@/shared/operator-config';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import {
  DEFAULT_CONDITION,
  insertCondition,
  removeCondition,
  type ConditionEntry,
} from './conditionRows';

/** Fields writable through the single asof patch callback. */
export interface JoinAsofPatch {
  leftTime?: string;
  rightTime?: string;
  operator?: string;
  tolerance?: string;
  by?: ConditionEntry[] | undefined;
}

export interface JoinAsofSectionProps {
  asof: JoinAsofUi;
  leftFields: string[];
  rightFields: string[];
  leftColumnTypes: Record<string, string>;
  rightColumnTypes: Record<string, string>;
  leftAlias: string;
  rightAlias: string;
  onAsofChange: (patch: JoinAsofPatch) => void;
}

export function JoinAsofSection({
  asof,
  leftFields,
  rightFields,
  leftColumnTypes,
  rightColumnTypes,
  leftAlias,
  rightAlias,
  onAsofChange,
}: JoinAsofSectionProps) {
  const tr = useFormTranslation('join');

  const displayedAsofBy = useMemo(
    () => (asof.by.length > 0 ? asof.by : [DEFAULT_CONDITION]),
    [asof.by]
  );

  const durationParts = useMemo(() => parseDuration(asof.tolerance), [asof.tolerance]);

  function handleDurationChange(part: keyof DurationParts, val: number) {
    onAsofChange({ tolerance: updateJoinDurationPart(asof.tolerance, part, val) });
  }

  function handleAsofByChange(next: ConditionEntry[]) {
    onAsofChange({ by: next.length > 0 ? next : undefined });
  }

  function handleAsofByAdd(index: number) {
    if (!canAppendRow(displayedAsofBy.length, MAX_JOIN_CONDITION_COUNT)) return;
    handleAsofByChange(insertCondition(displayedAsofBy, index));
  }

  function handleAsofByRemove(index: number) {
    handleAsofByChange(removeCondition(displayedAsofBy, index));
  }

  const leftColumnTypesQualified = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, type] of Object.entries(leftColumnTypes)) {
      map[qualifyJoinField(leftAlias, name)] = type;
    }
    return map;
  }, [leftColumnTypes, leftAlias]);
  const rightColumnTypesQualified = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, type] of Object.entries(rightColumnTypes)) {
      map[qualifyJoinField(rightAlias, name)] = type;
    }
    return map;
  }, [rightColumnTypes, rightAlias]);

  const hasLeftTypes = Object.keys(leftColumnTypes).length > 0;
  const hasRightTypes = Object.keys(rightColumnTypes).length > 0;
  const asofLeftTimeOptions = useMemo(() => {
    const filtered = hasLeftTypes
      ? leftFields.filter((c) => isTemporalDataFieldType(leftColumnTypes[c]))
      : leftFields;
    return filtered.map((field) => qualifyJoinField(leftAlias, field));
  }, [leftFields, leftColumnTypes, hasLeftTypes, leftAlias]);
  const asofRightTimeOptions = useMemo(() => {
    const filtered = hasRightTypes
      ? rightFields.filter((field) => isTemporalDataFieldType(rightColumnTypes[field]))
      : rightFields;
    return filtered.map((field) => qualifyJoinField(rightAlias, field));
  }, [hasRightTypes, rightAlias, rightColumnTypes, rightFields]);

  const leftFieldCompletions = useMemo(
    () => leftFields.map((field) => qualifyJoinField(leftAlias, field)),
    [leftFields, leftAlias]
  );
  const rightFieldCompletions = useMemo(
    () => rightFields.map((field) => qualifyJoinField(rightAlias, field)),
    [rightFields, rightAlias]
  );

  return (
    <div className="grid gap-1.5">
      {/* ASOF time settings card: the time trio and tolerance form their
          own group; only the by rows below use the condition grid. */}
      <div className="grid gap-2.5 rounded-lg border border-border-muted bg-background px-3 py-2.5">
        <div className="flex items-center gap-1">
          <div className="flex min-w-0 flex-[1] items-center">
            <div className="flex w-full">
              <GlassFieldSingleSelect
                value={asof.leftTime}
                options={asofLeftTimeOptions}
                columnTypes={leftColumnTypesQualified}
                onChange={(v) => onAsofChange({ leftTime: v || undefined })}
                placeholder={tr('leftTimeCol')}
                className="h-7 w-full min-w-0 text-[12px]"
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-[0.6] items-center">
            <div className="flex w-full">
              <GlassOptionSingleSelect
                value={asof.operator}
                groups={[
                  {
                    key: 'op',
                    items: [
                      { value: '>=', label: tr('asofOpBackward') },
                      { value: '<=', label: tr('asofOpForward') },
                      { value: 'nearest', label: tr('asofOpNearest') },
                    ],
                  },
                ]}
                onChange={(v) => onAsofChange({ operator: v })}
                variant="highlight"
                className="h-7 w-full text-[12px] [&>span]:text-center"
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-[1] items-center">
            <div className="flex w-full">
              <GlassFieldSingleSelect
                value={asof.rightTime}
                options={asofRightTimeOptions}
                columnTypes={rightColumnTypesQualified}
                onChange={(v) => onAsofChange({ rightTime: v || undefined })}
                placeholder={tr('rightTimeCol')}
                className="h-7 w-full min-w-0 text-[12px]"
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <GlassFormLabel className="!h-7">{tr('tolerance')}</GlassFormLabel>
          {(
            [
              { key: 'd', label: tr('toleranceDay'), max: 365 },
              { key: 'h', label: tr('toleranceHour'), max: 23 },
              { key: 'm', label: tr('toleranceMin'), max: 59 },
              { key: 's', label: tr('toleranceSec'), max: 59 },
              { key: 'ms', label: tr('toleranceMs'), max: 999 },
            ] as const
          ).map(({ key, label, max }) => (
            <div key={key} className="flex items-center gap-1">
              <GlassFormTextInput
                type="number"
                min={0}
                max={max}
                value={asof.tolerance ? String(durationParts[key]) : ''}
                placeholder="0"
                onChange={(value) => {
                  const parsed = parseInt(value, 10);
                  handleDurationChange(key, Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
                }}
                textCenter
                className="h-7 w-[46px] !px-1.5 text-[12px]"
              />
              <span className="w-[28px] text-[12px] text-text-muted">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="px-0.5 text-[12px] text-text-muted">{tr('joinAsofByHeader')}</div>
      <div className="scrollbar-hover min-w-0 max-h-[180px] overflow-x-hidden overflow-y-auto">
        <GlassRowList
          items={displayedAsofBy}
          columns={[
            {
              flex: 'flex-[1]',
              header: '',
              render: (cond: ConditionEntry, i: number) => (
                <GlassFieldSingleSelect
                  value={cond.left}
                  options={leftFieldCompletions}
                  columnTypes={leftColumnTypesQualified}
                  onChange={(v) =>
                    handleAsofByChange(
                      displayedAsofBy.map((c, j) => (j === i ? { ...c, left: v } : c))
                    )
                  }
                  placeholder={tr('leftField')}
                  className="h-7 w-full text-[12px]"
                />
              ),
            },
            {
              flex: 'flex-[0.6]',
              header: '',
              render: () => (
                <span className="w-full text-center text-[12px] text-text-secondary">
                  {tr('operatorEq')}
                </span>
              ),
            },
            {
              flex: 'flex-[1]',
              header: '',
              render: (cond: ConditionEntry, i: number) => (
                <GlassFieldSingleSelect
                  value={cond.right}
                  options={rightFieldCompletions}
                  columnTypes={rightColumnTypesQualified}
                  onChange={(v) =>
                    handleAsofByChange(
                      displayedAsofBy.map((c, j) => (j === i ? { ...c, right: v } : c))
                    )
                  }
                  placeholder={tr('rightField')}
                  className="h-7 w-full text-[12px]"
                />
              ),
            },
          ]}
          onAdd={handleAsofByAdd}
          onRemove={handleAsofByRemove}
          addTitle={tr('addCondition')}
          canAct={(action) =>
            action !== 'add' || canAppendRow(displayedAsofBy.length, MAX_JOIN_CONDITION_COUNT)
          }
          hideHeader
        />
      </div>
    </div>
  );
}
