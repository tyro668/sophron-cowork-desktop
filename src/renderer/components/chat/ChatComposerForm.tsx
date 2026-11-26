import type { ClipboardEvent, DragEvent, FormEvent, MutableRefObject, RefObject } from 'react';
import { ArrowUp, AtSign, Plus, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AttachedFile, PastedImage } from '../../hooks/useComposerAttachments';
import type { useSkillMentions } from '../../hooks/useSkillMentions';
import type { AppConfig, CloudTableChatAttachment } from '../../types';
import { handleNewlineShortcut } from '../../utils/composer-keys';
import { AgentModelSelector } from '../AgentModelSelector';
import { ComposerAttachmentBar } from '../ComposerAttachmentBar';
import { PermissionPolicySelector } from '../PermissionPolicySelector';
import { SelectedSkillChips, SkillMentionMenu } from '../SkillMentionPicker';

interface ChatComposerFormProps {
  prompt: string;
  isSubmitting: boolean;
  isDragging: boolean;
  canStop: boolean;
  hasSelectedModel: boolean;
  hasConfiguredModel: boolean;
  modelLabel: string;
  appConfig: AppConfig | null;
  pastedImages: PastedImage[];
  attachedFiles: AttachedFile[];
  attachedCloudTables: CloudTableChatAttachment[];
  showPermissionMenu: boolean;
  showModelMenu: boolean;
  textareaRef: RefObject<HTMLTextAreaElement>;
  isComposingRef: MutableRefObject<boolean>;
  skillMentions: ReturnType<typeof useSkillMentions>;
  onSubmit: (e?: FormEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onPaste: (e: ClipboardEvent) => void;
  onFileSelect: () => void;
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
  onRemoveCloudTable: (index: number) => void;
  onPermissionMenuOpenChange: (open: boolean) => void;
  onModelMenuOpenChange: (open: boolean) => void;
  onModelButtonClick: () => void;
  onModelOptionClick: (configSetId: string) => void;
  onStop: () => void;
}

export function ChatComposerForm({
  prompt,
  isSubmitting,
  isDragging,
  canStop,
  hasSelectedModel,
  hasConfiguredModel,
  modelLabel,
  appConfig,
  pastedImages,
  attachedFiles,
  attachedCloudTables,
  showPermissionMenu,
  showModelMenu,
  textareaRef,
  isComposingRef,
  skillMentions,
  onSubmit,
  onDragOver,
  onDragLeave,
  onDrop,
  onPaste,
  onFileSelect,
  onRemoveImage,
  onRemoveFile,
  onRemoveCloudTable,
  onPermissionMenuOpenChange,
  onModelMenuOpenChange,
  onModelButtonClick,
  onModelOptionClick,
  onStop,
}: ChatComposerFormProps) {
  const { t } = useTranslation();

  return (
    <div className="glass-panel-header border-b-0 pb-3 pt-2">
      <div className="mx-auto w-full max-w-[980px] px-4 sm:px-6">
        <form
          onSubmit={onSubmit}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className="relative w-full"
        >
          <ComposerAttachmentBar
            pastedImages={pastedImages}
            attachedFiles={attachedFiles}
            attachedCloudTables={attachedCloudTables}
            onRemoveImage={onRemoveImage}
            onRemoveFile={onRemoveFile}
            onRemoveCloudTable={onRemoveCloudTable}
          />

          <div
            className={`chat-composer-panel flex min-h-[120px] flex-col px-4 py-3 transition-colors sm:min-h-[132px] sm:py-3.5 ${
              isDragging ? 'ring-2 ring-accent bg-accent-muted' : ''
            }`}
          >
            <SkillMentionMenu
              open={skillMentions.isMentionMenuOpen}
              query={skillMentions.mentionQuery}
              skills={skillMentions.filteredSkills}
              highlightedIndex={skillMentions.highlightedIndex}
              onSelect={skillMentions.selectSkill}
            />
            <SelectedSkillChips
              skills={skillMentions.selectedSkills}
              disabled={isSubmitting}
              onRemove={skillMentions.removeSkill}
            />
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={skillMentions.handlePromptChange}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (skillMentions.handlePromptKeyDown(e)) {
                  return;
                }
                // Enter to send; Ctrl+Enter (and Shift+Enter) for new line
                if (handleNewlineShortcut(e)) {
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) {
                    return;
                  }
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder={t('chat.typeMessage')}
              disabled={isSubmitting}
              rows={1}
              className="min-h-[32px] flex-1 resize-none overflow-y-auto border-none bg-transparent text-[14px] leading-5 text-text-primary outline-none placeholder:text-text-muted sm:min-h-[36px] sm:text-[15px]"
            />

            <div className="mt-3 flex items-center justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onFileSelect}
                  className="composer-flat-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  title={t('welcome.attachFiles')}
                >
                  <Plus className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={skillMentions.insertMentionTrigger}
                  disabled={isSubmitting}
                  className="composer-flat-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  title={t('welcome.mentionSkill')}
                  aria-label={t('welcome.mentionSkill')}
                >
                  <AtSign className="h-4 w-4" />
                </button>

                <PermissionPolicySelector
                  open={showPermissionMenu}
                  onOpenChange={onPermissionMenuOpenChange}
                  buttonClassName="composer-flat-pill inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium"
                />
              </div>

              <div className="flex min-w-0 items-center gap-2">
                {hasConfiguredModel ? (
                  <AgentModelSelector
                    open={showModelMenu}
                    onOpenChange={onModelMenuOpenChange}
                    appConfig={appConfig}
                    fallbackLabel={modelLabel}
                    triggerClassName="composer-flat-pill hidden h-9 min-w-0 max-w-[18rem] items-center gap-1.5 rounded-full px-3 text-[13px] sm:inline-flex"
                    onSelect={onModelOptionClick}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={onModelButtonClick}
                    className="composer-flat-pill hidden h-9 min-w-0 max-w-[18rem] items-center gap-1.5 rounded-full px-3 text-[13px] sm:inline-flex"
                    title={modelLabel}
                  >
                    <span className="truncate">{modelLabel}</span>
                  </button>
                )}

                {canStop && (
                  <button
                    type="button"
                    onClick={onStop}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-active text-text-primary transition-colors hover:bg-surface-hover"
                    title={t('chat.stop')}
                  >
                    <Square className="h-3 w-3" fill="currentColor" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={
                    (!prompt.trim() &&
                      !textareaRef.current?.value.trim() &&
                      pastedImages.length === 0 &&
                      attachedFiles.length === 0 &&
                      attachedCloudTables.length === 0) ||
                    !hasSelectedModel ||
                    isSubmitting
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted"
                  title={t('chat.sendMessage')}
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
