import { InlineBanner } from './ui/inline-banner';
import { Button } from './ui/button';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { ChevronLeft, ChevronRight, Filter, Loader2, RefreshCw, X } from 'lucide-react';
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
  onRetry?: () => void;
  /** Show the column filter bar (filters apply to the loaded page). */
  enableFilters?: boolean;
}

type FilterOp = 'eq' | 'neq' | 'contains';
interface ColumnFilter {
  column: string;
  op: FilterOp;
  value: string;
}

function matchesFilter(cell: PreviewCellValue, filter: ColumnFilter): boolean {
  const text = cell === null || cell === undefined ? '' : String(cell);
  if (filter.op === 'contains') return text.toLowerCase().includes(filter.value.toLowerCase());
  const equal = text === filter.value;
  return filter.op === 'eq' ? equal : !equal;
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
  onRetry,
  enableFilters = false,
}: GlassDataGridPreviewProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  const [filterFormOpen, setFilterFormOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<ColumnFilter>({ column: '', op: 'eq', value: '' });
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
  const activeFilters = useMemo(
    () => filters.filter((filter) => columns.includes(filter.column)),
    [filters, columns]
  );
  const rows = useMemo(() => {
    const filtered =
      activeFilters.length === 0
        ? rawRows
        : rawRows.filter((row) =>
            activeFilters.every((filter) => matchesFilter(row[filter.column], filter))
          );
    if (!sort || !columns.includes(sort.column)) return filtered;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => compareCells(a[sort.column], b[sort.column]) * factor);
  }, [rawRows, sort, columns, activeFilters]);
  const opLabel = (op: FilterOp) =>
    op === 'eq' ? '=' : op === 'neq' ? '≠' : t('data.preview.filterContains');
  const totalRows = preview?.totalRows ?? 0;
  const pageSize = preview?.limit ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / Math.max(1, pageSize || 1)));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, pageCount);
  const gridColumns = useMemo(
    () =>
      buildGridColumns(columns, rawRows, columnTypeByName).map((column) =>
        sort && column.id === sort.column
          ? { ...column, title: `${column.title} ${sort.dir === 'asc' ? '↑' : '↓'}` }
          : column
      ),
    [columns, rawRows, columnTypeByName, sort]
  );
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
      {enableFilters && hasColumns && (
        <div
          className="relative flex min-h-10 flex-shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5"
          style={{ borderColor: 'var(--data-grid-border)' }}
        >
          <button
            type="button"
            onClick={() => {
              setFilterDraft((current) => ({ ...current, column: current.column || columns[0] }));
              setFilterFormOpen((open) => !open);
            }}
            className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
              activeFilters.length > 0
                ? 'border-accent/40 bg-accent-muted text-accent-text'
                : 'border-border-muted bg-surface text-text-secondary hover:border-accent/40'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            {t('data.preview.filter')}
            {activeFilters.length > 0 && ` · ${activeFilters.length}`}
          </button>
          {activeFilters.map((filter, index) => (
            <span
              key={`${filter.column}:${filter.op}:${filter.value}:${index}`}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-accent/25 bg-accent-muted px-2 text-[12px] text-accent-text"
            >
              {filter.column} {opLabel(filter.op)} {filter.value || '""'}
              <button
                type="button"
                aria-label={t('data.preview.removeFilter')}
                onClick={() => setFilters((current) => current.filter((item) => item !== filter))}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {activeFilters.length > 0 && (
            <span className="ml-auto text-[11.5px] text-text-muted">
              {t('data.preview.filterScope', { shown: rows.length, total: rawRows.length })}
            </span>
          )}
          {filterFormOpen && (
            <form
              className="absolute left-3 top-full z-30 mt-1 flex items-center gap-2 rounded-xl border border-border-subtle bg-surface p-2 shadow-elevated"
              onSubmit={(event) => {
                event.preventDefault();
                if (!filterDraft.column) return;
                setFilters((current) => [...current, filterDraft]);
                setFilterDraft((current) => ({ ...current, value: '' }));
                setFilterFormOpen(false);
              }}
            >
              <select
                aria-label={t('data.preview.filterColumn')}
                value={filterDraft.column}
                onChange={(event) =>
                  setFilterDraft((current) => ({ ...current, column: event.target.value }))
                }
                className="h-7 max-w-[10rem] rounded-md border border-border-muted bg-surface px-1.5 text-xs"
              >
                {columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('data.preview.filterOperator')}
                value={filterDraft.op}
                onChange={(event) =>
                  setFilterDraft((current) => ({ ...current, op: event.target.value as FilterOp }))
                }
                className="h-7 rounded-md border border-border-muted bg-surface px-1.5 text-xs"
              >
                <option value="eq">=</option>
                <option value="neq">≠</option>
                <option value="contains">{t('data.preview.filterContains')}</option>
              </select>
              <input
                autoFocus
                aria-label={t('data.preview.filterValue')}
                value={filterDraft.value}
                onChange={(event) =>
                  setFilterDraft((current) => ({ ...current, value: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setFilterFormOpen(false);
                }}
                placeholder={t('data.preview.filterValue')}
                className="h-7 w-36 rounded-md border border-border-muted bg-surface px-2 text-xs outline-none focus:border-accent/50"
              />
              <Button type="submit" size="sm" variant="primary">
                {t('data.preview.addFilter')}
              </Button>
            </form>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
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
        className="flex h-11 flex-shrink-0 items-center justify-between gap-3 border-t px-3 text-xs font-medium"
        style={{
          background: 'var(--data-grid-header-surface)',
          borderColor: 'var(--data-grid-border)',
          color: 'var(--data-grid-text-primary)',
        }}
      >
        <div className="flex min-w-0 items-center gap-x-3">{footerLeading}</div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <span className="mr-2">
            {preview ? labels.total(totalRows) : labels.pageSize(RAW_TABLE_FALLBACK_PAGE_SIZE)}
          </span>
          <span
            className="mr-2 hidden sm:inline"
            style={{ color: 'var(--data-grid-text-secondary)' }}
          >
            {labels.pageSize(preview?.limit ?? RAW_TABLE_FALLBACK_PAGE_SIZE)}
          </span>
          <button
            type="button"
            onClick={() => onPageChange?.(safeCurrentPage - 1)}
            disabled={isLoading || !onPageChange || safeCurrentPage <= 1}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
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
                  ? 'bg-accent text-accent-foreground shadow-soft'
                  : 'border border-border-muted bg-surface text-text-secondary hover:border-accent/30 hover:bg-accent-muted hover:text-text-primary'
              }`}
            >
              {pageNumber}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPageChange?.(safeCurrentPage + 1)}
            disabled={isLoading || !onPageChange || safeCurrentPage >= pageCount}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {footerTrailing}
        </div>
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
