export interface CategoryLike {
  id: string;
  userId?: string;
  name: string;
  slug?: string;
  parentId?: string | null;
  type?: string;
  color: string;
  icon?: string;
  sortOrder?: number;
}

export type CategoryNode<T extends CategoryLike = CategoryLike> = T & {
  parentName?: string | null;
  displayLabel: string;
  depth: 0 | 1;
};

function compareCategorySiblings(a: CategoryLike, b: CategoryLike): number {
  const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  if (orderDiff !== 0) return orderDiff;
  return a.name.localeCompare(b.name);
}

export interface CategorySubSlice {
  id: string;
  name: string;
  value: number;
  color: string;
  isDirectParentSpend?: boolean;
}

export interface CategoryDistributionPoint {
  id?: string;
  name: string;
  value: number;
  color: string;
  children?: CategorySubSlice[];
}

export interface BudgetGroup<T> {
  budget: T;
  subCaps: T[];
  subCapsAllocatedTotal: number;
  subCapsSpentTotal: number;
  exceedsParentCap: boolean;
  hasSubCapAlert: boolean;
  isStandaloneSubCategory: boolean;
}

export interface BudgetHierarchySummary<T> {
  groups: BudgetGroup<T>[];
  totalCap: number;
  totalSpent: number;
  overallPct: number;
}

export type CategoryDropPosition = "before" | "after" | "inside";

