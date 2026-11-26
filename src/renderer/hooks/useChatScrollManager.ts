import { useCallback, useEffect, useRef, useState } from 'react';

interface UseChatScrollManagerOptions {
  activeSessionId: string | null;
  messageCount: number;
  displayedMessageCount: number;
  partialLength: number;
}

export function useChatScrollManager({
  activeSessionId,
  messageCount,
  displayedMessageCount,
  partialLength,
}: UseChatScrollManagerOptions) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true);
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

      isScrollingRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior });
      updateScrollState();

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
      scrollRequestRef.current = requestAnimationFrame(() => {
        scrollTimeoutRef.current = setTimeout(performScroll, 16);
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
      displayedMessageCount === 0
    ) {
      return;
    }

    const requestId = requestAnimationFrame(() => {
      forceScrollToBottom();
      pendingInitialScrollSessionRef.current = null;
    });

    return () => cancelAnimationFrame(requestId);
  }, [activeSessionId, displayedMessageCount, forceScrollToBottom]);

  useEffect(() => {
    const hasNewMessage = messageCount !== prevMessageCountRef.current;
    const isStreamingTick = partialLength !== prevPartialLengthRef.current && !hasNewMessage;

    if (isScrollingRef.current) {
      prevMessageCountRef.current = messageCount;
      prevPartialLengthRef.current = partialLength;
      return;
    }

    if (isUserAtBottomRef.current) {
      if (!isStreamingTick) {
        const behavior: ScrollBehavior = hasNewMessage ? 'smooth' : 'auto';
        scrollToBottom(behavior, false);
      } else {
        scrollToBottom('auto', false);
      }
    }

    prevMessageCountRef.current = messageCount;
    prevPartialLengthRef.current = partialLength;
  }, [messageCount, partialLength, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const messagesContainer = messagesContainerRef.current;
    if (!container || !messagesContainer) return;

    const resizeObserver = new ResizeObserver(() => {
      if (!isScrollingRef.current && isUserAtBottomRef.current) {
        scrollToBottom('auto', false);
      }
    });

    resizeObserver.observe(messagesContainer);

    return () => {
      resizeObserver.disconnect();
    };
  }, [scrollToBottom]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (scrollRequestRef.current) cancelAnimationFrame(scrollRequestRef.current);
      if (scrollStateFrameRef.current) cancelAnimationFrame(scrollStateFrameRef.current);
    };
  }, []);

  return {
    messagesEndRef,
    scrollContainerRef,
    messagesContainerRef,
    showBackToTop,
    showScrollToBottom,
    scrollToConversationTop,
    scrollToConversationBottom,
  };
}
