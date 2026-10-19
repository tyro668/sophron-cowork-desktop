import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { useSkillMentions } from '../hooks/useSkillMentions';
import { getWorkingDirDisplayName } from '../utils/working-dir-label';
import { normalizeWorkspacePath } from '../utils/sidebar-project-groups';
import { BUILTIN_LLM_PROVIDER, parseBuiltinLlmConfigSetId } from '../../shared/builtin-llm';
import { AgentModelSelector } from './AgentModelSelector';
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
import type { CloudTableChatAttachment, ContentBlock } from '../types';
import { getInitialSessionTitle } from '../../shared/session-title';
import {
  FileText,
  BarChart3,
  FolderOpen,
  ArrowRight,
  X,
  Plus,
  BookOpen,
  Table2,
  Check,
  ChevronDown,
  Folder,
  AtSign,
} from 'lucide-react';

type AttachedFile = {
  name: string;
  path: string;
  size: number;
  type: string;
  inlineDataBase64?: string;
};

const EMPTY_WELCOME_CLOUD_TABLE_ATTACHMENTS: CloudTableChatAttachment[] = [];

export function WelcomeView() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isComposingRef = useRef(false);
  const [pastedImages, setPastedImages] = useState<
    Array<{ url: string; base64: string; mediaType: string }>
  >([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { startSession, changeWorkingDir, setWorkingDirPath, isElectron } = useIPC();
  const workingDir = useAppStore((state) => state.workingDir);
  const projects = useAppStore((state) => state.projects);
  const setWorkingDir = useAppStore((state) => state.setWorkingDir);
  const setGlobalNotice = useAppStore((state) => state.setGlobalNotice);
  const isConfigured = useAppStore((state) => state.isConfigured);
  const appConfig = useAppStore((state) => state.appConfig);
  const setAppConfig = useAppStore((state) => state.setAppConfig);
  const setIsConfigured = useAppStore((state) => state.setIsConfigured);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
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
  const canSubmit =
    hasSelectedModel &&
    (prompt.trim().length > 0 ||
      pastedImages.length > 0 ||
      attachedFiles.length > 0 ||
      attachedCloudTables.length > 0);
  const hasConfiguredModel = Boolean(
    isConfigured && (appConfig?.model?.trim() || appConfig?.provider === BUILTIN_LLM_PROVIDER)
  );
  const fallbackWorkingDirLabel = getWorkingDirDisplayName(
    workingDir,
    t('welcome.defaultWorkingFolder'),
    t('welcome.selectWorkingFolder')
  );
  const rendererPlatform = typeof window !== 'undefined' ? window.electronAPI?.platform : undefined;
  const projectOptions = useMemo(() => {
    const activeKey = normalizeWorkspacePath(workingDir, rendererPlatform);
    return [...projects]
      .filter((project) => Boolean(project.cwd?.trim()))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((project) => ({
        id: project.id,
        cwd: project.cwd,
        label:
          project.name?.trim() ||
          getWorkingDirDisplayName(project.cwd, t('welcome.defaultWorkingFolder'), project.cwd),
        active: normalizeWorkspacePath(project.cwd, rendererPlatform) === activeKey,
      }));
  }, [projects, workingDir, rendererPlatform, t]);
  const workingDirLabel =
    projectOptions.find((project) => project.active)?.label ?? fallbackWorkingDirLabel;
  const skillMentions = useSkillMentions({
    prompt,
    setPrompt,
    textareaRef,
    isElectron,
  });

  const handleSelectFolder = async () => {
    try {
      const result = await changeWorkingDir(undefined, workingDir || undefined);
      if (result.success && result.path) {
        setWorkingDir(result.path);
      } else if (result.error && result.error !== 'User cancelled') {
        setGlobalNotice({
          id: `notice-workdir-select-${Date.now()}`,
          type: 'warning',
          message: `${t('welcome.selectWorkingFolderFailed')}: ${result.error}`,
        });
      }
    } catch (error) {
      setGlobalNotice({
        id: `notice-workdir-select-${Date.now()}`,
        type: 'error',
        message:
          error instanceof Error && error.message
            ? `${t('welcome.selectWorkingFolderFailed')}: ${error.message}`
            : t('welcome.selectWorkingFolderFailed'),
      });
    }
  };

  const handleSelectProjectDir = async (path: string) => {
    const result = await setWorkingDirPath(path);
    if (!result.success && result.error && result.error !== 'User cancelled') {
      setGlobalNotice({
        id: `notice-workdir-project-${Date.now()}`,
        type: 'warning',
        message: `${t('welcome.selectWorkingFolderFailed')}: ${result.error}`,
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

  const handleModelOptionClick = async (configSetId: string) => {
    setShowModelMenu(false);
    if (!appConfig) {
      return;
    }

    if (!isElectron || !window.electronAPI) {
      return;
    }

    try {
      const builtinModel = parseBuiltinLlmConfigSetId(configSetId);
      if (!builtinModel && configSetId === appConfig.activeConfigSetId) {
        return;
      }
      if (
        builtinModel &&
        appConfig.provider === 'sophron' &&
        (appConfig.builtinLlmModel?.trim() || appConfig.model?.trim()) === builtinModel
      ) {
        return;
      }

      const result = builtinModel
        ? await window.electronAPI.config.selectBuiltinModel({ model: builtinModel })
        : await window.electronAPI.config.switchSet({ id: configSetId });
      if (result.success) {
        setAppConfig(result.config);
        setIsConfigured(Boolean(result.config.isConfigured));
      }
    } catch (error) {
      setGlobalNotice({
        id: `notice-model-switch-${Date.now()}`,
        type: 'error',
        message: error instanceof Error ? error.message : t('api.saveFailed'),
      });
    }
  };

  // Handle paste event for images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();

    const newImages: Array<{ url: string; base64: string; mediaType: string }> = [];

    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (!blob) continue;

      try {
        // Resize if needed to stay under API limit
        const resizedBlob = await resizeImageIfNeeded(blob);
        const base64 = await blobToBase64(resizedBlob);
        const url = URL.createObjectURL(resizedBlob);
        newImages.push({
          url,
          base64,
          mediaType: resizedBlob.type,
        });
      } catch (err) {
        console.error('Failed to process pasted image:', err);
      }
    }

    setPastedImages((prev) => [...prev, ...newImages]);
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Resize and compress image if needed to stay under 5MB base64 limit
  const resizeImageIfNeeded = async (blob: Blob): Promise<Blob> => {
    // Model API limit is 5MB for base64 encoded images
    // Base64 encoding increases size by ~33%, so we target 3.75MB for the blob
    const MAX_BLOB_SIZE = 3.75 * 1024 * 1024; // 3.75MB

    if (blob.size <= MAX_BLOB_SIZE) {
      return blob; // No need to resize
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        // Calculate scaling factor to reduce file size
        // We use a more aggressive approach: scale down until size is acceptable
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Start with a scale factor based on size ratio
        const scale = Math.sqrt(MAX_BLOB_SIZE / blob.size);
        const quality = 0.9;

        const attemptCompress = (currentScale: number, currentQuality: number): Promise<Blob> => {
          canvas.width = Math.floor(img.width * currentScale);
          canvas.height = Math.floor(img.height * currentScale);

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          return new Promise((resolveBlob) => {
            canvas.toBlob(
              (compressedBlob) => {
                if (!compressedBlob) {
                  reject(new Error('Failed to compress image'));
                  return;
                }

                // If still too large, try again with lower quality or scale
                if (
                  compressedBlob.size > MAX_BLOB_SIZE &&
                  (currentQuality > 0.5 || currentScale > 0.3)
                ) {
                  const newQuality = Math.max(0.5, currentQuality - 0.1);
                  const newScale = currentQuality <= 0.5 ? currentScale * 0.9 : currentScale;
                  attemptCompress(newScale, newQuality).then(resolveBlob);
                } else {
                  resolveBlob(compressedBlob);
                }
              },
              blob.type || 'image/jpeg',
              currentQuality
            );
          });
        };

        attemptCompress(scale, quality).then(resolve).catch(reject);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  };

  const removeImage = (index: number) => {
    setPastedImages((prev) => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].url);
      updated.splice(index, 1);
      return updated;
    });
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => {
      const updated = [...prev];
      updated.splice(index, 1);
      return updated;
    });
  };

  const removeCloudTable = (index: number) => {
    const table = attachedCloudTables[index];
    if (!table) return;
    removeCloudTableFromWelcomeChat(table.id);
  };

  const handleFileSelect = async () => {
    if (!isElectron || !window.electronAPI) {
      console.log('[WelcomeView] Not in Electron, file selection not available');
      return;
    }

    try {
      const filePaths = await window.electronAPI.selectFiles();
      if (filePaths.length === 0) return;

      const newFiles = filePaths.map((filePath) => {
        const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
        return {
          name: fileName,
          path: filePath,
          size: 0,
          type: 'application/octet-stream',
        };
      });

      setAttachedFiles((prev) => [...prev, ...newFiles]);
    } catch (error) {
      console.error('[WelcomeView] Error selecting files:', error);
    }
  };

  // Handle drag and drop for images
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    const otherFiles = files.filter((file) => !file.type.startsWith('image/'));

    if (imageFiles.length > 0) {
      const newImages: Array<{ url: string; base64: string; mediaType: string }> = [];

      for (const file of imageFiles) {
        try {
          // Resize if needed to stay under API limit
          const resizedBlob = await resizeImageIfNeeded(file);
          const base64 = await blobToBase64(resizedBlob);
          const url = URL.createObjectURL(resizedBlob);
          newImages.push({
            url,
            base64,
            mediaType: resizedBlob.type,
          });
        } catch (err) {
          console.error('Failed to process dropped image:', err);
        }
      }

      setPastedImages((prev) => [...prev, ...newImages]);
    }

    if (otherFiles.length > 0) {
      const newFiles = await Promise.all(
        otherFiles.map(async (file) => {
          const droppedPath = 'path' in file && typeof file.path === 'string' ? file.path : '';
          const inlineDataBase64 = droppedPath ? undefined : await blobToBase64(file);

          return {
            name: file.name,
            path: droppedPath,
            size: file.size,
            type: file.type || 'application/octet-stream',
            inlineDataBase64,
          };
        })
      );

      setAttachedFiles((prev) => [...prev, ...newFiles]);
    }
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

    // Build content blocks
    const contentBlocks: ContentBlock[] = [];

    // Add images first
    pastedImages.forEach((img) => {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: img.base64,
        },
      });
    });

    // Add file attachments
    attachedFiles.forEach((file) => {
      contentBlocks.push({
        type: 'file_attachment',
        filename: file.name,
        relativePath: file.path,
        size: file.size,
        mimeType: file.type,
        inlineDataBase64: file.inlineDataBase64,
      });
    });

    if (attachedCloudTables.length > 0) {
      contentBlocks.push({
        type: 'cloud_table_attachment',
        tables: attachedCloudTables,
      });
    }

    // Add text if present
    if (currentPrompt.trim()) {
      contentBlocks.push({
        type: 'text',
        text: currentPrompt.trim(),
      });
    }

    // Use the global working directory (always available after app startup)
    setIsSubmitting(true);
    try {
      const sessionTitle = getInitialSessionTitle(
        currentPrompt,
        attachedFiles[0]?.name ?? attachedCloudTables[0]?.tableName
      );
      const session = await startSession(sessionTitle, contentBlocks, workingDir || undefined, {
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

  const handleTagClick = (tagPrompt: string) => {
    setPrompt(tagPrompt);
    if (textareaRef.current) {
      textareaRef.current.value = tagPrompt;
      adjustTextareaHeight();
      textareaRef.current.focus();
    }
  };

  // Auto-adjust textarea height based on content
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set max height to 200px (about 8 lines), then scroll
      const maxHeight = 200;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
      // Show scrollbar if content exceeds max height
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  };

  // Adjust height when prompt changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [prompt]);

  const quickTags = [
    {
      id: 'create',
      label: t('welcome.createFile'),
      description: t('welcome.createFileDesc'),
      icon: FileText,
      prompt: t('welcome.quickPromptCreate'),
    },
    {
      id: 'crunch',
      label: t('welcome.crunchData'),
      description: t('welcome.crunchDataDesc'),
      icon: BarChart3,
      prompt: t('welcome.quickPromptCrunch'),
    },
    {
      id: 'organize',
      label: t('welcome.organizeFiles'),
      description: t('welcome.organizeFilesDesc'),
      icon: FolderOpen,
      prompt: t('welcome.quickPromptOrganize'),
    },
    {
      id: 'papers',
      label: t('welcome.searchPapers'),
      description: t('welcome.searchPapersDesc'),
      icon: BookOpen,
      prompt: t('welcome.quickPromptPapers'),
    },
  ];

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

        {/* Main Input Card */}
        <form
          onSubmit={handleSubmit}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`chat-composer-panel relative mx-auto mt-5 w-full max-w-[860px] px-4 py-3 transition-colors sm:px-5 sm:py-4 ${
            isDragging ? 'ring-2 ring-accent bg-accent-muted' : ''
          }`}
        >
          {/* Image previews */}
          {pastedImages.length > 0 && (
            <div className="grid w-full grid-cols-2 gap-2 border-b border-border pb-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {pastedImages.map((img, index) => (
                <div key={index} className="group relative">
                  <img
                    src={img.url}
                    alt={t('welcome.pastedImageAlt', { index: index + 1 })}
                    className="aspect-square w-full rounded-lg border border-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    aria-label={t('common.removeImage', { index: index + 1 })}
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-error text-error-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* File attachments */}
          {attachedFiles.length > 0 && (
            <div className="mb-3 space-y-2">
              {attachedFiles.map((file, index) => (
                <div
                  key={index}
                  className="group flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-primary">{file.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    aria-label={t('common.removeAttachment', { name: file.name })}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-error/10 text-error opacity-0 transition-opacity hover:bg-error/20 focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}

          {attachedCloudTables.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachedCloudTables.map((table, index) => (
                <div
                  key={table.id}
                  className="group inline-flex max-w-full items-center gap-2 rounded-lg border border-accent/20 bg-accent-muted px-3 py-2 text-[13px] text-accent-text shadow-soft"
                >
                  <Table2 className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="min-w-0 truncate font-medium">{table.tableName}</span>
                  {table.projectName && (
                    <span className="hidden flex-shrink-0 text-[11px] text-text-muted sm:inline">
                      {table.projectName}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeCloudTable(index)}
                    aria-label={t('common.removeCloudTable', { name: table.tableName })}
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-surface text-text-muted opacity-70 transition-colors hover:bg-error/10 hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Text Input - Auto-resizing */}
          <SkillMentionMenu
            open={skillMentions.isMentionMenuOpen}
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
            rows={3}
            style={{ minHeight: '76px', maxHeight: '140px' }}
            className="w-full resize-none overflow-hidden border-none bg-transparent text-[14px] leading-6 text-text-primary outline-none placeholder:text-text-muted sm:text-[15px]"
            onKeyDown={(e) => {
              if (skillMentions.handlePromptKeyDown(e)) {
                return;
              }
              // Enter to send, Shift+Enter for new line
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-max flex-1 items-center gap-1.5">
              <button
                type="button"
                onClick={handleFileSelect}
                className="composer-flat-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                title={t('welcome.attachFiles')}
              >
                <Plus className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={skillMentions.insertMentionTrigger}
                disabled={isSubmitting}
                className="composer-flat-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                title={t('welcome.mentionSkill')}
                aria-label={t('welcome.mentionSkill')}
              >
                <AtSign className="h-5 w-5" />
              </button>

              <PermissionPolicySelector
                open={showPermissionMenu}
                onOpenChange={handlePermissionMenuOpenChange}
                buttonClassName="composer-flat-pill inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-medium"
              />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="composer-flat-pill inline-flex h-9 min-w-0 max-w-[11rem] shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-medium"
                    title={workingDir || workingDirLabel}
                  >
                    <FolderOpen className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{workingDirLabel}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="max-h-72 w-64 overflow-y-auto"
                >
                  {projectOptions.length > 0 && (
                    <>
                      <DropdownMenuLabel>{t('welcome.projectDirectory')}</DropdownMenuLabel>
                      {projectOptions.map((project) => (
                        <DropdownMenuItem
                          key={project.id}
                          title={project.cwd}
                          onSelect={() => void handleSelectProjectDir(project.cwd)}
                        >
                          <Folder className="mr-2 h-4 w-4 shrink-0 text-text-muted" />
                          <span className="min-w-0 flex-1 truncate">{project.label}</span>
                          {project.active && (
                            <Check className="ml-2 h-4 w-4 shrink-0 text-accent" />
                          )}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onSelect={() => void handleSelectFolder()}>
                    <FolderOpen className="mr-2 h-4 w-4 shrink-0 text-text-muted" />
                    <span>{t('welcome.openFolder')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="ml-auto flex min-w-max items-center gap-2">
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
                  triggerClassName="composer-flat-pill inline-flex h-9 min-w-0 max-w-[13rem] items-center gap-2 rounded-full px-3 text-[13px] font-medium"
                  onSelect={(configSetId) => void handleModelOptionClick(configSetId)}
                />
              ) : (
                <button
                  type="button"
                  onClick={handleModelButtonClick}
                  className="composer-flat-pill inline-flex h-9 min-w-0 max-w-[13rem] items-center gap-2 rounded-full px-3 text-[13px] font-medium"
                  title={modelLabel}
                >
                  <span className="truncate">{modelLabel}</span>
                </button>
              )}

              <button
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className="composer-flat-pill inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-[13px] font-medium text-accent disabled:cursor-not-allowed disabled:text-text-muted"
              >
                <span>{isSubmitting ? t('welcome.starting') : t('welcome.letsGo')}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </form>
        {/* Quick Action Tags */}
        <div className="mx-auto mt-4 flex w-full max-w-[860px] flex-wrap items-center justify-center gap-2">
          {quickTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              title={tag.description}
              onClick={() => handleTagClick(tag.prompt)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:border-accent/30 hover:text-accent"
            >
              <tag.icon className="h-3.5 w-3.5" />
              <span>{tag.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
