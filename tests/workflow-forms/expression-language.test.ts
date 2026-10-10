import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { exprLanguage } from '../../src/renderer/components/workflow-forms/shared/GlassExpressionInput';

function tokenSpans(doc: string): Array<{ text: string; name: string }> {
  const state = EditorState.create({ doc, extensions: [exprLanguage] });
  const tree = ensureSyntaxTree(state, doc.length, 1000);
  const spans: Array<{ text: string; name: string }> = [];
  tree?.iterate({
    enter(node) {
      if (node.from !== node.to) {
        spans.push({ text: doc.slice(node.from, node.to), name: node.name });
      }
    },
  });
  return spans;
}

describe('expression language highlighting', () => {
  it('classifies a calculation DSL expression', () => {
    const spans = tokenSpans(
      'running(sum([revenue])) over(partition by [month], [region] order by [revenue] desc)'
    );
    const byText = new Map(spans.map((s) => [s.text, s.name]));
    expect(byText.get('running')).toBe('namespace');
    expect(byText.get('sum')).toBe('function');
    expect(byText.get('over')).toBe('keyword');
    expect(byText.get('partition')).toBe('keyword');
    expect(byText.get('by')).toBe('keyword');
    expect(byText.get('order')).toBe('keyword');
    expect(byText.get('desc')).toBe('keyword');
    expect(byText.get('[revenue]')).toBe('variableName');
    expect(byText.get('[month]')).toBe('variableName');
  });

  it('classifies window-frame keywords and literals', () => {
    const spans = tokenSpans(
      "moving(avg([revenue])) over(order by [month] rows between interval 2 'week' preceding and current row exclude ties)"
    );
    const names = spans.map((s) => s.name);
    const texts = spans.map((s) => s.text);
    expect(texts).toContain('moving');
    expect(texts).toContain('avg');
    const byText = new Map(spans.map((s) => [s.text, s.name]));
    expect(byText.get('moving')).toBe('namespace');
    expect(byText.get('avg')).toBe('function');
    expect(byText.get('rows')).toBe('keyword');
    expect(byText.get('between')).toBe('keyword');
    expect(byText.get('interval')).toBe('keyword');
    expect(byText.get('preceding')).toBe('keyword');
    expect(byText.get('current')).toBe('keyword');
    expect(byText.get('row')).toBe('keyword');
    expect(byText.get('exclude')).toBe('keyword');
    expect(byText.get('ties')).toBe('keyword');
    expect(byText.get("'week'")).toBe('string');
    expect(byText.get('2')).toBe('number');
    expect(names).not.toContain('invalid');
  });

  it('still highlights plain SQL expressions', () => {
    const spans = tokenSpans("case [status] when 'PAID' then 1 else 0 end");
    const byText = new Map(spans.map((s) => [s.text, s.name]));
    expect(byText.get('case')).toBe('keyword');
    expect(byText.get('when')).toBe('keyword');
    expect(byText.get('then')).toBe('keyword');
    expect(byText.get('else')).toBe('keyword');
    expect(byText.get('end')).toBe('keyword');
    expect(byText.get('[status]')).toBe('variableName');
    expect(byText.get("'PAID'")).toBe('string');
  });

  it('treats bare identifiers as field-like names', () => {
    const spans = tokenSpans('count(distinct [id]) over(partition by region)');
    const byText = new Map(spans.map((s) => [s.text, s.name]));
    expect(byText.get('count')).toBe('function');
    expect(byText.get('distinct')).toBe('keyword');
    expect(byText.get('region')).toBe('variableName');
  });
});
