import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sidebarPath = path.resolve(process.cwd(), 'src/renderer/components/Sidebar.tsx');

describe('Sidebar active session styling', () => {
  it('uses only a green leading line and light green background for the active conversation', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');

    expect(source).toContain("'bg-accent-muted'");
    expect(source).toContain('absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-accent');
    expect(source).not.toContain('ring-1 ring-accent/35');
    expect(source).not.toContain('shadow-[0_8px_18px_rgba(20,184,166,0.12)]');
  });
});
