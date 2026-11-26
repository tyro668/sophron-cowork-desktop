import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');
const chatHeaderPath = path.resolve(process.cwd(), 'src/renderer/components/chat/ChatHeader.tsx');
const chatComposerPath = path.resolve(
  process.cwd(),
  'src/renderer/components/chat/ChatComposerForm.tsx'
);
const permissionPolicySelectorPath = path.resolve(
  process.cwd(),
  'src/renderer/components/PermissionPolicySelector.tsx'
);
const zhLocalePath = path.resolve(process.cwd(), 'src/shared/i18n/locales/zh.json');
const enLocalePath = path.resolve(process.cwd(), 'src/shared/i18n/locales/en.json');

function readChatView() {
  return fs.readFileSync(chatViewPath, 'utf8');
}

function readChatHeader() {
  return fs.readFileSync(chatHeaderPath, 'utf8');
}

function readChatComposer() {
  return fs.readFileSync(chatComposerPath, 'utf8');
}

describe('ChatView layout', () => {
  it('keeps messages compact while allowing the composer to match the wide mockup', () => {
    const source = readChatView();
    const composer = readChatComposer();
    expect(source).toContain('max-w-[980px]');
    expect(composer).toContain('max-w-[980px]');
    expect(source).not.toContain('max-w-[1040px]');
    expect(composer).not.toContain('max-w-[1040px]');
  });

  it('uses a quieter header treatment without a left app-name label', () => {
    const source = readChatHeader();
    expect(source).toContain('<div aria-hidden="true" />');
    expect(source).toContain('glass-panel-header titlebar-drag relative grid h-12');
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
    const viewSource = readChatView();
    const composerSource = readChatComposer();
    expect(composerSource).toContain('chat-composer-panel flex min-h-[128px]');
    expect(composerSource).toContain('sm:min-h-[140px]');
    expect(composerSource).toContain('min-h-[58px]');
    expect(composerSource).toContain('sm:min-h-[68px]');
    expect(composerSource).not.toContain('min-h-[150px]');
    expect(composerSource).not.toContain('sm:min-h-[168px]');
    expect(composerSource).toContain('PermissionPolicySelector');
    expect(composerSource).toContain('showPermissionMenu');
    expect(viewSource).toContain('handlePermissionMenuOpenChange');
    expect(composerSource).toContain('onClick={onModelButtonClick}');
    expect(composerSource).toContain('open={showModelMenu}');
    expect(composerSource).toContain('onSelect={onModelOptionClick}');
    expect(viewSource).toContain(
      'onModelOptionClick={(configSetId) => void handleModelOptionClick(configSetId)}'
    );
  });

  it('uses a shared permission policy dropdown with all three modes', () => {
    const source = fs.readFileSync(permissionPolicySelectorPath, 'utf8');
    expect(source).toContain("'default'");
    expect(source).toContain("'auto_review'");
    expect(source).toContain("'full_access'");
    expect(source).toContain("t('chat.permissionPolicyDefault')");
    expect(source).toContain("t('chat.permissionPolicyAutoReview')");
    expect(source).toContain("t('chat.permissionPolicyFullAccess')");
    expect(source).toContain('permissionPolicy: policy');
  });
});
