import { useMemo } from 'react';
import { diffHunks, diffLines, diffStats } from '../../../shared/fix-error';
import type { TranslateFn } from './shared';

/**
 * Unified line diff of one file against the version it was derived from (修复 结果的「差异」视图):
 * old / new line numbers, +/- markers, unchanged regions collapsed to hunk headers.
 */
export function CodeDiffView({
  before,
  after,
  t,
}: {
  /** Content in the previous version; undefined = new file. */
  before: string | undefined;
  after: string;
  t: TranslateFn;
}) {
  const hunks = useMemo(() => diffHunks(diffLines(before ?? '', after), 3), [before, after]);
  if (hunks.length === 0) {
    return (
      <div
        className="flex min-h-0 flex-1 items-center justify-center text-xs text-text-muted"
        style={{ backgroundColor: 'var(--code-preview-background)' }}
        data-testid="code-diff-empty"
      >
        {t('fixError.diffEmpty')}
      </div>
    );
  }
  return (
    <div
      className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[20px]"
      style={{
        backgroundColor: 'var(--code-preview-background)',
        color: 'var(--code-preview-text)',
      }}
      data-testid="code-diff-view"
    >
      <table className="w-full border-collapse">
        <tbody>
          {hunks.map((hunk, hunkIndex) => (
            <HunkRows key={hunkIndex} header={hunk.header} lines={hunk.lines} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HunkRows({ header, lines }: { header: string; lines: ReturnType<typeof diffLines> }) {
  const gutter = {
    backgroundColor: 'var(--code-preview-gutter-background)',
    color: 'var(--code-preview-muted)',
    borderRight: '1px solid var(--code-preview-gutter-border)',
  };
  return (
    <>
      <tr>
        <td style={gutter} className="w-10 select-none" />
        <td style={gutter} className="w-10 select-none" />
        <td
          colSpan={2}
          className="select-none px-2 text-[11px]"
          style={{
            color: 'var(--code-preview-muted)',
            backgroundColor: 'var(--code-preview-gutter-background)',
          }}
        >
          {header}
        </td>
      </tr>
      {lines.map((line, index) => {
        const tone =
          line.kind === 'add'
            ? 'rgba(34, 160, 90, 0.14)'
            : line.kind === 'del'
              ? 'rgba(220, 38, 38, 0.12)'
              : undefined;
        return (
          <tr
            key={index}
            data-diff={line.kind}
            style={tone ? { backgroundColor: tone } : undefined}
          >
            <td style={gutter} className="w-10 select-none pr-2 text-right tabular-nums">
              {line.oldLine ?? ''}
            </td>
            <td style={gutter} className="w-10 select-none pr-2 text-right tabular-nums">
              {line.newLine ?? ''}
            </td>
            <td
              className="w-5 select-none text-center"
              style={{
                color:
                  line.kind === 'add' ? '#1f9d55' : line.kind === 'del' ? '#d64545' : undefined,
              }}
            >
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ''}
            </td>
            <td className="whitespace-pre-wrap break-all pr-3">{line.text || ' '}</td>
          </tr>
        );
      })}
    </>
  );
}

export function fileDiffStats(
  before: string | undefined,
  after: string
): { added: number; removed: number } {
  return diffStats(diffLines(before ?? '', after));
}
