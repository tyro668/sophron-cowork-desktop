import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassListEditor } from './shared/GlassListEditor';

interface MappingEntry {
  id: string;
  source: string;
  target: string;
}

function createMappingId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `map_${globalThis.crypto.randomUUID()}`;
  }
  return `map_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createDefault(): MappingEntry {
  return { id: createMappingId(), source: '', target: '' };
}

function normalizeMappings(
  raw: Array<{ id?: string; source: string; target: string }> | undefined
): MappingEntry[] {
  return (raw ?? []).map((item) => ({
    id: item.id || createMappingId(),
    source: item.source ?? '',
    target: item.target ?? '',
  }));
}

export default function FormFieldMapping({
  node,
  fieldCompletions,
  onNodeChange,
}: OperatorFormProps) {
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

  const mappings = useMemo(
    () =>
      normalizeMappings(
        node.config.mappings as Array<{ id?: string; source: string; target: string }> | undefined
      ),
    [node.config.mappings]
  );

  // Existing field names that are NOT being renamed away by any mapping
  const occupiedNames = useMemo(() => {
    const renamed = new Set(mappings.map((m) => m.source));
    return new Set(fieldCompletions.filter((c) => !renamed.has(c)));
  }, [fieldCompletions, mappings]);

  function handleMappingsChange(items: MappingEntry[]) {
    updateConfig((cfg) => ({ ...cfg, mappings: items.length > 0 ? items : undefined }));
  }

  function getTargetError(item: MappingEntry): string | null {
    const t = item.target.trim();
    if (!t) return null;
    if (t === item.source) return tr('fieldMappingErrSameSource', '不能与原字段名相同');
    if (occupiedNames.has(t)) return tr('fieldMappingErrConflict', '与已有字段名冲突');
    if (mappings.some((m) => m !== item && m.target.trim() === t))
      return tr('fieldMappingErrDuplicate', '目标字段名重复');
    return null;
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title={tr('fieldMappingTitle', '字段映射')}>
        <GlassListEditor
          items={mappings}
          renderRow={(item, _index, onChange) => {
            const err = getTargetError(item);
            return (
              <div className="grid gap-1">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                  <select
                    value={item.source}
                    onChange={(e) => onChange({ ...item, source: e.target.value })}
                    className="h-7 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent"
                  >
                    <option value="" disabled>
                      {tr('fieldMappingSourceField', '源字段')}
                    </option>
                    {fieldCompletions.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <span className="text-center text-[11px] text-text-muted">→</span>
                  <input
                    value={item.target}
                    onChange={(e) => onChange({ ...item, target: e.target.value })}
                    placeholder={tr('fieldMappingTargetPlaceholder', '目标字段名')}
                    className={`h-7 w-full rounded-md border bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent placeholder:text-text-muted ${
                      err ? 'border-warning/70 ring-1 ring-warning/10' : 'border-border-muted'
                    }`}
                  />
                </div>
                {err && <div className="text-[11px] text-warning">{err}</div>}
              </div>
            );
          }}
          createDefault={createDefault}
          onChange={handleMappingsChange}
          getKey={(item) => item.id}
          addLabel={tr('fieldMappingAdd', '添加映射')}
          emptyText={tr('fieldMappingEmpty', '暂无字段映射')}
        />
      </GlassFormSection>
    </div>
  );
}
