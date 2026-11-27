import { useTranslation } from 'react-i18next';
import type { AppConfig, DataRawTableCustomizeProcessingConfig } from '../../../types';
import { AgentModelSelector, getAgentModelLabel } from '../../AgentModelSelector';
import { LlmPromptComposer } from '../../LlmPromptComposer';
import { RawTableConfigRow } from '../ColumnTypeOverridesEditor';

interface CustomizeRulesStepProps {
  dataProcessing: DataRawTableCustomizeProcessingConfig;
  selectedSkillNames: string[];
  appConfig: AppConfig | null;
  disabled: boolean;
  modelMenuOpen: boolean;
  selectedModelConfigSetId?: string;
  onModelMenuOpenChange: (open: boolean) => void;
  onPatchProcessing: (patch: Partial<DataRawTableCustomizeProcessingConfig>) => void;
}

export function CustomizeRulesStep({
  dataProcessing,
  selectedSkillNames,
  appConfig,
  disabled,
  modelMenuOpen,
  selectedModelConfigSetId,
  onModelMenuOpenChange,
  onPatchProcessing,
}: CustomizeRulesStepProps) {
  const { t } = useTranslation();
  const promptLength = dataProcessing.rulePrompt.length;

  return (
    <>
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

      <div className="ui-form-row min-h-0 flex-1 !pr-0">
        <div
          className="ui-form-label items-start pt-3"
          title={t('data.rawTables.editor.rulePromptHint')}
        >
          {t('data.rawTables.editor.ruleLabel')}
          <span className="ml-0.5 text-error">*</span>
        </div>
        <div className="ui-form-value relative min-h-0 bg-surface transition-colors focus-within:bg-surface-hover/20">
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
            className="ui-composer-flush min-h-0 flex-1 !px-3 !py-2.5 !pb-8"
            textareaClassName="h-full text-[13px] leading-[1.65]"
            skillMenuPlacement="bottom"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-2.5 px-3 py-1.5">
            {promptLength > 0 && !disabled && (
              <button
                type="button"
                onClick={() => onPatchProcessing({ rulePrompt: '' })}
                className="pointer-events-auto text-[11px] font-medium text-text-muted transition-colors hover:text-text-primary"
              >
                {t('common.clear')}
              </button>
            )}
            <span
              className={`text-[11px] tabular-nums ${
                promptLength >= 3600 ? 'text-warning' : 'text-text-muted'
              }`}
              data-testid="raw-customize-prompt-count"
            >
              {promptLength} / 4000
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
