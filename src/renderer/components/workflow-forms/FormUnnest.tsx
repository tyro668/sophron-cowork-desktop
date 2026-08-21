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
  const withIndexEnabled = node.config.withIndex !== undefined;

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
                {tr('unnestSourceHeader')}
              </span>
              <span className="text-[10px] text-text-muted">{tr('unnestSourceHint')}</span>
            </div>
          </div>
          <section className="operator-section flex-1">
            <div className="p-3 grid gap-2.5">
              <label className="grid gap-1">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('unnestSourceField')}
                </span>
                <GlassFieldSingleSelect
                  value={column}
                  options={fieldCompletions}
                  onChange={(v) => updateConfig((cfg) => ({ ...cfg, column: v || undefined }))}
                  placeholder={tr('unnestSelectField')}
                  className="w-full"
                />
              </label>

              <GlassRadioSelect
                value={sourceKind}
                options={[
                  {
                    value: 'list',
                    label: tr('unnestSourceTypeList'),
                    tip: tr('unnestSourceTypeListTip'),
                  },
                  {
                    value: 'json',
                    label: tr('unnestSourceTypeObject'),
                    tip: tr('unnestSourceTypeJsonTip'),
                  },
                ]}
                onChange={(v) =>
                  updateConfig((cfg) => ({
                    ...cfg,
                    sourceKind: v,
                    ...(v === 'json'
                      ? {
                          withIndex: undefined,
                          keepParentNames: undefined,
                          preserveOrder: undefined,
                        }
                      : {}),
                  }))
                }
                label={tr('unnestSourceType')}
              />
              {isObjectMode ? (
                <span className="text-[11px] text-text-muted">{tr('unnestObjectHint')}</span>
              ) : (
                <span className="text-[11px] text-text-muted">{tr('unnestListHint')}</span>
              )}
            </div>
          </section>
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
                {tr('unnestRulesHeader')}
              </span>
              <span className="text-[10px] text-text-muted">{tr('unnestRulesHint')}</span>
            </div>
          </div>
          <section className="operator-section flex-1 border-l border-border-subtle/70">
            <div className="p-3 grid gap-2.5">
              {isObjectMode ? (
                <span className="text-[11px] text-text-muted">{tr('unnestAliasObjectHint')}</span>
              ) : (
                <label className="grid gap-1">
                  <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                    {tr('unnestAlias')}
                  </span>
                  <GlassFormTextInput
                    value={alias}
                    onChange={(v) => updateConfig((cfg) => ({ ...cfg, alias: v || undefined }))}
                    placeholder={tr('unnestAliasPlaceholder')}
                    className="h-8 text-[13px] w-full"
                  />
                </label>
              )}

              <label className="grid gap-1">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('unnestPathLabel')}
                </span>
                <GlassFormTextInput
                  value={path}
                  onChange={(v) => updateConfig((cfg) => ({ ...cfg, path: v || undefined }))}
                  placeholder={tr('unnestPathPlaceholder')}
                  className="h-8 text-[13px] w-full"
                />
                <span className="text-[10px] text-text-muted">{tr('unnestPathHint')}</span>
              </label>
            </div>
          </section>
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
                  {tr('unnestOutputHeader')}
                </span>
                <span className="text-[10px] text-text-muted">{tr('unnestOutputHint')}</span>
              </div>
            </div>
            <section className="operator-section flex-1">
              <div className="p-3">
                <span className="text-[11px] text-text-muted">{tr('unnestObjectNoConfig')}</span>
              </div>
            </section>
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex items-end gap-3 px-0.5">
              <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
                3
              </span>
              <div className="grid">
                <span className="text-[13px] font-semibold text-text-primary">
                  {tr('unnestOutputHeader')}
                </span>
                <span className="text-[10px] text-text-muted">{tr('unnestOutputHint')}</span>
              </div>
            </div>
            <section className="operator-section flex-1 border-l border-border-subtle/70">
              <div className="p-3 grid gap-2.5">
                <div className="grid gap-1">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
                    <input
                      type="checkbox"
                      checked={withIndexEnabled}
                      onChange={(e) => {
                        updateConfig((cfg) => ({
                          ...cfg,
                          withIndex: e.target.checked ? '' : undefined,
                        }));
                      }}
                      className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                    />
                    {tr('unnestIndexCol')}
                  </label>
                  <GlassFormTextInput
                    value={withIndex}
                    disabled={!withIndexEnabled}
                    onChange={(v) => updateConfig((cfg) => ({ ...cfg, withIndex: v }))}
                    placeholder={tr('unnestIndexPlaceholder')}
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
                  {tr('unnestKeepParent')}
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
                  {tr('unnestPreserveOrder')}
                </label>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
