import { handleNewlineShortcut } from '../utils/composer-keys';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp } from 'lucide-react';
import type { AppConfig } from '../types';
import { useSkillMentions } from '../hooks/useSkillMentions';
import { AgentModelSelector, getAgentModelLabel } from './AgentModelSelector';
import { SelectedSkillChips, SkillMentionMenu } from './SkillMentionPicker';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export interface LlmPromptComposerModelSelection {
  configSetId: string;
  model: string;
}

export interface LlmPromptComposerSkillSelectionCommit {
  value: string;
  selectedSkillNames: string[];
}

export interface LlmPromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  selectedSkillNames?: string[];
  onSelectedSkillNamesChange?: (names: string[]) => void;
  onSkillSelectionCommit?: (selection: LlmPromptComposerSkillSelectionCommit) => void;
  appConfig?: AppConfig | null;
  selectedModelConfigSetId?: string;
  onModelSelect?: (selection: LlmPromptComposerModelSelection) => void;
  modelDisabled?: boolean;
  modelFallbackLabel?: string;
  className?: string;
  textareaClassName?: string;
  modelTriggerClassName?: string;
  skillMenuPlacement?: 'top' | 'bottom';
  modelMenuSide?: 'top' | 'right' | 'bottom' | 'left';
  modelMenuAlign?: 'start' | 'center' | 'end';
  /** Enter-to-send + round send button, same affordance as the main chat composer. */
  onSubmit?: () => void;
  submitDisabled?: boolean;
  submitTitle?: string;
}

function normalizeSelectedSkillNames(selectedSkillNames: string[] | undefined): string[] {
  return Array.isArray(selectedSkillNames)
    ? selectedSkillNames.filter((name): name is string => typeof name === 'string')
    : [];
}

export function LlmPromptComposer({
  value,
  onChange,
  placeholder,
  disabled = false,
  maxLength,
  selectedSkillNames,
  onSelectedSkillNamesChange,
  onSkillSelectionCommit,
  appConfig,
  selectedModelConfigSetId,
  onModelSelect,
  modelDisabled = false,
  modelFallbackLabel,
  className = '',
  textareaClassName = '',
  modelTriggerClassName = '',
  skillMenuPlacement = 'top',
  modelMenuSide = 'bottom',
  modelMenuAlign = 'end',
  onSubmit,
  submitDisabled = false,
  submitTitle,
}: LlmPromptComposerProps) {
  const { t } = useTranslation();
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const normalizedSelectedSkillNames = useMemo(
    () =>
      selectedSkillNames === undefined
        ? undefined
        : normalizeSelectedSkillNames(selectedSkillNames),
    [selectedSkillNames]
  );
  const activeModelConfigSetId = selectedModelConfigSetId || appConfig?.activeConfigSetId;
  const skillMentions = useSkillMentions({
    prompt: value,
    setPrompt: onChange,
    textareaRef,
    isElectron,
    selectedSkillNames: normalizedSelectedSkillNames,
    onSelectedSkillNamesChange,
    onSkillSelectionCommit: ({ prompt, selectedSkillNames }) => {
      if (onSkillSelectionCommit) {
        onSkillSelectionCommit({ value: prompt, selectedSkillNames });
        return;
      }
      onChange(prompt);
      onSelectedSkillNamesChange?.(selectedSkillNames);
    },
  });

  return (
    <div
      ref={composerRef}
      className={`chat-composer-panel relative flex min-h-[116px] flex-col px-3 py-2.5 ${className}`}
    >
      <SkillMentionMenu
        open={skillMentions.isMentionMenuOpen}
        skills={skillMentions.filteredSkills}
        highlightedIndex={skillMentions.highlightedIndex}
        onSelect={skillMentions.selectSkill}
        anchorRef={composerRef}
        placement={skillMenuPlacement}
      />
      <SelectedSkillChips
        skills={skillMentions.selectedSkills}
        disabled={disabled}
        onRemove={skillMentions.removeSkill}
      />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={skillMentions.handlePromptChange}
        onKeyDown={(event) => {
          if (skillMentions.handlePromptKeyDown(event)) {
            return;
          }
          if (onSubmit && handleNewlineShortcut(event)) {
            return;
          }
          if (onSubmit && event.key === 'Enter' && !event.shiftKey) {
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              return;
            }
            event.preventDefault();
            onSubmit();
          }
        }}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        className={`min-h-[58px] flex-1 resize-none overflow-y-auto border-none bg-transparent text-[13px] leading-5 text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60 ${textareaClassName}`}
      />
      {onModelSelect || onSubmit ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          {onModelSelect ? (
            <AgentModelSelector
              open={modelMenuOpen}
              onOpenChange={setModelMenuOpen}
              appConfig={appConfig}
              selectedConfigSetId={activeModelConfigSetId}
              fallbackLabel={modelFallbackLabel ?? t('chat.noModel')}
              disabled={disabled || modelDisabled}
              side={modelMenuSide}
              align={modelMenuAlign}
              triggerClassName={
                modelTriggerClassName ||
                'composer-flat-pill inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-medium'
              }
              onSelect={(configSetId) =>
                onModelSelect({
                  configSetId,
                  model: getAgentModelLabel(appConfig, '', configSetId),
                })
              }
            />
          ) : null}
          {onSubmit ? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={disabled || submitDisabled}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted"
              title={submitTitle ?? t('chat.sendMessage')}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
