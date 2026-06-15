import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';

const TOGGLE_BTN = 'h-6 rounded px-2.5 text-[11px] font-medium transition-colors';
const INPUT_CLASS =
  'h-7 w-full rounded-md border border-border-muted bg-background/42 px-2 text-[12px] text-text-primary outline-none focus:border-accent';

export default function FormSetOp({
  node,
  otherNodes,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) => t(`formLabels.${key}`, { defaultValue: fallback }),
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

  const operation = (node.config.operation as string) ?? 'union';
  const rawRightInput = (node.config.rightInput as string) ?? '';
  const mode = (node.config.mode as string) ?? 'all';
  const match = (node.config.match as string) ?? 'by_name';

  // Resolve readable labels from node references
  const resolveNodeLabel = useCallback(
    (ref: { id: string; config?: Record<string, unknown> } | undefined): string => {
      if (!ref) return '';
      const full = otherNodes.find((n) => n.id === ref.id);
      if (full) return full.label || (full.config?.alias as string) || '';
      return (ref.config?.alias as string) || ref.id;
    },
    [otherNodes]
  );

  const leftSourceLabel = useMemo(
    () => resolveNodeLabel(sourceNode),
    [sourceNode, resolveNodeLabel]
  );

  const inputSourceNodes = otherNodes.filter((n) => n.type === 'input_source');

  // Resolve a raw rightInput value (UUID or alias) to a readable name
  const resolveRightName = useCallback(
    (raw: string): string => {
      if (!raw) return '';
      const matched = inputSourceNodes.find((n) => n.id === raw);
      return matched ? (matched.config?.alias as string) || matched.label : raw;
    },
    [inputSourceNodes]
  );

  // Build select value: include node-id suffix for unique option matching
  const selectValue = useMemo(() => {
    if (!rawRightInput) return '';
    // UUID match
    const byId = inputSourceNodes.find((n) => n.id === rawRightInput);
    if (byId) {
      const display = (byId.config?.alias as string) || byId.label;
      return `${display}$${byId.id}`;
    }
    // Alias match (already migrated from UUID)
    const byAlias = inputSourceNodes.find(
      (n) => ((n.config?.alias as string) || n.label) === rawRightInput
    );
    if (byAlias) {
      const display = (byAlias.config?.alias as string) || byAlias.label;
      return `${display}$${byAlias.id}`;
    }
    return rawRightInput;
  }, [rawRightInput, inputSourceNodes]);

  // Auto-correct UUID-stored rightInput to readable name on mount
  useEffect(() => {
    if (!rawRightInput) return;
    const name = resolveRightName(rawRightInput);
    if (name && name !== rawRightInput) {
      updateConfig((cfg) => ({ ...cfg, rightInput: name }));
    }
  }, [rawRightInput, resolveRightName, updateConfig]);

  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title={tr('setOpTitle', '集合操作')}>
        <div className="grid gap-2.5">
          {/* Operation type — inline toggle */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium text-text-secondary">
              {tr('setOpType', '操作类型')}
            </span>
            <div className="inline-flex rounded-md bg-surface-active/70 p-0.5">
              {(['union', 'intersect', 'except'] as const).map((op) => (
                <button
                  key={op}
                  type="button"
                  onClick={() => updateConfig((cfg) => ({ ...cfg, operation: op }))}
                  className={`${TOGGLE_BTN} ${
                    operation === op
                      ? 'bg-background/70 text-accent shadow-soft'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {op === 'union'
                    ? tr('setOpUnion', '并集')
                    : op === 'intersect'
                      ? tr('setOpIntersect', '交集')
                      : tr('setOpExcept', '差集')}
                </button>
              ))}
            </div>
          </div>

          {/* Left + Right sources — same row, two columns */}
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('leftInput', '左数据源')}
              </span>
              <div className="h-7 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 text-[12px] text-text-secondary">
                {leftSourceLabel || tr('noLeftSource', '上游节点')}
              </div>
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('setOpRightInput', '右侧输入源')}
              </span>
              <select
                value={selectValue}
                onChange={(e) => {
                  const val = e.target.value;
                  // Strip uniqueness suffix if present
                  const clean = val.includes('$') ? val.slice(0, val.lastIndexOf('$')) : val;
                  updateConfig((cfg) => ({ ...cfg, rightInput: clean || undefined }));
                }}
                className={INPUT_CLASS}
              >
                <option value="" disabled>
                  {tr('setOpSelectSource', '选择输入源')}
                </option>
                {inputSourceNodes.map((n) => {
                  const display = (n.config?.alias as string) || n.label;
                  // Append node id as suffix to guarantee uniqueness across
                  // sources with identical labels; stripped on save.
                  const selectValue = `${display}$${n.id}`;
                  return (
                    <option key={n.id} value={selectValue}>
                      {display}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
        </div>
      </GlassFormSection>

      {/* Advanced options — collapsible */}
      <div className="rounded-lg border border-border-muted/70 bg-background/18">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary transition-colors"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${showAdvanced ? '' : '-rotate-90'}`}
          />
          {tr('setOpOptions', '高级选项')}
        </button>
        {showAdvanced && (
          <div className="grid gap-2 border-t border-border-muted/50 px-3 pb-2.5 pt-2">
            {/* Dedup mode — inline toggle */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('setOpDedupMode', '去重模式')}
              </span>
              <div className="inline-flex rounded-md bg-surface-active/70 p-0.5">
                {(['all', 'distinct'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateConfig((cfg) => ({ ...cfg, mode: m }))}
                    className={`${TOGGLE_BTN} ${
                      mode === m
                        ? 'bg-background/70 text-accent shadow-soft'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {m === 'all' ? tr('setOpAll', '保留重复') : tr('setOpDistinct', '去重')}
                  </button>
                ))}
              </div>
            </div>

            {/* Match mode — only for union */}
            {operation === 'union' && (
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-medium text-text-secondary">
                  {tr('setOpMatchMode', '匹配方式')}
                </span>
                <div className="inline-flex rounded-md bg-surface-active/70 p-0.5">
                  {(['by_name', 'by_position'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateConfig((cfg) => ({ ...cfg, match: m }))}
                      className={`${TOGGLE_BTN} ${
                        match === m
                          ? 'bg-background/70 text-accent shadow-soft'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                    >
                      {m === 'by_name'
                        ? tr('setOpByName', '按名称')
                        : tr('setOpByPosition', '按位置')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
