import { useEffect, useMemo, useState } from 'react';
import DataEditor, {
  GridCellKind,
  GridColumnIcon,
  type DataEditorProps,
  type GridCell,
  type GridColumn,
  type Item,
  type Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { DataInputTablePreview } from '../types';

type PreviewCellValue = string | number | boolean | null | undefined;

interface GlassDataGridPreviewLabels {
  loading: string;
  empty: string;
  total: (count: number) => string;
  pageSize: (count: number) => string;
}

export interface GlassDataGridPreviewProps {
  preview: DataInputTablePreview | null;
  isLoading?: boolean;
  error?: string | null;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  labels: GlassDataGridPreviewLabels;
  className?: string;
  rowHeight?: number;
  headerHeight?: number;
  edgeToEdge?: boolean;
}

export function GlassDataGridPreview({
  preview,
  isLoading = false,
  error = null,
  currentPage = 1,
  onPageChange,
  labels,
  className = '',
  rowHeight = 34,
  headerHeight = 36,
  edgeToEdge = false,
}: GlassDataGridPreviewProps) {
  const theme = useGlassDataGridTheme();
  const columns = preview?.columns ?? EMPTY_COLUMNS;
  const rows = preview?.rows ?? EMPTY_ROWS;
  const totalRows = preview?.totalRows ?? 0;
  const pageSize = preview?.limit ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / Math.max(1, pageSize || 1)));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, pageCount);
  const gridColumns = useMemo(() => buildGridColumns(columns, rows), [columns, rows]);
  const hasData = columns.length > 0 && rows.length > 0;
  const getCellContent = useMemo(() => {
    return ([col, row]: Item): GridCell => {
      const column = columns[col];
      const record = rows[row];
      return createGridCell(record?.[column]);
    };
  }, [columns, rows]);
  const containerClassName = edgeToEdge
    ? `glass-data-grid-preview flex h-full min-h-0 flex-col overflow-hidden ${className}`
    : `glass-data-grid-preview glass-table flex h-full min-h-0 flex-col ${className}`;

  return (
    <div className={containerClassName}>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <PreviewState label={labels.loading} kind="loading" />
        ) : error ? (
          <PreviewState label={error} kind="error" />
        ) : !hasData ? (
          <PreviewState label={labels.empty} kind="empty" />
        ) : (
          <DataEditor
            className="h-full w-full"
            width="100%"
            height="100%"
            rows={rows.length}
            columns={gridColumns}
            getCellContent={getCellContent}
            getCellsForSelection={true}
            rowMarkers={{
              kind: 'number',
              startIndex: ((safeCurrentPage - 1) * Math.max(1, pageSize || rows.length || 1)) + 1,
              width: 48,
              theme: {
                textMedium: theme.textLight,
                bgCell: theme.bgHeader,
                bgCellMedium: theme.bgHeader,
              },
            }}
            rowHeight={rowHeight}
            headerHeight={headerHeight}
            smoothScrollX={true}
            smoothScrollY={true}
            copyHeaders={true}
            rangeSelect="multi-rect"
            columnSelect="none"
            rowSelect="none"
            verticalBorder={true}
            theme={theme}
            drawHeader={drawStaticHeader}
            onPaste={false}
            keybindings={{ paste: false, delete: false }}
          />
        )}
      </div>
      <div
        className="flex h-11 flex-shrink-0 items-center justify-between gap-3 border-t px-3 text-xs font-medium"
        style={{
          background: PREVIEW_GRID_HEADER_SURFACE,
          borderColor: PREVIEW_GRID_BORDER,
          color: PREVIEW_GRID_TEXT_PRIMARY,
        }}
      >
        <span className="min-w-0 truncate">
          {preview ? labels.total(totalRows) : labels.pageSize(INPUT_TABLE_FALLBACK_PAGE_SIZE)}
        </span>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <span className="mr-2 hidden sm:inline" style={{ color: PREVIEW_GRID_TEXT_SECONDARY }}>
            {labels.pageSize(preview?.limit ?? INPUT_TABLE_FALLBACK_PAGE_SIZE)}
          </span>
          <button
            type="button"
            onClick={() => onPageChange?.(safeCurrentPage - 1)}
            disabled={isLoading || !onPageChange || safeCurrentPage <= 1}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange?.(pageNumber)}
              disabled={isLoading || !onPageChange}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                pageNumber === safeCurrentPage
                  ? 'bg-accent text-white shadow-soft'
                  : 'border border-border-muted bg-white/70 text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary'
              }`}
            >
              {pageNumber}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPageChange?.(safeCurrentPage + 1)}
            disabled={isLoading || !onPageChange || safeCurrentPage >= pageCount}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewState({ label, kind }: { label: string; kind: 'loading' | 'empty' | 'error' }) {
  const isError = kind === 'error';
  return (
    <div
      className={`flex h-full min-h-0 items-center justify-center px-4 text-center text-xs font-medium ${
        isError ? 'text-error' : 'text-text-muted'
      }`}
    >
      <div
        className={`inline-flex max-w-[30rem] items-center gap-2 rounded-lg border px-3 py-2 ${
          isError ? 'border-error/15 bg-error/5' : 'border-border-muted bg-background/34'
        }`}
      >
        {kind === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        <span>{label}</span>
      </div>
    </div>
  );
}

const drawStaticHeader: NonNullable<DataEditorProps['drawHeader']> = ({
  ctx,
  rect,
  column,
  theme,
  spriteManager,
}) => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.globalCompositeOperation = 'copy';
  ctx.fillStyle = theme.bgHeader;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = `${theme.headerFontStyle} ${theme.fontFamily}`;
  ctx.fillStyle = theme.textHeader;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const title = column.title ?? '';
  let textX = rect.x + theme.cellHorizontalPadding;
  const icon = column.icon;
  if (icon) {
    const iconSize = theme.headerIconSize;
    spriteManager.drawSprite(
      icon,
      'normal',
      ctx,
      textX,
      rect.y + (rect.height - iconSize) / 2,
      iconSize,
      theme
    );
    textX += Math.ceil(iconSize * 1.3);
  }
  if (title) {
    ctx.fillText(
      title,
      textX,
      rect.y + rect.height / 2,
      Math.max(12, rect.x + rect.width - textX - theme.cellHorizontalPadding)
    );
  }
  ctx.restore();
};

function buildGridColumns(
  columns: string[],
  rows: Array<Record<string, string | number | boolean | null>>
): GridColumn[] {
  return columns.map((column) => ({
    id: column,
    title: column,
    width: estimateColumnWidth(column, rows),
    icon: inferColumnIcon(column, rows),
  }));
}

function createGridCell(value: PreviewCellValue): GridCell {
  if (value === null || value === undefined) {
    return {
      kind: GridCellKind.Text,
      allowOverlay: false,
      readonly: true,
      data: '',
      displayData: 'NULL',
      copyData: '',
      style: 'faded',
      contentAlign: 'left',
    };
  }
  if (typeof value === 'boolean') {
    return {
      kind: GridCellKind.Boolean,
      allowOverlay: false,
      readonly: true,
      data: value,
      copyData: value ? 'true' : 'false',
      contentAlign: 'center',
    };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      kind: GridCellKind.Number,
      allowOverlay: false,
      readonly: true,
      data: value,
      displayData: formatPreviewCell(value),
      copyData: String(value),
      contentAlign: 'right',
    };
  }
  const text = formatPreviewCell(value);
  return {
    kind: GridCellKind.Text,
    allowOverlay: true,
    readonly: true,
    data: text,
    displayData: text,
    copyData: text,
    style: text ? 'normal' : 'faded',
    contentAlign: 'left',
  };
}

function inferColumnIcon(
  column: string,
  rows: Array<Record<string, string | number | boolean | null>>
): GridColumnIcon {
  const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined);
  if (values.length > 0 && values.every((value) => typeof value === 'number')) {
    return GridColumnIcon.HeaderNumber;
  }
  if (values.length > 0 && values.every((value) => typeof value === 'boolean')) {
    return GridColumnIcon.HeaderBoolean;
  }
  return GridColumnIcon.HeaderString;
}

function estimateColumnWidth(
  column: string,
  rows: Array<Record<string, string | number | boolean | null>>
): number {
  const sampledValues = rows.slice(0, 30).map((row) => formatPreviewCell(row[column]));
  const widest = [column, ...sampledValues].reduce(
    (current, value) => Math.max(current, measureDisplayWidth(value)),
    0
  );
  return clamp(Math.round(widest * 7.2 + 40), 104, 280);
}

function measureDisplayWidth(value: string): number {
  return Array.from(value).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 1.7 : 1), 0);
}

function formatPreviewCell(value: PreviewCellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function getVisiblePageNumbers(currentPage: number, pageCount: number): number[] {
  if (pageCount <= 1) return [1];
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const start = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}

function useGlassDataGridTheme(): Partial<Theme> {
  const [theme, setTheme] = useState<Partial<Theme>>(() => readGlassDataGridTheme());

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const updateTheme = () => setTheme(readGlassDataGridTheme());
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function readGlassDataGridTheme(): Partial<Theme> {
  if (typeof document === 'undefined') {
    return buildGlassDataGridTheme(() => '');
  }
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(name).trim();
  return buildGlassDataGridTheme(color);
}

function buildGlassDataGridTheme(readColor: (name: string) => string): Partial<Theme> {
  const color = (name: string, fallback: string) => readColor(name) || fallback;
  return {
    accentColor: color('--color-accent', '#62c99a'),
    accentFg: '#ffffff',
    accentLight: color('--color-accent-muted', 'rgba(98, 201, 154, 0.14)'),
    textDark: PREVIEW_GRID_TEXT_PRIMARY,
    textMedium: PREVIEW_GRID_TEXT_SECONDARY,
    textLight: PREVIEW_GRID_TEXT_MUTED,
    textBubble: PREVIEW_GRID_TEXT_PRIMARY,
    textHeader: PREVIEW_GRID_TEXT_PRIMARY,
    textHeaderSelected: PREVIEW_GRID_TEXT_PRIMARY,
    bgIconHeader: PREVIEW_GRID_ICON_SURFACE,
    fgIconHeader: color('--color-accent', '#3baf7a'),
    bgCell: PREVIEW_GRID_CELL_SURFACE,
    bgCellMedium: PREVIEW_GRID_CELL_MUTED,
    bgHeader: PREVIEW_GRID_HEADER_SURFACE,
    bgHeaderHasFocus: PREVIEW_GRID_HEADER_SURFACE,
    bgHeaderHovered: PREVIEW_GRID_HEADER_SURFACE,
    bgBubble: PREVIEW_GRID_CELL_MUTED,
    bgBubbleSelected: color('--color-accent-muted', 'rgba(98, 201, 154, 0.14)'),
    bgSearchResult: color('--color-accent-muted', 'rgba(98, 201, 154, 0.14)'),
    borderColor: PREVIEW_GRID_BORDER,
    horizontalBorderColor: PREVIEW_GRID_BORDER,
    headerBottomBorderColor: PREVIEW_GRID_BORDER,
    drilldownBorder: PREVIEW_GRID_BORDER,
    linkColor: color('--color-accent', '#3baf7a'),
    cellHorizontalPadding: 10,
    cellVerticalPadding: 0,
    headerFontStyle: '600 12px',
    baseFontStyle: '13px',
    markerFontStyle: '12px',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Plus Jakarta Sans', system-ui, sans-serif",
    editorFontSize: '13px',
    lineHeight: 1.35,
    resizeIndicatorColor: color('--color-accent', '#3baf7a'),
    roundingRadius: 8,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const INPUT_TABLE_FALLBACK_PAGE_SIZE = 20;
const EMPTY_COLUMNS: string[] = [];
const EMPTY_ROWS: Array<Record<string, string | number | boolean | null>> = [];
const PREVIEW_GRID_HEADER_SURFACE = '#F2FAF5';
const PREVIEW_GRID_CELL_SURFACE = '#FFFFFF';
const PREVIEW_GRID_CELL_MUTED = '#F3FBF6';
const PREVIEW_GRID_ICON_SURFACE = '#E7F8EF';
const PREVIEW_GRID_BORDER = 'rgba(220, 236, 227, 0.82)';
const PREVIEW_GRID_TEXT_PRIMARY = '#263B33';
const PREVIEW_GRID_TEXT_SECONDARY = '#49685A';
const PREVIEW_GRID_TEXT_MUTED = '#8AA99A';
