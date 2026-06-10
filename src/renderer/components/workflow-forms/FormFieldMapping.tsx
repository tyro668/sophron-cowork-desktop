import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassListEditor } from './shared/GlassListEditor';

interface MappingEntry {
  source: string;
  target: string;
}

function createDefault(): MappingEntry {
  return { source: '', target: '' };
}

export default function FormFieldMapping({
  node,
  fieldCompletions,
  onNodeChange,
}: OperatorFormProps) {
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

  const mappings: MappingEntry[] = (node.config.mappings as MappingEntry[]) ?? [];

  function handleMappingsChange(items: MappingEntry[]) {
    updateConfig((cfg) => ({ ...cfg, mappings: items.length > 0 ? items : undefined }));
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="字段映射">
        <GlassFormLabel>源字段 → 目标字段</GlassFormLabel>
        <GlassListEditor
          items={mappings}
          renderRow={(item, _index, onChange) => (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
              <select
                value={item.source}
                onChange={(e) => onChange({ ...item, source: e.target.value })}
                className="h-7 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent"
              >
                <option value="" disabled>
                  源字段
                </option>
                {fieldCompletions.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
              <span className="text-center text-[11px] text-text-muted">→</span>
              <GlassFormTextInput
                value={item.target}
                onChange={(value) => onChange({ ...item, target: value })}
                placeholder="目标字段名"
                className="h-7"
              />
            </div>
          )}
          createDefault={createDefault}
          onChange={handleMappingsChange}
          addLabel="添加映射"
          emptyText="暂无字段映射"
        />
        <p className="text-[10px] leading-relaxed text-text-muted">
          未列出的字段默认透传。若只需要输出映射字段，请先使用「字段选择」算子。
        </p>
      </GlassFormSection>
    </div>
  );
}
