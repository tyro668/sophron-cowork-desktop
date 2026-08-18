export interface CalculationWindowFrame {
  type: 'rows' | 'range' | 'groups';
  start: string;
  end: string;
  exclude?: 'current row' | 'group' | 'ties' | 'no others';
}

export interface ParsedWindowFrameBound {
  position:
    | 'unbounded-preceding'
    | 'preceding'
    | 'current-row'
    | 'following'
    | 'unbounded-following';
  offset?: number;
  unit?: string;
}

export function parseWindowFrameBound(bound: string): ParsedWindowFrameBound {
  const normalized = bound.trim();
  if (/^unbounded preceding$/i.test(normalized)) return { position: 'unbounded-preceding' };
  if (/^current row$/i.test(normalized)) return { position: 'current-row' };
  if (/^unbounded following$/i.test(normalized)) return { position: 'unbounded-following' };

  const numeric = /^(\d+) (preceding|following)$/i.exec(normalized);
  if (numeric) {
    return {
      position: numeric[2].toLowerCase() as 'preceding' | 'following',
      offset: Number(numeric[1]),
    };
  }

  const interval = /^interval (\d+) (day|week|month|quarter|year) (preceding|following)$/i.exec(
    normalized
  );
  if (interval) {
    return {
      position: interval[3].toLowerCase() as 'preceding' | 'following',
      offset: Number(interval[1]),
      unit: interval[2].toLowerCase(),
    };
  }

  throw new Error(`Invalid window frame bound '${bound}'`);
}

export function isOffsetFrameBound(bound: ParsedWindowFrameBound): boolean {
  return bound.position === 'preceding' || bound.position === 'following';
}

const POSITION_RANK: Record<ParsedWindowFrameBound['position'], number> = {
  'unbounded-preceding': 0,
  preceding: 1,
  'current-row': 2,
  following: 3,
  'unbounded-following': 4,
};

export function validateWindowFrameOrder(
  start: ParsedWindowFrameBound,
  end: ParsedWindowFrameBound
): boolean {
  if (start.position === 'unbounded-following' || end.position === 'unbounded-preceding') {
    return false;
  }
  const startRank = POSITION_RANK[start.position];
  const endRank = POSITION_RANK[end.position];
  if (startRank !== endRank) return startRank < endRank;

  const comparableOffsets = start.unit === end.unit;
  if (!comparableOffsets || start.offset === undefined || end.offset === undefined) return true;
  if (start.position === 'preceding') return start.offset >= end.offset;
  if (start.position === 'following') return start.offset <= end.offset;
  return true;
}

export function validateWindowFrame(
  functionId: string,
  frame: CalculationWindowFrame,
  orderFieldCount: number
): void {
  const start = parseWindowFrameBound(frame.start);
  const end = parseWindowFrameBound(frame.end);
  if (
    frame.type === 'range' &&
    (isOffsetFrameBound(start) || isOffsetFrameBound(end)) &&
    orderFieldCount !== 1
  ) {
    throw new Error(
      `Calculation function '${functionId}' requires exactly one order field for a RANGE offset`
    );
  }
  if (!validateWindowFrameOrder(start, end)) {
    throw new Error(`Calculation function '${functionId}' frame start must not be after its end`);
  }
}
