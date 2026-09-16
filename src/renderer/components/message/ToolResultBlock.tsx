// Fallback ToolResultBlock — only renders for truly orphan results (no matching tool_use anywhere)
import { useState, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, XCircle, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../../store';
import {
  shouldPreferToolResultImages,
  shouldRenderToolResultText,
  shouldUseScreenshotSummary,
} from '../../utils/tool-result-summary';
import type { ToolResultContent, ContentBlock, ToolUseContent, Message } from '../../types';
import { getMcpToolDisplayName } from './toolHelpers';
import { DataLinkedText } from './DataLinkedText';

// Only allow safe image MIME types for data: URI rendering
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

interface ToolResultBlockProps {
  block: ToolResultContent;
  allBlocks?: ContentBlock[];
  message?: Message;
}

export const ToolResultBlock = memo(function ToolResultBlock({
  block,
  allBlocks,
  message,
}: ToolResultBlockProps) {
  const { t } = useTranslation();
  const traceSteps = useAppStore((s) =>
    message?.sessionId ? (s.sessionStates[message.sessionId]?.traceSteps ?? []) : []
  );
  const allMessages = useAppStore((s) =>
    message?.sessionId ? (s.sessionStates[message.sessionId]?.messages ?? []) : []
  );
  const [expanded, setExpanded] = useState(false);

  // If a ToolUseBlock in any message already merges this result, hide this block
  const isOrphan = useMemo(() => {
    if (!message?.sessionId) return true;
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      const hasMatchingToolUse = (msg.content as ContentBlock[]).some(
        (b) => b.type === 'tool_use' && (b as ToolUseContent).id === block.toolUseId
      );
      if (hasMatchingToolUse) return false;
    }
    return true;
  }, [allMessages, block.toolUseId, message?.sessionId]);

  if (!isOrphan) return null;

  // Try to find the tool name from trace steps
  let toolName: string | undefined;
  let toolDisplayName: string | undefined;
  if (message?.sessionId) {
    const toolCallStep = traceSteps.find((s) => s.id === block.toolUseId && s.type === 'tool_call');
    if (toolCallStep) {
      toolName = toolCallStep.toolName;
      toolDisplayName = toolCallStep.title;
    }
  }
  const toolUseBlock = allBlocks?.find(
    (b) => b.type === 'tool_use' && (b as ToolUseContent).id === block.toolUseId
  ) as ToolUseContent | undefined;
  if (!toolName) {
    toolName = toolUseBlock?.name;
  }
  if (!toolDisplayName) {
    toolDisplayName = toolUseBlock?.displayName;
  }

  const displayName = toolName ? getMcpToolDisplayName(toolName, toolDisplayName) : 'tool';

  const getSummary = (): string => {
    const content = typeof block.content === 'string' ? block.content : '';
    if (block.isError) {
      const firstLine = content.split(/\r?\n/)[0];
      return firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
    }
    if (shouldUseScreenshotSummary(toolName, content)) return t('messageCard.screenshotCaptured');
    if (content.length < 60) return content.trim();
    const lines = content.trim().split(/\r?\n/);
    return t('messageCard.linesCount', { count: lines.length });
  };

  const validImages =
    block.images?.filter(
      (image) => image?.mimeType && image?.data && ALLOWED_IMAGE_TYPES.has(image.mimeType)
    ) ?? [];
  const hasImages = validImages.length > 0;
  const preferImageOutput = shouldPreferToolResultImages(
    toolName,
    typeof block.content === 'string' ? block.content : '',
    hasImages,
    block.isError === true
  );
  const shouldShowOutputText = shouldRenderToolResultText(
    toolName,
    typeof block.content === 'string' ? block.content : '',
    hasImages,
    block.isError === true
  );

  return (
    <div className="-mx-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover/60"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          {block.isError ? (
            <XCircle className="h-3.5 w-3.5 text-error" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          )}
        </span>
        <span
          className={`flex-shrink-0 font-mono text-[12px] ${block.isError ? 'text-error' : 'text-text-secondary'}`}
        >
          {displayName}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{getSummary()}</span>
        {hasImages && (
          <span className="flex-shrink-0 text-[11px] text-text-muted">
            {t('messageCard.imagesCount', { count: validImages.length })}
          </span>
        )}
        <ChevronRight
          className={`ml-auto h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="mb-1 ml-4 mt-0.5 animate-fade-in border-l border-border-subtle pb-1 pl-3">
          {preferImageOutput && hasImages && (
            <div className="space-y-1.5 py-1">
              {validImages.map((image, index) => (
                <div key={index} className="overflow-hidden rounded-md">
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Screenshot ${index + 1}`}
                    className="w-full h-auto"
                    style={{ maxHeight: '400px', objectFit: 'contain' }}
                  />
                </div>
              ))}
            </div>
          )}
          {shouldShowOutputText && (
            <div
              className={`max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all rounded-md p-2 font-mono text-[11.5px] leading-5 ${
                block.isError ? 'bg-error/5 text-error' : 'bg-surface-muted/70 text-text-secondary'
              } ${preferImageOutput ? 'mt-1.5' : ''}`}
            >
              <DataLinkedText text={block.content} />
            </div>
          )}
          {!preferImageOutput && hasImages && (
            <div className="mt-1.5 space-y-1.5">
              {validImages.map((image, index) => (
                <div key={index} className="overflow-hidden rounded-md">
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Screenshot ${index + 1}`}
                    className="w-full h-auto"
                    style={{ maxHeight: '400px', objectFit: 'contain' }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
