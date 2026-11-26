import { mcpClient } from '../features/mcp/api/mcp-client';
import { handleNewlineShortcut } from '../utils/composer-keys';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
  buildComposerContentBlocks,
  useComposerAttachments,
} from '../hooks/useComposerAttachments';
import { useComposerModelSwitcher } from '../hooks/useComposerModelSwitcher';
import { useSkillMentions } from '../hooks/useSkillMentions';
import { BUILTIN_LLM_PROVIDER } from '../../shared/builtin-llm';
import { AgentModelSelector } from './AgentModelSelector';
import { ComposerAttachmentBar } from './ComposerAttachmentBar';
import { MessageCard } from './MessageCard';
import type { ChatScriptMessageInfo } from './message/ChatScriptCards';
import { chatScriptAnchors, detectScheduleTime } from '../../shared/chat-to-script';
import type { ScriptPackageSummary } from '../../shared/automation/script-package';
import { TaskActivity } from './message/TaskActivity';
import { PermissionPolicySelector } from './PermissionPolicySelector';
import { SelectedSkillChips, SkillMentionMenu } from './SkillMentionPicker';
import { Button } from './ui';
import type { CloudTableChatAttachment, ContentBlock, Message } from '../types';
import { Square, Plus, Plug, Clock, ArrowUp, ArrowDown, AtSign } from 'lucide-react';

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
  const [activeConnectors, setActiveConnectors] = useState<
    { id: string; name: string; connected: boolean; toolCount: number }[]
  >([]);
  const [showConnectorLabel, setShowConnectorLabel] = useState(true);
  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const connectorMeasureRef = useRef<HTMLDivElement>(null);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevMessageCountRef = useRef(0);
  const prevPartialLengthRef = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRequestRef = useRef<number | null>(null);
  const scrollStateFrameRef = useRef<number | null>(null);
  const isScrollingRef = useRef(false);
  const pendingInitialScrollSessionRef = useRef<string | null>(null);
  const showBackToTopRef = useRef(false);
  const showScrollToBottomRef = useRef(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const hasActiveTurn = Boolean(activeTurn);
  const pendingCount = pendingTurns.length;
  const isSessionRunning = activeSession?.status === 'running';
  const canStop = isSessionRunning || hasActiveTurn || pendingCount > 0;
  const modelLabel = appConfig?.model?.trim() || t('chat.noModel');
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

  const updateScrollState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isUserAtBottomRef.current = distanceToBottom <= 80;
    const nextShowBackToTop =
      container.scrollTop > 160 && container.scrollHeight > container.clientHeight;
    const nextShowScrollToBottom =
      distanceToBottom > 80 && container.scrollHeight > container.clientHeight;
    if (nextShowBackToTop !== showBackToTopRef.current) {
      showBackToTopRef.current = nextShowBackToTop;
      setShowBackToTop(nextShowBackToTop);
    }
    if (nextShowScrollToBottom !== showScrollToBottomRef.current) {
      showScrollToBottomRef.current = nextShowScrollToBottom;
      setShowScrollToBottom(nextShowScrollToBottom);
    }
  }, []);

  // Debounced scroll function to prevent scroll conflicts
  const scrollToBottom = useRef((behavior: ScrollBehavior = 'auto', immediate: boolean = false) => {
    // Cancel any pending scroll requests
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
    if (scrollRequestRef.current) {
      cancelAnimationFrame(scrollRequestRef.current);
      scrollRequestRef.current = null;
    }

    const performScroll = () => {
      if (!isUserAtBottomRef.current) return;

      // Mark as scrolling to prevent concurrent scrolls
      isScrollingRef.current = true;

      messagesEndRef.current?.scrollIntoView({ behavior });
      updateScrollState();

      // Reset scrolling flag after a short delay
      setTimeout(
        () => {
          isScrollingRef.current = false;
        },
        behavior === 'smooth' ? 300 : 50
      );
    };

    if (immediate) {
      performScroll();
    } else {
      // Use RAF + timeout for debouncing
      scrollRequestRef.current = requestAnimationFrame(() => {
        scrollTimeoutRef.current = setTimeout(performScroll, 16); // ~1 frame delay
      });
    }
  }).current;

  const forceScrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    isScrollingRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    isUserAtBottomRef.current = true;
    updateScrollState();

    setTimeout(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
      isUserAtBottomRef.current = true;
      updateScrollState();
      isScrollingRef.current = false;
    }, 80);
  }, [updateScrollState]);

  const scrollToConversationTop = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    isUserAtBottomRef.current = false;
    container.scrollTo({ top: 0, behavior: 'smooth' });
    setShowBackToTop(false);
    showBackToTopRef.current = false;
    showScrollToBottomRef.current = true;
    setShowScrollToBottom(true);
  }, []);

  const scrollToConversationBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    isScrollingRef.current = true;
    isUserAtBottomRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    showScrollToBottomRef.current = false;
    setShowScrollToBottom(false);

    setTimeout(() => {
      updateScrollState();
      isScrollingRef.current = false;
    }, 320);
  }, [updateScrollState]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    updateScrollState();
    // 用户阅读旧消息时，阻止新消息自动滚动打断视线
    const onScroll = () => {
      if (scrollStateFrameRef.current !== null) return;
      scrollStateFrameRef.current = requestAnimationFrame(() => {
        scrollStateFrameRef.current = null;
        updateScrollState();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (scrollStateFrameRef.current !== null) {
        cancelAnimationFrame(scrollStateFrameRef.current);
        scrollStateFrameRef.current = null;
      }
    };
  }, [updateScrollState]);

  useEffect(() => {
    pendingInitialScrollSessionRef.current = activeSessionId;
    isUserAtBottomRef.current = true;
    showBackToTopRef.current = false;
    showScrollToBottomRef.current = false;
    setShowBackToTop(false);
    setShowScrollToBottom(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (
      !activeSessionId ||
      pendingInitialScrollSessionRef.current !== activeSessionId ||
      displayedMessages.length === 0
    ) {
      return;
    }

    const requestId = requestAnimationFrame(() => {
      forceScrollToBottom();
      pendingInitialScrollSessionRef.current = null;
    });

    return () => cancelAnimationFrame(requestId);
  }, [activeSessionId, displayedMessages.length, forceScrollToBottom]);

  useEffect(() => {
    const messageCount = messages.length;
    const partialLength = partialMessage.length + partialThinking.length;
    const hasNewMessage = messageCount !== prevMessageCountRef.current;
    const isStreamingTick = partialLength !== prevPartialLengthRef.current && !hasNewMessage;

    // Skip scroll if already scrolling (prevent conflicts)
    if (isScrollingRef.current) {
      prevMessageCountRef.current = messageCount;
      prevPartialLengthRef.current = partialLength;
      return;
    }

    if (isUserAtBottomRef.current) {
      if (!isStreamingTick) {
        // New message - use smooth scroll but with debounce
        const behavior: ScrollBehavior = hasNewMessage ? 'smooth' : 'auto';
        scrollToBottom(behavior, false);
      } else {
        // Streaming tick - use instant scroll with debounce
        scrollToBottom('auto', false);
      }
    }

    prevMessageCountRef.current = messageCount;
    prevPartialLengthRef.current = partialLength;
  }, [messages.length, partialMessage.length, partialThinking.length, scrollToBottom]);

  // Additional scroll trigger for content height changes (e.g., TodoWrite expand/collapse)
  useEffect(() => {
    const container = scrollContainerRef.current;
    const messagesContainer = messagesContainerRef.current;
    if (!container || !messagesContainer) return;

    const resizeObserver = new ResizeObserver(() => {
      // Don't interfere with ongoing scrolls
      if (!isScrollingRef.current && isUserAtBottomRef.current) {
        // Scroll to bottom when content height changes
        scrollToBottom('auto', false);
      }
    });

    resizeObserver.observe(messagesContainer);

    return () => {
      resizeObserver.disconnect();
    };
  }, [scrollToBottom]); // ResizeObserver is stable — no need to recreate on message count changes

  // Cleanup scroll timeouts on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (scrollRequestRef.current) {
        cancelAnimationFrame(scrollRequestRef.current);
      }
      if (scrollStateFrameRef.current) {
        cancelAnimationFrame(scrollStateFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeSessionId]);

  const removeCloudTable = (index: number) => {
    if (!activeSessionId) return;
    const table = attachedCloudTables[index];
    if (!table) return;
    removeCloudTableFromChat(activeSessionId, table.id);
  };

  // Load active MCP connectors
  useEffect(() => {
    if (isElectron && typeof window !== 'undefined' && window.electronAPI) {
      const loadConnectors = async () => {
        try {
          const statuses = await mcpClient.getServerStatus();
          const active =
            (
              statuses as Array<{ id: string; name: string; connected: boolean; toolCount: number }>
            )?.filter((s) => s.connected && s.toolCount > 0) || [];
          setActiveConnectors(active);
        } catch (err) {
          console.error('Failed to load MCP connectors:', err);
        }
      };
      loadConnectors();
      // Refresh every 5 seconds
      const interval = setInterval(loadConnectors, 5000);
      return () => clearInterval(interval);
    }
  }, [isElectron]);

  useEffect(() => {
    const titleEl = titleRef.current;
    const headerEl = headerRef.current;
    const measureEl = connectorMeasureRef.current;
    if (!titleEl || !headerEl || !measureEl) {
      setShowConnectorLabel(true);
      return;
    }
    const updateLabelVisibility = () => {
      const isTruncated = titleEl.scrollWidth > titleEl.clientWidth;
      const headerStyle = window.getComputedStyle(headerEl);
      const paddingLeft = Number.parseFloat(headerStyle.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(headerStyle.paddingRight) || 0;
      const contentWidth = headerEl.clientWidth - paddingLeft - paddingRight;
      const titleWidth = titleEl.getBoundingClientRect().width;
      const rightColumnWidth = Math.max(0, (contentWidth - titleWidth) / 2);
      const connectorFullWidth = measureEl.getBoundingClientRect().width;
      setShowConnectorLabel(!isTruncated && rightColumnWidth >= connectorFullWidth);
    };
    updateLabelVisibility();
    const observer = new ResizeObserver(() => {
      updateLabelVisibility();
    });
    observer.observe(titleEl);
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [activeSession?.title, activeConnectors.length]);

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
  const resendText = useCallback(
    (text: string) => {
      if (!activeSessionId || !text.trim()) return;
      void continueSession(activeSessionId, [{ type: 'text', text: text.trim() }], {});
    },
    [activeSessionId, continueSession]
  );
  const findPreviousUserText = (index: number): string | null => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = displayedMessages[i];
      if (candidate.role !== 'user') continue;
      const content = candidate.content as unknown;
      const text = Array.isArray(content)
        ? (content as ContentBlock[])
            .filter((block) => block.type === 'text')
            .map((block) => (block as { text: string }).text)
            .join('\n')
        : String(content ?? '');
      if (text.trim()) return text.trim();
    }
    return null;
  };

  // 对话「转成脚本」: packages generated from this conversation (backlink cards). Reloaded when
  // the editor closes or a generation job changes.
  useEffect(() => {
    const api = window.electronAPI?.automation?.scripts;
    if (!activeSessionId || !api || scriptEditorOpen) return;
    let cancelled = false;
    void api
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
              onResend={canActOnMessages && message.role === 'user' ? resendText : undefined}
              onRegenerate={
                canActOnMessages &&
                message.role === 'assistant' &&
                !isPendingReply &&
                displayedMessages[index + 1]?.role !== 'assistant' &&
                findPreviousUserText(index)
                  ? () => resendText(findPreviousUserText(index) ?? '')
                  : undefined
              }
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
      resendText,
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
      {/* Header */}
      <div
        ref={headerRef}
        className="glass-panel-header titlebar-drag relative grid h-12 grid-cols-[1fr_auto_1fr] items-center px-4 lg:px-8"
      >
        <div aria-hidden="true" />
        <h2
          ref={titleRef}
          className="text-[15px] font-medium text-text-primary text-center truncate max-w-[40vw] lg:max-w-[32rem]"
        >
          {activeSession.title}
        </h2>
        {activeConnectors.length > 0 && (
          <>
            <div
              ref={connectorMeasureRef}
              aria-hidden="true"
              className="absolute left-0 top-0 -z-10 opacity-0 pointer-events-none"
            >
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full">
                <Plug className="w-3.5 h-3.5" />
                <span className="text-xs font-medium whitespace-nowrap">
                  {t('chat.connectorCount', { count: activeConnectors.length })}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-mcp/10 justify-self-end">
              <Plug className="w-3.5 h-3.5 text-mcp" />
              <span className="text-xs text-mcp font-medium">
                {showConnectorLabel
                  ? t('chat.connectorCount', { count: activeConnectors.length })
                  : activeConnectors.length}
              </span>
            </div>
          </>
        )}
      </div>

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

      {/* Input */}
      <div className="glass-panel-header border-b-0 pb-3 pt-2">
        <div className="mx-auto w-full max-w-[980px] px-4 sm:px-6">
          <form
            onSubmit={handleSubmit}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="relative w-full"
          >
            <ComposerAttachmentBar
              pastedImages={pastedImages}
              attachedFiles={attachedFiles}
              attachedCloudTables={attachedCloudTables}
              onRemoveImage={removeImage}
              onRemoveFile={removeFile}
              onRemoveCloudTable={removeCloudTable}
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
                onPaste={handlePaste}
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
                placeholder={t('chat.typeMessage')}
                disabled={isSubmitting}
                rows={1}
                className="min-h-[32px] flex-1 resize-none overflow-y-auto border-none bg-transparent text-[14px] leading-5 text-text-primary outline-none placeholder:text-text-muted sm:min-h-[36px] sm:text-[15px]"
              />

              <div className="mt-3 flex items-center justify-between gap-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={handleFileSelect}
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
                    onOpenChange={handlePermissionMenuOpenChange}
                    buttonClassName="composer-flat-pill inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium"
                  />
                </div>

                <div className="flex min-w-0 items-center gap-2">
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
                      triggerClassName="composer-flat-pill hidden h-9 min-w-0 max-w-[18rem] items-center gap-1.5 rounded-full px-3 text-[13px] sm:inline-flex"
                      onSelect={(configSetId) => void handleModelOptionClick(configSetId)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={handleModelButtonClick}
                      className="composer-flat-pill hidden h-9 min-w-0 max-w-[18rem] items-center gap-1.5 rounded-full px-3 text-[13px] sm:inline-flex"
                      title={modelLabel}
                    >
                      <span className="truncate">{modelLabel}</span>
                    </button>
                  )}

                  {canStop && (
                    <button
                      type="button"
                      onClick={handleStop}
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
    </div>
  );
}
