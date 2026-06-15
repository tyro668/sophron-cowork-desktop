import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';

const TOGGLE_BTN = 'h-6 rounded px-2.5 text-[11px] font-medium transition-colors';
const INPUT_CLASS =
  'h-7 w-full rounded-md border border-border-muted bg-background/42 px-2 text-[12px] text-text-primary outline-none focus:border-accent';

export default function FormUnnest({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
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

  const sourceKind = (node.config.sourceKind as string) ?? 'list';
  const column = String(node.config.column ?? '');
  const alias = String(node.config.alias ?? '');
  const path = String(node.config.path ?? '');
  const withIndex = String(node.config.withIndex ?? '');
  const keepParentNames = Boolean(node.config.keepParentNames ?? false);

  // recursiveDepth: 0=不递归, -1=无限制递归, N=递归指定深度
  const recursive = Boolean(node.config.recursive ?? false);
  const depth =
    recursive && typeof node.config.maxDepth === 'number'
      ? Number(node.config.maxDepth)
      : recursive
        ? -1
        : 0;
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title={tr('unnestSettings', '展开设置')}>
        <div className="grid gap-2.5">
          {/* Source type — inline toggle */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium text-text-secondary">
              {tr('unnestSourceType', '源类型')}
            </span>
            <div className="inline-flex rounded-md bg-surface-active/70 p-0.5">
              {(['list', 'json'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => updateConfig((cfg) => ({ ...cfg, sourceKind: s }))}
                  className={`${TOGGLE_BTN} ${
                    sourceKind === s
                      ? 'bg-background/70 text-accent shadow-soft'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {s === 'list' ? 'List' : 'JSON'}
                </button>
              ))}
            </div>
          </div>

          {/* Source field + Alias — two columns */}
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('unnestSourceField', '源字段')}
              </span>
              <select
                value={column}
                onChange={(e) =>
                  updateConfig((cfg) => ({ ...cfg, column: e.target.value || undefined }))
                }
                className={INPUT_CLASS}
              >
                <option value="" disabled>
                  {tr('aggregateSelectField', '选择字段')}
                </option>
                {fieldCompletions.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('unnestAlias', '展开后的别名')}
              </span>
              <input
                type="text"
                value={alias}
                onChange={(e) =>
                  updateConfig((cfg) => ({ ...cfg, alias: e.target.value || undefined }))
                }
                placeholder={tr('unnestAliasPlaceholder', '如 item')}
                className={INPUT_CLASS}
              />
            </label>
          </div>

          {/* JSON path — only when sourceKind === 'json' */}
          {sourceKind === 'json' && (
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('unnestJsonPath', 'JSON 路径')}
              </span>
              <input
                type="text"
                value={path}
                onChange={(e) =>
                  updateConfig((cfg) => ({ ...cfg, path: e.target.value || undefined }))
                }
                placeholder={tr('unnestJsonPathPlaceholder', '如 $.items')}
                className={INPUT_CLASS}
              />
            </label>
          )}
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
          {tr('unnestOptions', '高级选项')}
        </button>
        {showAdvanced && (
          <div className="grid gap-2 border-t border-border-muted/50 px-3 pb-2.5 pt-2">
            {/* 索引列 checkbox + input */}
            <div className="flex items-center gap-2">
              <label className="flex w-[5.5rem] shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={!!withIndex}
                  onChange={(e) =>
                    updateConfig((cfg) => ({
                      ...cfg,
                      withIndex: e.target.checked ? cfg.withIndex || 'index' : undefined,
                    }))
                  }
                  className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                />
                {tr('unnestIndexCol', '索引列')}
              </label>
              <input
                type="text"
                value={withIndex}
                disabled={!withIndex}
                onChange={(e) =>
                  updateConfig((cfg) => ({ ...cfg, withIndex: e.target.value || undefined }))
                }
                placeholder={tr('unnestIndexColPlaceholder', '如 item_index')}
                className={`${INPUT_CLASS} flex-1 disabled:cursor-not-allowed disabled:opacity-40`}
              />
            </div>

            {/* 递归展开 checkbox + depth input */}
            <div className="flex items-center gap-2">
              <label className="flex w-[5.5rem] shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={recursive}
                  onChange={(e) =>
                    updateConfig((cfg) => ({
                      ...cfg,
                      recursive: e.target.checked ? true : undefined,
                      maxDepth: e.target.checked ? cfg.maxDepth : undefined,
                    }))
                  }
                  className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                />
                {tr('unnestRecursive', '递归展开')}
              </label>
              <input
                type="text"
                inputMode="numeric"
                disabled={!recursive}
                value={depth === -1 ? '' : depth}
                onChange={(e) => {
                  const v = e.target.value;
                  const n = v === '' ? -1 : Number(v);
                  if (Number.isNaN(n)) return;
                  if (n <= 0) {
                    updateConfig((cfg) => ({ ...cfg, recursive: true, maxDepth: undefined }));
                  } else {
                    updateConfig((cfg) => ({ ...cfg, recursive: true, maxDepth: n }));
                  }
                }}
                placeholder={tr('unnestMaxDepthPlaceholder', '不限制深度')}
                className={`${INPUT_CLASS} flex-1 disabled:cursor-not-allowed disabled:opacity-40`}
              />
            </div>

            {/* 保留父字段名 — JSON only */}
            {sourceKind === 'json' && (
              <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={keepParentNames}
                  onChange={(e) =>
                    updateConfig((cfg) => ({
                      ...cfg,
                      keepParentNames: e.target.checked || undefined,
                    }))
                  }
                  className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                />
                {tr('unnestKeepParent', '保留父字段名')}
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
