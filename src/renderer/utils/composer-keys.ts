import type React from 'react';

/**
 * Ctrl/Cmd + Enter inserts a newline at the caret (Shift + Enter keeps working natively).
 * Returns true when the event was handled.
 */
export function handleNewlineShortcut(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) {
    return false;
  }
  if (event.nativeEvent.isComposing || event.keyCode === 229) {
    return true;
  }
  event.preventDefault();
  const el = event.currentTarget;
  // execCommand keeps the native undo stack and fires React's onChange.
  if (!document.execCommand('insertText', false, '\n')) {
    const { selectionStart, selectionEnd } = el;
    el.setRangeText('\n', selectionStart, selectionEnd, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return true;
}
