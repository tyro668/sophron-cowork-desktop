import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Content split across MessageCard.tsx and the message/ sub-components directory
const messageCardPath = path.resolve(process.cwd(), 'src/renderer/components/MessageCard.tsx');
const messageDir = path.resolve(process.cwd(), 'src/renderer/components/message');

function readAllMessageContent() {
  return [
    fs.readFileSync(messageCardPath, 'utf8'),
    ...fs.readdirSync(messageDir).map((f) => fs.readFileSync(path.join(messageDir, f), 'utf8')),
  ].join('\n');
}

describe('MessageCard layout', () => {
  it('uses a softer user bubble treatment', () => {
    const source = readAllMessageContent();
    expect(source).toContain(
      'message-user max-w-[min(44rem,88%)] min-w-0 space-y-2 break-words rounded-xl px-4 py-3'
    );
    expect(source).not.toContain('rounded-[1.65rem]');
  });

  it('uses quieter rounded shells for tool and thinking cards', () => {
    const source = readAllMessageContent();
    expect(source).toContain('overflow-hidden rounded-xl border shadow-card');
    expect(source).toContain(
      'overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card)] shadow-card'
    );
    expect(source).not.toContain('rounded-2xl border overflow-hidden');
  });
});
