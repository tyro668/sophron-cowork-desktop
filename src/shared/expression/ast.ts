export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '||'
  | '='
  | '!='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='
  | 'AND'
  | 'OR'
  | 'LIKE'
  | 'ILIKE'
  | 'NOT LIKE'
  | 'NOT ILIKE';

export interface WindowSpec {
  partitionBy: Expr[];
  orderBy: Array<{ expr: Expr; direction?: 'ASC' | 'DESC'; nulls?: 'FIRST' | 'LAST' }>;
  /** Canonical frame text with nested expressions already compiled lazily. */
  frame?: {
    unit: 'ROWS' | 'RANGE' | 'GROUPS';
    start: FrameBound;
    end?: FrameBound;
    exclude?: string;
  };
}

export type FrameBound =
  | { kind: 'unbounded'; side: 'PRECEDING' | 'FOLLOWING' }
  | { kind: 'current' }
  | { kind: 'offset'; offset: Expr; side: 'PRECEDING' | 'FOLLOWING' };

export type Expr =
  | { k: 'field'; name: string; qualifier?: string }
  | { k: 'str'; value: string }
  | { k: 'num'; raw: string }
  | { k: 'bool'; value: boolean }
  | { k: 'null' }
  | { k: 'star' }
  | { k: 'paren'; e: Expr }
  | { k: 'unary'; op: '-' | '+' | 'NOT'; e: Expr }
  | { k: 'bin'; op: BinaryOp; l: Expr; r: Expr }
  | { k: 'isnull'; e: Expr; not: boolean }
  | { k: 'distinct'; l: Expr; r: Expr; not: boolean }
  | { k: 'in'; e: Expr; not: boolean; list: Expr[] }
  | { k: 'between'; e: Expr; not: boolean; lo: Expr; hi: Expr }
  | { k: 'textop'; op: 'matches' | 'begin' | 'end'; not: boolean; l: Expr; r: Expr }
  | {
      k: 'call';
      name: string;
      args: Expr[];
      distinct: boolean;
      over?: WindowSpec;
      bare?: boolean;
    }
  | { k: 'case'; operand?: Expr; whens: Array<[Expr, Expr]>; else?: Expr }
  | { k: 'cast'; e: Expr; type: string; try: boolean }
  | { k: 'extract'; part: string; e: Expr }
  | { k: 'interval'; value: Expr; unit?: string }
  | { k: 'typed'; type: 'DATE' | 'TIMESTAMP'; value: string };
