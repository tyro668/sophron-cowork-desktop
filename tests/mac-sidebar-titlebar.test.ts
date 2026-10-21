import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f: string) => fs.readFileSync(path.resolve(process.cwd(), f), 'utf8');

describe('macOS sidebar title row', () => {
  const sidebar = read('src/renderer/components/Sidebar.tsx');

  it('renders a 48px drag row with the name only (no logo) next to the traffic lights', () => {
    expect(sidebar).toContain('renderBrand(true, false)');
    expect(sidebar).toMatch(
      /titlebar-drag flex h-12 shrink-0 select-none items-center[^"]*pl-\[84px\]/
    );
    expect(sidebar).toContain('pointer-events-none');
    expect(sidebar).not.toContain('pb-3 titlebar-drag pt-12');
  });

  it('keeps the collapsed rail drag strip aligned at 48px', () => {
    expect(sidebar).toMatch(/titlebar-drag h-12 shrink-0 border-b border-border-subtle/);
  });

  it('centers the traffic lights vertically in the 48px row', () => {
    expect(read('src/main/app/window.ts')).toContain('trafficLightPosition = { x: 16, y: 17 }');
  });

  it('leaves Windows/Linux portaling the full brand into the titlebar', () => {
    expect(sidebar).toContain('createPortal(renderBrand(true), titlebarBrandSlot)');
  });
});
