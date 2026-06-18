import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const storePath = path.resolve(process.cwd(), 'src/main/data/data-task-store.ts');

describe('filter SQL compiler', () => {
  it('compiles filter conditions before embedding them into runtime SQL', () => {
    const source = fs.readFileSync(storePath, 'utf8');

    expect(source).toContain('compileFilterConditionExpression');
    expect(source).toContain('WHERE ${compileFilterConditionExpression(');
    expect(source).toContain('regexp_matches(');
    expect(source).not.toContain('WHERE ${compileScalarExpression(');
  });
});
