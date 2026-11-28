import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { automationClient } from '../features/automation/api/automation-client';
import {
  useActiveSessionId,
  useCurrentSession,
  useActiveSessionMessages,
  useActivePartialContent,
  useActiveTurn,
  usePendingTurns,
  useActiveExecutionClock,
  useAppConfig,
} from '../store/selectors';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { useChatScrollManager } from '../hooks/useChatScrollManager';
import {
  buildComposerContentBlocks,
  useComposerAttachments,
} from '../hooks/useComposerAttachments';
import { useComposerModelSwitcher } from '../hooks/useComposerModelSwitcher';
import { useSkillMentions } from '../hooks/useSkillMentions';
import { BUILTIN_LLM_PROVIDER } from '../../shared/builtin-llm';
import { ChatComposerForm } from './chat/ChatComposerForm';
import { getAgentModelLabel } from './AgentModelSelector';
import { ChatHeader } from './chat/ChatHeader';
import { MessageCard } from './MessageCard';
import type { ChatScriptMessageInfo } from './message/ChatScriptCards';
import { chatScriptAnchors, detectScheduleTime } from '../../shared/chat-to-script';
import type { ScriptPackageSummary } from '../../shared/automation/script-package';
import { TaskActivity } from './message/TaskActivity';
import { Button } from './ui';
import type { CloudTableChatAttachment, ContentBlock, Message } from '../types';
import { Clock, ArrowUp, ArrowDown } from 'lucide-react';

const EMPTY_CLOUD_TABLE_ATTACHMENTS: CloudTableChatAttachment[] = [];

