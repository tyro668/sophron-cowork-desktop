// Collapsible "thinking" row for models that expose reasoning traces.
import { Suspense, lazy, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Brain } from 'lucide-react';
import { PanelErrorBoundary } from '../PanelErrorBoundary';

const MessageMarkdown = lazy(() =>
  import('../MessageMarkdown').then((module) => ({ default: module.MessageMarkdown }))
);

// Render **bold** markers in thinking preview text.
// Only handles double-asterisk bold to avoid false positives with single * in math/code.
function renderThinkingPreview(raw: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      parts.push(raw.slice(lastIndex, match.index));
    }
    parts.push(
      <strong key={key++} className="font-medium not-italic">
        {match[1]}
      </strong>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) {
    parts.push(raw.slice(lastIndex));
  }
  return parts;
}

interface ThinkingBlockProps {
  block: { type: 'thinking'; thinking: string };
}

export const ThinkingBlock = memo(function ThinkingBlock({ block }: ThinkingBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const text = block.thinking || '';
  if (!text) return null;

  // Preview: first ~80 chars, clean up broken ** markers from truncation
  let preview = text.length > 80 ? text.substring(0, 77) + '...' : text;
  // Strip a trailing unclosed ** that truncation may have created
  preview = preview.replace(/\*{1,2}(?:\.{3})?$/, (m) => {
    // Keep the ... suffix if present, just remove the dangling asterisks
    return m.endsWith('...') ? '...' : '';
  });
  const previewNodes = renderThinkingPreview(preview);

  return (
    <div className="-mx-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover/60"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-text-muted">
          <Brain className="h-3.5 w-3.5" />
        </span>
        <span className="flex-shrink-0 text-[12px] font-medium text-text-muted">
          {t('messageCard.thinking')}
        </span>
        {!expanded && (
          <span className="min-w-0 flex-1 truncate text-[12px] italic text-text-muted/70">
            {previewNodes}
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
          <div className="prose-chat max-w-none text-[13px] leading-relaxed text-text-secondary">
            <PanelErrorBoundary
              name="ThinkingMarkdown"
              fallback={<div className="whitespace-pre-wrap">{text}</div>}
            >
              <Suspense fallback={<div className="whitespace-pre-wrap">{text}</div>}>
                <MessageMarkdown normalizedText={text} />
              </Suspense>
            </PanelErrorBoundary>
          </div>
        </div>
      )}
    </div>
  );
});
