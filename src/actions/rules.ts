"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { store, CategoryRecord, RuleRecord, TransactionWithLedger } from "@/lib/store";
import {
  evaluateRuleMatch,
  findMatchingRule,
  generateRuleSuggestions,
  type LearnOnEditSuggestion,
  type RuleSuggestion,
} from "@/lib/rule-engine";
import { formatCategoryDisplayLabel } from "@/lib/category-utils";

export type { LearnOnEditSuggestion, RuleSuggestion };

export interface CreateRuleInput {
  name: string;
  priority: number;
  field: "description" | "merchant" | "amount";
  matchType: "contains" | "exact" | "ilike" | "starts_with" | "regex";
  matchValue: string;
  targetCategoryId: string;
}

export interface UpdateRuleInput extends CreateRuleInput {
  id: string;
  isActive?: boolean;
}

function revalidateRuleDependentPaths() {
  revalidatePath("/transactions");
  revalidatePath("/rules");
  revalidatePath("/ingest");
  revalidatePath("/budgets");
  revalidatePath("/accounts");
  revalidatePath("/");
}

export async function getClassificationRulesAction() {
  return store.getRules();
}

export async function createClassificationRuleAction(input: CreateRuleInput) {
  try {
    const { name, priority, field, matchType, matchValue, targetCategoryId } = input;
    if (!name.trim() || !matchValue.trim() || !targetCategoryId) {
      return { success: false, error: "Rule name, match value, and target category are required." };
    }

    const categories = await store.getCategories();
    const cat = categories.find((c) => c.id === targetCategoryId);
    if (!cat) {
      return { success: false, error: "Target category not found." };
    }

    const userId = await store.resolveActiveUserId();
    if (!userId) {
      return { success: false, error: "Authentication required." };
    }
    const newRule = {
      id: crypto.randomUUID(),
      userId,
      name: name.trim(),
      priority: priority || 100,
      field,
      matchType,
      matchValue: matchValue.trim(),
      targetCategoryId,
      autoApply: true,
      isActive: true,
      matchCount: 0,
    };

    await store.addRule(newRule);

    revalidateRuleDependentPaths();

    return { success: true, rule: newRule };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to create classification rule." };
  }
}

export async function updateClassificationRuleAction(input: UpdateRuleInput) {
  try {
    const { id, name, priority, field, matchType, matchValue, targetCategoryId, isActive } = input;
    if (!id || !name.trim() || !matchValue.trim() || !targetCategoryId) {
      return { success: false, error: "Rule ID, name, match pattern, and category are required." };
    }

    const categories = await store.getCategories();
    const cat = categories.find((c) => c.id === targetCategoryId);
    if (!cat) {
      return { success: false, error: "Target category not found." };
    }

    const updated = await store.updateRule(id, {
      name: name.trim(),
      priority: priority || 100,
      field,
      matchType,
      matchValue: matchValue.trim(),
      targetCategoryId,
      isActive,
    });
    if (!updated) {
      return { success: false, error: "Classification rule not found." };
    }

    revalidateRuleDependentPaths();
    return { success: true, rule: updated };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to update classification rule." };
  }
}

export async function toggleClassificationRuleAction(id: string, isActive: boolean) {
  try {
    await store.toggleRuleActive(id, isActive);
    revalidateRuleDependentPaths();
    return { success: true, rules: await store.getRules() };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to update rule status." };
  }
}

export async function deleteClassificationRuleAction(id: string) {
  try {
    await store.deleteRule(id);
    revalidateRuleDependentPaths();
    return { success: true, rules: await store.getRules() };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to delete rule." };
  }
}

/**
 * Evaluates posted non-reversal transactions against active rules.
 * - "unclassified": tags entries currently missing a category
 * - "refine_parents": evaluates sub-category rules against unclassified or broad parent-tagged entries
 */
