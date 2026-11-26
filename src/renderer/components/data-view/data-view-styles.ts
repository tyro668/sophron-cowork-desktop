/**
 * Underline-tab trigger styling for `TabsTrigger` — preserves the legacy
 * text + bottom-accent-line look on top of the semantic `Tabs` primitives.
 */
export const underlineTabTriggerClass =
  'relative h-full rounded-none border-r border-border-subtle bg-transparent px-4 text-ui-body font-medium text-text-secondary shadow-none ' +
  'hover:bg-surface-hover/60 hover:text-text-primary data-[state=active]:bg-accent-muted data-[state=active]:text-accent ' +
  'data-[state=active]:shadow-none after:absolute after:bottom-0 after:left-0 after:h-0.5 ' +
  'after:w-full data-[state=active]:after:bg-accent';

/**
 * Fixed tab width shared by the data page top tabs, the raw/result editor
 * bottom tabs and the cloud space bottom tabs. Widths include the 1px divider,
 * so N tabs span exactly N × FIXED_TAB_WIDTH (the cloud tree = 4 tabs).
 */
export const FIXED_TAB_WIDTH = 112;
export const fixedTabWidthClass = 'w-[112px] min-w-0 flex-none justify-center px-2';
export const fixedTabGroupWidth = (count: number) => count * FIXED_TAB_WIDTH;
export const fixedUnderlineTabTriggerClass = `${underlineTabTriggerClass} ${fixedTabWidthClass}`;

/**
 * Shared underline-tab bar chrome for the main workspace pages (data, skills,
 * automation): a fixed-height row with a baseline border that the active
 * trigger underline sits on. Keeps tab height/spacing identical across pages.
 */
export const underlineTabBarClass =
  'flex h-12 flex-shrink-0 items-stretch border-b border-border-subtle px-0';
export const underlineTabListClass =
  'inline-flex h-full items-stretch gap-0 rounded-none border-0 bg-transparent p-0';

/**
 * Bottom tab bar (cloud list panels style): the strip sits at the panel's
 * bottom edge; the active tab is tinted and marked by a top accent line.
 */
export const bottomTabBarClass =
  'flex h-12 flex-shrink-0 items-stretch border-t border-border-muted';
export const bottomTabListClass =
  'flex h-full items-stretch gap-0 rounded-none border-0 bg-transparent p-0';
export const bottomTabTriggerClass =
  'relative h-full w-[112px] min-w-0 flex-none justify-center rounded-none border-r border-border-subtle bg-transparent px-2 text-xs font-medium text-text-secondary shadow-none ' +
  'hover:bg-surface-hover/50 hover:text-text-primary ' +
  'data-[state=active]:bg-accent-muted data-[state=active]:text-accent data-[state=active]:shadow-none ' +
  'after:absolute after:inset-x-0 after:top-0 after:h-0.5 data-[state=active]:after:bg-accent';

/**
 * Flat full-width header strip for workspace list pages: search/create on the
 * left, row actions on the right. Replaces the old floating `mb-3` toolbar so
 * the bar sits flush against the tab underline and the table below it.
 */
export const flatToolbarRowClass =
  'flex h-10 flex-shrink-0 items-stretch gap-0 border-b border-border-subtle p-0 ' +
  '[&>div]:flex-nowrap [&>div]:items-stretch [&>div]:gap-0';

/** Primary create button rendered as a flush toolbar cell (no radius / gap). */
export const toolbarPrimaryCellClass =
  'inline-flex h-full flex-shrink-0 items-center justify-center gap-1.5 rounded-none jade-primary-button px-4 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Editor header strip (pipeline/raw-table/result-table editors): sits where the
 * workspace tab bar would be, so it must match `underlineTabBarClass` height
 * (h-12) to avoid a vertical shift when drilling into an editor.
 */
export const editorHeaderRowClass =
  'flex h-12 flex-shrink-0 items-center gap-2.5 border-b border-border-subtle px-3';

/** Config / detail body: child `.ui-group` cards become edge-to-edge sections. */
export const configFlushBodyClass = 'ui-config-flush min-h-0 flex-1 overflow-auto bg-surface';

/** Width of the trailing icon cell (toolbar ⋯ and the tab-bar split-button arrow). */
export const toolbarEndControlWidthClass = 'w-10';

/** Compact flush "+ 新建…" cell at the right end of the tab bar: accent text, hover tint. */
export const tabBarNewCellClass =
  'inline-flex h-full flex-shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle px-4 text-xs font-medium text-accent transition-colors hover:bg-accent-muted/60 disabled:cursor-not-allowed disabled:opacity-50';
