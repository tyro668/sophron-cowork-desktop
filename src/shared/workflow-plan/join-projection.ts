import { parseFieldRefExact } from '../expression-syntax/fields';

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    : [];
}

/**
 * Shared join output-projection planner: decides the output column list for
 * `keep` items and conflict renaming, so SQL generation and schema inference
 * compute identical output schemas.
 */

export interface JoinProjectionColumn {
  /** Output column name after alias/conflict resolution. */
  outputName: string;
  /** Which input side produced the column. */
  side: 'left' | 'right';
  /** Source column name on that side. */
  sourceColumn: string;
  /** The keep item's source text, or `left.<col>`/`right.<col>` for expansions. */
  sourceField: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function lastQualifiedPart(value: string): string {
  return parseFieldRefExact(value)?.name ?? value.trim();
}

function joinRightPrefix(conflict: unknown): string {
  if (
    isRecord(conflict) &&
    typeof conflict.rightPrefix === 'string' &&
    conflict.rightPrefix.trim()
  ) {
    return conflict.rightPrefix;
  }
  return 'right_';
}

function joinConflictAlias(conflict: unknown, side: 'left' | 'right', fieldName: string): string {
  if (isRecord(conflict) && conflict.strategy === 'suffix') {
    const leftSuffix = typeof conflict.leftSuffix === 'string' ? conflict.leftSuffix : '_left';
    const rightSuffix = typeof conflict.rightSuffix === 'string' ? conflict.rightSuffix : '_right';
    return `${fieldName}${side === 'left' ? leftSuffix : rightSuffix}`;
  }
  if (side === 'right') {
    return `${joinRightPrefix(conflict)}${fieldName}`;
  }
  return fieldName;
}

function emittedConflicts(
  items: Record<string, unknown>[],
  leftColumns: string[],
  rightColumns: string[],
  rightAlias?: string
): Set<string> {
  const left = new Set<string>();
  const right = new Set<string>();
  const lowerLeft = new Set(leftColumns.map((c) => c.toLowerCase()));
  if (items.length === 0) {
    leftColumns.forEach((c) => left.add(c.toLowerCase()));
    rightColumns.forEach((c) => right.add(c.toLowerCase()));
  }
  for (const item of items) {
    if (item.wildcard && item.side === 'left')
      leftColumns.forEach((c) => left.add(c.toLowerCase()));
    else if (item.wildcard && item.side === 'right')
      rightColumns.forEach((c) => right.add(c.toLowerCase()));
    else if (typeof item.source === 'string' && typeof item.alias !== 'string') {
      const ref = parseFieldRefExact(item.source);
      const name = (ref?.name ?? lastQualifiedPart(item.source)).toLowerCase();
      const side =
        item.side === 'right' || item.side === 'left'
          ? item.side
          : ref?.source && rightAlias && ref.source.toLowerCase() === rightAlias.toLowerCase()
            ? 'right'
            : ref?.source
              ? 'left'
              : lowerLeft.has(name)
                ? 'left'
                : 'right';
      (side === 'right' ? right : left).add(name);
    }
  }
  return new Set([...left].filter((name) => right.has(name)));
}

export function planJoinProjectionColumns(
  keep: unknown,
  leftColumns: string[],
  rightColumns: string[],
  conflict: unknown,
  rightAlias?: string
): JoinProjectionColumn[] {
  const items = objectArray(keep);
  // A column only "conflicts" when both sides actually emit it un-aliased into
  // the output; a right-side column that is not kept must not rename the left one.
  const conflictColumns = emittedConflicts(items, leftColumns, rightColumns, rightAlias);
  const isSuffix = isRecord(conflict) && conflict.strategy === 'suffix';
  const rightPrefix = joinRightPrefix(conflict);
  const isConflictColumn = (column: string) => conflictColumns.has(column.toLowerCase());

  const projections: JoinProjectionColumn[] = [];
  const push = (side: 'left' | 'right', column: string, outputName: string, sourceField: string) =>
    projections.push({ outputName, side, sourceColumn: column, sourceField });

  const pushLeftColumn = (column: string) =>
    push(
      'left',
      column,
      isConflictColumn(column) ? joinConflictAlias(conflict, 'left', column) : column,
      `left.${column}`
    );
  const pushRightColumn = (column: string) =>
    push(
      'right',
      column,
      isConflictColumn(column)
        ? isSuffix
          ? joinConflictAlias(conflict, 'right', column)
          : `${rightPrefix}${column}`
        : column,
      `right.${column}`
    );

  if (items.length === 0) {
    leftColumns.forEach(pushLeftColumn);
    rightColumns.forEach(pushRightColumn);
  } else {
    for (const item of items) {
      if (item.side === 'left' && item.wildcard) {
        leftColumns.forEach(pushLeftColumn);
        continue;
      }
      if (item.side === 'right' && item.wildcard) {
        rightColumns.forEach(pushRightColumn);
        continue;
      }
      if (typeof item.source !== 'string') continue;
      const ref = parseFieldRefExact(item.source);
      const fieldName = ref?.name ?? lastQualifiedPart(item.source);
      const side =
        item.side === 'right'
          ? 'right'
          : item.side === 'left'
            ? 'left'
            : ref?.source && rightAlias && ref.source.toLowerCase() === rightAlias.toLowerCase()
              ? 'right'
              : ref?.source
                ? 'left'
                : leftColumns.some((c) => c.toLowerCase() === fieldName.toLowerCase())
                  ? 'left'
                  : 'right';
      const conflictSide = side === 'right' ? 'right' : 'left';
      const alias =
        typeof item.alias === 'string'
          ? (parseFieldRefExact(item.alias)?.name ?? item.alias)
          : isConflictColumn(fieldName)
            ? joinConflictAlias(conflict, conflictSide, fieldName)
            : fieldName;
      push(side, fieldName, alias, item.source);
    }
  }

  const usedNames = new Map<string, JoinProjectionColumn>();
  for (const entry of projections) {
    const normalized = entry.outputName.toLowerCase();
    const previous = usedNames.get(normalized);
    if (previous) {
      throw new Error(
        `Join output field "${entry.outputName}" conflicts with ` +
          `"${previous.sourceField}" after applying aliases`
      );
    }
    usedNames.set(normalized, entry);
  }
  return projections;
}
