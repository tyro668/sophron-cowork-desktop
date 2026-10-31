// MessageCard — top-level chat message renderer.
// Delegates block rendering to ContentBlockView and its sub-components.
import { useState, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Clock, PencilLine, RotateCcw, Wand2, XCircle } from 'lucide-react';
import type { Message, ContentBlock, ToolUseContent, ToolResultContent } from '../types';
import { ContentBlockView } from './message/ContentBlockView';
import { DataObjectCards, extractDataObjects } from './message/DataObjectCards';
import { ChatScriptCards, type ChatScriptMessageInfo } from './message/ChatScriptCards';

interface MessageCardProps {
  message: Message;
  isStreaming?: boolean;
  /** User message: load its text back into the composer. */
  onEdit?: (text: string) => void;
  /** User message: send the same text again as a new message. */
  onResend?: (text: string) => void;
  /** Assistant message (last of a turn): re-ask the preceding user message. */
  onRegenerate?: () => void;
  /** 对话「转成脚本」: entry, backlink and proposal cards of this turn (last message only). */
  chatScript?: ChatScriptMessageInfo;
  sessionTitle?: string;
  /** Open the 转成脚本 confirm dialog for this turn. */
  onConvertToScript?: () => void;
}

export const MessageCard = memo(function MessageCard({
  message,
  isStreaming,
  onEdit,
  onResend,
  onRegenerate,
  chatScript,
  sessionTitle,
  onConvertToScript,
}: MessageCardProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isQueued = message.localStatus === 'queued';
  const isCancelled = message.localStatus === 'cancelled';
  const rawContent = message.content as unknown;
  const contentBlocks = useMemo(
    () =>
      Array.isArray(rawContent)
        ? (rawContent as ContentBlock[])
        : [{ type: 'text', text: String(rawContent ?? '') } as ContentBlock],
    [rawContent]
  );
  const [copied, setCopied] = useState(false);

  // Build a set of tool_result IDs that have a matching tool_use (for merging)
  const mergedResultIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of contentBlocks) {
      if (b.type === 'tool_use') {
        const tu = b as ToolUseContent;
        const result = contentBlocks.find(
          (r) => r.type === 'tool_result' && (r as ToolResultContent).toolUseId === tu.id
        );
        if (result) ids.add((result as ToolResultContent).toolUseId);
      }
    }
    return ids;
  }, [contentBlocks]);

  // Extract text content for copying
  const getTextContent = () =>
    contentBlocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');

  const hasText = getTextContent().trim().length > 0;
  const dataObjects = useMemo(
    () =>
      isUser || isStreaming
        ? []
        : extractDataObjects(
            contentBlocks
              .filter((block) => block.type === 'text')
              .map((block) => (block as { text: string }).text)
          ),
    [contentBlocks, isUser, isStreaming]
  );

  const handleCopy = async () => {
    const text = getTextContent();
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard unavailable
      }
    }
  };

  return (
    <div className="animate-fade-in">
      {isUser ? (
        // User message - right-aligned flat tinted bubble in the conversation flow.
        <div className="group flex items-start justify-end gap-2">
          <div
            className={`message-user max-w-[min(44rem,88%)] min-w-0 space-y-2 break-words px-4 py-2.5 text-[14px] leading-6 ${
              isQueued ? 'opacity-70 border-dashed' : ''
            } ${isCancelled ? 'opacity-60' : ''}`}
          >
            {isQueued && (
              <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                <Clock className="w-3 h-3" />
                <span>{t('messageCard.queued')}</span>
              </div>
            )}
            {isCancelled && (
              <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                <XCircle className="w-3 h-3" />
                <span>{t('messageCard.cancelled')}</span>
              </div>
            )}
            {contentBlocks.length === 0 ? (
              <span className="text-text-muted italic">{t('messageCard.emptyMessage')}</span>
            ) : (
              contentBlocks.map((block, index) => (
                <ContentBlockView
                  key={
                    'id' in block ? (block as { id: string }).id : `block-${block.type}-${index}`
                  }
                  block={block}
                  isUser={isUser}
                  isStreaming={isStreaming}
                />
              ))
            )}
          </div>
          <div className="mt-1.5 flex flex-shrink-0 flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <MessageActionButton onClick={handleCopy} title={t('messageCard.copyMessage')}>
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
            </MessageActionButton>
            {onEdit && hasText && (
              <MessageActionButton
                onClick={() => onEdit(getTextContent())}
                title={t('messageCard.editMessage')}
              >
                <PencilLine className="h-3 w-3" />
              </MessageActionButton>
            )}
            {onResend && hasText && (
              <MessageActionButton
                onClick={() => onResend(getTextContent())}
                title={t('messageCard.resendMessage')}
              >
                <RotateCcw className="h-3 w-3" />
              </MessageActionButton>
            )}
          </div>
        </div>
      ) : (
        // Assistant message — no bubble, direct content.
        <div className="space-y-1.5">
          {contentBlocks.map((block, index) => {
            // Skip tool_result blocks that are merged into their tool_use card
            if (
              block.type === 'tool_result' &&
              mergedResultIds.has((block as ToolResultContent).toolUseId)
            ) {
              return null;
            }
            return (
              <ContentBlockView
                key={'id' in block ? (block as { id: string }).id : `block-${block.type}-${index}`}
                block={block}
                isUser={isUser}
                isStreaming={isStreaming}
                allBlocks={contentBlocks}
                message={message}
              />
            );
          })}
          <DataObjectCards objects={dataObjects} />
          {chatScript && !isStreaming && (
            <ChatScriptCards info={chatScript} sessionTitle={sessionTitle ?? ''} />
          )}
          {onRegenerate && !isStreaming && (
            <div className="flex items-center gap-1 pt-1 text-xs text-text-muted">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-surface-hover hover:text-text-primary"
              >
                {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                {t('messageCard.copy')}
              </button>
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-surface-hover hover:text-text-primary"
              >
                <RotateCcw className="h-3 w-3" />
                {t('messageCard.regenerate')}
              </button>
              {chatScript?.entry && onConvertToScript && (
                <button
                  type="button"
                  data-testid="chat-script-entry"
                  onClick={onConvertToScript}
                  className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-accent hover:bg-accent-muted"
                >
                  <Wand2 className="h-3 w-3" />
                  {chatScript.entry === 'reconvert'
                    ? t('chatScript.reconvert')
                    : t('chatScript.convert')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function MessageActionButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
    >
      {children}
    </button>
  );
}
