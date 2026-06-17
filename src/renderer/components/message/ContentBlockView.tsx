// Dispatches a single ContentBlock to the appropriate sub-renderer
import { Suspense, lazy, isValidElement, cloneElement, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { PanelErrorBoundary } from '../PanelErrorBoundary';
import {
  splitTextByFileMentions,
  splitChildrenByFileMentions,
  getFileLinkButtonClassName,
} from '../../utils/file-link';
import { resolvePathAgainstWorkspace } from '../../../shared/workspace-path';
import {
  normalizeLocalFileMarkdownLinks,
  resolveLocalFilePathFromHref,
} from '../../utils/markdown-local-link';
import { normalizeLatexDelimiters } from '../../utils/latex-delimiters';
import { isHtmlReportPath } from '../../../shared/report-path';
import {
  normalizeDataResourceMarkdownLinks,
  parseDataResourceHref,
} from '../../../shared/data-resource-link';
import type {
  CloudTableAttachmentContent,
  ToolUseContent,
  ToolResultContent,
  FileAttachmentContent,
} from '../../types';
import { FileText, Table2 } from 'lucide-react';
import { CodeBlock } from './CodeBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolUseBlock } from './ToolUseBlock';
import { ToolResultBlock } from './ToolResultBlock';
import type { ContentBlockViewProps } from './types';

const MessageMarkdown = lazy(() =>
  import('../MessageMarkdown').then((module) => ({ default: module.MessageMarkdown }))
);

// Cowork citation guidance can emit ~[Title](url)~ markers.
// Render them as regular links instead of strikethrough links.
function normalizeCitationMarkdownLinks(markdown: string): string {
  return markdown.replace(/~\[(.+?)\]\(([^)\s]+)\)~/g, '[$1]($2)');
}

