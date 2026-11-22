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
