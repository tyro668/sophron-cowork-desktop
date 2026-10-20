// Tool use row — flat Codex-style activity line, expands to show input/output
import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Loader2, XCircle, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../../store';
import {
  shouldPreferToolResultImages,
  shouldRenderToolResultText,
  shouldUseScreenshotSummary,
} from '../../utils/tool-result-summary';
import type { ToolUseContent, ToolResultContent, ContentBlock, Message } from '../../types';
import { AskUserQuestionBlock } from './AskUserQuestionBlock';
import { TodoWriteBlock } from './TodoWriteBlock';
import { getToolIcon, getToolLabel } from './toolHelpers';
import { DataLinkedText } from './DataLinkedText';

// Only allow safe image MIME types for data: URI rendering
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

interface ToolUseBlockProps {
  block: ToolUseContent;
  allBlocks?: ContentBlock[];
  message?: Message;
}

export const ToolUseBlock = memo(function ToolUseBlock({
  block,
  allBlocks,
  message,
}: ToolUseBlockProps) {
  const { t } = useTranslation();
  const traceSteps = useAppStore((s) =>
    message?.sessionId ? (s.sessionStates[message.sessionId]?.traceSteps ?? []) : []
  );
  const allMessages = useAppStore((s) =>
    message?.sessionId ? (s.sessionStates[message.sessionId]?.messages ?? []) : []
  );
  const activeTurn = useAppStore((s) =>
    message?.sessionId ? (s.sessionStates[message.sessionId]?.activeTurn ?? null) : null
  );
  const [expanded, setExpanded] = useState(false);

  // Special-case tool UIs
  if (block.name === 'AskUserQuestion') {
    return <AskUserQuestionBlock block={block} />;
  }
  if (block.name === 'TodoWrite') {
    return <TodoWriteBlock block={block} />;
  }

  // Find matching tool_result: first in same message, then across all session messages
  let toolResult = allBlocks?.find(
    (b) => b.type === 'tool_result' && (b as ToolResultContent).toolUseId === block.id
  ) as ToolResultContent | undefined;

  if (!toolResult && message?.sessionId) {
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      const found = (msg.content as ContentBlock[]).find(
        (b) => b.type === 'tool_result' && (b as ToolResultContent).toolUseId === block.id
      );
      if (found) {
        toolResult = found as ToolResultContent;
        break;
      }
    }
  }

  // Determine state: running / success / error
  // Only show spinner if session still has an active turn; otherwise treat as done
  const hasActiveTurn = Boolean(activeTurn);
  const isRunning = !toolResult && hasActiveTurn;
  const isError = toolResult?.isError === true;
  const isSuccess = toolResult && !isError;

  const label = getToolLabel(block.name, block.input, block.displayName);
  const isMCPTool = block.name.startsWith('mcp__');
  const mcpServerName = isMCPTool ? block.name.match(/^mcp__(.+?)__/)?.[1] : null;

  const getSummary = (): string => {
    if (!toolResult) return '';
    const content = typeof toolResult.content === 'string' ? toolResult.content : '';
    if (toolResult.isError) {
      const firstLine = content.split(/\r?\n/)[0];
      return firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
    }
    if (shouldUseScreenshotSummary(block.name, content)) return t('messageCard.screenshotCaptured');
    if (content.length < 60) return content.trim();
    const lines = content.trim().split(/\r?\n/);
    return t('messageCard.linesCount', { count: lines.length });
  };

  const summary = getSummary();
  const validImages =
    toolResult?.images?.filter(
      (image) => image?.mimeType && image?.data && ALLOWED_IMAGE_TYPES.has(image.mimeType)
    ) ?? [];
  const preferImageOutput = toolResult
    ? shouldPreferToolResultImages(
        block.name,
        typeof toolResult.content === 'string' ? toolResult.content : '',
        validImages.length > 0,
        isError
      )
    : false;
  const shouldShowOutputText = toolResult
    ? shouldRenderToolResultText(
        block.name,
        typeof toolResult.content === 'string' ? toolResult.content : '',
        validImages.length > 0,
        isError
      )
    : false;

  // Duration from trace steps
  let duration: number | undefined;
  if (message?.sessionId) {
    const resultStep = traceSteps.find((s) => s.id === block.id && s.type === 'tool_result');
    duration = resultStep?.duration;
  }

  return (
    <div className="-mx-2">
      {/* Flat activity row — Codex-style, no card chrome */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
          isError
            ? 'border border-error/20 bg-error/5 hover:bg-error/8'
            : 'hover:bg-surface-hover/60'
        }`}
      >
        {/* Status icon */}
        <span
          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center ${
            isError ? 'text-error' : isRunning ? 'text-accent' : 'text-text-muted'
          }`}
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isError ? (
            <XCircle className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          )}
        </span>

        {/* Tool icon */}
        <span className="flex-shrink-0 text-text-muted">{getToolIcon(block.name)}</span>

        {/* Label */}
        <span className="min-w-0 truncate font-mono text-[12px] text-text-secondary">{label}</span>

        {/* MCP badge */}
        {isMCPTool && mcpServerName && (
          <span className="flex-shrink-0 rounded bg-mcp/10 px-1.5 py-px text-[10px] font-medium text-mcp">
            {mcpServerName}
          </span>
        )}

        {/* Summary / duration */}
        {isSuccess && summary && !expanded && (
          <span className="max-w-[220px] flex-shrink-0 truncate text-[11px] text-text-muted">
            {summary}
          </span>
        )}
        {isError && summary && !expanded && (
          <span className="min-w-0 max-w-[260px] truncate text-[11px] text-error">{summary}</span>
        )}
        {isError && !expanded && (
          <span className="flex-shrink-0 text-[11px] text-accent-text">
            {t('messageCard.viewReason')}
          </span>
        )}
        {validImages.length > 0 && (
          <span className="flex-shrink-0 text-[11px] text-text-muted">
            {t('messageCard.imagesCount', { count: validImages.length })}
          </span>
        )}
        {duration !== undefined && (
          <span className="flex-shrink-0 text-[10px] tabular-nums text-text-muted">
            {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Chevron */}
        <ChevronRight
          className={`ml-auto h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {/* Expanded content — indented under a thin left rail */}
      {expanded && (
        <div className="mb-1 ml-4 mt-0.5 animate-fade-in border-l border-border-subtle pb-1 pl-3">
          {/* Input section */}
          <div className="py-1">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted">
              {t('messageCard.input')}
            </div>
            <pre className="whitespace-pre-wrap break-all rounded-md bg-surface-muted p-2 font-mono text-[11.5px] leading-5 text-text-secondary">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>

          {/* Output section */}
          {toolResult && (
            <div className="py-1">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                {t('messageCard.output')}
              </div>
              {preferImageOutput &&
                validImages.map((image, index) => (
                  <div key={index} className="mt-1.5 overflow-hidden rounded-md">
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={`Output ${index + 1}`}
                      className="w-full h-auto"
                      style={{ maxHeight: '400px', objectFit: 'contain' }}
                    />
                  </div>
                ))}
              {shouldShowOutputText && (
                <div
                  className={`max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all rounded-md p-2 font-mono text-[11.5px] leading-5 ${
                    isError ? 'bg-error/5 text-error' : 'bg-surface-muted text-text-secondary'
                  } ${preferImageOutput ? 'mt-1.5' : ''}`}
                >
                  <DataLinkedText text={toolResult.content} />
                </div>
              )}
              {!preferImageOutput &&
                validImages.map((image, index) => (
                  <div key={index} className="mt-1.5 overflow-hidden rounded-md">
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={`Output ${index + 1}`}
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
