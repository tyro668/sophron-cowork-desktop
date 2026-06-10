import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';

const OPERATION_OPTIONS = [
  { value: 'union', label: 'UNION — 合并' },
  { value: 'intersect', label: 'INTERSECT — 交集' },
  { value: 'except', label: 'EXCEPT — 差集' },
];

const MODE_OPTIONS = [
  { value: 'all', label: 'all — 保留重复' },
  { value: 'distinct', label: 'distinct — 去重' },
];

const MATCH_OPTIONS = [
  { value: 'by_name', label: '按名称匹配' },
  { value: 'by_position', label: '按位置匹配' },
];

export default function FormSetOp({ node, otherNodes, onNodeChange }: OperatorFormProps) {
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
  const rightInput = (node.config.rightInput as string) ?? '';
  const mode = (node.config.mode as string) ?? 'all';
  const match = (node.config.match as string) ?? 'by_name';

  // Filter to only input_source nodes for right-input selection
  const inputSourceNodes = otherNodes.filter((n) => n.type === 'input_source');

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title={tr('setOpTitle', '集合操作')}>
        <div className="grid gap-2">
          <div>
            <GlassFormLabel required>{tr('setOpType', '操作类型')}</GlassFormLabel>
            <select
              value={operation}
              onChange={(e) => updateConfig((cfg) => ({ ...cfg, operation: e.target.value }))}
              className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
            >
              {OPERATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {tr(
                    o.value === 'union'
                      ? 'setOpUnion'
                      : o.value === 'intersect'
                        ? 'setOpIntersect'
                        : 'setOpExcept',
                    o.label
                  )}
                </option>
              ))}
            </select>
          </div>
          <div>
            <GlassFormLabel required>{tr('setOpRightInput', '右侧输入源')}</GlassFormLabel>
            <select
              value={rightInput}
              onChange={(e) =>
                updateConfig((cfg) => ({ ...cfg, rightInput: e.target.value || undefined }))
              }
              className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent"
            >
              <option value="" disabled>
                {tr('setOpSelectSource', '选择输入源')}
              </option>
              {inputSourceNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </GlassFormSection>

      <GlassFormSection title={tr('setOpOptions', '选项')}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <GlassFormLabel>{tr('setOpDedupMode', '去重模式')}</GlassFormLabel>
            <select
              value={mode}
              onChange={(e) => updateConfig((cfg) => ({ ...cfg, mode: e.target.value }))}
              className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
            >
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {tr(o.value === 'all' ? 'setOpAll' : 'setOpDistinct', o.label)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <GlassFormLabel>{tr('setOpMatchMode', '匹配方式')}</GlassFormLabel>
            <select
              value={match}
              onChange={(e) => updateConfig((cfg) => ({ ...cfg, match: e.target.value }))}
              className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
            >
              {MATCH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {tr(o.value === 'by_name' ? 'setOpByName' : 'setOpByPosition', o.label)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </GlassFormSection>
    </div>
  );
}
