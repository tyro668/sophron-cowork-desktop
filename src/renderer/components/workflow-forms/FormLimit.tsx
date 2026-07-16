import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X, ChevronDown } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassTagBar } from './shared/GlassTagBar';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';

interface SortKeyEntry {
  field: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

const LABEL_CLASS = 'text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7';

const TAG_CONTAINER =
  'flex min-h-7 items-center rounded-md border border-border-muted bg-background/42 focus-within:border-accent';

export default function FormLimit({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const updateConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  const mode = (node.config.mode as string) ?? 'fixed';
  const limit = Number(node.config.limit ?? 100);
  const unit = (node.config.unit as string) ?? 'rows';
  const offset = Number(node.config.offset ?? 0);
  const orderBy: SortKeyEntry[] = (node.config.orderBy as SortKeyEntry[]) ?? [];
  const ties = !!node.config.ties;
  const rawGroupBy = node.config.groupBy;
  const groupBy: string[] = Array.isArray(rawGroupBy) ? rawGroupBy : [];
  const method = (node.config.method as string) ?? 'system';
  const seed = node.config.seed as number | undefined;

  const configRef = useRef(node.config);
  const [localLimit, setLocalLimit] = useState(String(limit));
  const [localOffset, setLocalOffset] = useState(String(offset));
  const [localSeed, setLocalSeed] = useState(seed != null ? String(seed) : '');
  const [groupOpen, setGroupOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  if (configRef.current !== node.config) {
    configRef.current = node.config;
    if (String(limit) !== localLimit) setLocalLimit(String(limit));
    if (String(offset) !== localOffset) setLocalOffset(String(offset));
  }

  const [errors, setErrors] = useState<string[]>([]);

  function pushLimit(value: string) {
    setLocalLimit(value);
    if (value === '') return;
    const n = Math.max(0, Math.floor(Number(value) || 0));
    const clamped = String(n);
    if (clamped !== value) setLocalLimit(clamped);
    setErrors(runValidation(n, unit));
    updateConfig((cfg) => ({ ...cfg, limit: n > 0 ? n : 0 }));
  }

  function pushOffset(value: string) {
    setLocalOffset(value);
    if (value === '') return;
    const n = Math.max(0, Number(value) || 0);
    const clamped = String(n);
    if (clamped !== value) setLocalOffset(clamped);
    setErrors(runValidation(limit, unit));
    updateConfig((cfg) => ({ ...cfg, offset: n > 0 ? n : undefined }));
  }

  function pushSeed(value: string) {
    setLocalSeed(value);
    if (value === '') {
      updateConfig((cfg) => ({ ...cfg, seed: undefined }));
      return;
    }
    const n = Math.max(0, Math.floor(Number(value) || 0));
    updateConfig((cfg) => ({ ...cfg, seed: n }));
  }

  function runValidation(limitVal: number, unitVal: string): string[] {
    const errs: string[] = [];
    if (unitVal === 'percent' && limitVal > 100)
      errs.push(tr('limitPercentError', '百分比不能超过 100'));
    return errs;
  }

  const isFixedMode = mode === 'fixed';
  const isRandomMode = mode === 'random';
  const isRows = unit === 'rows';
  const hasSort = orderBy.length > 0;
  const isGrouped = Array.isArray(rawGroupBy);

  const sortFields = orderBy.map((k) => k.field);

  function toggleSortDirection(field: string) {
    updateConfig((cfg) => ({
      ...cfg,
      orderBy: (cfg.orderBy as SortKeyEntry[])?.map((k) =>
        k.field === field ? { ...k, direction: k.direction === 'asc' ? 'desc' : 'asc' } : k
      ),
    }));
  }

  function removeSortField(field: string) {
    updateConfig((cfg) => {
      const next = (cfg.orderBy as SortKeyEntry[])?.filter((k) => k.field !== field);
      return { ...cfg, orderBy: next && next.length > 0 ? next : undefined };
    });
  }

  function setSortFields(next: string[]) {
    updateConfig((cfg) => {
      const prev = (cfg.orderBy as SortKeyEntry[]) ?? [];
      const mapped = next.map((f) => {
        const existing = prev.find((k) => k.field === f);
        return existing ?? { field: f, direction: 'asc' as const };
      });
      return { ...cfg, orderBy: mapped.length > 0 ? mapped : undefined };
    });
  }

  return (
    <div className="flex flex-col gap-3 h-full min-h-0 overflow-y-auto p-4">
      {/* 模式 */}
      <div className="flex items-center gap-2">
        <span className={LABEL_CLASS}>{tr('limitMode', '模式')}</span>
        <GlassOperatorSelect
          value={mode}
          groups={[
            {
              key: 'mode',
              items: [
                { value: 'fixed', label: tr('limitFixedMode', '限制取样') },
                { value: 'random', label: tr('limitRandomMode', '随机采样') },
              ],
            },
          ]}
          onChange={(v) => {
            if (v === 'fixed') {
              updateConfig((cfg) => ({
                ...cfg,
                mode: 'fixed',
                method: undefined,
                seed: undefined,
              }));
            } else {
              updateConfig((cfg) => ({
                ...cfg,
                mode: 'random',
                ties: undefined,
                groupBy: undefined,
                orderBy: undefined,
              }));
            }
          }}
          className="h-7 text-[12px] w-28"
        />
      </div>

      {/* 数量 + 单位 + 偏移量/种子 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={LABEL_CLASS}>
            {isRandomMode ? tr('limitSampleSize', '采样量') : tr('limitCount', '数量')}
          </span>
          <GlassFormTextInput
            inputMode="numeric"
            value={localLimit}
            onChange={(v) => pushLimit(v)}
            placeholder={isRandomMode ? '10' : '100'}
            textCenter
            className="h-7 rounded-md px-2 text-[12px] w-28"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className={LABEL_CLASS}>{tr('limitUnit', '单位')}</span>
          <GlassOperatorSelect
            value={unit}
            groups={[
              {
                key: 'unit',
                items: [
                  { value: 'rows', label: tr('limitUnitRows', '行数') },
                  { value: 'percent', label: tr('limitUnitPercent', '百分比') },
                ],
              },
            ]}
            onChange={(value) => {
              updateConfig((cfg) => ({ ...cfg, unit: value }));
              setErrors(runValidation(limit, value));
            }}
            className="h-7 text-[12px] w-28"
          />
        </div>
        {isRandomMode ? (
          <div className="flex items-center gap-2">
            <span className={LABEL_CLASS}>{tr('limitSampleSeed', '随机种子')}</span>
            <GlassFormTextInput
              inputMode="numeric"
              value={localSeed}
              onChange={(v) => pushSeed(v)}
              placeholder={tr('limitSampleSeedPlaceholder', '可选')}
              textCenter
              className="h-7 rounded-md px-2 text-[12px] w-28"
            />
          </div>
        ) : isRows ? (
          <div className="flex items-center gap-2">
            <span className={LABEL_CLASS}>{tr('limitOffset', '偏移量')}</span>
            <GlassFormTextInput
              inputMode="numeric"
              value={localOffset}
              onChange={(v) => pushOffset(v)}
              placeholder="0"
              textCenter
              className="h-7 rounded-md px-2 text-[12px] w-28"
            />
          </div>
        ) : null}
      </div>

      {/* 采样方式（仅随机采样） */}
      {isRandomMode && (
        <div className="flex items-center gap-2">
          <span className={LABEL_CLASS}>{tr('limitSampleMethod', '采样方式')}</span>
          <GlassOperatorSelect
            value={method}
            groups={[
              {
                key: 'method',
                items: [
                  { value: 'system', label: tr('limitSampleSystem', '按块抽样') },
                  { value: 'bernoulli', label: tr('limitSampleBernoulli', '逐行随机') },
                ],
              },
            ]}
            onChange={(value) => updateConfig((cfg) => ({ ...cfg, method: value }))}
            className="h-7 text-[12px] w-28"
          />
        </div>
      )}

      {errors.map((err) => (
        <div key={err} className="text-[11px] text-warning">
          {err}
        </div>
      ))}

      {/* 限制取样：分组 + 排序 + TIES */}
      {isFixedMode && (
        <>
          {/* 分组范围 + 分组字段 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={LABEL_CLASS}>{tr('limitGroupRange', '分组范围')}</span>
              <GlassOperatorSelect
                value={isGrouped ? 'group' : 'none'}
                groups={[
                  {
                    key: 'groupMode',
                    items: [
                      { value: 'none', label: tr('limitGroupNone', '不分组') },
                      { value: 'group', label: tr('limitGroupEnabled', '分组') },
                    ],
                  },
                ]}
                onChange={(v) => {
                  if (v === 'none') {
                    updateConfig((cfg) => ({ ...cfg, groupBy: undefined }));
                  } else {
                    updateConfig((cfg) => ({ ...cfg, groupBy: [] }));
                    setGroupOpen(true);
                  }
                }}
                className="h-7 text-[12px] w-28"
              />
            </div>
            {isGrouped && (
              <div className="flex items-center gap-2">
                <span className={LABEL_CLASS}>{tr('limitGroupBy', '分组字段')}</span>
                <div className="w-72 min-w-0 relative">
                  <GlassTagBar
                    items={groupBy}
                    onRemove={(col) =>
                      updateConfig((cfg) => ({
                        ...cfg,
                        groupBy: groupBy.filter((c) => c !== col),
                      }))
                    }
                    onClear={() => updateConfig((cfg) => ({ ...cfg, groupBy: [] }))}
                    open={groupOpen}
                    onToggle={() => setGroupOpen((o) => !o)}
                    toggleStyle="chevron"
                    density="compact"
                    className="min-h-7"
                    placeholder={tr('limitGroupByPlaceholder', '选择分组字段')}
                  />
                  {groupOpen && (
                    <div className="absolute z-10 left-0 right-0 mt-0.5">
                      <GlassFieldMultiSelect
                        columns={fieldCompletions}
                        selected={groupBy}
                        onChange={(v) =>
                          updateConfig((cfg) => ({ ...cfg, groupBy: v.length > 0 ? v : undefined }))
                        }
                        maxHeight="160px"
                        variant="glass"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 排序字段 */}
          <div className="flex items-center gap-2">
            <span className={LABEL_CLASS}>{tr('limitSortHeader', '排序字段')}</span>
            <div className="w-72 min-w-0 relative">
              <div className={TAG_CONTAINER}>
                {sortFields.length > 0 && (
                  <button
                    type="button"
                    onClick={() => updateConfig((cfg) => ({ ...cfg, orderBy: undefined }))}
                    className="ml-1 inline-flex flex-shrink-0 items-center justify-center self-stretch rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                    title={tr('clearAll', '清空')}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                <div className="flex flex-1 items-center gap-1 px-1.5 min-w-0 overflow-x-auto">
                  {orderBy.map((k) => (
                    <span
                      key={k.field}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1 py-0.5 text-[12px] font-medium text-accent"
                    >
                      {k.field}
                      <button
                        type="button"
                        onClick={() => toggleSortDirection(k.field)}
                        className="text-[11px] leading-none px-0.5 hover:text-text-primary rounded"
                        title={k.direction === 'asc' ? tr('asc', '升序') : tr('desc', '降序')}
                      >
                        {k.direction === 'asc' ? '↑' : '↓'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSortField(k.field)}
                        className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  <input
                    key="sort-input"
                    type="text"
                    readOnly
                    placeholder={
                      !sortFields.length ? tr('limitSortPlaceholder', '选择排序字段') : ''
                    }
                    onFocus={() => setSortOpen(true)}
                    onBlur={() => setTimeout(() => setSortOpen(false), 150)}
                    className="h-5 min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted cursor-pointer"
                  />
                </div>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setSortOpen((o) => !o)}
                  className="flex w-7 flex-shrink-0 items-center justify-center self-stretch border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${sortOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>
              {sortOpen && (
                <div className="absolute z-10 left-0 right-0 mt-0.5">
                  <GlassFieldMultiSelect
                    columns={fieldCompletions}
                    selected={sortFields}
                    onChange={(v) => setSortFields(v)}
                    maxHeight="160px"
                    variant="glass"
                  />
                </div>
              )}
            </div>
            {hasSort && (
              <label className="flex items-center gap-1.5 text-[12px] cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={ties}
                  onChange={(e) =>
                    updateConfig((cfg) => ({ ...cfg, ties: e.target.checked || undefined }))
                  }
                  className="h-4 w-4 rounded border-border-muted accent-accent"
                />
                {tr('limitTies', '保留并列值（WITH TIES）')}
              </label>
            )}
          </div>
        </>
      )}
    </div>
  );
}
