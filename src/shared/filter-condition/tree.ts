import {
  isBranch,
  isLeaf,
  nextNodeId,
  type FilterConditionBranch,
  type FilterConditionConnective,
  type FilterConditionLeaf,
  type FilterConditionNode,
} from './model';

export function createEmptyLeaf(): FilterConditionLeaf {
  return {
    kind: 'leaf',
    id: nextNodeId(),
    field: '',
    op: '=',
    val1: '',
    val2: '',
  };
}

export function createEmptyBranch(
  connective: FilterConditionConnective = 'and'
): FilterConditionBranch {
  return {
    kind: 'branch',
    id: nextNodeId(),
    connective,
    items: [createEmptyLeaf()],
  };
}

/**
 * Walk a tree and compute the depth of each node.
 * Root branch has depth 0. Its direct children have depth 1, etc.
 */
export function getNodeDepth(node: FilterConditionNode, root: FilterConditionBranch): number {
  function findDepth(
    target: FilterConditionNode,
    branch: FilterConditionBranch,
    depth: number
  ): number {
    for (const item of branch.items) {
      if (item.id === target.id) return depth;
      if (isBranch(item)) {
        const found = findDepth(target, item, depth + 1);
        if (found >= 0) return found;
      }
    }
    return -1;
  }
  return findDepth(node, root, 0);
}

export function getBranchDepth(branch: FilterConditionBranch, root: FilterConditionBranch): number {
  return getNodeDepth(branch, root);
}

/** Maximum allowed nesting depth (3 levels of nesting + root = 4) */
export const MAX_NESTING_DEPTH = 3;

/**
 * Check if a branch can be nested further (i.e., create/wrap into a new
 * nested group at the given branch's level).
 */
export function canNestFurther(
  branch: FilterConditionBranch,
  root: FilterConditionBranch
): boolean {
  const depth = getBranchDepth(branch, root);
  return depth < MAX_NESTING_DEPTH;
}

export function addLeafToBranch(
  branch: FilterConditionBranch,
  afterIndex: number
): FilterConditionBranch {
  const items = [...branch.items];
  items.splice(afterIndex + 1, 0, createEmptyLeaf());
  return { ...branch, items };
}

export function removeNodeFromBranch(
  branch: FilterConditionBranch,
  nodeId: string
): FilterConditionBranch {
  const items = branch.items
    .filter((item) => item.id !== nodeId)
    .map((item) => {
      if (isBranch(item)) {
        const cleaned = removeNodeFromBranch(item, nodeId);
        return cleaned.items.length > 0 ? cleaned : null;
      }
      return item;
    })
    .filter((item): item is FilterConditionNode => item !== null);
  return { ...branch, items };
}

export function updateLeafInBranch(
  branch: FilterConditionBranch,
  leafId: string,
  patch: Partial<FilterConditionLeaf>
): FilterConditionBranch {
  const items = branch.items.map((item) => {
    if (isLeaf(item) && item.id === leafId) {
      return { ...item, ...patch };
    }
    if (isBranch(item)) {
      return updateLeafInBranch(item, leafId, patch);
    }
    return item;
  });
  return { ...branch, items };
}

export function updateBranchInTree(
  branch: FilterConditionBranch,
  branchId: string,
  updater: (target: FilterConditionBranch) => FilterConditionBranch
): FilterConditionBranch {
  if (branch.id === branchId) return updater(branch);

  const items = branch.items.map((item) =>
    isBranch(item) ? updateBranchInTree(item, branchId, updater) : item
  );
  return { ...branch, items };
}

export function toggleBranchConnectiveInTree(
  branch: FilterConditionBranch,
  branchId: string
): FilterConditionBranch {
  return updateBranchInTree(branch, branchId, (target) => ({
    ...target,
    connective: target.connective === 'and' ? 'or' : 'and',
  }));
}

export function updateBranchConnective(
  branch: FilterConditionBranch,
  branchId: string,
  connective: FilterConditionConnective
): FilterConditionBranch {
  if (branch.id === branchId) {
    return { ...branch, connective };
  }
  const items = branch.items.map((item) => {
    if (isBranch(item)) {
      return updateBranchConnective(item, branchId, connective);
    }
    return item;
  });
  return { ...branch, items };
}

/**
 * Wrap a subset of items in a branch into a new nested group.
 * Returns the updated branch with the wrapped items replaced by a new branch.
 */
export function wrapItemsInGroup(
  branch: FilterConditionBranch,
  itemIds: string[],
  groupConnective: FilterConditionConnective = 'and'
): FilterConditionBranch | null {
  if (itemIds.length < 2) return null;

  const wrappedItems: FilterConditionNode[] = [];
  const remainingItems: FilterConditionNode[] = [];
  let foundFirst = false;
  let collecting = false;

  for (const item of branch.items) {
    if (itemIds.includes(item.id)) {
      if (!foundFirst) {
        foundFirst = true;
        collecting = true;
      }
      if (collecting) {
        wrappedItems.push(item);
      } else {
        remainingItems.push(item);
      }
    } else {
      if (collecting) {
        collecting = false;
      }
      remainingItems.push(item);
    }
  }

  if (wrappedItems.length < 2) return null;

  const newGroup: FilterConditionBranch = {
    kind: 'branch',
    id: nextNodeId(),
    connective: groupConnective,
    items: wrappedItems,
  };

  // Insert the new group at the position of the first wrapped item
  const firstIdx = branch.items.findIndex((item) => item.id === itemIds[0]);
  const newItems = [...branch.items];
  newItems.splice(firstIdx, wrappedItems.length, newGroup);

  return { ...branch, items: newItems };
}

/**
 * Unwrap a nested group, moving its items to the parent branch.
 */
export function unwrapGroup(branch: FilterConditionBranch, groupId: string): FilterConditionBranch {
  const newItems: FilterConditionNode[] = [];
  for (const item of branch.items) {
    if (isBranch(item) && item.id === groupId) {
      newItems.push(...item.items);
    } else {
      newItems.push(item);
    }
  }
  return { ...branch, items: newItems };
}
