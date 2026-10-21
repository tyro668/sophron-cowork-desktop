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
