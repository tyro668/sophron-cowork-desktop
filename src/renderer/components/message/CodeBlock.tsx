// Fenced code block — flat container with language header and copy button
import { useState, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';
import hljs from 'highlight.js';

// Sanitize highlight.js output - only allow highlight span tags
const sanitizeHighlight = (html: string): string =>
  html.replace(/<(?!\/?span(?:\s+class="hljs-[^"]*")?\s*\/?>)[^>]*>/g, (match) =>
    match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );

interface CodeBlockProps {
  language: string;
  children: string;
}

export const CodeBlock = memo(function CodeBlock({ language, children }: CodeBlockProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const highlightedHtml = useMemo(() => {
    try {
      const lang = language.toLowerCase();
      let result: string;
      if (hljs.getLanguage(lang)) {
        result = hljs.highlight(children, { language: lang }).value;
      } else {
        result = hljs.highlightAuto(children).value;
      }
      return sanitizeHighlight(result);
    } catch {
      return null;
    }
  }, [children, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail if focus is lost or permission denied
    }
  };

  return (
    <div className="group my-3 overflow-hidden rounded-lg border border-border-subtle bg-surface-muted">
      <div className="flex h-7 items-center justify-between border-b border-border-subtle/70 px-3">
        <span className="font-mono text-[11px] lowercase text-text-muted">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          title={t('messageCard.copyCode')}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <pre className="code-block overflow-x-auto rounded-none border-0 bg-transparent p-3.5 text-[12.5px] leading-5">
        {highlightedHtml ? (
          // highlight.js sanitizes and escapes input before injecting span tokens
          <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <code>{children}</code>
        )}
      </pre>
    </div>
  );
});
