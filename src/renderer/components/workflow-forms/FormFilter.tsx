import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';

export default function FormFilter({ node, onNodeChange }: OperatorFormProps) {
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

  const condition = String(node.config.condition ?? '');

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="筛选条件">
        <GlassFormLabel required>条件表达式</GlassFormLabel>
        <GlassFormTextInput
          value={condition}
          onChange={(value) => updateConfig((cfg) => ({ ...cfg, condition: value || undefined }))}
          placeholder={'例如: [revenue] > 0 and [status] = "PAID"'}
        />
        <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
          字段用方括号引用，如 [字段名]。支持 =, !=, &gt;, &gt;=, &lt;, &lt;=, and, or, not, in,
          between, matches, like 等操作符。字符串用双引号。
        </p>
      </GlassFormSection>
    </div>
  );
}
