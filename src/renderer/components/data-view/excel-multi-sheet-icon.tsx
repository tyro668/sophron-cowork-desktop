/**
 * Excel workbook that owns several tables (one per sheet): a spreadsheet page with a second
 * page stacked behind it. Same 24px grid, 2px round stroke as the lucide icons around it.
 */
export function ExcelMultiSheetIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      data-testid="excel-multi-sheet-icon"
    >
      {/* back sheet: only its top and right edges show */}
      <path d="M8 2h8l5 5v11" />
      {/* front sheet with folded corner */}
      <path d="M13 5H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
      <path d="M13 5v4h4" />
      {/* cell grid */}
      <path d="M6.5 13h2M11.5 13h2M6.5 17h2M11.5 17h2" />
    </svg>
  );
}
