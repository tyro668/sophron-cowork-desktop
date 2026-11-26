import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  ScriptPackageSummary,
  ScriptRuntime,
} from '../../../shared/automation/script-package';
import type { AppConfig } from '../../types';
import { AgentModelSelector } from '../AgentModelSelector';
import { GlassSelect } from '../GlassSelect';
import { RawTableConfigRow } from '../data-view/ColumnTypeOverridesEditor';

const EXAMPLE_KEYS = [
  'examplePaging',
  'exampleApiAuth',
  'exampleDedupe',
  'exampleRetry',
  'exampleIncremental',
] as const;

interface ScriptRulesStepProps {
  rulePrompt: string;
  generating: boolean;
  packageId?: string;
  baseVersion: number | null;
  baseOptions: Array<{ value: string; label: string }>;
  runtime: ScriptRuntime;
  summary: ScriptPackageSummary | null;
  appConfig: AppConfig | null;
  modelMenuOpen: boolean;
  modelConfigSetId?: string | null;
  onRulePromptChange: (value: string) => void;
  onAppendRuleExample: (example: string) => void;
  onBaseVersionChange: (version: number | null) => void;
  onRuntimeChange: (runtime: ScriptRuntime) => void;
  onModelMenuOpenChange: (open: boolean) => void;
  onModelConfigSetSelect: (configSetId: string) => void;
}

export function ScriptRulesStep({
  rulePrompt,
  generating,
  packageId,
  baseVersion,
  baseOptions,
  runtime,
  summary,
  appConfig,
  modelMenuOpen,
  modelConfigSetId,
  onRulePromptChange,
  onAppendRuleExample,
  onBaseVersionChange,
  onRuntimeChange,
  onModelMenuOpenChange,
  onModelConfigSetSelect,
}: ScriptRulesStepProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="ui-form-row min-h-0 flex-1">
        <div className="ui-form-label items-start pt-2.5">
          {t('scripts.editor.ruleLabel')}
          <span className="ml-0.5 text-error">*</span>
        </div>
        <div className="ui-form-value relative min-h-0">
          <textarea
            value={rulePrompt}
            onChange={(event) => onRulePromptChange(event.target.value.slice(0, 4000))}
            placeholder={t('scripts.editor.rulePlaceholder')}
            disabled={generating}
            data-testid="script-rule-prompt"
            className="h-full min-h-[120px] w-full resize-none border-0 bg-transparent px-2.5 py-2 pb-6 text-[13px] leading-6 text-text-primary outline-none placeholder:text-text-muted"
          />
          <span className="pointer-events-none absolute bottom-2 right-2.5 text-[11px] tabular-nums text-text-muted">
            {rulePrompt.length} / 4000
          </span>
        </div>
      </div>
      <RawTableConfigRow label={t('scripts.editor.base')}>
        <GlassSelect
          ariaLabel={t('scripts.editor.base')}
          value={baseVersion != null && packageId ? String(baseVersion) : 'scratch'}
          onValueChange={(value) => onBaseVersionChange(value === 'scratch' ? null : Number(value))}
          options={baseOptions}
          disabled={generating || !packageId}
          triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </RawTableConfigRow>
      <RawTableConfigRow label={t('scripts.editor.language')}>
        <GlassSelect
          ariaLabel={t('scripts.editor.language')}
          value={runtime}
          onValueChange={(value) => onRuntimeChange(value as ScriptRuntime)}
          options={[
            {
              value: 'python',
              label:
                summary?.runtime === 'python' && summary.runtimeVersion
                  ? summary.runtimeVersion
                  : 'Python 3',
            },
            { value: 'node', label: 'Node.js' },
          ]}
          disabled={generating}
          triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </RawTableConfigRow>
      <RawTableConfigRow label={t('data.rawTables.editor.customizeModelLabel')}>
        <AgentModelSelector
          open={modelMenuOpen}
          onOpenChange={onModelMenuOpenChange}
          appConfig={appConfig}
          selectedConfigSetId={modelConfigSetId ?? appConfig?.activeConfigSetId ?? ''}
          fallbackLabel={t('chat.noModel')}
          disabled={generating}
          align="start"
          triggerClassName="ui-flush-control flex items-center justify-between gap-2 text-left text-text-primary"
          onSelect={onModelConfigSetSelect}
        />
      </RawTableConfigRow>
      <RawTableConfigRow label={t('data.rawTables.editor.examplesLabel')}>
        <div className="flex min-h-[35px] flex-wrap items-center gap-1.5 px-2.5 py-1.5">
          {EXAMPLE_KEYS.map((key) => {
            const example = t(`scripts.editor.${key}`);
            return (
              <button
                key={key}
                type="button"
                disabled={generating}
                onClick={() => onAppendRuleExample(example)}
                className="inline-flex h-6 items-center gap-1 rounded border border-accent/25 bg-surface px-2 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                {t(`scripts.editor.${key}Label`)}
              </button>
            );
          })}
        </div>
      </RawTableConfigRow>
    </>
  );
}
