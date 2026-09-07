export type FilterConditionConnective = 'and' | 'or';

export interface FilterConditionRow {
  field: string;
  op: string;
  val1: string;
  val2: string;
  connective: FilterConditionConnective;
}

export interface FilterConditionLeaf {
  kind: 'leaf';
  id: string;
  field: string;
  op: string;
  val1: string;
  val2: string;
  /** Structured value list for `in` / `not in`. Authoritative source for
   *  building DSL and rendering the multi-value UI; falls back to
   *  `splitInValues(val1)` for pre-existing leaves. */
  values?: string[];
}

export interface FilterConditionBranch {
  kind: 'branch';
  id: string;
  connective: FilterConditionConnective;
  items: FilterConditionNode[];
}

export type FilterConditionNode = FilterConditionLeaf | FilterConditionBranch;

let _nodeIdCounter = 0;
export function resetNodeIdCounter(): void {
  _nodeIdCounter = 0;
}
export function nextNodeId(): string {
  return `fc_${++_nodeIdCounter}`;
}

export function isLeaf(node: FilterConditionNode): node is FilterConditionLeaf {
  return node.kind === 'leaf';
}

export function isBranch(node: FilterConditionNode): node is FilterConditionBranch {
  return node.kind === 'branch';
}