export function ChatView() {
  const { t } = useTranslation();
  // Scoped selectors — each subscription only re-renders when its slice changes
  const activeSessionId = useActiveSessionId();
  const activeSession = useCurrentSession();
  const messages = useActiveSessionMessages();
  const { partialMessage, partialThinking } = useActivePartialContent();
  const activeTurn = useActiveTurn();
  const pendingTurns = usePendingTurns();
  const executionClock = useActiveExecutionClock();
  const appConfig = useAppConfig();
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const chatScriptJobs = useAppStore((s) => s.chatScriptJobs);
  const scriptEditorOpen = useAppStore((s) => s.scriptEditor !== null);
  const openChatScriptDialog = useAppStore((s) => s.openChatScriptDialog);
  const [originPackages, setOriginPackages] = useState<ScriptPackageSummary[]>([]);
  const isConfigured = useAppStore((s) => s.isConfigured);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const attachedCloudTables = useAppStore((s) =>
    activeSessionId
      ? (s.cloudTableChatDraftsBySession[activeSessionId] ?? EMPTY_CLOUD_TABLE_ATTACHMENTS)
      : EMPTY_CLOUD_TABLE_ATTACHMENTS
  );
  const removeCloudTableFromChat = useAppStore((s) => s.removeCloudTableFromChat);
  const clearCloudTablesFromChat = useAppStore((s) => s.clearCloudTablesFromChat);
  const { continueSession, stopSession, isElectron } = useIPC();
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const closeModelMenu = useCallback(() => setShowModelMenu(false), []);
  const { handleModelOptionClick } = useComposerModelSwitcher({
    isElectron,
    onCloseMenu: closeModelMenu,
  });
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasActiveTurn = Boolean(activeTurn);
  const pendingCount = pendingTurns.length;
  const isSessionRunning = activeSession?.status === 'running';
  const canStop = isSessionRunning || hasActiveTurn || pendingCount > 0;
  const modelLabel = getAgentModelLabel(appConfig, t('chat.noModel'));
  const hasSelectedModel = Boolean(appConfig?.model?.trim());
  const hasConfiguredModel = Boolean(
    isConfigured && (appConfig?.model?.trim() || appConfig?.provider === BUILTIN_LLM_PROVIDER)
  );
  const skillMentions = useSkillMentions({
    prompt,
    setPrompt,
    textareaRef,
    isElectron,
  });

  const displayedMessages = useMemo(() => {
    if (!activeSessionId) return messages;
    // While a turn is active, keep a pending assistant reply slot anchored to
    // the turn's user message — it hosts streamed content and the activity
    // indicator so the loading state reads as part of the reply.
    if (!activeTurn?.userMessageId) return messages;
    const anchorIndex = messages.findIndex((message) => message.id === activeTurn.userMessageId);
    if (anchorIndex === -1) return messages;

    let insertIndex = anchorIndex + 1;
    while (insertIndex < messages.length) {
      if (messages[insertIndex].role === 'user') break;
      insertIndex += 1;
    }

    const contentBlocks: ContentBlock[] = [];
    if (partialThinking) {
      contentBlocks.push({ type: 'thinking', thinking: partialThinking });
    }
    if (partialMessage) {
      contentBlocks.push({ type: 'text', text: partialMessage });
    }

    const streamingMessage: Message = {
      id: `partial-${activeSessionId}`,
      sessionId: activeSessionId,
      role: 'assistant',
      content: contentBlocks,
      timestamp: Date.now(),
    };

    return [...messages.slice(0, insertIndex), streamingMessage, ...messages.slice(insertIndex)];
  }, [activeSessionId, activeTurn?.userMessageId, messages, partialMessage, partialThinking]);

  // Format execution time for display
  const formatExecutionTime = useCallback((ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }, []);

  // --- Real-time execution timer ---
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    const isActive = Boolean(executionClock?.startAt && executionClock.endAt === null);
    if (!isActive) {
      return;
    }
    setClockNow(Date.now());
    const interval = setInterval(() => {
      setClockNow(Date.now());
    }, 500);
    return () => clearInterval(interval);
  }, [executionClock?.startAt, executionClock?.endAt]);

  const liveElapsed =
    executionClock?.startAt == null
      ? 0
      : Math.max(0, (executionClock.endAt ?? clockNow) - executionClock.startAt);
  const timerActive = Boolean(executionClock?.startAt && executionClock.endAt === null);

  const {
    messagesEndRef,
    scrollContainerRef,
    messagesContainerRef,
    showBackToTop,
    showScrollToBottom,
    scrollToConversationTop,
    scrollToConversationBottom,
  } = useChatScrollManager({
    activeSessionId,
    messageCount: messages.length,
    displayedMessageCount: displayedMessages.length,
    partialLength: partialMessage.length + partialThinking.length,
  });

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeSessionId]);

  const removeCloudTable = (index: number) => {
    if (!activeSessionId) return;
    const table = attachedCloudTables[index];
    if (!table) return;
    removeCloudTableFromChat(activeSessionId, table.id);
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
      !activeSessionId ||
      !hasSelectedModel ||
      isSubmitting
    )
      return;

    setIsSubmitting(true);
    try {
      const contentBlocks = buildComposerContentBlocks({
        prompt: currentPrompt,
        pastedImages,
        attachedFiles,
        attachedCloudTables,
      });

      // Send message with content blocks
      await continueSession(activeSessionId, contentBlocks, {
        selectedSkillNames: skillMentions.selectedSkillNames,
      });

      // Clean up
      setPrompt('');
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
      pastedImages.forEach((img) => URL.revokeObjectURL(img.url));
      setPastedImages([]);
      setAttachedFiles([]);
      clearCloudTablesFromChat(activeSessionId);
      skillMentions.clearSelectedSkills();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStop = () => {
    if (activeSessionId) {
      stopSession(activeSessionId);
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

  const canActOnMessages = Boolean(activeSessionId) && !activeTurn && !isSubmitting;
  const editIntoComposer = useCallback((text: string) => {
    setPrompt(text);
    if (textareaRef.current) {
      textareaRef.current.value = text;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(text.length, text.length);
      });
    }
  }, []);
  const resendContent = useCallback(
    (content: ContentBlock[]) => {
      if (!activeSessionId || !content.length) return;
      void continueSession(activeSessionId, content, {});
    },
    [activeSessionId, continueSession]
  );
  const findPreviousUserContent = (index: number): ContentBlock[] | undefined => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = displayedMessages[i];
      if (candidate.role !== 'user') continue;
      const content = candidate.content as unknown;
      if (Array.isArray(content)) return content.length ? content : undefined;
      const text = String(content ?? '').trim();
      return text ? [{ type: 'text', text }] : undefined;
    }
  };

  // 对话「转成脚本」: packages generated from this conversation (backlink cards). Reloaded when
  // the editor closes or a generation job changes.
  useEffect(() => {
    if (!activeSessionId || !automationClient.isAvailable() || scriptEditorOpen) return;
    let cancelled = false;
    void automationClient.scripts
      .list()
      .then((list) => {
        if (!cancelled)
          setOriginPackages(list.filter((pkg) => pkg.origin?.sessionId === activeSessionId));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, scriptEditorOpen, chatScriptJobs]);

  // Entry (strict trigger), backlink, job and proposal cards, under the last message of a turn.
  const chatScriptByMessage = useMemo(() => {
    const result = new Map<string, ChatScriptMessageInfo>();
    if (!activeSessionId) return result;
    const anchors = chatScriptAnchors(messages, {
      running: Boolean(activeTurn) || isSubmitting,
      sessionError: activeSession?.status === 'error',
    });
    const packagesByAnchor = new Map<string, ScriptPackageSummary[]>();
    for (const pkg of originPackages) {
      const key = pkg.origin!.messageId;
      packagesByAnchor.set(key, [...(packagesByAnchor.get(key) ?? []), pkg]);
    }
    const ids = new Set([
      ...anchors.keys(),
      ...packagesByAnchor.keys(),
      ...Object.keys(chatScriptJobs),
    ]);
    for (const id of ids) {
      const anchor = anchors.get(id);
      const packages = packagesByAnchor.get(id) ?? [];
      const job =
        chatScriptJobs[id]?.sessionId === activeSessionId ? chatScriptJobs[id] : undefined;
      if (!anchor && packages.length === 0 && !job) continue;
      result.set(id, {
        sessionId: activeSessionId,
        ...(anchor?.eligible && job?.status !== 'running'
          ? { entry: packages.length > 0 ? ('reconvert' as const) : ('convert' as const) }
          : {}),
        packages,
        ...(job ? { job } : {}),
        ...(anchor?.proposal
          ? {
              proposal: {
                target: anchor.proposal.target,
                scheduleTime:
                  anchor.proposal.scheduleTime ?? detectScheduleTime(anchor.turn.userText),
              },
            }
          : {}),
      });
    }
    return result;
  }, [
    activeSessionId,
    messages,
    activeTurn,
    isSubmitting,
    activeSession?.status,
    originPackages,
    chatScriptJobs,
  ]);

  const messageElements = useMemo(
    () =>
      displayedMessages.map((message, index) => {
        const isPendingReply = typeof message.id === 'string' && message.id.startsWith('partial-');
        const previous = index > 0 ? displayedMessages[index - 1] : null;
        const startsTurn = message.role === 'user' || previous?.role === 'user';
        const regenerateContent =
          canActOnMessages &&
          message.role === 'assistant' &&
          !isPendingReply &&
          displayedMessages[index + 1]?.role !== 'assistant'
            ? findPreviousUserContent(index)
            : undefined;
        return (
          <div
            key={message.id}
            className={`chat-message-row ${index === 0 ? '' : startsTurn ? 'mt-6' : 'mt-3'}`}
          >
            <MessageCard
              message={message}
              isStreaming={isPendingReply}
              chatScript={
                displayedMessages[index + 1]?.role === 'assistant'
                  ? undefined
                  : chatScriptByMessage.get(String(message.id))
              }
              sessionTitle={activeSession?.title}
              onConvertToScript={
                activeSessionId
                  ? () =>
                      openChatScriptDialog({
                        sessionId: activeSessionId,
                        messageId: String(message.id),
                      })
                  : undefined
              }
              onEdit={canActOnMessages && message.role === 'user' ? editIntoComposer : undefined}
              onResend={canActOnMessages && message.role === 'user' ? resendContent : undefined}
              onRegenerate={regenerateContent ? () => resendContent(regenerateContent) : undefined}
            />
            {isPendingReply && activeSessionId && activeTurn && (
              <TaskActivity
                sessionId={activeSessionId}
                activeTurnStepId={activeTurn.stepId}
                hasStreamingText={Boolean(partialMessage.trim() || partialThinking.trim())}
                elapsedMs={liveElapsed}
                now={clockNow}
              />
            )}
          </div>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      displayedMessages,
      chatScriptByMessage,
      openChatScriptDialog,
      activeSession?.title,
      canActOnMessages,
      editIntoComposer,
      resendContent,
      activeSessionId,
      activeTurn,
      partialMessage,
      partialThinking,
      liveElapsed,
      clockNow,
    ]
  );

  // Fallback only when the turn's anchor message isn't in the list (no pending
  // reply row was inserted) — otherwise the indicator lives inside the reply.
  const showStandaloneActivity = Boolean(
    activeSessionId &&
    activeTurn &&
    !displayedMessages.some(
      (message) => typeof message.id === 'string' && message.id.startsWith('partial-')
    )
  );

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <span>{t('chat.loadingConversation')}</span>
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden bg-transparent">
      <ChatHeader title={activeSession.title} isElectron={isElectron} />

      {showBackToTop && (
        <div className="pointer-events-none absolute left-0 right-0 top-12 z-20 flex justify-center px-4">
          <Button
            variant="secondary"
            size="icon"
            onClick={scrollToConversationTop}
            aria-label={t('chat.backToTop')}
            title={t('chat.backToTop')}
            className="pointer-events-auto mt-3 h-9 w-9 rounded-full border-border-subtle text-text-secondary shadow-soft hover:text-text-primary"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      )}

      {showScrollToBottom && (
        <div className="pointer-events-none absolute bottom-[9.5rem] left-0 right-0 z-20 flex justify-center px-4">
          <Button
            variant="secondary"
            size="icon"
            onClick={scrollToConversationBottom}
            aria-label={t('chat.scrollToBottom')}
            title={t('chat.scrollToBottom')}
            className="pointer-events-auto h-9 w-9 rounded-full border-border-subtle text-text-secondary shadow-soft hover:text-text-primary"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div ref={messagesContainerRef} className="w-full max-w-[980px] mx-auto py-5 px-4 lg:px-6">
          {displayedMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-28 text-text-muted space-y-3 text-center">
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted/80">
                {t('common.appName')}
              </p>
              <p className="text-base text-text-secondary">{t('chat.startConversation')}</p>
            </div>
          ) : (
            messageElements
          )}

          {showStandaloneActivity && activeSessionId && activeTurn && (
            <TaskActivity
              sessionId={activeSessionId}
              activeTurnStepId={activeTurn.stepId}
              hasStreamingText={Boolean(partialMessage.trim() || partialThinking.trim())}
              elapsedMs={liveElapsed}
              now={clockNow}
            />
          )}

          {/* Real-time execution timer */}
          {!hasActiveTurn && liveElapsed > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-1 ml-0.5">
              <Clock className="w-3 h-3" />
              <span>
                {timerActive
                  ? formatExecutionTime(liveElapsed)
                  : t('messageCard.executionTime', { time: formatExecutionTime(liveElapsed) })}
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <ChatComposerForm
        prompt={prompt}
        isSubmitting={isSubmitting}
        isDragging={isDragging}
        canStop={canStop}
        hasSelectedModel={hasSelectedModel}
        hasConfiguredModel={hasConfiguredModel}
        modelLabel={modelLabel}
        appConfig={appConfig}
        pastedImages={pastedImages}
        attachedFiles={attachedFiles}
        attachedCloudTables={attachedCloudTables}
        showPermissionMenu={showPermissionMenu}
        showModelMenu={showModelMenu}
        textareaRef={textareaRef}
        isComposingRef={isComposingRef}
        skillMentions={skillMentions}
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
        onFileSelect={handleFileSelect}
        onRemoveImage={removeImage}
        onRemoveFile={removeFile}
        onRemoveCloudTable={removeCloudTable}
        onPermissionMenuOpenChange={handlePermissionMenuOpenChange}
        onModelMenuOpenChange={(open) => {
          setShowModelMenu(open);
          if (open) setShowPermissionMenu(false);
        }}
        onModelButtonClick={handleModelButtonClick}
        onModelOptionClick={(configSetId) => void handleModelOptionClick(configSetId)}
        onStop={handleStop}
      />
    </div>
  );
}
