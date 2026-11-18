"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { store } from "@/lib/store";
import { findMatchingRule } from "@/lib/rule-engine";

export interface CreateRuleInput {
  name: string;
  priority: number;
  field: "description" | "merchant" | "amount";
  matchType: "contains" | "exact" | "ilike" | "starts_with" | "regex";
  matchValue: string;
  targetCategoryId: string;
}

export async function getClassificationRulesAction() {
  return store.getRules();
}

export async function createClassificationRuleAction(input: CreateRuleInput) {
  try {
    const { name, priority, field, matchType, matchValue, targetCategoryId } = input;
    if (!name || !matchValue || !targetCategoryId) {
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
      name,
      priority: priority || 100,
      field,
      matchType,
      matchValue,
      targetCategoryId,
      autoApply: true,
      isActive: true,
      matchCount: 0,
    };

    await store.addRule(newRule);

    revalidatePath("/rules");
    revalidatePath("/transactions");

    return { success: true, rule: newRule };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to create classification rule." };
  }
}

/**
 * Evaluates all existing unclassified transactions against active rules and updates category tags
 */
export async function runClassificationRulesOnUnclassifiedAction() {
  try {
    const transactions = await store.getTransactions();
    const rules = await store.getRules();
    const categories = await store.getCategories();

    let matchedCount = 0;

    for (const tx of transactions) {
      for (const entry of tx.ledgerEntries) {
        if (!entry.categoryId || entry.categoryName === "Uncategorized") {
          const matchedRule = findMatchingRule(
            {
              merchant: tx.merchant,
              rawDescription: tx.rawDescription,
              cleanDescription: tx.cleanDescription,
              amount: tx.amount,
            },
            rules
          );

          if (matchedRule) {
            const cat = categories.find((c) => c.id === matchedRule.targetCategoryId);
            if (cat) {
              await store.updateLedgerEntryCategory(entry.id, {
                id: cat.id,
                name: cat.name,
                color: cat.color,
              });
              await store.incrementRuleMatchCount(matchedRule.id);
              matchedCount++;
            }
          }
        }
      }
    }

    revalidatePath("/transactions");
    revalidatePath("/rules");
    revalidatePath("/budgets");
    revalidatePath("/");

    return { success: true, matchedCount };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to run rules engine." };
  }
}
