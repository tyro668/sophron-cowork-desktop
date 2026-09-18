import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');

describe('dark theme palette', () => {
  it('uses the solid dark companion palette for the default theme', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-background: #17251f;');
    expect(source).toContain('--color-surface: #21342b;');
    expect(source).toContain('--color-text-primary: #f2f8f4;');
  });

  it('uses the Mint Workbench palette for the light theme', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--app-backdrop: #f4f8f5;');
    expect(source).toContain('--color-background: #fbfdfb;');
    expect(source).toContain('--color-surface-active: #eaf6ee;');
    expect(source).toContain('--color-text-primary: #24362e;');
  });

  it('keeps the accent replaceable through semantic palettes', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-accent: #2f8f63;');
    expect(source).toContain('--color-accent-hover: #267b54;');
    for (const theme of ['lake', 'lavender', 'orange', 'rose']) {
      expect(source).toContain(`:root:not(.light)[data-accent-theme='${theme}']`);
      expect(source).toContain(`:root.light[data-accent-theme='${theme}']`);
    }
  });
});
