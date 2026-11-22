"use server";

import { revalidatePath } from "next/cache";
import {
  AccountRecord,
  CategoryRecord,
  CategoryUsageCount,
  store,
} from "@/lib/store";

export interface ManageDataResponse {
  categories: CategoryRecord[];
  accounts: AccountRecord[];
  baseCurrency: string;
  txCountsByAccount: Record<string, number>;
  usageByCategory: Record<string, CategoryUsageCount>;
}

const VALID_CATEGORY_TYPES = new Set(["expense", "income", "investment", "transfer"]);
const VALID_ACCOUNT_TYPES = new Set([
  "checking",
  "savings",
  "offset",
  "credit_card",
  "loan",
  "superannuation",
  "investment",
]);

function revalidateManagedPaths() {
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/budgets");
  revalidatePath("/rules");
  revalidatePath("/subscriptions");
  revalidatePath("/cash-flow");
  revalidatePath("/property-goals");
  revalidatePath("/");
}

export async function getManageDataAction(): Promise<ManageDataResponse> {
  const [
    categories,
    accounts,
    txCountsByAccount,
    usageByCategory,
    activeUserId,
  ] = await Promise.all([
    store.getCategories(),
    store.getAllAccounts(),
    store.getAccountTransactionCounts(),
    store.getCategoryUsageCounts(),
    store.getVerifiedSessionUserId(),
  ]);

  const activeUser = activeUserId ? await store.getUserById(activeUserId) : undefined;
  const baseCurrency = activeUser?.baseCurrency || "AUD";

  return {
    categories,
    accounts,
    baseCurrency,
    txCountsByAccount,
    usageByCategory,
  };
}

export async function createCategoryAction(input: {
  name: string;
  type: string;
  color: string;
  icon?: string;
  parentId?: string | null;
}): Promise<{
  success: boolean;
  error?: string;
  category?: CategoryRecord;
  data?: ManageDataResponse;
}> {
  try {
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      return { success: false, error: "Category name is required." };
    }
    if (!VALID_CATEGORY_TYPES.has(input.type)) {
      return { success: false, error: "Invalid category type." };
    }

    let effectiveType = input.type;
    const parentId = input.parentId?.trim() || null;

    if (parentId) {
      const existingCats = await store.getCategories();
      const parent = existingCats.find((c) => c.id === parentId);
      if (!parent) {
        return { success: false, error: "Selected parent category was not found." };
      }
      if (parent.parentId) {
        return {
          success: false,
          error: "Sub-categories can only be nested 2 levels deep under a top-level category.",
        };
      }
      effectiveType = parent.type;
    }

    const category = await store.addCategory({
      name: trimmedName,
      type: effectiveType,
      color: input.color || "#6d5dfc",
      icon: input.icon || "Tag",
      parentId,
    });

    revalidateManagedPaths();
    const data = await getManageDataAction();
    return { success: true, category, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create category.",
    };
  }
}

export async function updateCategoryAction(input: {
  id: string;
  name: string;
  type: string;
  color: string;
  icon?: string;
  parentId?: string | null;
}): Promise<{
  success: boolean;
  error?: string;
  category?: CategoryRecord;
  data?: ManageDataResponse;
}> {
  try {
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      return { success: false, error: "Category name is required." };
    }
    if (!VALID_CATEGORY_TYPES.has(input.type)) {
      return { success: false, error: "Invalid category type." };
    }

    const existingCats = await store.getCategories();
    const current = existingCats.find((c) => c.id === input.id);
    if (!current) {
      return { success: false, error: "Category not found." };
    }

    let effectiveType = input.type;
    const parentId = input.parentId?.trim() || null;

    if (parentId) {
      if (parentId === input.id) {
        return { success: false, error: "A category cannot be its own parent." };
      }
      const hasChildren = existingCats.some((c) => c.parentId === input.id);
      if (hasChildren) {
        return {
          success: false,
          error:
            "Cannot move a parent category with existing sub-categories inside another category.",
        };
      }
      const parent = existingCats.find((c) => c.id === parentId);
      if (!parent) {
        return { success: false, error: "Selected parent category was not found." };
      }
      if (parent.parentId) {
        return {
          success: false,
          error: "Sub-categories can only be nested 2 levels deep under a top-level category.",
        };
      }
      effectiveType = parent.type;
    }

    const updated = await store.updateCategory(input.id, {
      name: trimmedName,
      type: effectiveType,
      color: input.color || current.color,
      icon: input.icon || current.icon,
      parentId,
    });
    if (!updated) {
      return { success: false, error: "Category could not be updated." };
    }

    revalidateManagedPaths();
    const data = await getManageDataAction();
    return { success: true, category: updated, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update category.",
    };
  }
}

