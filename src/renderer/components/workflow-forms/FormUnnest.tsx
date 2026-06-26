import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassRadioSelect } from './shared/GlassRadioSelect';

export default function FormUnnest({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
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

  const sourceKind = (node.config.sourceKind as string) ?? 'list';
  const column = String(node.config.column ?? '');
  const alias = String(node.config.alias ?? '');
  const path = String(node.config.path ?? '');
  const withIndex = String(node.config.withIndex ?? '');
  const keepParentNames = Boolean(node.config.keepParentNames ?? false);
  const recursive = Boolean(node.config.recursive ?? false);
  const depth = (() => {
    if (!recursive) return 0;
    if (typeof node.config.maxDepth === 'number') return Number(node.config.maxDepth);
    return -1; // unlimited
  })();

  return (
    <div className="grid content-start gap-2.5">
      {/* Three column boxes */}
      <div className="flex items-stretch gap-0">
        {/* ═══ 数据来源 ═══ */}
        <div className="flex-[2] rounded-lg border border-border-muted bg-background/42 grid content-start">
          <div className="px-3 py-1.5 text-[11px] font-medium text-text-muted">
            {tr('unnestSourceHeader', '数据来源')}
          </div>
          <div className="border-t border-border-muted" />
          <div className="p-3 grid gap-2.5">
            <label className="grid gap-1">
              <GlassFormLabel>{tr('unnestSourceField', '源字段')}</GlassFormLabel>
              <GlassFieldCombo
                value={column}
                options={fieldCompletions}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, column: v || undefined }))}
                placeholder={tr('unnestSelectField', '选择字段')}
                className="w-full"
              />
            </label>

            <GlassRadioSelect
              value={sourceKind}
              options={[
                { value: 'list', label: 'List' },
                { value: 'json', label: 'JSON' },
              ]}
              onChange={(v) => updateConfig((cfg) => ({ ...cfg, sourceKind: v }))}
              label={tr('unnestSourceType', '源类型')}
            />
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center justify-center px-3">
          <ArrowRight className="h-5 w-5 text-text-muted" />
        </div>

        {/* ═══ 展开规则 ═══ */}
        <div className="flex-[4] rounded-lg border border-border-muted bg-background/42 grid content-start">
          <div className="px-3 py-1.5 text-[11px] font-medium text-text-muted">
            {tr('unnestRulesHeader', '展开规则')}
          </div>
          <div className="border-t border-border-muted" />
          <div className="p-3 grid gap-2.5">
            <label className="grid gap-1">
              <GlassFormLabel>{tr('unnestAlias', '展开后的别名')}</GlassFormLabel>
              <GlassFormTextInput
                value={alias}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, alias: v || undefined }))}
                placeholder={tr('unnestAliasPlaceholder', '如 item')}
              />
            </label>

            {sourceKind === 'json' && (
              <label className="grid gap-1">
                <GlassFormLabel>{tr('unnestJsonPath', 'JSON 路径')}</GlassFormLabel>
                <GlassFormTextInput
                  value={path}
                  onChange={(v) => updateConfig((cfg) => ({ ...cfg, path: v || undefined }))}
                  placeholder={tr('unnestJsonPathPlaceholder', '如 $.items')}
                />
              </label>
            )}
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center justify-center px-3">
          <ArrowRight className="h-5 w-5 text-text-muted" />
        </div>

        {/* ═══ 输出配置 ═══ */}
        <div className="flex-[2] rounded-lg border border-border-muted bg-background/42 grid content-start">
          <div className="px-3 py-1.5 text-[11px] font-medium text-text-muted">
            {tr('unnestOutputHeader', '输出配置')}
          </div>
          <div className="border-t border-border-muted" />
          <div className="p-3 grid gap-2.5">
            <div className="grid gap-1">
              <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={!!withIndex}
                  onChange={(e) =>
                    updateConfig((cfg) => ({
                      ...cfg,
                      withIndex: e.target.checked
                        ? cfg.withIndex && typeof cfg.withIndex === 'string'
                          ? cfg.withIndex
                          : 'index'
                        : undefined,
                    }))
                  }
                  className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                />
                {tr('unnestIndexCol', '索引列')}
              </label>
              <GlassFormTextInput
                value={withIndex}
                disabled={!withIndex}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, withIndex: v || undefined }))}
                placeholder={tr('unnestIndexColPlaceholder', '如 item_index')}
                className="disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>

            <div className="grid gap-1">
              <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
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
              <GlassFormTextInput
                value={depth === -1 ? '' : String(depth)}
                disabled={!recursive}
                inputMode="numeric"
                onChange={(v) => {
                  const n = v === '' ? -1 : Number(v);
                  if (Number.isNaN(n)) return;
                  if (n <= 0) {
                    // empty / 0 / negative → unlimited
                    updateConfig((cfg) => ({ ...cfg, recursive: true, maxDepth: undefined }));
                  } else {
                    updateConfig((cfg) => ({ ...cfg, recursive: true, maxDepth: n }));
                  }
                }}
                placeholder={tr('unnestMaxDepthPlaceholder', '不限制深度')}
                className="disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>

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
        </div>
      </div>
    </div>
  );
}
