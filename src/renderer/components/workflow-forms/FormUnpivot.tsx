import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassColumnSelector } from './shared/GlassColumnSelector';

export default function FormUnpivot({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
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

  const mode = (node.config.mode as string) ?? 'include';
  const columns: string[] = (node.config.columns as string[]) ?? [];
  const nameColumn = String(node.config.nameColumn ?? '');
  const valueColumn = String(node.config.valueColumn ?? '');
  const includeNulls = Boolean(node.config.includeNulls ?? false);

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title={tr('unpivotMode', '列展开模式')}>
        <GlassFormLabel>{tr('unpivotModeLabel', '模式')}</GlassFormLabel>
        <div className="flex gap-1.5">
          {(['include', 'except'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => updateConfig((cfg) => ({ ...cfg, mode: m }))}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                mode === m
                  ? 'bg-accent/10 text-accent border border-accent/30'
                  : 'border border-border-muted bg-background/42 text-text-secondary hover:border-accent/30'
              }`}
            >
              {m === 'include' ? tr('unpivotInclude', '指定列') : tr('unpivotExclude', '排除列')}
            </button>
          ))}
        </div>
      </GlassFormSection>

      <GlassFormSection
        title={
          mode === 'include'
            ? tr('unpivotExpandCols', '要展开的列')
            : tr('unpivotExcludeCols', '排除的列')
        }
      >
        <GlassColumnSelector
          columns={fieldCompletions}
          selected={columns}
          onChange={(next) =>
            updateConfig((cfg) => ({ ...cfg, columns: next.length > 0 ? next : undefined }))
          }
        />
      </GlassFormSection>

      <GlassFormSection title={tr('unpivotOutputSettings', '输出列设置')}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <GlassFormLabel required>{tr('unpivotNameCol', '名称列')}</GlassFormLabel>
            <GlassFormTextInput
              value={nameColumn}
              onChange={(value) =>
                updateConfig((cfg) => ({ ...cfg, nameColumn: value || undefined }))
              }
              placeholder={tr('unpivotNameColPlaceholder', '如 month')}
              className="h-7"
            />
          </div>
          <div>
            <GlassFormLabel required>{tr('unpivotValueCol', '值列')}</GlassFormLabel>
            <GlassFormTextInput
              value={valueColumn}
              onChange={(value) =>
                updateConfig((cfg) => ({ ...cfg, valueColumn: value || undefined }))
              }
              placeholder={tr('unpivotValueColPlaceholder', '如 sales_amount')}
              className="h-7"
            />
          </div>
        </div>
      </GlassFormSection>

      <GlassFormSection title={tr('unpivotOptions', '选项')}>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            checked={includeNulls}
            onChange={(e) =>
              updateConfig((cfg) => ({
                ...cfg,
                includeNulls: e.target.checked || undefined,
              }))
            }
            className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
          />
          {tr('unpivotIncludeNulls', '包含空值行 (include nulls)')}
        </label>
      </GlassFormSection>
    </div>
  );
}
