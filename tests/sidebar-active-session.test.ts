import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sidebarPath = path.resolve(process.cwd(), 'src/renderer/components/Sidebar.tsx');

describe('Sidebar active session styling', () => {
  it('uses a 3px accent leading line and surface-active background for the active conversation', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');

    expect(source).toContain("'bg-surface-active'");
    expect(source).toContain('absolute left-0 w-[3px] bg-accent');
    expect(source).toContain('top-1.5 bottom-1.5 rounded-r-full');
    expect(source).not.toContain('ring-1 ring-accent/35');
    expect(source).not.toContain('shadow-[0_8px_18px_rgba(20,184,166,0.12)]');
  });
});
