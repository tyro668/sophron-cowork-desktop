import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppConfig, DataRawTableCustomizeProcessingConfig } from '../../../types';
import { AgentModelSelector, getAgentModelLabel } from '../../AgentModelSelector';
import { LlmPromptComposer } from '../../LlmPromptComposer';
import { SecretsEditor } from '../../secrets/secrets-ui';
import { RawTableConfigRow } from '../ColumnTypeOverridesEditor';

const EXAMPLE_KEYS = [
  'exampleMergeHeaders',
  'exampleSplitMultiHeaders',
  'exampleDeduplicateColumns',
  'exampleExpandMergedCells',
  'exampleDateNormalize',
] as const;

interface CustomizeRulesStepProps {
  dataProcessing: DataRawTableCustomizeProcessingConfig;
  selectedSkillNames: string[];
  appConfig: AppConfig | null;
  disabled: boolean;
  isBusy: boolean;
  generating: boolean;
  modelMenuOpen: boolean;
  selectedModelConfigSetId?: string;
  secretsKey: number;
  onModelMenuOpenChange: (open: boolean) => void;
  onPatchProcessing: (patch: Partial<DataRawTableCustomizeProcessingConfig>) => void;
}

export function CustomizeRulesStep({
  dataProcessing,
  selectedSkillNames,
  appConfig,
  disabled,
  isBusy,
  generating,
  modelMenuOpen,
  selectedModelConfigSetId,
  secretsKey,
  onModelMenuOpenChange,
  onPatchProcessing,
}: CustomizeRulesStepProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="ui-form-row min-h-0 flex-1">
        <div
          className="ui-form-label items-start pt-2.5"
          title={t('data.rawTables.editor.rulePromptHint')}
        >
          {t('data.rawTables.editor.ruleLabel')}
          <span className="ml-0.5 text-error">*</span>
        </div>
        <div className="ui-form-value relative min-h-0">
          <LlmPromptComposer
            value={dataProcessing.rulePrompt}
            onChange={(rulePrompt) => onPatchProcessing({ rulePrompt })}
            selectedSkillNames={selectedSkillNames}
            onSelectedSkillNamesChange={(nextSkillNames) =>
              onPatchProcessing({ selectedSkillNames: nextSkillNames })
            }
            onSkillSelectionCommit={({ value, selectedSkillNames: nextSkillNames }) =>
              onPatchProcessing({
                rulePrompt: value,
                selectedSkillNames: nextSkillNames,
              })
            }
            appConfig={appConfig}
            placeholder={t('data.rawTables.editor.rulePromptPlaceholder')}
            disabled={disabled}
            maxLength={4000}
            className="ui-composer-flush min-h-0 flex-1 pb-6"
            textareaClassName="h-full"
            skillMenuPlacement="bottom"
          />
          <span
            className="pointer-events-none absolute bottom-2 right-2.5 text-[11px] tabular-nums text-text-muted"
            data-testid="raw-customize-prompt-count"
          >
            {dataProcessing.rulePrompt.length} / 4000
          </span>
        </div>
      </div>
      <RawTableConfigRow label={t('data.rawTables.editor.customizeModelLabel')}>
        <AgentModelSelector
          open={modelMenuOpen}
          onOpenChange={onModelMenuOpenChange}
          appConfig={appConfig}
          selectedConfigSetId={selectedModelConfigSetId ?? appConfig?.activeConfigSetId ?? ''}
          fallbackLabel={t('chat.noModel')}
          disabled={disabled}
          align="start"
          triggerClassName="ui-flush-control flex items-center justify-between gap-2 text-left text-text-primary"
          onSelect={(configSetId) =>
            onPatchProcessing({
              modelConfigSetId: configSetId,
              model: getAgentModelLabel(appConfig, '', configSetId),
            })
          }
        />
      </RawTableConfigRow>
      <RawTableConfigRow label={t('secrets.label')}>
        <SecretsEditor
          kind="normalizer"
          ownerId={dataProcessing.artifactId}
          refreshKey={secretsKey}
          disabled={isBusy}
        />
      </RawTableConfigRow>
      <RawTableConfigRow label={t('data.rawTables.editor.examplesLabel')}>
        <div className="flex min-h-[35px] flex-wrap items-center gap-1.5 px-2.5 py-1.5">
          {EXAMPLE_KEYS.map((key) => {
            const example = t(`data.rawTables.editor.${key}`);
            return (
              <button
                key={key}
                type="button"
                disabled={disabled || generating}
                onClick={() =>
                  onPatchProcessing({
                    rulePrompt: dataProcessing.rulePrompt.trim()
                      ? `${dataProcessing.rulePrompt.replace(/\s+$/, '')}\n${example}`
                      : example,
                  })
                }
                className="inline-flex h-6 items-center gap-1 rounded border border-accent/25 bg-surface px-2 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                {example}
              </button>
            );
          })}
        </div>
      </RawTableConfigRow>
    </>
  );
}
