import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassListEditor } from './shared/GlassListEditor';

const TYPE_OPTIONS = ['string', 'int', 'double', 'decimal', 'boolean', 'date', 'timestamp'];
const ON_ERROR_OPTIONS = [
  { value: 'null', label: '置空 (null)' },
  { value: 'fail', label: '报错 (fail)' },
  { value: 'keep', label: '保留 (keep)' },
];

interface ConversionEntry {
  column: string;
  type: string;
  format?: string;
  onError?: string;
  locale?: string;
  timezone?: string;
}

function createDefault(): ConversionEntry {
  return { column: '', type: 'string' };
}

export default function FormTypeConvert({
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

  const conversions: ConversionEntry[] = (node.config.conversions as ConversionEntry[]) ?? [];

  function handleChange(items: ConversionEntry[]) {
    updateConfig((cfg) => ({ ...cfg, conversions: items.length > 0 ? items : undefined }));
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="类型转换">
        <GlassListEditor
          items={conversions}
          renderRow={(item, _index, onChange) => (
            <div className="grid gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <GlassFormLabel>字段</GlassFormLabel>
                  <select
                    value={item.column}
                    onChange={(e) => onChange({ ...item, column: e.target.value })}
                    className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent"
                  >
                    <option value="" disabled>
                      选择字段
                    </option>
                    {fieldCompletions.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <GlassFormLabel>目标类型</GlassFormLabel>
                  <select
                    value={item.type}
                    onChange={(e) => onChange({ ...item, type: e.target.value })}
                    className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <GlassFormLabel>日期格式</GlassFormLabel>
                  <GlassFormTextInput
                    value={item.format ?? ''}
                    onChange={(value) => onChange({ ...item, format: value || undefined })}
                    placeholder={'如 yyyy-MM-dd'}
                    className="h-7"
                  />
                </div>
                <div>
                  <GlassFormLabel>错误处理</GlassFormLabel>
                  <select
                    value={item.onError ?? 'null'}
                    onChange={(e) =>
                      onChange({
                        ...item,
                        onError: e.target.value !== 'null' ? e.target.value : undefined,
                      })
                    }
                    className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                  >
                    {ON_ERROR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
          createDefault={createDefault}
          onChange={handleChange}
          addLabel="添加转换"
          emptyText="暂未设置类型转换"
        />
      </GlassFormSection>
    </div>
  );
}