export interface CategoryDragResult {
  orderedIds: string[];
  nextParentId: string | null;
  parentChanged: boolean;
  changed: boolean;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Resolves a human-readable category label, formatting sub-categories as "Parent › Child".
 */
export function formatCategoryDisplayLabel<T extends CategoryLike>(
  categoryId: string | null | undefined,
  categories: T[]
): string {
  if (!categoryId) return "Uncategorized";
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return "Uncategorized";
  if (cat.parentId) {
    const parent = categories.find((c) => c.id === cat.parentId);
    if (parent) {
      return `${parent.name} › ${cat.name}`;
    }
  }
  return cat.name;
}

/**
 * Organizes flat categories into a 2-level parent -> sub-category list ordered by sortOrder then name.
 */
export function sortAndFlattenCategories<T extends CategoryLike>(
  categories: T[]
): CategoryNode<T>[] {
  const byId = new Map<string, T>();
  for (const cat of categories) {
    byId.set(cat.id, cat);
  }

  const parents: T[] = [];
  const childrenByParent = new Map<string, T[]>();

  for (const cat of categories) {
    if (cat.parentId && cat.parentId !== cat.id && byId.has(cat.parentId)) {
      const list = childrenByParent.get(cat.parentId) || [];
      list.push(cat);
      childrenByParent.set(cat.parentId, list);
    } else {
      parents.push(cat);
    }
  }

  parents.sort(compareCategorySiblings);

  const result: CategoryNode<T>[] = [];
  for (const parent of parents) {
    result.push({
      ...parent,
      parentName: null,
      displayLabel: parent.name,
      depth: 0,
    });

    const children = (childrenByParent.get(parent.id) || []).sort(
      compareCategorySiblings
    );
    for (const child of children) {
      result.push({
        ...child,
        parentName: parent.name,
        displayLabel: `${parent.name} › ${child.name}`,
        depth: 1,
      });
    }
  }

  return result;
}

/**
 * Aggregates debit spending into top-level parent slices with optional child drilldown breakdown
 * without double-counting demo baselines or nested sub-category budgets.
 */
export function buildCategorySpendingHierarchy(
  categories: CategoryLike[],
  budgets: Array<{
    categoryId: string;
    parentCategoryId?: string | null;
    spentAmount: number;
  }>,
  activeTransactions: Array<{
    status?: string;
    isReversal?: boolean;
    ledgerEntries: Array<{
      categoryId?: string | null;
      categoryName?: string;
      categoryColor?: string;
      entryType: string;
      amount: string | number;
    }>;
  }>
): CategoryDistributionPoint[] {
  const catById = new Map<string, CategoryLike>();
  const childrenByParent = new Map<string, string[]>();

  for (const cat of categories) {
    catById.set(cat.id, cat);
  }
  for (const cat of categories) {
    if (cat.parentId && cat.parentId !== cat.id && catById.has(cat.parentId)) {
      const list = childrenByParent.get(cat.parentId) || [];
      list.push(cat.id);
      childrenByParent.set(cat.parentId, list);
    }
  }

  const spendByCatId = new Map<string, number>();
  const fallbackNames = new Map<string, string>();
  const fallbackColors = new Map<string, string>();

  for (const tx of activeTransactions) {
    if (tx.status && tx.status !== "posted") continue;
    if (tx.isReversal) continue;
    for (const le of tx.ledgerEntries) {
      if (le.entryType !== "debit") continue;
      const amt = typeof le.amount === "number" ? le.amount : parseFloat(le.amount) || 0;
      if (amt <= 0) continue;

      const key = le.categoryId || "uncategorized";
      spendByCatId.set(key, round2((spendByCatId.get(key) || 0) + amt));
      if (!catById.has(key)) {
        fallbackNames.set(key, le.categoryName || "Uncategorized");
        fallbackColors.set(key, le.categoryColor || "#64748b");
      }
    }
  }

  // Preserve historical demo baselines stored on top-level budgets without double-counting sub-categories
  for (const b of budgets) {
    const cat = catById.get(b.categoryId);
    if (b.parentCategoryId || cat?.parentId) continue;

    const directSpend = spendByCatId.get(b.categoryId) || 0;
    const childIds = childrenByParent.get(b.categoryId) || [];
    const childSpend = childIds.reduce((sum, cid) => sum + (spendByCatId.get(cid) || 0), 0);
    const covered = directSpend + childSpend;

    if (b.spentAmount > covered + 0.005) {
      spendByCatId.set(b.categoryId, round2(directSpend + (b.spentAmount - covered)));
    }
  }

  const parentBuckets = new Map<
    string,
    {
      id: string;
      name: string;
      color: string;
      value: number;
      directAmount: number;
      childrenMap: Map<string, CategorySubSlice>;
    }
  >();

  const getOrCreateBucket = (id: string, name: string, color: string) => {
    let bucket = parentBuckets.get(id);
    if (!bucket) {
      bucket = {
        id,
        name,
        color,
        value: 0,
        directAmount: 0,
        childrenMap: new Map<string, CategorySubSlice>(),
      };
      parentBuckets.set(id, bucket);
    }
    return bucket;
  };

  for (const [catKey, rawAmt] of spendByCatId.entries()) {
    const amt = round2(rawAmt);
    if (amt <= 0) continue;

    const cat = catById.get(catKey);
    if (cat && cat.parentId && catById.has(cat.parentId)) {
      const parent = catById.get(cat.parentId)!;
      const bucket = getOrCreateBucket(parent.id, parent.name, parent.color);
      bucket.value = round2(bucket.value + amt);
      const existingChild = bucket.childrenMap.get(cat.id);
      bucket.childrenMap.set(cat.id, {
        id: cat.id,
        name: cat.name,
        value: round2((existingChild?.value || 0) + amt),
        color: cat.color,
      });
    } else {
      const bucketId = cat ? cat.id : catKey;
      const bucketName = cat ? cat.name : fallbackNames.get(catKey) || "Uncategorized";
      const bucketColor = cat ? cat.color : fallbackColors.get(catKey) || "#64748b";
      const bucket = getOrCreateBucket(bucketId, bucketName, bucketColor);
      bucket.value = round2(bucket.value + amt);
      bucket.directAmount = round2(bucket.directAmount + amt);
    }
  }

  const result: CategoryDistributionPoint[] = [];
  for (const bucket of parentBuckets.values()) {
    const children = Array.from(bucket.childrenMap.values());
    if (children.length > 0 && bucket.directAmount > 0.005) {
      children.push({
        id: `${bucket.id}-direct`,
        name: `General ${bucket.name}`,
        value: round2(bucket.directAmount),
        color: bucket.color,
        isDirectParentSpend: true,
      });
    }
    children.sort((a, b) => b.value - a.value);

    result.push({
      id: bucket.id,
      name: bucket.name,
      value: round2(bucket.value),
      color: bucket.color,
      ...(children.length > 0 ? { children } : {}),
    });
  }

  result.sort((a, b) => b.value - a.value);
  return result;
}

/**
 * Groups parent budgets with nested child sub-caps and computes aggregate totals without double-counting.
 */
export function summarizeBudgetsHierarchy<
  T extends {
    id: string;
    categoryId: string;
    parentCategoryId?: string | null;
    allocatedAmount: number;
    spentAmount: number;
    status: "normal" | "warning" | "overrun";
  },
>(budgets: T[]): BudgetHierarchySummary<T> {
  const topLevelCatIds = new Set(
    budgets.filter((b) => !b.parentCategoryId).map((b) => b.categoryId)
  );

  const subCapsByParentCatId = new Map<string, T[]>();
  const primaryBudgets: T[] = [];

  for (const b of budgets) {
    if (b.parentCategoryId && topLevelCatIds.has(b.parentCategoryId)) {
      const list = subCapsByParentCatId.get(b.parentCategoryId) || [];
      list.push(b);
      subCapsByParentCatId.set(b.parentCategoryId, list);
    } else {
      primaryBudgets.push(b);
    }
  }

  const groups: BudgetGroup<T>[] = primaryBudgets.map((budget) => {
    const isStandaloneSubCategory = Boolean(budget.parentCategoryId);
    const subCaps = isStandaloneSubCategory
      ? []
      : subCapsByParentCatId.get(budget.categoryId) || [];
    const subCapsAllocatedTotal = round2(
      subCaps.reduce((sum, s) => sum + s.allocatedAmount, 0)
    );
    const subCapsSpentTotal = round2(subCaps.reduce((sum, s) => sum + s.spentAmount, 0));
    return {
      budget,
      subCaps,
      subCapsAllocatedTotal,
      subCapsSpentTotal,
      exceedsParentCap: subCaps.length > 0 && subCapsAllocatedTotal > budget.allocatedAmount + 0.005,
      hasSubCapAlert: subCaps.some(
        (s) => s.status === "warning" || s.status === "overrun"
      ),
      isStandaloneSubCategory,
    };
  });

  const totalCap = round2(groups.reduce((sum, g) => sum + g.budget.allocatedAmount, 0));
  const totalSpent = round2(groups.reduce((sum, g) => sum + g.budget.spentAmount, 0));
  const overallPct = totalCap > 0 ? Math.round((totalSpent / totalCap) * 100) : 0;

  return {
    groups,
    totalCap,
    totalSpent,
    overallPct,
  };
}

/**
 * Calculates the next ordered category IDs and optional parentId transition for a drag-and-drop operation,
 * enforcing the 2-level hierarchy invariant and same-type constraints while preserving all user categories.
 */
export function computeCategoryDragResult<T extends CategoryLike>(
  categories: T[],
  draggedId: string,
  targetId: string,
  position: CategoryDropPosition
): CategoryDragResult {
  const flattened = sortAndFlattenCategories(categories);
  const oldOrderedIds = flattened.map((c) => c.id);

  if (!draggedId || !targetId || draggedId === targetId) {
    return {
      orderedIds: oldOrderedIds,
      nextParentId: null,
      parentChanged: false,
      changed: false,
    };
  }

  const byId = new Map(categories.map((c) => [c.id, c]));
  const dragged = byId.get(draggedId);
  const target = byId.get(targetId);

  if (!dragged || !target) {
    return {
      orderedIds: oldOrderedIds,
      nextParentId: null,
      parentChanged: false,
      changed: false,
    };
  }

  const draggedParentId =
    dragged.parentId && dragged.parentId !== dragged.id && byId.has(dragged.parentId)
      ? dragged.parentId
      : null;
  const targetParentId =
    target.parentId && target.parentId !== target.id && byId.has(target.parentId)
      ? target.parentId
      : null;

  const draggedHasChildren = categories.some(
    (c) => c.parentId === draggedId && c.id !== draggedId
  );

  // Build mutable ordered structure: parentIds + childrenByParent
  const parentIds: string[] = [];
  const childrenMap = new Map<string, string[]>();
  for (const node of flattened) {
    if (node.depth === 0) {
      parentIds.push(node.id);
      childrenMap.set(node.id, []);
    } else if (node.parentId && childrenMap.has(node.parentId)) {
      childrenMap.get(node.parentId)!.push(node.id);
    }
  }

  const flattenTree = (): string[] => {
    const ids: string[] = [];
    for (const pid of parentIds) {
      ids.push(pid);
      const children = childrenMap.get(pid) || [];
      ids.push(...children);
    }
    return ids;
  };

  // Case A: Drop inside a top-level parent category (reparent as child)
  if (position === "inside") {
    if (draggedHasChildren || targetParentId !== null || dragged.type !== target.type) {
      return {
        orderedIds: oldOrderedIds,
        nextParentId: draggedParentId,
        parentChanged: false,
        changed: false,
      };
    }

    if (draggedParentId === target.id) {
      return {
        orderedIds: oldOrderedIds,
        nextParentId: target.id,
        parentChanged: false,
        changed: false,
      };
    }

    if (draggedParentId) {
      const oldSibs = childrenMap.get(draggedParentId) || [];
      childrenMap.set(
        draggedParentId,
        oldSibs.filter((id) => id !== draggedId)
      );
    } else {
      const idx = parentIds.indexOf(draggedId);
      if (idx !== -1) parentIds.splice(idx, 1);
      childrenMap.delete(draggedId);
    }

    const destChildren = childrenMap.get(target.id) || [];
    destChildren.push(draggedId);
    childrenMap.set(target.id, destChildren);

    return {
      orderedIds: flattenTree(),
      nextParentId: target.id,
      parentChanged: true,
      changed: true,
    };
  }

  // Case B1: Dragging a top-level parent category ("before" | "after")
  if (!draggedParentId) {
    const effectiveTargetParentId = targetParentId || target.id;
    if (effectiveTargetParentId === draggedId) {
      return {
        orderedIds: oldOrderedIds,
        nextParentId: null,
        parentChanged: false,
        changed: false,
      };
    }

    const withoutDragged = parentIds.filter((id) => id !== draggedId);
    const targetIdx = withoutDragged.indexOf(effectiveTargetParentId);
    if (targetIdx === -1) {
      return {
        orderedIds: oldOrderedIds,
        nextParentId: null,
        parentChanged: false,
        changed: false,
      };
    }

    const insertIdx = position === "before" ? targetIdx : targetIdx + 1;
    withoutDragged.splice(insertIdx, 0, draggedId);
    parentIds.length = 0;
    parentIds.push(...withoutDragged);

    const nextOrdered = flattenTree();
    const changed = nextOrdered.some((id, idx) => id !== oldOrderedIds[idx]);
    return {
      orderedIds: nextOrdered,
      nextParentId: null,
      parentChanged: false,
      changed,
    };
  }

  // Case B2: Dragging a sub-category ("before" | "after")
  let destParentId: string;
  if (targetParentId) {
    destParentId = targetParentId;
  } else {
    if (target.id === draggedParentId) {
      return {
        orderedIds: oldOrderedIds,
        nextParentId: draggedParentId,
        parentChanged: false,
        changed: false,
      };
    }
    destParentId = target.id;
  }

  const destParent = byId.get(destParentId);
  if (!destParent || destParent.type !== dragged.type) {
    return {
      orderedIds: oldOrderedIds,
      nextParentId: draggedParentId,
      parentChanged: false,
      changed: false,
    };
  }

  const oldSibs = childrenMap.get(draggedParentId) || [];
  childrenMap.set(
    draggedParentId,
    oldSibs.filter((id) => id !== draggedId)
  );

  const destSibs = [...(childrenMap.get(destParentId) || [])];
  if (target.id === destParentId) {
    if (position === "before") {
      destSibs.unshift(draggedId);
    } else {
      destSibs.push(draggedId);
    }
  } else {
    const tIdx = destSibs.indexOf(target.id);
    if (tIdx === -1) {
      destSibs.push(draggedId);
    } else {
      const insertIdx = position === "before" ? tIdx : tIdx + 1;
      destSibs.splice(insertIdx, 0, draggedId);
    }
  }
  childrenMap.set(destParentId, destSibs);

  const nextOrdered = flattenTree();
  const parentChanged = destParentId !== draggedParentId;
  const orderChanged = nextOrdered.some((id, idx) => id !== oldOrderedIds[idx]);
  return {
    orderedIds: nextOrdered,
    nextParentId: destParentId,
    parentChanged,
    changed: parentChanged || orderChanged,
  };
}
