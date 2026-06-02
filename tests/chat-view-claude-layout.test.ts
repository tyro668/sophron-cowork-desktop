import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');
const permissionPolicySelectorPath = path.resolve(
  process.cwd(),
  'src/renderer/components/PermissionPolicySelector.tsx'
);
const zhLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json');
const enLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/en.json');

function readChatView() {
  return fs.readFileSync(chatViewPath, 'utf8');
}

describe('ChatView Claude-style layout', () => {
  it('keeps messages compact while allowing the composer to match the wide mockup', () => {
    const source = readChatView();
    expect(source).toContain('max-w-[980px]');
    expect(source).not.toContain('max-w-[1040px]');
  });

  it('uses a quieter header treatment without a left app-name label', () => {
    const source = readChatView();
    expect(source).toContain('<div aria-hidden="true" />');
    expect(source).toContain('bg-background/88');
    expect(source).toContain('border-border-muted');
    expect(source).not.toContain('tracking-[0.08em] uppercase text-text-muted');
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
    expect(zh.chat.autoReview).toBe('自动审查');
    expect(en.chat.autoReview).toBe('Auto review');
    expect(zh.chat.permissionPolicyDefault).toBe('默认权限');
    expect(zh.chat.permissionPolicyAutoReview).toBe('自动审查');
    expect(zh.chat.permissionPolicyFullAccess).toBe('完全访问权限');
    expect(en.chat.permissionPolicyDefault).toBe('Default permissions');
    expect(en.chat.permissionPolicyAutoReview).toBe('Auto review');
    expect(en.chat.permissionPolicyFullAccess).toBe('Full access');
  });

  it('uses a compact rounded composer shell with bottom toolbar controls', () => {
    const source = readChatView();
    expect(source).toContain('min-h-[96px]');
    expect(source).toContain('sm:min-h-[104px]');
    expect(source).toContain('rounded-2xl');
    expect(source).toContain('min-h-[32px]');
    expect(source).toContain('sm:min-h-[36px]');
    expect(source).not.toContain('min-h-[150px]');
    expect(source).not.toContain('sm:min-h-[168px]');
    expect(source).not.toContain('rounded-[28px]');
    expect(source).toContain('bg-background');
    expect(source).toContain('shadow-soft');
    expect(source).toContain('PermissionPolicySelector');
    expect(source).toContain('showPermissionMenu');
    expect(source).toContain('handlePermissionMenuOpenChange');
    expect(source).toContain('onClick={handleModelButtonClick}');
    expect(source).toContain('showModelMenu && hasConfiguredModel');
    expect(source).toContain('handleModelOptionClick(option.id)');
  });

  it('uses a shared permission policy dropdown with all three modes', () => {
    const source = fs.readFileSync(permissionPolicySelectorPath, 'utf8');
    expect(source).toContain("'default'");
    expect(source).toContain("'auto_review'");
    expect(source).toContain("'full_access'");
    expect(source).toContain("t('chat.permissionPolicyDefault')");
    expect(source).toContain("t('chat.permissionPolicyAutoReview')");
    expect(source).toContain("t('chat.permissionPolicyFullAccess')");
    expect(source).toContain('getPermissionRulesForPolicy(policy)');
  });
});
