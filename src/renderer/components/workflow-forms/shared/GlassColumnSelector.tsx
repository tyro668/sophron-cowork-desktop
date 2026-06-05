interface GlassColumnSelectorProps {
  columns: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  maxHeight?: string;
}

export function GlassColumnSelector({
  columns,
  selected,
  onChange,
  maxHeight = '160px',
}: GlassColumnSelectorProps) {
  const allSelected = columns.length > 0 && selected.length === columns.length;

  function toggleAll() {
    onChange(allSelected ? [] : [...columns]);
  }

  function toggleColumn(col: string) {
    if (selected.includes(col)) {
      onChange(selected.filter((c) => c !== col));
    } else {
      onChange([...selected, col]);
    }
  }

  return (
    <div className="rounded-lg border border-border-muted bg-background/42">
      <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
          />
          {allSelected ? '取消全选' : '全选'}
        </label>
        <span className="text-[10px] text-text-muted">
          {selected.length}/{columns.length}
        </span>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight }}>
        {columns.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12px] text-text-muted">暂无可用字段</div>
        ) : (
          columns.map((col) => (
            <label
              key={col}
              className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12px] transition-colors hover:bg-surface-hover ${
                selected.includes(col) ? 'text-text-primary' : 'text-text-secondary'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.includes(col)}
                onChange={() => toggleColumn(col)}
                className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
              />
              {col}
            </label>
          ))
        )}
      </div>
    </div>
  );
}
