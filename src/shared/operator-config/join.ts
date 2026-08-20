import type { KeepItem } from '../operator-schemas';
import { parseFieldRef } from '../prep-dsl/syntax/fields';
import { normalizeDuration, parseDuration, type DurationParts } from '../operator-schemas/join';

const DURATION_PART_MS: Record<keyof DurationParts, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1_000,
  ms: 1,
};

export type JoinSide = 'left' | 'right';

export interface JoinKeepDraft {
  leftTotal: number;
  rightTotal: number;
  leftWildcard: boolean;
  rightWildcard: boolean;
  leftSelected: Set<string>;
  rightSelected: Set<string>;
  leftAliases: Map<string, string>;
  rightAliases: Map<string, string>;
}

export interface JoinKeepSummary {
  selected: number;
  renamed: number;
}

export function qualifyJoinField(alias: string, field: string): string {
  return `[${alias}].[${field}]`;
}

export function updateJoinDurationPart(
  value: string,
  part: keyof DurationParts,
  amount: number
): string | undefined {
  const parts = { ...parseDuration(value), [part]: amount };
  const totalMilliseconds = (Object.keys(DURATION_PART_MS) as Array<keyof DurationParts>).reduce(
    (total, key) => total + parts[key] * DURATION_PART_MS[key],
    0
  );
  return normalizeDuration(String(totalMilliseconds)) || undefined;
}

export function isJoinFieldFromAlias(source: string, alias: string): boolean {
  const reference = parseFieldRef(source);
  if (reference?.source) return reference.source.toLowerCase() === alias.toLowerCase();
  return source.toLowerCase().startsWith(`${alias}.`.toLowerCase());
}

function isKeepItemFromSide(item: KeepItem, side: JoinSide, alias: string): boolean {
  if (typeof item.side === 'string') return item.side === side;
  return isJoinFieldFromAlias(item.source ?? '', alias);
}

export function createJoinKeepDraft(
  keepItems: readonly KeepItem[],
  leftFields: readonly string[],
  rightFields: readonly string[],
  leftAlias: string,
  rightAlias: string
): JoinKeepDraft {
  const isEmpty = keepItems.length === 0;
  const draft: JoinKeepDraft = {
    leftTotal: leftFields.length,
    rightTotal: rightFields.length,
    leftWildcard: isEmpty || keepItems.some((item) => item.side === 'left' && item.wildcard),
    rightWildcard: isEmpty || keepItems.some((item) => item.side === 'right' && item.wildcard),
    leftSelected: new Set<string>(),
    rightSelected: new Set<string>(),
    leftAliases: new Map<string, string>(),
    rightAliases: new Map<string, string>(),
  };

  if (isEmpty) {
    leftFields.forEach((field) => draft.leftSelected.add(qualifyJoinField(leftAlias, field)));
    rightFields.forEach((field) => draft.rightSelected.add(qualifyJoinField(rightAlias, field)));
    return draft;
  }

  for (const item of keepItems) {
    if (item.wildcard) {
      if (item.side === 'left') {
        leftFields.forEach((field) => draft.leftSelected.add(qualifyJoinField(leftAlias, field)));
      } else if (item.side === 'right') {
        rightFields.forEach((field) =>
          draft.rightSelected.add(qualifyJoinField(rightAlias, field))
        );
      }
      continue;
    }
    if (!item.source) continue;
    if (isKeepItemFromSide(item, 'left', leftAlias)) {
      draft.leftSelected.add(item.source);
      if (item.alias) draft.leftAliases.set(item.source, item.alias);
    } else if (isKeepItemFromSide(item, 'right', rightAlias)) {
      draft.rightSelected.add(item.source);
      if (item.alias) draft.rightAliases.set(item.source, item.alias);
    }
  }
  return draft;
}

export function serializeJoinKeepDraft(draft: JoinKeepDraft): KeepItem[] {
  const items: KeepItem[] = [];
  const appendSide = (
    side: JoinSide,
    selected: ReadonlySet<string>,
    aliases: ReadonlyMap<string, string>,
    wildcard: boolean,
    total: number
  ) => {
    if (wildcard && selected.size === total && aliases.size === 0) {
      items.push({ side, wildcard: true });
      return;
    }
    for (const source of selected) {
      const alias = aliases.get(source);
      items.push({ side, source, ...(alias ? { alias } : {}) });
    }
  };
  appendSide('left', draft.leftSelected, draft.leftAliases, draft.leftWildcard, draft.leftTotal);
  appendSide(
    'right',
    draft.rightSelected,
    draft.rightAliases,
    draft.rightWildcard,
    draft.rightTotal
  );
  return items;
}

export function summarizeJoinKeep(
  keepItems: readonly KeepItem[],
  side: JoinSide,
  alias: string,
  totalFields: number
): JoinKeepSummary {
  const selectedItems = keepItems.filter(
    (item) => !item.wildcard && isKeepItemFromSide(item, side, alias)
  );
  const keepsAllFields =
    keepItems.length === 0 || keepItems.some((item) => item.side === side && item.wildcard);
  return {
    selected: keepsAllFields ? totalFields : selectedItems.length,
    renamed: selectedItems.filter((item) => Boolean(item.alias)).length,
  };
}
