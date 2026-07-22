import type { OperatorFormProps } from './index';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';

export default function FormUnnest({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
  const tr = useFormTranslation();
  const updateConfig = useUpdateConfig(onNodeChange);

  const sourceKind = (node.config.sourceKind as string) ?? 'list';
  const column = String(node.config.column ?? '');
  const alias = String(node.config.alias ?? '');
  const path = String(node.config.path ?? '');
  const withIndex = String(node.config.withIndex ?? '');
  const keepParentNames = Boolean(node.config.keepParentNames ?? false);
  const preserveOrder = Boolean(node.config.preserveOrder ?? false);

  const isObjectMode = sourceKind === 'json';

  return (
    <div className="grid content-start gap-2.5">
      <div className="flex items-stretch gap-0">
        {/* ═══ 步骤1: 数据来源 ═══ */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-end gap-3 px-0.5">
            <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
              1
            </span>
            <div className="grid">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('unnestSourceHeader', '数据来源')}
              </span>
              <span className="text-[10px] text-text-muted">
                {tr('unnestSourceHint', '选择要展开的字段，并指定展开方式')}
              </span>
            </div>
          </div>
          <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
            <div className="p-3 grid gap-2.5">
              <label className="grid gap-1">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('unnestSourceField', '源字段')}
                </span>
                <GlassFieldSingleSelect
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
                  {
                    value: 'list',
                    label: tr('unnestSourceTypeList', '展开为行'),
                    tip: tr(
                      'unnestSourceTypeListTip',
                      '将数组展开为多行，支持原生数组和 JSON 数组字符串'
                    ),
                  },
                  {
                    value: 'json',
                    label: tr('unnestSourceTypeObject', '展开为列'),
                    tip: tr('unnestSourceTypeJsonTip', '将 JSON 对象展开为多列，每个 key 一列'),
                  },
                ]}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, sourceKind: v }))}
                label={tr('unnestSourceType', '展开方式')}
              />
              {isObjectMode ? (
                <span className="text-[11px] text-text-muted">
                  {tr('unnestObjectHint', '结果：JSON 对象的每个 key 展开为一列')}
                </span>
              ) : (
                <span className="text-[11px] text-text-muted">
                  {tr('unnestListHint', '结果：数组的每个元素展开为一行')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-start pt-[12px] px-2">
          <span className="text-text-muted font-bold text-base leading-none">❯</span>
        </div>

        {/* ═══ 步骤2: 展开规则 ═══ */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-end gap-3 px-0.5">
            <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
              2
            </span>
            <div className="grid">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('unnestRulesHeader', '展开规则')}
              </span>
              <span className="text-[10px] text-text-muted">
                {tr('unnestRulesHint', '设置展开后的列名与定位路径')}
              </span>
            </div>
          </div>
          <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
            <div className="p-3 grid gap-2.5">
              {isObjectMode ? (
                <span className="text-[11px] text-text-muted">
                  {tr('unnestAliasObjectHint', 'JSON 对象展开后，列名自动使用 key 名称')}
                </span>
              ) : (
                <label className="grid gap-1">
                  <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                    {tr('unnestAlias', '展开后的别名')}
                  </span>
                  <GlassFormTextInput
                    value={alias}
                    onChange={(v) => updateConfig((cfg) => ({ ...cfg, alias: v || undefined }))}
                    placeholder={tr('unnestAliasPlaceholder', '默认 item')}
                    className="h-8 text-[13px] w-full"
                  />
                </label>
              )}

              <label className="grid gap-1">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('unnestPathLabel', '定位路径')}
                </span>
                <GlassFormTextInput
                  value={path}
                  onChange={(v) => updateConfig((cfg) => ({ ...cfg, path: v || undefined }))}
                  placeholder={tr('unnestPathPlaceholder', '如 $.xxx')}
                  className="h-8 text-[13px] w-full"
                />
                <span className="text-[10px] text-text-muted">
                  {tr('unnestPathHint', '不填则直接展开，填 $.xxx 则定位到子节点')}
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-start pt-[12px] px-2">
          <span className="text-text-muted font-bold text-base leading-none">❯</span>
        </div>

        {/* ═══ 步骤3: 输出配置 ═══ */}
        {isObjectMode ? (
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex items-end gap-3 px-0.5">
              <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
                3
              </span>
              <div className="grid">
                <span className="text-[13px] font-semibold text-text-primary">
                  {tr('unnestOutputHeader', '输出配置')}
                </span>
                <span className="text-[10px] text-text-muted">
                  {tr('unnestOutputHint', '配置输出选项')}
                </span>
              </div>
            </div>
            <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
              <div className="p-3">
                <span className="text-[11px] text-text-muted">
                  {tr('unnestObjectNoConfig', '展开为列时列名由 key 自动生成')}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex items-end gap-3 px-0.5">
              <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
                3
              </span>
              <div className="grid">
                <span className="text-[13px] font-semibold text-text-primary">
                  {tr('unnestOutputHeader', '输出配置')}
                </span>
                <span className="text-[10px] text-text-muted">
                  {tr('unnestOutputHint', '配置输出选项')}
                </span>
              </div>
            </div>
            <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
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
                    className="h-8 text-[13px] w-full disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>

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
                  {tr('unnestKeepParent', '添加源字段名前缀')}
                </label>

                <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={preserveOrder}
                    onChange={(e) =>
                      updateConfig((cfg) => ({
                        ...cfg,
                        preserveOrder: e.target.checked || undefined,
                      }))
                    }
                    className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                  />
                  {tr('unnestPreserveOrder', '保持原始行顺序')}
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
