import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassListEditor } from './shared/GlassListEditor';

interface CalculationEntry {
  field: string;
  expression: string;
}

function createDefault(): CalculationEntry {
  return { field: '', expression: '' };
}

export default function FormCalculateField({ node, onNodeChange }: OperatorFormProps) {
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

  const calculations: CalculationEntry[] = (node.config.calculations as CalculationEntry[]) ?? [];

  function handleChange(items: CalculationEntry[]) {
    updateConfig((cfg) => ({
      ...cfg,
      calculations: items.length > 0 ? items : undefined,
    }));
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="计算字段 (derive)">
        <GlassListEditor
          items={calculations}
          renderRow={(item, _index, onChange) => (
            <div className="grid gap-1.5">
              <div>
                <GlassFormLabel required>目标字段名</GlassFormLabel>
                <GlassFormTextInput
                  value={item.field}
                  onChange={(value) => onChange({ ...item, field: value })}
                  placeholder="如 margin"
                  className="h-7"
                />
              </div>
              <div>
                <GlassFormLabel required>表达式</GlassFormLabel>
                <GlassFormTextInput
                  value={item.expression}
                  onChange={(value) => onChange({ ...item, expression: value })}
                  placeholder={'如 if [revenue] = 0 then 0 else [profit] / [revenue]'}
                  className="h-7"
                />
              </div>
            </div>
          )}
          createDefault={createDefault}
          onChange={handleChange}
          addLabel="添加计算字段"
          emptyText="暂无计算字段"
        />
        <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
          支持标量表达式、条件表达式 (if/then/else) 和窗口函数 (row_number, rank, lag, lead 等需带
          over(...))。 不允许裸聚合函数，带 over(...) 的窗口聚合才可用。
        </p>
      </GlassFormSection>
    </div>
  );
}