export async function runClassificationRulesAction(
  mode: "unclassified" | "refine_parents" = "unclassified"
) {
  try {
    const [transactions, rules, categories] = await Promise.all([
      store.getTransactions(),
      store.getRules(),
      store.getCategories(),
    ]);

    const catById = new Map(categories.map((c) => [c.id, c]));
    const subCategoryRules = rules.filter((r) => {
      const cat = catById.get(r.targetCategoryId);
      return Boolean(cat?.parentId);
    });

    let matchedCount = 0;

    for (const tx of transactions) {
      if (tx.status !== "posted" || tx.isReversal) continue;

      for (const entry of tx.ledgerEntries) {
        const isEntryUnclassified =
          !entry.categoryId || entry.categoryName === "Uncategorized";

        if (mode === "unclassified" && !isEntryUnclassified) continue;

        const candidateRules = mode === "refine_parents" ? subCategoryRules : rules;
        if (candidateRules.length === 0) continue;

        const matchedRule = findMatchingRule(
          {
            merchant: tx.merchant,
            rawDescription: tx.rawDescription,
            cleanDescription: tx.cleanDescription,
            amount: tx.amount,
          },
          candidateRules
        );

        if (!matchedRule) continue;

        const cat = catById.get(matchedRule.targetCategoryId);
        if (!cat) continue;

        if (mode === "refine_parents") {
          const canRefineEntry =
            entry.categoryId !== cat.id &&
            (isEntryUnclassified || entry.categoryId === cat.parentId);
          if (!canRefineEntry) continue;
        }

        await store.updateLedgerEntryCategory(entry.id, {
          id: cat.id,
          name: formatCategoryDisplayLabel(cat.id, categories),
          color: cat.color,
        });
        await store.incrementRuleMatchCount(matchedRule.id);
        matchedCount++;
      }
    }

    revalidateRuleDependentPaths();

    return {
      success: true,
      matchedCount,
      rules: await store.getRules(),
    };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to run rules engine." };
  }
}

/**
 * Backwards-compatible wrapper that evaluates rules against unclassified ledger entries.
 */
export async function runClassificationRulesOnUnclassifiedAction() {
  return runClassificationRulesAction("unclassified");
}

function normalizeRuleMatchKey(matchValue: string): string {
  return matchValue.trim().toLowerCase().replace(/^%+|%+$/g, "");
}

async function applySuggestedRuleItem(params: {
  userId: string;
  item: {
    name: string;
    matchValue: string;
    targetCategoryId: string;
    field?: "description" | "merchant";
    matchType?: "contains" | "exact" | "ilike" | "starts_with" | "regex";
    priority?: number;
    applyToExisting?: boolean;
  };
  categories: CategoryRecord[];
  rules: RuleRecord[];
  transactions: TransactionWithLedger[];
}): Promise<{ rule: RuleRecord; created: boolean; matchedCount: number } | null> {
  const { userId, item, categories, rules, transactions } = params;
  const trimmedName = item.name.trim();
  const trimmedMatch = item.matchValue.trim();
  if (!trimmedName || !trimmedMatch || !item.targetCategoryId) return null;

  const cat = categories.find((c) => c.id === item.targetCategoryId);
  if (!cat) return null;

  const normalizedKey = normalizeRuleMatchKey(trimmedMatch);
  const existing = rules.find(
    (r) =>
      normalizeRuleMatchKey(r.matchValue) === normalizedKey &&
      r.targetCategoryId === cat.id
  );

  let effectiveRule: RuleRecord;
  let created = false;
  if (existing) {
    effectiveRule = existing;
  } else {
    effectiveRule = {
      id: crypto.randomUUID(),
      userId,
      name: trimmedName,
      priority: item.priority ?? (cat.parentId ? 25 : 45),
      field: item.field || "description",
      matchType: item.matchType || "contains",
      matchValue: trimmedMatch,
      targetCategoryId: cat.id,
      autoApply: true,
      isActive: true,
      matchCount: 0,
    };
    await store.addRule(effectiveRule);
    rules.push(effectiveRule);
    created = true;
  }

  let matchedCount = 0;
  if (item.applyToExisting !== false) {
    const displayName = formatCategoryDisplayLabel(cat.id, categories);
    for (const tx of transactions) {
      if (tx.status !== "posted" || tx.isReversal) continue;

      if (
        !evaluateRuleMatch(effectiveRule, {
          merchant: tx.merchant,
          rawDescription: tx.rawDescription,
          cleanDescription: tx.cleanDescription,
          amount: tx.amount,
        })
      ) {
        continue;
      }

      for (const entry of tx.ledgerEntries) {
        const isEntryUnclassified =
          !entry.categoryId || entry.categoryName === "Uncategorized";
        const canRefineFromParent =
          Boolean(cat.parentId) && entry.categoryId === cat.parentId;
        if (!isEntryUnclassified && !canRefineFromParent) continue;

        await store.updateLedgerEntryCategory(entry.id, {
          id: cat.id,
          name: displayName,
          color: cat.color,
        });
        entry.categoryId = cat.id;
        entry.categoryName = displayName;
        entry.categoryColor = cat.color;
        await store.incrementRuleMatchCount(effectiveRule.id);
        matchedCount += 1;
      }
    }
  }

  return { rule: effectiveRule, created, matchedCount };
}

