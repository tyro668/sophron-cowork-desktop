import { memo } from 'react';
import { parseDataResourceHref } from '../../../shared/data-resource-link';
import { useAppStore } from '../../store';

const DATA_MARKDOWN_LINK_RE =
  /\[([^\]\n]+)\]\(((?:#\/data\/|sophron:\/\/data\/)[^)\s]+)\)/gi;

interface DataLinkedTextProps {
  text: string;
}

export const DataLinkedText = memo(function DataLinkedText({ text }: DataLinkedTextProps) {
  const navigateToDataElement = useAppStore((state) => state.navigateToDataElement);
  const parts: Array<{ type: 'text'; text: string } | { type: 'link'; text: string; href: string }> =
    [];
  let lastIndex = 0;

  for (const match of text.matchAll(DATA_MARKDOWN_LINK_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, index) });
    }
    parts.push({ type: 'link', text: match[1], href: match[2] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.slice(lastIndex) });
  }

  if (parts.length === 0) {
    return <>{text}</>;
  }

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <span key={index}>{part.text}</span>;
        }

        const target = parseDataResourceHref(part.href);
        if (!target) {
          return <span key={index}>{part.text}</span>;
        }

        return (
          <button
            key={index}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              navigateToDataElement(target);
            }}
            className="prose-accent-link inline rounded px-1 underline underline-offset-2 hover:bg-accent-muted"
            title={target.id}
          >
            {part.text}
          </button>
        );
      })}
    </>
  );
});
