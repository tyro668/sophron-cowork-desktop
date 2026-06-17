import { describe, expect, it } from 'vitest';
import {
  extractKeywords,
  lexicalScore,
  simpleTokenize,
  tokenizeSearchText,
} from '../src/main/memory/memory-utils';

describe('memory search tokenizer', () => {
  it('filters low-value Chinese words and keeps useful Chinese terms', () => {
    const tokens = simpleTokenize('我们需要继续修改自动化配置界面');

    expect(tokens).not.toContain('我们');
    expect(tokens).not.toContain('需要');
    expect(tokens).not.toContain('继续');
    expect(tokens).toContain('自动化');
    expect(tokens).toContain('配置');
    expect(tokens).toContain('界面');
  });

  it('normalizes English words and filters English stop words', () => {
    const tokens = simpleTokenize('Please update running tasks and created tables');

    expect(tokens).not.toContain('please');
    expect(tokens).not.toContain('and');
    expect(tokens).toContain('update');
    expect(tokens).toContain('run');
    expect(tokens).toContain('task');
    expect(tokens).toContain('create');
    expect(tokens).toContain('table');
  });

  it('splits code-like identifiers while preserving useful compact terms', () => {
    const tokens = simpleTokenize('DataView.tsx createInputTable dropdown');

    expect(tokens).toContain('dataview');
    expect(tokens).toContain('data');
    expect(tokens).toContain('view');
    expect(tokens).toContain('tsx');
    expect(tokens).toContain('createinputtable');
    expect(tokens).toContain('create');
    expect(tokens).toContain('input');
    expect(tokens).toContain('table');
    expect(tokens).toContain('dropdown');
  });

  it('scores mixed Chinese and English memory text', () => {
    const score = lexicalScore(
      '自动化 dropdown 卡顿',
      '修复自动化页面中 dropdown 弹出菜单卡顿'
    );

    expect(score).toBeGreaterThan(0);
  });

  it('uses weighted structured tokens for keyword extraction', () => {
    const tokens = tokenizeSearchText('DataView.tsx 自动化配置界面');
    const keywords = extractKeywords('DataView.tsx 自动化配置界面', 5);

    expect(tokens.some((token) => token.text === 'dataview' && token.kind === 'code')).toBe(true);
    expect(keywords).toEqual(expect.arrayContaining(['自动化', '配置', '界面']));
  });
});
