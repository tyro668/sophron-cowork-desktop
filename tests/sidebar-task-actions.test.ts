import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'src/renderer/components/Sidebar.tsx'),
  'utf8'
);

describe('Sidebar task actions', () => {
  it('offers 复制任务 wired to session.duplicate', () => {
    expect(source).toContain("t('sidebar.copyTask')");
    expect(source).toContain("duplicateSession(session.id, t('sidebar.copySuffix'))");
  });

  it('renames through a dialog from the menu and F2, keeping double-click inline edit', () => {
    expect(source).toContain('onSelect={() => openRenameDialog(session.id, session.title)}');
    expect(source).toContain("event.key !== 'F2'");
    expect(source).toContain("t('sidebar.renameTaskTitle')");
    expect(source).toContain('className="ui-footer-split"');
    expect(source).toContain('handleStartRenameSession(session.id, session.title)');
  });
});

describe('Sidebar login dialog', () => {
  it('shows the read-only sign-in server from the auth status', () => {
    expect(source).toContain("t('sidebar.loginAddressLabel')");
    expect(source).toContain('{desktopAuthStatus.apiOrigin}');
  });
});

describe('new task shortcut', () => {
  const ev = (o: Partial<KeyboardEvent>) =>
    ({
      key: 'n',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      repeat: false,
      ...o,
    }) as KeyboardEvent;
  it('uses Cmd on mac and Ctrl elsewhere', async () => {
    const { isNewTaskShortcut } = await import('../src/renderer/components/Sidebar');
    expect(isNewTaskShortcut(ev({ metaKey: true }), true)).toBe(true);
    expect(isNewTaskShortcut(ev({ ctrlKey: true }), true)).toBe(false);
    expect(isNewTaskShortcut(ev({ ctrlKey: true, key: 'N' }), false)).toBe(true);
    expect(isNewTaskShortcut(ev({ metaKey: true }), false)).toBe(false);
    expect(isNewTaskShortcut(ev({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isNewTaskShortcut(ev({ ctrlKey: true, repeat: true }), false)).toBe(false);
  });
  it('renders the hint cell and lists the shortcut in settings', () => {
    expect(source).toContain("{isMac ? '⌘N' : 'Ctrl+N'}");
    expect(source).toContain('data-testid="new-task-shortcut-cell"');
    const settings = fs.readFileSync(
      path.resolve(process.cwd(), 'src/renderer/components/settings/SettingsShortcuts.tsx'),
      'utf8'
    );
    expect(settings).toContain("labelKey: 'settings.shortcutList.newTask'");
  });
});

describe('sidebar task rows', () => {
  it('has no per-row dividers, an indent guide, hover-only menu and tinted active row', () => {
    expect(source).not.toContain(
      'border-b border-border-subtle py-1.5 pl-7 pr-2.5 last:border-b-0'
    );
    expect(source).toContain('h-[31px]');
    expect(source).toContain('sidebar-task-guide');
    expect(source).toContain("? 'bg-accent-muted/60'");
    expect(source).toContain("hoveredSession === session.id ? 'opacity-100' : 'opacity-0'");
  });
});
