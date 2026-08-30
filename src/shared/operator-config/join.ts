import type { KeepItem } from '../operator-schemas';
import { parseFieldRef } from '../prep-dsl/syntax/fields';
import {
  normalizeDuration,
  parseDuration,
  type DurationParts,
  type JoinCondition,
} from '../operator-schemas/join';

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

export interface JoinConflictUi {
  strategy: string;
  leftSuffix: string;
  rightSuffix: string;
  rightPrefix: string;
}

export interface JoinAsofUi {
  leftTime: string;
  operator: string;
  rightTime: string;
  by: JoinCondition[];
  tolerance: string;
}

export interface JoinUiConfig {
  joinType: string;
  conditions: JoinCondition[];
  conflict: JoinConflictUi;
  keep: KeepItem[];
  asof: JoinAsofUi;
}

export const JOIN_CONFLICT_DEFAULTS: JoinConflictUi = {
  strategy: 'suffix',
  leftSuffix: '_left',
  rightSuffix: '_right',
  rightPrefix: 'right_',
};

/** Conflict object persisted to node config: only the fields relevant to the
 *  chosen strategy are kept, so stale values never survive a strategy switch. */
export interface JoinConflictConfig {
  strategy: string;
  leftSuffix?: string;
  rightSuffix?: string;
  rightPrefix?: string;
}

/** Normalize the dialog's conflict draft into the persisted config shape:
 *  trims input and falls back to the defaults on blank values (blank prefixes
 *  would otherwise fail JoinConfigSchema validation). */
export function buildJoinConflictConfig(draft: JoinConflictUi): JoinConflictConfig {
  return {
    strategy: draft.strategy,
    ...(draft.strategy === 'suffix'
      ? {
          leftSuffix: draft.leftSuffix.trim() || JOIN_CONFLICT_DEFAULTS.leftSuffix,
          rightSuffix: draft.rightSuffix.trim() || JOIN_CONFLICT_DEFAULTS.rightSuffix,
        }
      : {
          rightPrefix: draft.rightPrefix.trim() || JOIN_CONFLICT_DEFAULTS.rightPrefix,
        }),
  };
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Single read-side normalizer for the join form: fills display defaults and
 *  removes the per-field `as` casts that used to live in the component. */
export function readJoinUiConfig(config: Record<string, unknown> | undefined): JoinUiConfig {
  const cfg = config ?? {};
  const joinType = asString(cfg.joinType, 'left');
  const conflictRaw = asRecord(cfg.conflict);
  const strategy = asString(conflictRaw.strategy, JOIN_CONFLICT_DEFAULTS.strategy);
  const rightPrefixRaw = asString(conflictRaw.rightPrefix);
  const conflict: JoinConflictUi = {
    strategy,
    leftSuffix: asString(conflictRaw.leftSuffix, JOIN_CONFLICT_DEFAULTS.leftSuffix),
    rightSuffix: asString(conflictRaw.rightSuffix, JOIN_CONFLICT_DEFAULTS.rightSuffix),
    rightPrefix:
      strategy === 'right_prefix'
        ? rightPrefixRaw || JOIN_CONFLICT_DEFAULTS.rightPrefix
        : rightPrefixRaw,
  };
  const asofRaw = asRecord(cfg.asof);
  return {
    joinType,
    conditions: Array.isArray(cfg.conditions) ? (cfg.conditions as JoinCondition[]) : [],
    conflict,
    keep: Array.isArray(cfg.keep) ? (cfg.keep as KeepItem[]) : [],
    asof: {
      leftTime: asString(asofRaw.leftTime),
      operator: asString(asofRaw.operator, '>='),
      rightTime: asString(asofRaw.rightTime),
      by: Array.isArray(asofRaw.by) ? (asofRaw.by as JoinCondition[]) : [],
      tolerance: asString(asofRaw.tolerance),
    },
  };
}

/** Merge an asof patch into the raw `asof` config object. */
export function updateJoinAsof(
  existing: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return { ...asRecord(existing), ...patch };
}
