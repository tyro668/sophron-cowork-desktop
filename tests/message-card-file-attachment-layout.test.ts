import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Content split across MessageCard.tsx and the message/ sub-components directory
function readMessageCard() {
  const messageCardPath = path.resolve(__dirname, '../src/renderer/components/MessageCard.tsx');
  const messageDir = path.resolve(__dirname, '../src/renderer/components/message');
  return [
    fs.readFileSync(messageCardPath, 'utf8'),
    ...fs.readdirSync(messageDir).map((f) => fs.readFileSync(path.join(messageDir, f), 'utf8')),
  ].join('\n');
}

describe('message card file attachment layout', () => {
  it('keeps user bubble shrinkable in flex layouts', () => {
    const source = readMessageCard();
    expect(source).toContain('max-w-[min(44rem,88%)] min-w-0 space-y-2 break-words');
  });

  it('prevents file attachment row overflow with long filenames', () => {
    const source = readMessageCard();
    expect(source).toContain('max-w-full min-w-0');
    expect(source).toContain('overflow-hidden');
    expect(source).toContain('text-[13px] text-text-primary truncate');
  });
});