export async function getRuleSuggestionsAction(options?: {
  batchId?: string;
}): Promise<RuleSuggestion[]> {
  const [transactions, rules, categories] = await Promise.all([
    store.getTransactions(),
    store.getRules(),
    store.getCategories(),
  ]);

  return generateRuleSuggestions({
    transactions,
    rules,
    categories,
    onlyBatchId: options?.batchId,
  });
}

export async function acceptRuleSuggestionAction(input: {
  name: string;
  matchValue: string;
  targetCategoryId: string;
  field?: "description" | "merchant";
  matchType?: "contains" | "exact" | "ilike" | "starts_with" | "regex";
  priority?: number;
  applyToExisting?: boolean;
}) {
  try {
    const userId = await store.resolveActiveUserId();
    if (!userId) {
      return { success: false, error: "Authentication required." };
    }

    if (!input.name?.trim() || !input.matchValue?.trim() || !input.targetCategoryId) {
      return {
        success: false,
        error: "Rule name, match pattern, and target category are required.",
      };
    }

    const [categories, rules, transactions] = await Promise.all([
      store.getCategories(),
      store.getRules(),
      store.getTransactions(),
    ]);

    const result = await applySuggestedRuleItem({
      userId,
      item: input,
      categories,
      rules,
      transactions,
    });

    if (!result) {
      return { success: false, error: "Selected target category was not found." };
    }

    revalidateRuleDependentPaths();

    const [updatedRules, updatedTransactions] = await Promise.all([
      store.getRules(),
      store.getTransactions(),
    ]);
    const suggestions = generateRuleSuggestions({
      transactions: updatedTransactions,
      rules: updatedRules,
      categories,
    });

    return {
      success: true,
      rule: result.rule,
      created: result.created,
      matchedCount: result.matchedCount,
      rules: updatedRules,
      suggestions,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to accept rule suggestion.",
    };
  }
}

export async function acceptBulkRuleSuggestionsAction(
  items: Array<{
    name: string;
    matchValue: string;
    targetCategoryId: string;
    field?: "description" | "merchant";
    priority?: number;
  }>
) {
  try {
    const userId = await store.resolveActiveUserId();
    if (!userId) {
      return { success: false, error: "Authentication required." };
    }

    const [categories, rules, transactions] = await Promise.all([
      store.getCategories(),
      store.getRules(),
      store.getTransactions(),
    ]);

    let createdCount = 0;
    let matchedCount = 0;

    for (const item of items) {
      const res = await applySuggestedRuleItem({
        userId,
        item: { ...item, applyToExisting: true },
        categories,
        rules,
        transactions,
      });
      if (res) {
        if (res.created) createdCount += 1;
        matchedCount += res.matchedCount;
      }
    }

    revalidateRuleDependentPaths();

    const [updatedRules, updatedTransactions] = await Promise.all([
      store.getRules(),
      store.getTransactions(),
    ]);
    const suggestions = generateRuleSuggestions({
      transactions: updatedTransactions,
      rules: updatedRules,
      categories,
    });

    return {
      success: true,
      createdCount,
      matchedCount,
      rules: updatedRules,
      suggestions,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to create suggested rules.",
    };
  }
}
