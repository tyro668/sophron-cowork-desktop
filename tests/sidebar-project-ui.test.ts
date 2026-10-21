import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sidebarPath = path.resolve(process.cwd(), 'src/renderer/components/Sidebar.tsx');

describe('Sidebar project UI hierarchy', () => {
  it('renders projects as collapsible rows with indented tasks', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');

    expect(source).toContain('SIDEBAR_PROJECT_EXPANSION_STORAGE_KEY');
    expect(source).toContain('aria-expanded={isProjectExpanded}');
    expect(source).toContain('expandedProjectKeys.has(group.key)');
    expect(source).not.toContain('ml-6 space-y-0.5 pl-2');
    expect(source).not.toContain('border-l border-border-subtle/70');
  });

  it('renders the project section title as static text', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');

    expect(source).toContain("t('sidebar.projectsTitle')");
    expect(source).toContain('text-[11.5px] font-semibold leading-5 text-text-muted');
    expect(source).toContain('flex h-7 mt-2 items-center px-3.5');
    expect(source).not.toContain("isMac ? 'mb-2 px-3'");
    expect(source).not.toContain(
      '<ListChecks className="h-4 w-4 flex-shrink-0" />\n          <span>{t(\'mainNav.tasks\')}</span>'
    );
  });

  it('keeps project rows compact', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');

    expect(source).not.toContain("isMac ? 'space-y-1'");
    expect(source).not.toContain('<div className="space-y-3">');
  });

  it('uses one project icon slot for expanded and collapsed states', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');

    expect(source).toContain(
      '<FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />'
    );
    expect(source).toContain('<Folder className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />');
    expect(source).not.toContain(
      '<ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />'
    );
  });

  it('does not render the actual workspace path in the project header', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');

    expect(source).not.toContain('group.path ||');
    expect(source).not.toContain("t('sidebar.noWorkspacePath')");
    expect(source).not.toContain("t('sidebar.projectTaskCount'");
  });
});

describe('Sidebar option C (no horizontal dividers)', () => {
  const src = fs.readFileSync(sidebarPath, 'utf8');
  it('has no row/section dividers except the one above the bottom bar', () => {
    expect(src).toContain("const navItemShape = 'mx-2.5 h-9 px-2.5';");
    expect(src).toContain("'mx-2.5 mt-2.5 flex h-[34px] items-stretch'");
    expect(src).toContain("'mx-2.5 mt-2 flex h-[30px] items-stretch bg-surface-active/60'");
    expect(src).not.toContain("className={'border-b border-border-subtle bg-surface'}");
    expect(src).not.toContain("'flex h-12 items-stretch border-b border-border-subtle'");
    expect(src).toContain('shadow-[inset_2px_0_0_var(--color-accent)]');
    expect(src).toContain('<div className="border-t border-border-subtle">');
  });
});
