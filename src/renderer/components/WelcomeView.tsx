import { handleNewlineShortcut } from '../utils/composer-keys';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import {
  buildComposerContentBlocks,
  useComposerAttachments,
} from '../hooks/useComposerAttachments';
import { useComposerModelSwitcher } from '../hooks/useComposerModelSwitcher';
import { useSkillMentions } from '../hooks/useSkillMentions';
import {
  getWorkingDirDisplayName,
  isInternalDefaultWorkingDirPath,
} from '../utils/working-dir-label';
import { normalizeWorkspacePath } from '../utils/sidebar-project-groups';
import { BUILTIN_LLM_PROVIDER } from '../../shared/builtin-llm';
import { AgentModelSelector } from './AgentModelSelector';
import { ComposerAttachmentBar } from './ComposerAttachmentBar';
import { CreateProjectDialog } from './CreateProjectDialog';
import { PermissionPolicySelector } from './PermissionPolicySelector';
import { SelectedSkillChips, SkillMentionMenu } from './SkillMentionPicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import type { CloudTableChatAttachment } from '../types';
import { getInitialSessionTitle } from '../../shared/session-title';
import {
  FolderOpen,
  FolderPlus,
  ArrowRight,
  ArrowUp,
  Plus,
  Check,
  ChevronDown,
  Folder,
  AtSign,
} from 'lucide-react';

const EMPTY_WELCOME_CLOUD_TABLE_ATTACHMENTS: CloudTableChatAttachment[] = [];

