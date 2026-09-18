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
import { useSkillMentions } from '../hooks/useSkillMentions';
import { BUILTIN_LLM_PROVIDER, parseBuiltinLlmConfigSetId } from '../../shared/builtin-llm';
import { AgentModelSelector } from './AgentModelSelector';
import { MessageCard } from './MessageCard';
import { PermissionPolicySelector } from './PermissionPolicySelector';
import { SelectedSkillChips, SkillMentionMenu } from './SkillMentionPicker';
import { Button } from './ui';
import type { CloudTableChatAttachment, Message, ContentBlock } from '../types';
import { Square, Plus, Loader2, Plug, X, Clock, ArrowUp, ArrowDown, Table2 } from 'lucide-react';

type AttachedFile = {
  name: string;
  path: string;
  size: number;
  type: string;
  inlineDataBase64?: string;
};

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
  const isConfigured = useAppStore((s) => s.isConfigured);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const setIsConfigured = useAppStore((s) => s.setIsConfigured);
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
  const [pastedImages, setPastedImages] = useState<
    Array<{ url: string; base64: string; mediaType: string }>
  >([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
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
    // Show streaming message if we have partial text OR partial thinking
    const hasStreamingContent = partialMessage || partialThinking;
    if (!hasStreamingContent || !activeTurn?.userMessageId) return messages;
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
          mediaType: resizedBlob.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        });
      } catch (err) {
        // Notify the user instead of silently dropping the error
        setGlobalNotice({
          id: `image-paste-failed-${Date.now()}`,
          type: 'warning',
          message: t('chat.imageProcessFailed'),
        });
      }
    }

    setPastedImages((prev) => [...prev, ...newImages]);
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('FileReader result is not a string'));
          return;
        }
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const parts = result.split(',');
        resolve(parts[1] || '');
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
    if (!activeSessionId) return;
    const table = attachedCloudTables[index];
    if (!table) return;
    removeCloudTableFromChat(activeSessionId, table.id);
  };

  const handleFileSelect = async () => {
    if (!isElectron || !window.electronAPI) {
      console.log('[ChatView] Not in Electron, file selection not available');
      return;
    }

    try {
      const filePaths = await window.electronAPI.selectFiles();
      if (filePaths.length === 0) return;

      // Get file info for each selected file
      const newFiles = filePaths.map((filePath) => {
        const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
        return {
          name: fileName,
          path: filePath,
          size: 0, // Will be set by backend when copying
          type: 'application/octet-stream',
        };
      });

      setAttachedFiles((prev) => [...prev, ...newFiles]);
    } catch (error) {
      console.error('[ChatView] Error selecting files:', error);
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

    // Process images
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
          // Notify the user instead of silently dropping the error
          setGlobalNotice({
            id: `image-drop-failed-${Date.now()}`,
            type: 'warning',
            message: t('chat.imageProcessFailed'),
          });
        }
      }

      setPastedImages((prev) => [...prev, ...newImages]);
    }

    // Process other files
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

  // Load active MCP connectors
  useEffect(() => {
    if (isElectron && typeof window !== 'undefined' && window.electronAPI) {
      const loadConnectors = async () => {
        try {
          const statuses = await window.electronAPI.mcp.getServerStatus();
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
          relativePath: file.path, // Will be processed by backend to copy to .tmp
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

  const messageElements = useMemo(
    () =>
      displayedMessages.map((message, index) => {
        const isStreaming = typeof message.id === 'string' && message.id.startsWith('partial-');
        const previous = index > 0 ? displayedMessages[index - 1] : null;
        const startsTurn = message.role === 'user' || previous?.role === 'user';
        return (
          <div
            key={message.id}
            className={`chat-message-row ${index === 0 ? '' : startsTurn ? 'mt-6' : 'mt-3'}`}
          >
            <MessageCard message={message} isStreaming={isStreaming} />
          </div>
        );
      }),
    [displayedMessages]
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
        className="glass-panel-header relative grid h-12 grid-cols-[1fr_auto_1fr] items-center px-4 lg:px-8"
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

          {/* Processing indicator - show when we have an active turn but no streaming content yet */}
          {hasActiveTurn &&
            (!partialMessage || partialMessage.trim() === '') &&
            !partialThinking && (
              <div className="-mx-2 flex items-center gap-2 px-2 py-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                <span className="text-[12px] text-text-muted">{t('chat.processing')}</span>
              </div>
            )}

          {/* Real-time execution timer */}
          {liveElapsed > 0 && (
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
            {/* Image previews */}
            {pastedImages.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-3">
                {pastedImages.map((img, index) => (
                  <div key={img.url || `pasted-image-${index}`} className="relative group">
                    <img
                      src={img.url}
                      alt={t('common.pastedImageAlt', { index: index + 1 })}
                      className="w-full aspect-square object-cover rounded-lg border border-border block"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      aria-label={t('common.removeImage', { index: index + 1 })}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-error text-error-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* File attachments */}
            {attachedFiles.length > 0 && (
              <div className="space-y-2 mb-3">
                {attachedFiles.map((file, index) => (
                  <div
                    key={file.path || `attached-file-${index}`}
                    className="group flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-text-primary truncate">{file.name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      aria-label={t('common.removeAttachment', { name: file.name })}
                      className="w-6 h-6 rounded-full hover:bg-error/10 text-text-muted hover:text-error flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden />
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
                    className="group inline-flex max-w-full items-center gap-2 rounded-lg bg-accent-muted px-3 py-1.5 text-[13px] text-accent-text"
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
                      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-error/10 hover:text-error"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              className={`chat-composer-panel flex min-h-[120px] flex-col px-4 py-3 transition-colors sm:min-h-[132px] sm:py-3.5 ${
                isDragging ? 'ring-2 ring-accent bg-accent-muted' : ''
              }`}
            >
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
                  // Enter to send, Shift+Enter for new line
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
