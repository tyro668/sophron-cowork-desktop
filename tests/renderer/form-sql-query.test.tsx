// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n-test';
import FormSqlQuery from '../../src/renderer/components/workflow-forms/FormSqlQuery';
import type { DataWorkflowNode } from '../../src/renderer/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node: DataWorkflowNode = {
  id: 'n1',
  taskId: 't1',
  type: 'sql_query',
  label: 'SQL',
  x: 0,
  y: 0,
  config: { sql: 'select a, b from input where a>0' },
  createdAt: 0,
  updatedAt: 0,
};

async function mount(
  props: Partial<Parameters<typeof FormSqlQuery>[0]> = {},
  onNodeChange = vi.fn()
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(FormSqlQuery, {
        node,
        fieldCompletions: ['sku', 'name', 'price'],
        otherNodes: [],
        onNodeChange,
        ...props,
      })
    );
  });
  return { host, root };
}

describe('FormSqlQuery', () => {
  it('filters the field list via the search box', async () => {
    const { host, root } = await mount();
    const searchBox = host.querySelector('input[type="text"]') as HTMLInputElement;
    expect(host.textContent).toContain('sku');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(searchBox, 'pr');
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('price');
    expect(host.textContent).not.toContain('sku');
    await act(async () => root.unmount());
    host.remove();
  });

  it('shows field type icons when fieldTypes are provided', async () => {
    const { host, root } = await mount({
      fieldTypes: [
        { name: 'sku', type: 'text', storageType: 'VARCHAR' },
        { name: 'name', type: 'text', storageType: 'VARCHAR' },
        { name: 'price', type: 'decimal', storageType: 'DECIMAL(18,6)' },
      ],
    });
    expect(host.querySelectorAll('.lucide-hash').length).toBe(1);
    expect(host.querySelectorAll('.lucide-type').length).toBe(2);
    await act(async () => root.unmount());
    host.remove();
  });

  it('clicking a field inserts the quoted name into the editor', async () => {
    const { host, root } = await mount();
    const fieldButton = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('name')
    ) as HTMLButtonElement;
    await act(async () => fieldButton.click());
    expect(host.querySelector('.cm-content')?.textContent).toContain('"name"');
    await act(async () => root.unmount());
    host.remove();
  });

  it('format button rewrites the editor document', async () => {
    const onNodeChange = vi.fn();
    const { host, root } = await mount({}, onNodeChange);
    const formatButton = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Format')
    ) as HTMLButtonElement;
    await act(async () => formatButton.click());
    const doc = host.querySelector('.cm-content')?.textContent ?? '';
    expect(doc).toContain('SELECT');
    expect(doc).toContain('FROM input');
    expect(onNodeChange).toHaveBeenCalled();
    await act(async () => root.unmount());
    host.remove();
  });

  it('validate button reports status for valid and broken SQL', async () => {
    const { host, root } = await mount();
    const validateButton = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Validate')
    ) as HTMLButtonElement;
    await act(async () => validateButton.click());
    expect(host.textContent).toContain('Validation passed');
    await act(async () => root.unmount());
    host.remove();

    const broken = { ...node, config: { sql: 'select * from (' } };
    const { host: host2, root: root2 } = await mount({ node: broken });
    const validateButton2 = [...host2.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Validate')
    ) as HTMLButtonElement;
    await act(async () => validateButton2.click());
    expect(host2.querySelector('.text-error')).not.toBeNull();
    await act(async () => root2.unmount());
    host2.remove();
  });
});
