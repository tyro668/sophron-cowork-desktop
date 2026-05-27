import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');

describe('dark theme palette', () => {
  it('uses the 九思助理 green data-workspace palette for the default theme', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-background: #101918;');
    expect(source).toContain('--color-surface: #182927;');
    expect(source).toContain('--color-text-primary: #eef7f5;');
  });

  it('keeps the accent within the teal-green family', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-accent: #19a99a;');
    expect(source).toContain('--color-accent-hover: #148f83;');
  });
});
