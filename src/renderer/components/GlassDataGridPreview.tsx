import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { InlineBanner } from './ui/inline-banner';
import { Button } from './ui/button';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import DataEditor, {
  GridCellKind,
  GridColumnIcon,
  type DataEditorProps,
  type GridCell,
  type GridColumn,
  type Item,
  type SpriteMap,
  type Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataRawTablePreview } from '../types';
import {
  isNumericDataFieldType,
  normalizeDataFieldType,
  type DataColumnTypeInfo,
  type DataFieldType,
} from '../../shared/data-field-types';

type PreviewCellValue = string | number | boolean | null | undefined;

interface GlassDataGridPreviewLabels {
  loading: string;
  empty: string;
  total: (count: number) => string;
  pageSize: (count: number) => string;
  errorTitle?: string;
  retry?: string;
}

export interface GlassDataGridPreviewProps {
  preview: DataRawTablePreview | null;
  isLoading?: boolean;
  error?: string | null;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  labels: GlassDataGridPreviewLabels;
  className?: string;
  rowHeight?: number;
  headerHeight?: number;
  edgeToEdge?: boolean;
  footerLeading?: ReactNode;
  footerTrailing?: ReactNode;
  /** Optional page-size dropdown (flush cell). When omitted the size is shown as text. */
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (size: number) => void;
  /** Pager height; defaults to 36px (h-9). */
  footerClassName?: string;
  onRetry?: () => void;
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
  footerLeading,
  footerTrailing,
  pageSizeOptions,
  onPageSizeChange,
  footerClassName,
  onRetry,
}: GlassDataGridPreviewProps) {
  const { t } = useTranslation();
  const theme = useGlassDataGridTheme();
  const columns = preview?.columns ?? EMPTY_COLUMNS;
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null);
  // Avoid skeleton flicker for fast loads (< 300ms).
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setShowSkeleton(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSkeleton(true), 300);
    return () => window.clearTimeout(timer);
  }, [isLoading]);
  const columnTypeByName = useMemo(
    () => new Map((preview?.columnTypes ?? []).map((column) => [column.name, column])),
    [preview?.columnTypes]
  );
  const rawRows = preview?.rows ?? EMPTY_ROWS;
  const rows = useMemo(() => {
    if (!sort || !columns.includes(sort.column)) return rawRows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rawRows].sort((a, b) => compareCells(a[sort.column], b[sort.column]) * factor);
  }, [rawRows, sort, columns]);
  const totalRows = preview?.totalRows ?? 0;
  const pageSize = preview?.limit ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / Math.max(1, pageSize || 1)));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, pageCount);
  const gridHostRef = useRef<HTMLDivElement | null>(null);
  const [gridHostWidth, setGridHostWidth] = useState(0);
  useEffect(() => {
    const host = gridHostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      setGridHostWidth(Math.floor(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const gridColumns = useMemo(() => {
    const built = buildGridColumns(columns, rawRows, columnTypeByName).map((column) =>
      sort && column.id === sort.column
        ? { ...column, title: `${column.title} ${sort.dir === 'asc' ? '↑' : '↓'}` }
        : column
    );
    // Columns share the spare width (fr-style) so the grid fills the editor.
    const total = built.reduce((sum, column) => sum + ('width' in column ? column.width : 0), 0);
    const available = gridHostWidth - 48 - 14;
    if (total <= 0 || available <= total) return built;
    const ratio = available / total;
    return built.map((column) =>
      'width' in column ? { ...column, width: Math.floor(column.width * ratio) } : column
    );
  }, [columns, rawRows, columnTypeByName, sort, gridHostWidth]);
  const hasColumns = columns.length > 0;
  const getCellContent = useMemo(() => {
    return ([col, row]: Item): GridCell => {
      const column = columns[col];
      const record = rows[row];
      return createGridCell(record?.[column], columnTypeByName.get(column)?.type);
    };
  }, [columnTypeByName, columns, rows]);
  const containerClassName = edgeToEdge
    ? `glass-data-grid-preview flex h-full min-h-0 flex-col overflow-hidden ${className}`
    : `glass-data-grid-preview glass-table flex h-full min-h-0 flex-col ${className}`;

  return (
    <div className={containerClassName}>
      <div ref={gridHostRef} className="relative min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          showSkeleton ? (
            <GridSkeleton columns={Math.max(4, Math.min(columns.length || 6, 10))} />
          ) : null
        ) : error ? (
          <div className="p-4">
            <InlineBanner
              tone="error"
              title={labels.errorTitle ?? error}
              description={labels.errorTitle ? error : undefined}
              actions={
                onRetry ? (
                  <Button size="sm" variant="secondary" onClick={onRetry}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    {labels.retry ?? 'Retry'}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : !hasColumns ? (
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
              startIndex: (safeCurrentPage - 1) * Math.max(1, pageSize || rows.length || 1) + 1,
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
            headerIcons={DATA_FIELD_HEADER_ICONS}
            drawHeader={drawStaticHeader}
            onHeaderClicked={(col) => {
              const column = columns[col];
              if (!column) return;
              setSort((current) =>
                current?.column !== column
                  ? { column, dir: 'asc' }
                  : current.dir === 'asc'
                    ? { column, dir: 'desc' }
                    : null
              );
            }}
            onPaste={false}
            keybindings={{ paste: false, delete: false }}
          />
        )}
      </div>
      <div
        className={`flex ${footerClassName ?? 'h-9'} flex-shrink-0 items-stretch border-t text-xs font-medium`}
        data-testid="grid-pager"
        style={{
          background: 'var(--data-grid-header-surface)',
          borderColor: 'var(--data-grid-border)',
          color: 'var(--data-grid-text-primary)',
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-x-3 px-3">
          {footerLeading}
          <span
            className="truncate font-normal"
            style={{ color: 'var(--data-grid-text-secondary)' }}
          >
            {preview ? labels.total(totalRows) : labels.pageSize(RAW_TABLE_FALLBACK_PAGE_SIZE)}
          </span>
        </div>
        {pageSizeOptions && onPageSizeChange ? (
          <Select
            value={String(preview?.limit ?? pageSizeOptions[0])}
            onValueChange={(v) => onPageSizeChange(Number(v))}
            disabled={isLoading}
          >
            <SelectTrigger
              data-testid="grid-page-size"
              className="h-full w-[120px] flex-shrink-0 rounded-none border-0 border-l bg-transparent px-3 text-xs font-medium focus-visible:ring-0"
              style={{ borderColor: 'var(--data-grid-border)' }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {labels.pageSize(size)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span
            className="hidden w-[120px] items-center border-l px-3 sm:flex"
            style={{
              borderColor: 'var(--data-grid-border)',
              color: 'var(--data-grid-text-secondary)',
            }}
          >
            {labels.pageSize(preview?.limit ?? RAW_TABLE_FALLBACK_PAGE_SIZE)}
          </span>
        )}
        <button
          type="button"
          aria-label={t('common.previous', 'Previous')}
          onClick={() => onPageChange?.(safeCurrentPage - 1)}
          disabled={isLoading || !onPageChange || safeCurrentPage <= 1}
          className="inline-flex w-10 items-center justify-center border-l text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          style={{ borderColor: 'var(--data-grid-border)' }}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pageNumbers.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            onClick={() => onPageChange?.(pageNumber)}
            disabled={isLoading || !onPageChange}
            aria-current={pageNumber === safeCurrentPage ? 'page' : undefined}
            className={`inline-flex w-10 items-center justify-center border-l text-xs font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              pageNumber === safeCurrentPage
                ? 'bg-accent-muted text-accent'
                : 'text-text-secondary hover:bg-accent-muted hover:text-accent'
            }`}
            style={{ borderColor: 'var(--data-grid-border)' }}
          >
            {pageNumber}
          </button>
        ))}
        <button
          type="button"
          aria-label={t('common.next', 'Next')}
          onClick={() => onPageChange?.(safeCurrentPage + 1)}
          disabled={isLoading || !onPageChange || safeCurrentPage >= pageCount}
          className="inline-flex w-10 items-center justify-center border-l text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          style={{ borderColor: 'var(--data-grid-border)' }}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {footerTrailing}
      </div>
    </div>
  );
}

function compareCells(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const an = typeof a === 'number' ? a : Number(a);
  const bn = typeof b === 'number' ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a).localeCompare(String(b), 'zh-CN');
}

function GridSkeleton({ columns }: { columns: number }) {
  return (
    <div className="h-full overflow-hidden" aria-busy="true">
      <div className="flex h-9 items-center gap-4 border-b border-border-muted bg-[var(--data-grid-header-surface)] px-4">
        {Array.from({ length: columns }, (_, index) => (
          <span key={index} className="h-2.5 flex-1 rounded bg-surface-active" />
        ))}
      </div>
      {Array.from({ length: 16 }, (_, row) => (
        <div
          key={row}
          className="flex h-[34px] items-center gap-4 border-b border-border-subtle px-4"
        >
          {Array.from({ length: columns }, (_, index) => (
            <span
              key={index}
              className="h-2.5 flex-1 animate-pulse rounded bg-surface-active"
              style={{ maxWidth: `${55 + ((row * 7 + index * 13) % 40)}%` }}
            />
          ))}
        </div>
      ))}
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
          isError ? 'border-error/15 bg-error/5' : 'border-border-muted bg-surface'
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
  rows: Array<Record<string, string | number | boolean | null>>,
  columnTypeByName: Map<string, DataColumnTypeInfo>
): GridColumn[] {
  return columns.map((column) => {
    const columnType = columnTypeByName.get(column);
    return {
      id: column,
      title: formatColumnTitle(column),
      width: estimateColumnWidth(column, rows),
      icon: inferColumnIcon(column, rows, columnType?.type),
    };
  });
}

function createGridCell(value: PreviewCellValue, semanticType?: DataFieldType): GridCell {
  const normalizedType = semanticType ? normalizeDataFieldType(semanticType) : undefined;
  if (value === null || value === undefined) {
    return {
      kind: GridCellKind.Text,
      allowOverlay: false,
      readonly: true,
      data: '',
      displayData: '—',
      copyData: '',
      style: 'faded',
      contentAlign: normalizedType && isNumericDataFieldType(normalizedType) ? 'right' : 'left',
    };
  }
  if (
    normalizedType === 'boolean' &&
    (typeof value === 'boolean' || /^(true|false)$/i.test(String(value).trim()))
  ) {
    const data = typeof value === 'boolean' ? value : String(value).trim().toLowerCase() === 'true';
    return {
      kind: GridCellKind.Boolean,
      allowOverlay: false,
      readonly: true,
      data,
      copyData: data ? 'true' : 'false',
      contentAlign: 'center',
    };
  }
  if (
    normalizedType === 'decimal' &&
    typeof value !== 'boolean' &&
    String(value).trim() !== '' &&
    Number.isFinite(Number(String(value).trim())) &&
    Math.abs(Number(String(value).trim())) < 1e15
  ) {
    const numericValue = Number(String(value).trim());
    return {
      kind: GridCellKind.Number,
      allowOverlay: false,
      readonly: true,
      data: numericValue,
      displayData: decimalFormatter.format(numericValue),
      copyData: String(value),
      contentAlign: 'right',
    };
  }
  if (
    normalizedType !== 'decimal' &&
    ((typeof value === 'number' && Number.isFinite(value)) ||
      (normalizedType &&
        isNumericDataFieldType(normalizedType) &&
        Number.isFinite(Number(String(value).trim()))))
  ) {
    const numericValue = typeof value === 'number' ? value : Number(String(value).trim());
    return {
      kind: GridCellKind.Number,
      allowOverlay: false,
      readonly: true,
      data: numericValue,
      displayData:
        normalizedType === 'float' || !Number.isInteger(numericValue)
          ? floatFormatter.format(numericValue)
          : formatPreviewCell(value),
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
    contentAlign: normalizedType && isNumericDataFieldType(normalizedType) ? 'right' : 'left',
  };
}

function inferColumnIcon(
  column: string,
  rows: Array<Record<string, string | number | boolean | null>>,
  semanticType?: DataFieldType
): GridColumnIcon | string {
  if (semanticType) {
    return iconForDataFieldType(semanticType);
  }
  const values = rows
    .map((row) => row[column])
    .filter((value) => value !== null && value !== undefined);
  if (values.length > 0 && values.every((value) => typeof value === 'number')) {
    return GridColumnIcon.HeaderNumber;
  }
  if (values.length > 0 && values.every((value) => typeof value === 'boolean')) {
    return GridColumnIcon.HeaderBoolean;
  }
  return GridColumnIcon.HeaderString;
}

function iconForDataFieldType(semanticType: DataFieldType): GridColumnIcon | string {
  switch (normalizeDataFieldType(semanticType)) {
    case 'text':
      return GridColumnIcon.HeaderString;
    case 'date':
      return GridColumnIcon.HeaderDate;
    case 'datetime':
      return GridColumnIcon.HeaderTime;
    case 'integer':
      return 'dataFieldTypeInteger';
    case 'float':
      return 'dataFieldTypeFloat';
    case 'decimal':
      return 'dataFieldTypeDecimal';
    case 'boolean':
      return GridColumnIcon.HeaderBoolean;
  }
}

function estimateColumnWidth(
  column: string,
  rows: Array<Record<string, string | number | boolean | null>>
): number {
  const sampledValues = rows.slice(0, 30).map((row) => formatPreviewCell(row[column]));
  const widest = [formatColumnTitle(column), ...sampledValues].reduce(
    (current, value) => Math.max(current, measureDisplayWidth(value)),
    0
  );
  return clamp(Math.round(widest * 7.2 + 40), 104, 280);
}

function formatColumnTitle(column: string): string {
  return column;
}

function measureDisplayWidth(value: string): number {
  return Array.from(value).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 1.7 : 1), 0);
}

// Amount-style decimals: thousands separators, exactly 2 fraction digits (B07).
const decimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
// Floats: thousands separators, strip binary floating-point noise.
const floatFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

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
  const gridHeaderSurface = color('--data-grid-header-surface', PREVIEW_GRID_HEADER_SURFACE);
  const gridCellSurface = color('--data-grid-cell-surface', PREVIEW_GRID_CELL_SURFACE);
  const gridCellMuted = color('--data-grid-cell-muted', PREVIEW_GRID_CELL_MUTED);
  const gridIconSurface = color('--data-grid-icon-surface', PREVIEW_GRID_ICON_SURFACE);
  const gridBorder = color('--data-grid-border', PREVIEW_GRID_BORDER);
  const gridTextPrimary = color('--data-grid-text-primary', PREVIEW_GRID_TEXT_PRIMARY);
  const gridTextSecondary = color('--data-grid-text-secondary', PREVIEW_GRID_TEXT_SECONDARY);
  const gridTextMuted = color('--data-grid-text-muted', PREVIEW_GRID_TEXT_MUTED);
  return {
    accentColor: color('--color-accent', '#2f8f63'),
    accentFg: color('--color-accent-foreground', '#0c1210'),
    accentLight: color('--color-accent-muted', '#eaf6ee'),
    textDark: gridTextPrimary,
    textMedium: gridTextSecondary,
    textLight: gridTextMuted,
    textBubble: gridTextPrimary,
    textHeader: gridTextPrimary,
    textHeaderSelected: gridTextPrimary,
    bgIconHeader: gridIconSurface,
    fgIconHeader: color('--color-accent', '#2f8f63'),
    bgCell: gridCellSurface,
    bgCellMedium: gridCellMuted,
    bgHeader: gridHeaderSurface,
    bgHeaderHasFocus: gridHeaderSurface,
    bgHeaderHovered: gridHeaderSurface,
    bgBubble: gridCellMuted,
    bgBubbleSelected: color('--color-accent-muted', '#eaf6ee'),
    bgSearchResult: color('--color-accent-muted', '#eaf6ee'),
    borderColor: gridBorder,
    horizontalBorderColor: gridBorder,
    headerBottomBorderColor: gridBorder,
    drilldownBorder: gridBorder,
    linkColor: color('--color-accent', '#2f8f63'),
    cellHorizontalPadding: 10,
    cellVerticalPadding: 0,
    headerFontStyle: '600 12px',
    baseFontStyle: '13px',
    markerFontStyle: '12px',
    fontFamily:
      "'PingFang SC', 'Inter', 'SF Pro Text', 'Microsoft YaHei UI', 'Noto Sans SC', sans-serif",
    editorFontSize: '13px',
    lineHeight: 1.35,
    resizeIndicatorColor: color('--color-accent', '#2f8f63'),
    roundingRadius: 8,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const RAW_TABLE_FALLBACK_PAGE_SIZE = 20;
const EMPTY_COLUMNS: string[] = [];
const EMPTY_ROWS: Array<Record<string, string | number | boolean | null>> = [];
const PREVIEW_GRID_HEADER_SURFACE = '#F0F7F2';
const PREVIEW_GRID_CELL_SURFACE = '#FFFFFF';
const PREVIEW_GRID_CELL_MUTED = '#F6FAF7';
const PREVIEW_GRID_ICON_SURFACE = '#EAF6EE';
const PREVIEW_GRID_BORDER = '#DCE8DF';
const PREVIEW_GRID_TEXT_PRIMARY = '#24362E';
const PREVIEW_GRID_TEXT_SECONDARY = '#52675D';
const PREVIEW_GRID_TEXT_MUTED = '#718078';

const DATA_FIELD_HEADER_ICONS: SpriteMap = {
  dataFieldTypeInteger: (props) => buildTextHeaderIcon(props.bgColor, props.fgColor, '#', '11px'),
  dataFieldTypeFloat: (props) => buildTextHeaderIcon(props.bgColor, props.fgColor, '1.2', '7px'),
  dataFieldTypeDecimal: (props) => buildTextHeaderIcon(props.bgColor, props.fgColor, '0.00', '6px'),
};

function buildTextHeaderIcon(
  bgColor: string,
  fgColor: string,
  label: string,
  fontSize: string
): string {
  return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="16" height="16" rx="2" fill="${bgColor}"/>
  <text x="10" y="10.8" text-anchor="middle" dominant-baseline="middle" fill="${fgColor}" font-family="Inter, SF Pro Text, Arial, sans-serif" font-size="${fontSize}" font-weight="600">${label}</text>
</svg>`;
}