export const ContentBlockView = memo(function ContentBlockView({
  block,
  isUser,
  isStreaming,
  allBlocks,
  message,
}: ContentBlockViewProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workingDir = useAppStore((s) => s.workingDir);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const navigateToDataElement = useAppStore((s) => s.navigateToDataElement);
  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;

  const resolveFilePath = (value: string) => resolvePathAgainstWorkspace(value, currentWorkingDir);
  const openOrRevealFile = useCallback(
    async (resolvedPath: string) => {
      if (typeof window === 'undefined' || !window.electronAPI) {
        return;
      }

      try {
        const api = window.electronAPI;
        const handled =
          isHtmlReportPath(resolvedPath) && api.openGeneratedReport
            ? await api.openGeneratedReport(resolvedPath, currentWorkingDir ?? undefined)
            : api.showItemInFolder
              ? await api.showItemInFolder(resolvedPath, currentWorkingDir ?? undefined)
              : false;
        if (!handled) {
          setGlobalNotice({
            id: `message-card-reveal-failed-${Date.now()}`,
            type: 'warning',
            message: t('context.revealFailed'),
          });
        }
      } catch (error) {
        setGlobalNotice({
          id: `message-card-reveal-failed-${Date.now()}`,
          type: 'warning',
          message:
            error instanceof Error && error.message ? error.message : t('context.revealFailed'),
        });
      }
    },
    [currentWorkingDir, setGlobalNotice, t]
  );

  const renderFileButton = (value: string, key?: string) => (
    <button
      key={key}
      type="button"
      onClick={async () => {
        const resolvedPath = resolveFilePath(value);
        await openOrRevealFile(resolvedPath);
      }}
      className={getFileLinkButtonClassName()}
      title={resolveFilePath(value)}
    >
      {value}
    </button>
  );

  const renderFileMentionParts = (
    parts: ReturnType<typeof splitChildrenByFileMentions>,
    keyPrefix: string
  ) =>
    parts.map((part, partIndex) => {
      const key = `${keyPrefix}-${partIndex}`;
      if (part.type === 'file') {
        return renderFileButton(part.value, key);
      }
      if (part.type === 'text') {
        return <span key={key}>{part.value}</span>;
      }
      if (isValidElement(part.value)) {
        return part.value.key ? part.value : cloneElement(part.value, { key });
      }
      return <span key={key}>{String(part.value)}</span>;
    });

  const renderChildrenWithFileLinks = (children: unknown, keyPrefix: string) => {
    const normalized = Array.isArray(children) ? children : [children];
    const parts = splitChildrenByFileMentions(normalized);
    return renderFileMentionParts(parts, keyPrefix);
  };

  const markdownComponents = useMemo(
    () => ({
      a({ children, href }: { children?: React.ReactNode; href?: string }) {
        const dataTarget = parseDataResourceHref(href);
        if (dataTarget) {
          return (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                navigateToDataElement(dataTarget);
              }}
              className="prose-accent-link underline underline-offset-2"
              title={dataTarget.id}
            >
              {children}
            </button>
          );
        }

        const localFilePath = resolveLocalFilePathFromHref(href, currentWorkingDir);
        if (localFilePath) {
          return (
            <button
              type="button"
              onClick={async () => {
                await openOrRevealFile(localFilePath);
              }}
              className={getFileLinkButtonClassName()}
              title={localFilePath}
            >
              {children}
            </button>
          );
        }

        const safeHref = href && /^(?:https?:|mailto:|#)/i.test(href) ? href : undefined;
        return (
          <a
            href={safeHref}
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              if (safeHref && typeof window !== 'undefined' && window.electronAPI?.openExternal) {
                void window.electronAPI.openExternal(safeHref);
              }
            }}
            className="prose-accent-link"
          >
            {children}
          </a>
        );
      },
      blockquote({ children }: { children?: React.ReactNode }) {
        return (
          <blockquote className="border-l-2 border-accent/40 pl-4 text-text-muted">
            {children}
          </blockquote>
        );
      },
      code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
        const match = /language-([\w+#.-]+)/.exec(className || '');
        const isInline = !match;

        if (isInline) {
          const raw = String(children);
          const parts = splitTextByFileMentions(raw);
          if (parts.length === 1 && parts[0]?.type === 'file') {
            return renderFileButton(parts[0].value);
          }
          return (
            <code
              className="prose-accent-inline px-1.5 py-0.5 rounded bg-surface-muted font-mono text-sm"
              {...props}
            >
              {children}
            </code>
          );
        }

        return <CodeBlock language={match[1]}>{String(children).replace(/\n$/, '')}</CodeBlock>;
      },
      p({ children }: { children?: React.ReactNode }) {
        return <p className="text-left">{renderChildrenWithFileLinks(children, 'p')}</p>;
      },
      li({ children }: { children?: React.ReactNode }) {
        return <li className="text-left">{renderChildrenWithFileLinks(children, 'li')}</li>;
      },
      table({ children }: { children?: React.ReactNode }) {
        return (
          <div className="overflow-x-auto my-3">
            <table className="min-w-full border-collapse">{children}</table>
          </div>
        );
      },
      th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
        return (
          <th
            className="border border-border px-3 py-2 text-sm font-medium text-text-primary bg-surface-muted"
            style={style}
          >
            {children}
          </th>
        );
      },
      td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
        return (
          <td className="border border-border px-3 py-2 text-sm text-text-primary" style={style}>
            {children}
          </td>
        );
      },
      input({ checked, ...props }: { checked?: boolean }) {
        return (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="mr-2 accent-accent"
            {...props}
          />
        );
      },
      strong({ children }: { children?: React.ReactNode }) {
        return <strong>{renderChildrenWithFileLinks(children, 'strong')}</strong>;
      },
      em({ children }: { children?: React.ReactNode }) {
        return <em>{renderChildrenWithFileLinks(children, 'em')}</em>;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentWorkingDir, navigateToDataElement, openOrRevealFile]
  );

  switch (block.type) {
    case 'text': {
      const textBlock = block as { type: 'text'; text: string };
      const text = textBlock.text || '';
      const normalizedText = normalizeDataResourceMarkdownLinks(
        normalizeCitationMarkdownLinks(
          normalizeLocalFileMarkdownLinks(normalizeLatexDelimiters(text))
        )
      );

      if (!text) {
        return <span className="text-text-muted italic">{t('messageCard.emptyText')}</span>;
      }

      // Simple text display for user messages, Markdown for assistant
      if (isUser) {
        return (
          <p className="text-text-primary whitespace-pre-wrap break-words text-left">
            {text}
            {isStreaming && <span className="inline-block w-2 h-4 bg-accent ml-1 animate-pulse" />}
          </p>
        );
      }

      return (
        <PanelErrorBoundary
          name="MessageMarkdown"
          fallback={
            <div className="prose-chat max-w-none text-text-primary whitespace-pre-wrap break-words">
              {normalizedText}
            </div>
          }
        >
          <Suspense
            fallback={
              <div className="prose-chat max-w-none text-text-primary whitespace-pre-wrap break-words">
                {normalizedText}
              </div>
            }
          >
            <MessageMarkdown
              normalizedText={normalizedText}
              isStreaming={isStreaming}
              components={markdownComponents}
            />
          </Suspense>
        </PanelErrorBoundary>
      );
    }

    case 'image': {
      const imageBlock = block as {
        type: 'image';
        source: { type: 'base64'; media_type: string; data: string };
      };
      if (!imageBlock.source?.media_type || !imageBlock.source?.data) {
        return null;
      }
      const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
      if (!ALLOWED_IMAGE_TYPES.has(imageBlock.source.media_type)) {
        return null;
      }
      const { source } = imageBlock;
      const imageSrc = `data:${source.media_type};base64,${source.data}`;

      return (
        <div className={`${isUser ? 'inline-block' : ''}`}>
          <img
            src={imageSrc}
            alt={t('messageCard.pastedContentAlt')}
            className="w-full max-w-full rounded-lg border border-border"
            style={{ maxHeight: '600px', objectFit: 'contain' }}
          />
        </div>
      );
    }

    case 'file_attachment': {
      const fileBlock = block as FileAttachmentContent;

      return (
        <div className="flex max-w-full min-w-0 items-center gap-2 px-3 py-2 rounded-lg bg-surface-muted border border-border overflow-hidden">
          <FileText className="w-4 h-4 text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary truncate">{fileBlock.filename}</p>
          </div>
        </div>
      );
    }

    case 'cloud_table_attachment': {
      const cloudTableBlock = block as CloudTableAttachmentContent;
      const tables = Array.isArray(cloudTableBlock.tables) ? cloudTableBlock.tables : [];

      if (tables.length === 0) return null;

      return (
        <div className="flex max-w-full flex-wrap gap-2">
          {tables.map((table, index) => (
            <div
              key={table.id || `${table.tableId}-${index}`}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-accent/20 bg-accent/10 px-3 py-2 text-[13px] text-accent-text shadow-soft"
            >
              <Table2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 truncate font-medium">{table.tableName}</span>
              {table.projectName && (
                <span className="hidden flex-shrink-0 text-[11px] text-text-muted sm:inline">
                  {table.projectName}
                </span>
              )}
            </div>
          ))}
        </div>
      );
    }

    case 'tool_use':
      return (
        <ToolUseBlock block={block as ToolUseContent} allBlocks={allBlocks} message={message} />
      );

    case 'tool_result':
      return (
        <ToolResultBlock
          block={block as ToolResultContent}
          allBlocks={allBlocks}
          message={message}
        />
      );

    case 'thinking':
      return <ThinkingBlock block={block as { type: 'thinking'; thinking: string }} />;

    default:
      return null;
  }
});
