import { useCallback, useRef, useState } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassListEditor } from './shared/GlassListEditor';

interface CalculationEntry {
  field: string;
  expression: string;
}

function createDefault(): CalculationEntry {
  return { field: '', expression: '' };
}

const FIELD_INPUT_CLASS =
  'h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent placeholder:text-text-muted';

const CHIP_CLASS =
  'inline-flex h-7 cursor-pointer items-center rounded border border-border-muted px-2 text-[12px] text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent';

const FUNCTION_GROUPS: Record<string, string[]> = {
  条件: ['if', 'then', 'else'],
  窗口: ['row_number', 'rank', 'lag', 'lead'],
  聚合: ['sum', 'avg', 'count', 'min', 'max'],
  数学: ['abs', 'round'],
  字符串: ['upper', 'lower', 'trim', 'length', 'substr', 'split_part', 'concat'],
  空值: ['coalesce', 'nullif'],
  类型: ['CAST'],
};

export default function FormCalculateField({
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

  const calculations: CalculationEntry[] = (node.config.calculations as CalculationEntry[]) ?? [];
  const exprInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [helperTab, setHelperTab] = useState<'fields' | 'functions'>('fields');

  function handleChange(items: CalculationEntry[]) {
    updateConfig((cfg) => ({
      ...cfg,
      calculations: items.length > 0 ? items : undefined,
    }));
  }

  function insert(text: string) {
    const el = exprInputRefs.current.get(activeIndex);
    if (!el) return;
    const calc = calculations[activeIndex];
    if (!calc) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    handleChange(calculations.map((c, i) => (i === activeIndex ? { ...c, expression: next } : c)));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="计算字段">
        <GlassListEditor
          items={calculations}
          renderRow={(item, index, onChange) => (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="w-20 flex-shrink-0 text-[12px] font-medium text-text-secondary after:ml-0.5 after:text-danger after:content-['*']">
                  目标字段
                </span>
                <input
                  value={item.field}
                  onChange={(e) => onChange({ ...item, field: e.target.value })}
                  placeholder="如 margin"
                  className={`${FIELD_INPUT_CLASS} flex-1 ${!item.field.trim() ? '!border-warning/60' : ''}`}
                />
              </div>
              <div>
                <GlassFormLabel required>表达式</GlassFormLabel>
                <input
                  ref={(el) => {
                    if (el) exprInputRefs.current.set(index, el);
                    else exprInputRefs.current.delete(index);
                  }}
                  value={item.expression}
                  onChange={(e) => onChange({ ...item, expression: e.target.value })}
                  onFocus={() => setActiveIndex(index)}
                  placeholder="如 [revenue] - [cost] 或 if [a] > 0 then 1 else 0"
                  className={`${FIELD_INPUT_CLASS} ${!item.expression.trim() ? '!border-warning/60' : ''}`}
                />
              </div>
            </div>
          )}
          createDefault={createDefault}
          onChange={handleChange}
          addLabel="添加计算字段"
          emptyText="暂无计算字段"
        />

        {/* Shared helper card */}
        <div className="mt-3 overflow-hidden rounded-md border border-border-muted bg-background/28">
          <div className="flex border-b border-border-muted">
            {(['fields', 'functions'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setHelperTab(tab)}
                className={`flex-1 cursor-pointer py-1.5 text-center text-[12px] font-medium transition-colors ${
                  helperTab === tab
                    ? 'bg-background/42 text-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {tab === 'fields' ? '字段' : '函数'}
              </button>
            ))}
          </div>
          <div className="max-h-36 overflow-y-auto p-2">
            {helperTab === 'fields' ? (
              <div className="flex flex-wrap gap-1">
                {fieldCompletions.length > 0 ? (
                  fieldCompletions.map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => insert(`[${col}]`)}
                      className={CHIP_CLASS}
                    >
                      {col}
                    </button>
                  ))
                ) : (
                  <span className="text-[11px] text-text-muted">暂无可用字段</span>
                )}
              </div>
            ) : (
              <div className="grid gap-2">
                {Object.entries(FUNCTION_GROUPS).map(([group, fns]) => (
                  <div key={group}>
                    <span className="mb-1 block text-[11px] text-text-muted">{group}</span>
                    <div className="flex flex-wrap gap-1">
                      {fns.map((fn) => (
                        <button
                          key={fn}
                          type="button"
                          onClick={() => insert(`${fn}()`)}
                          className={CHIP_CLASS}
                        >
                          {fn}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </GlassFormSection>
    </div>
  );
}
