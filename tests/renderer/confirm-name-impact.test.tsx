// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  ConfirmDialogProvider,
  useConfirmDialog,
} from '../../src/renderer/components/ConfirmDialog';
import {
  pipelineDeleteImpact,
  rawTableDeleteImpact,
  resultTableDeleteImpact,
} from '../../src/renderer/features/data/utils/delete-impact';
import './i18n-test';

const t = (key: string, opts?: Record<string, unknown>) => `${key}:${JSON.stringify(opts ?? {})}`;

describe('delete impact helpers', () => {
  it('lists pipelines linked to a result table', () => {
    const text = resultTableDeleteImpact({ relatedPipelineNames: ['A', 'B'] } as never, t);
    expect(text).toContain('resultTablePipelines');
    expect(text).toContain('A、B');
    expect(resultTableDeleteImpact({ relatedPipelineNames: [] } as never, t)).toContain(
      'resultTableNone'
    );
  });
  it('finds pipelines using a raw table as input, truncating long lists', () => {
    const pipelines = ['p1', 'p2', 'p3', 'p4'].map((name) => ({
      name,
      sourceRawTableId: 'r1',
    }));
    const text = rawTableDeleteImpact('r1', pipelines as never, t);
    expect(text).toContain('p1、p2、p3 等 4 个');
    expect(rawTableDeleteImpact('other', pipelines as never, t)).toContain('rawTableNone');
  });
  it('mentions the pipeline result table', () => {
    expect(pipelineDeleteImpact({ resultTable: 'out' } as never, t)).toContain('"name":"out"');
    expect(pipelineDeleteImpact({ resultTable: null } as never, t)).toContain('pipelineNone');
  });
});

describe('ConfirmDialog name / impact rows', () => {
  function Harness({ onResult }: { onResult: (v: boolean) => void }) {
    const { confirmDelete } = useConfirmDialog();
    return (
      <button
        onClick={() => {
          void confirmDelete({ message: 'msg', name: '表一', impact: '影响文本' }).then(onResult);
        }}
      >
        ask
      </button>
    );
  }
  it('renders 名称 and 影响 rows and still resolves', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmDialogProvider>
        <Harness onResult={onResult} />
      </ConfirmDialogProvider>
    );
    fireEvent.click(screen.getByText('ask'));
    expect(await screen.findByText('表一')).toBeTruthy();
    expect(screen.getByText('影响文本')).toBeTruthy();
    fireEvent.click(
      screen.getAllByRole('button').find((b) => /取消|Cancel/.test(b.textContent ?? ''))!
    );
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});
