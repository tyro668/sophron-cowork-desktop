import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');
const zhLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json');
const enLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/en.json');

function readChatView() {
  return fs.readFileSync(chatViewPath, 'utf8');
}

describe('ChatView Claude-style layout', () => {
  it('uses a narrower conversation column shared by messages and composer', () => {
    const source = readChatView();
    expect(source).toContain('max-w-[920px]');
  });

  it('uses a quieter header treatment with Metis Cowork eyebrow and compact connector badge', () => {
    const source = readChatView();
    expect(source).toContain('Metis Cowork');
    expect(source).toContain('bg-background/88');
    expect(source).toContain('border-border-muted');
  });

  it('renders a floating back-to-top trigger below the conversation title', () => {
    const source = readChatView();
    expect(source).toContain("t('chat.backToTop')");
    expect(source).toContain('top-12 z-20 flex justify-center');
    expect(source).toContain('onClick={scrollToConversationTop}');
  });

  it('defines back-to-top text in the chat i18n namespace', () => {
    const zh = JSON.parse(fs.readFileSync(zhLocalePath, 'utf8'));
    const en = JSON.parse(fs.readFileSync(enLocalePath, 'utf8'));

    expect(zh.chat.backToTop).toBe('回到顶部');
    expect(en.chat.backToTop).toBe('Back to top');
  });

  it('uses a softer rounded composer shell instead of the previous heavy input bar', () => {
    const source = readChatView();
    expect(source).toContain('rounded-[1.75rem]');
    expect(source).toContain('shadow-soft');
  });
});