export function WelcomeView() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isComposingRef = useRef(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const [showCreateProjectDialog, setShowCreateProjectDialog] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { startSession, createProject, selectFolders, setWorkingDirPath, isElectron } = useIPC();
  const workingDir = useAppStore((state) => state.workingDir);
  const projects = useAppStore((state) => state.projects);
  const setGlobalNotice = useAppStore((state) => state.setGlobalNotice);
  const isConfigured = useAppStore((state) => state.isConfigured);
  const appConfig = useAppStore((state) => state.appConfig);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const notifyImageProcessError = useCallback(() => {
    setGlobalNotice({
      id: `image-process-failed-${Date.now()}`,
      type: 'warning',
      message: t('chat.imageProcessFailed'),
    });
  }, [setGlobalNotice, t]);
  const {
    pastedImages,
    setPastedImages,
    attachedFiles,
    setAttachedFiles,
    isDragging,
    handlePaste,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeImage,
    removeFile,
  } = useComposerAttachments({
    isElectron,
    onImageProcessError: notifyImageProcessError,
  });
  const closeModelMenu = useCallback(() => setShowModelMenu(false), []);
  const { handleModelOptionClick } = useComposerModelSwitcher({
    isElectron,
    onCloseMenu: closeModelMenu,
  });
  const attachedCloudTables = useAppStore(
    (state) => state.welcomeCloudTableChatDrafts || EMPTY_WELCOME_CLOUD_TABLE_ATTACHMENTS
  );
  const removeCloudTableFromWelcomeChat = useAppStore(
    (state) => state.removeCloudTableFromWelcomeChat
  );
  const clearCloudTablesFromWelcomeChat = useAppStore(
    (state) => state.clearCloudTablesFromWelcomeChat
  );
  const modelLabel = appConfig?.model?.trim() || t('chat.noModel');
  const hasSelectedModel = Boolean(appConfig?.model?.trim());
  const effectiveWorkingDir =
    workingDir && !isInternalDefaultWorkingDirPath(workingDir) ? workingDir.trim() : null;
  const hasWorkingDir = Boolean(effectiveWorkingDir);
  const hasSubmitContent =
    prompt.trim().length > 0 ||
    pastedImages.length > 0 ||
    attachedFiles.length > 0 ||
    attachedCloudTables.length > 0;
  const canSubmit = hasSelectedModel && hasWorkingDir && hasSubmitContent;
  const hasConfiguredModel = Boolean(
    isConfigured && (appConfig?.model?.trim() || appConfig?.provider === BUILTIN_LLM_PROVIDER)
  );
  const fallbackWorkingDirLabel = getWorkingDirDisplayName(
    effectiveWorkingDir,
    t('welcome.defaultWorkingFolder'),
    t('welcome.selectWorkingFolder')
  );
  const rendererPlatform = typeof window !== 'undefined' ? window.electronAPI?.platform : undefined;
  const projectOptions = useMemo(() => {
    const activeKey = normalizeWorkspacePath(effectiveWorkingDir, rendererPlatform);
    return [...projects]
      .filter(
        (project) => Boolean(project.cwd?.trim()) && !isInternalDefaultWorkingDirPath(project.cwd)
      )
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((project) => {
        const folders =
          project.folders && project.folders.length > 0 ? project.folders : [project.cwd];
        return {
          id: project.id,
          cwd: project.cwd,
          folders,
          label:
            project.name?.trim() ||
            getWorkingDirDisplayName(project.cwd, t('welcome.defaultWorkingFolder'), project.cwd),
          active: normalizeWorkspacePath(project.cwd, rendererPlatform) === activeKey,
        };
      });
  }, [projects, effectiveWorkingDir, rendererPlatform, t]);
  const workingDirLabel =
    projectOptions.find((project) => project.active)?.label ?? fallbackWorkingDirLabel;
  const skillMentions = useSkillMentions({
    prompt,
    setPrompt,
    textareaRef,
    isElectron,
    consumePendingSkill: true,
  });

  const handleSelectProjectDir = async (path: string) => {
    try {
      const result = await setWorkingDirPath(path);
      if (!result.success && result.error && result.error !== 'User cancelled') {
        setGlobalNotice({
          id: `notice-workdir-project-${Date.now()}`,
          type: 'warning',
          message: `${t('welcome.selectWorkingFolderFailed')}: ${result.error}`,
        });
      }
    } catch (error) {
      setGlobalNotice({
        id: `notice-workdir-project-${Date.now()}`,
        type: 'error',
        message:
          error instanceof Error && error.message
            ? `${t('welcome.selectWorkingFolderFailed')}: ${error.message}`
            : t('welcome.selectWorkingFolderFailed'),
      });
    }
  };

  const handleOpenModelSettings = () => {
    setSettingsTab('api');
    setShowSettings(true);
  };

  const handleModelButtonClick = () => {
    if (!hasConfiguredModel) {
      handleOpenModelSettings();
      return;
    }

    setShowPermissionMenu(false);
    setShowModelMenu((open) => !open);
  };

  const handlePermissionMenuOpenChange = (open: boolean) => {
    setShowPermissionMenu(open);
    if (open) {
      setShowModelMenu(false);
    }
  };

  const removeCloudTable = (index: number) => {
    const table = attachedCloudTables[index];
    if (!table) return;
    removeCloudTableFromWelcomeChat(table.id);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // Get value from ref to handle both controlled and uncontrolled cases
    const currentPrompt = textareaRef.current?.value || prompt;

    if (
      (!currentPrompt.trim() &&
        pastedImages.length === 0 &&
        attachedFiles.length === 0 &&
        attachedCloudTables.length === 0) ||
      !hasSelectedModel ||
      isSubmitting
    )
      return;

    if (!effectiveWorkingDir) {
      setShowCreateProjectDialog(true);
      return;
    }

    const contentBlocks = buildComposerContentBlocks({
      prompt: currentPrompt,
      pastedImages,
      attachedFiles,
      attachedCloudTables,
    });

    setIsSubmitting(true);
    try {
      const sessionTitle = getInitialSessionTitle(
        currentPrompt,
        attachedFiles[0]?.name ?? attachedCloudTables[0]?.tableName
      );
      const session = await startSession(sessionTitle, contentBlocks, effectiveWorkingDir, {
        selectedSkillNames: skillMentions.selectedSkillNames,
      });
      if (session) {
        setPrompt('');
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
        pastedImages.forEach((img) => URL.revokeObjectURL(img.url));
        setPastedImages([]);
        setAttachedFiles([]);
        clearCloudTablesFromWelcomeChat();
        skillMentions.clearSelectedSkills();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auto-adjust textarea height based on content
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set max height to 220px (about 9 lines), then scroll
      const maxHeight = 220;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
      // Show scrollbar if content exceeds max height
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  };

  // 新建任务 remounts this view: the cursor starts in the empty input.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Adjust height when prompt changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [prompt]);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-transparent px-4 py-6 md:px-8">
      <div className="my-auto w-full max-w-[860px] animate-fade-in">
        <div className="mx-auto max-w-[36rem] text-center">
          <h1 className="text-[18px] font-semibold tracking-normal text-text-primary">
            {t('welcome.title')}
          </h1>
          <p className="mt-2 text-[13px] text-text-secondary">{t('welcome.subtitle')}</p>
        </div>

        {/* API Not Configured Hint */}
        {!isConfigured && (
          <p className="mx-auto mt-5 max-w-[44rem] rounded-xl border border-warning/20 bg-warning/10 px-3 py-2 text-center text-[13px] text-text-secondary shadow-soft">
            {t('welcome.apiNotConfigured')}{' '}
            <button
              type="button"
              onClick={() => {
                setSettingsTab('api');
                setShowSettings(true);
              }}
              className="inline-flex items-center gap-1 text-accent hover:text-accent-hover transition-colors"
            >
              {t('welcome.goToSettings')}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </p>
        )}

        {/* Working Directory Required Hint */}
        {!hasWorkingDir && (
          <p
            className={`mx-auto ${isConfigured ? 'mt-5' : 'mt-2.5'} max-w-[44rem] rounded-xl border border-warning/20 bg-warning/10 px-3 py-2 text-center text-[13px] text-text-secondary shadow-soft`}
          >
            {t('welcome.workingFolderRequired')}{' '}
            <button
              type="button"
              onClick={() => setShowCreateProjectDialog(true)}
              className="inline-flex items-center gap-1 font-medium text-accent transition-colors hover:text-accent-hover"
            >
              {t('welcome.newProject')}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </p>
        )}

        {/* Main Input Card */}
        <form
          onSubmit={handleSubmit}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`chat-composer-panel relative mx-auto mt-6 flex w-full max-w-[860px] flex-col px-4 pb-3 pt-3.5 transition-colors ${
            isDragging ? 'ring-2 ring-accent bg-accent-muted' : ''
          }`}
        >
          <ComposerAttachmentBar
            pastedImages={pastedImages}
            attachedFiles={attachedFiles}
            attachedCloudTables={attachedCloudTables}
            onRemoveImage={removeImage}
            onRemoveFile={removeFile}
            onRemoveCloudTable={removeCloudTable}
          />

          {/* Text Input - Auto-resizing */}
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
            onChange={(e) => {
              skillMentions.handlePromptChange(e);
              adjustTextareaHeight();
            }}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onPaste={handlePaste}
            placeholder={t('welcome.placeholder')}
            rows={4}
            style={{ minHeight: '96px', maxHeight: '220px' }}
            className="w-full resize-none overflow-hidden border-none bg-transparent text-[14px] leading-6 text-text-primary outline-none placeholder:text-text-muted/85"
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
                handleSubmit();
              }
            }}
          />

          {/* Bottom Actions */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border-subtle/60 pt-2">
            <div className="flex min-w-max flex-1 items-center gap-1">
              <button
                type="button"
                onClick={handleFileSelect}
                className="composer-flat-button flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                title={t('welcome.attachFiles')}
              >
                <Plus className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={skillMentions.insertMentionTrigger}
                disabled={isSubmitting}
                className="composer-flat-button flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                title={t('welcome.mentionSkill')}
                aria-label={t('welcome.mentionSkill')}
              >
                <AtSign className="h-4 w-4" />
              </button>

              <span className="mx-0.5 h-3.5 w-px bg-border-subtle" aria-hidden="true" />

              <PermissionPolicySelector
                open={showPermissionMenu}
                onOpenChange={handlePermissionMenuOpenChange}
                buttonClassName="composer-flat-pill inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium"
              />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={`group inline-flex h-7 min-w-0 max-w-[11.5rem] shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium transition-colors ${
                      hasWorkingDir
                        ? 'composer-flat-pill'
                        : 'border border-warning/35 bg-warning/10 text-text-primary hover:bg-warning/15'
                    }`}
                    title={effectiveWorkingDir || workingDirLabel}
                  >
                    <FolderOpen
                      className={`h-3.5 w-3.5 shrink-0 ${
                        hasWorkingDir ? 'text-text-muted' : 'text-warning'
                      }`}
                    />
                    <span className="truncate">{workingDirLabel}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-65 transition-transform duration-150 group-data-[state=open]:rotate-180" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-64">
                  <DropdownMenuLabel className="px-2.5 pb-1 pt-1 text-[11px] font-medium text-text-muted">
                    {t('welcome.projectDirectory')}
                  </DropdownMenuLabel>
                  {projectOptions.length > 0 ? (
                    <div className="scrollbar-hover max-h-56 space-y-0.5 overflow-y-auto">
                      {projectOptions.map((project) => (
                        <DropdownMenuItem
                          key={project.id}
                          title={project.folders.join('\n')}
                          onSelect={() => void handleSelectProjectDir(project.cwd)}
                          className={`text-[12.5px] ${
                            project.active ? 'bg-accent-muted font-medium text-accent' : ''
                          }`}
                        >
                          <Folder className="mr-2 h-3.5 w-3.5 shrink-0 text-text-muted" />
                          <span className="min-w-0 flex-1 truncate">{project.label}</span>
                          {project.folders.length > 1 && (
                            <span className="ml-1.5 shrink-0 text-[11px] tabular-nums text-text-muted">
                              {project.folders.length}
                            </span>
                          )}
                          {project.active && (
                            <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-accent" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  ) : (
                    <div className="px-2.5 py-2 text-[12px] text-text-muted">
                      {t('welcome.noProjectsYet')}
                    </div>
                  )}
                  <DropdownMenuSeparator className="mx-0 my-1.5" />
                  <DropdownMenuItem
                    onSelect={() => setShowCreateProjectDialog(true)}
                    className="text-[12.5px] font-medium text-accent data-[highlighted]:text-accent"
                  >
                    <FolderPlus className="mr-2 h-3.5 w-3.5 shrink-0" />
                    <span>{t('welcome.newProject')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="ml-auto flex min-w-max items-center gap-1.5">
              {hasConfiguredModel ? (
                <AgentModelSelector
                  open={showModelMenu}
                  onOpenChange={(open) => {
                    setShowModelMenu(open);
                    if (open) {
                      setShowPermissionMenu(false);
                    }
                  }}
                  appConfig={appConfig}
                  fallbackLabel={modelLabel}
                  triggerClassName="composer-flat-pill inline-flex h-7 min-w-0 max-w-[14rem] items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium"
                  onSelect={(configSetId) => void handleModelOptionClick(configSetId)}
                />
              ) : (
                <button
                  type="button"
                  onClick={handleModelButtonClick}
                  className="composer-flat-pill inline-flex h-7 min-w-0 max-w-[14rem] items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium"
                  title={modelLabel}
                >
                  <span className="truncate">{modelLabel}</span>
                </button>
              )}

              <button
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-2.5 text-[12.5px] font-medium text-accent-foreground shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted disabled:shadow-none"
              >
                <span>{isSubmitting ? t('welcome.starting') : t('welcome.letsGo')}</span>
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
              </button>
            </div>
          </div>
        </form>
      </div>
      <CreateProjectDialog
        open={showCreateProjectDialog}
        onOpenChange={setShowCreateProjectDialog}
        onSelectFolders={selectFolders}
        onCreateProject={createProject}
      />
    </div>
  );
}