export async function deleteCategoryAction(
  id: string,
  replacementCategoryId?: string | null
): Promise<{
  success: boolean;
  error?: string;
  mergedSummary?: {
    reassignedEntries: number;
    reassignedRules: number;
    reassignedSubscriptions: number;
    movedSubcategories: number;
  };
  data?: ManageDataResponse;
}> {
  try {
    const replacementId = replacementCategoryId?.trim();
    if (replacementId) {
      const mergedSummary = await store.mergeCategory(id, replacementId);
      revalidateManagedPaths();
      const data = await getManageDataAction();
      return { success: true, mergedSummary, data };
    }

    await store.deleteCategory(id);
    revalidateManagedPaths();
    const data = await getManageDataAction();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete category.",
    };
  }
}

export async function mergeCategoryAction(
  sourceId: string,
  targetId: string
): Promise<{
  success: boolean;
  error?: string;
  summary?: {
    reassignedEntries: number;
    reassignedRules: number;
    reassignedSubscriptions: number;
    movedSubcategories: number;
  };
  data?: ManageDataResponse;
}> {
  try {
    if (!sourceId || !targetId) {
      return {
        success: false,
        error: "Both source and replacement categories are required.",
      };
    }

    const summary = await store.mergeCategory(sourceId, targetId);
    revalidateManagedPaths();
    const data = await getManageDataAction();
    return { success: true, summary, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to merge category.",
    };
  }
}

export async function reorderCategoriesAction(orderedIds: string[]): Promise<{
  success: boolean;
  error?: string;
  data?: ManageDataResponse;
}> {
  try {
    await store.reorderCategories(orderedIds);
    revalidateManagedPaths();
    const data = await getManageDataAction();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reorder categories.",
    };
  }
}

export async function moveCategoryOrderAction(input: {
  categoryId: string;
  targetParentId?: string | null;
  orderedIds: string[];
}): Promise<{
  success: boolean;
  error?: string;
  data?: ManageDataResponse;
}> {
  try {
    await store.moveCategoryAndReorder(input);
    revalidateManagedPaths();
    const data = await getManageDataAction();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to move category.",
    };
  }
}

export async function createAccountAction(input: {
  name: string;
  institution: string;
  accountType: string;
  accountNumberLast4?: string;
  currency?: string;
  currentBalance: number;
  isOffsetAccount?: boolean;
  interestRatePct?: number;
}): Promise<{
  success: boolean;
  error?: string;
  account?: AccountRecord;
  data?: ManageDataResponse;
}> {
  try {
    if (!input.name.trim()) {
      return { success: false, error: "Account name is required." };
    }
    if (!input.institution.trim()) {
      return { success: false, error: "Institution name is required." };
    }
    if (!VALID_ACCOUNT_TYPES.has(input.accountType)) {
      return { success: false, error: "Invalid account type selected." };
    }
    if (!Number.isFinite(input.currentBalance)) {
      return { success: false, error: "Current balance must be a valid number." };
    }

    const account = await store.addAccount({
      name: input.name,
      institution: input.institution,
      accountType: input.accountType,
      accountNumberLast4: input.accountNumberLast4,
      currency: input.currency || "AUD",
      currentBalance: input.currentBalance,
      isOffsetAccount: input.isOffsetAccount,
      interestRatePct: input.interestRatePct,
    });

    revalidateManagedPaths();
    const data = await getManageDataAction();
    return { success: true, account, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create account.",
    };
  }
}

export async function updateAccountAction(input: {
  id: string;
  name: string;
  institution: string;
  accountType: string;
  accountNumberLast4?: string;
  currency?: string;
  currentBalance: number;
  isOffsetAccount?: boolean;
  interestRatePct?: number;
}): Promise<{
  success: boolean;
  error?: string;
  account?: AccountRecord;
  data?: ManageDataResponse;
}> {
  try {
    if (!input.name.trim()) {
      return { success: false, error: "Account name is required." };
    }
    if (!input.institution.trim()) {
      return { success: false, error: "Institution name is required." };
    }
    if (!VALID_ACCOUNT_TYPES.has(input.accountType)) {
      return { success: false, error: "Invalid account type selected." };
    }
    if (!Number.isFinite(input.currentBalance)) {
      return { success: false, error: "Current balance must be a valid number." };
    }

    const account = await store.updateAccount(input.id, {
      name: input.name,
      institution: input.institution,
      accountType: input.accountType,
      accountNumberLast4: input.accountNumberLast4,
      currency: input.currency || "AUD",
      currentBalance: input.currentBalance,
      isOffsetAccount: input.isOffsetAccount,
      interestRatePct: input.interestRatePct,
    });

    if (!account) {
      return { success: false, error: "Account not found." };
    }

    revalidateManagedPaths();
    const data = await getManageDataAction();
    return { success: true, account, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update account.",
    };
  }
}

export async function toggleAccountActiveAction(
  id: string,
  isActive: boolean
): Promise<{
  success: boolean;
  error?: string;
  data?: ManageDataResponse;
}> {
  try {
    await store.toggleAccountActive(id, isActive);
    revalidateManagedPaths();
    const data = await getManageDataAction();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update account status.",
    };
  }
}

export async function deleteAccountAction(id: string): Promise<{
  success: boolean;
  error?: string;
  data?: ManageDataResponse;
}> {
  try {
    await store.deleteAccount(id);
    revalidateManagedPaths();
    const data = await getManageDataAction();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete account.",
    };
  }
}
