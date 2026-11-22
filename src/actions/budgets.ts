"use server";

import { revalidatePath } from "next/cache";
import { store, BudgetItem } from "@/lib/store";
import { formatCategoryDisplayLabel } from "@/lib/category-utils";

export type { BudgetItem };

export interface SpendingAnomalyItem {
  id: string;
  date: string;
  merchant: string;
  categoryName: string;
  amount: number;
  anomalyType: string;
  severity: "high" | "medium" | "low";
}

export async function getBudgetsAction(): Promise<BudgetItem[]> {
  return store.getBudgets();
}

export async function createBudgetAction(input: {
  categoryId: string;
  categoryName: string;
  allocatedAmount: number;
  period: "monthly" | "weekly" | "yearly";
  alertThresholdPct?: number;
}) {
  if (!input.categoryId || !Number.isFinite(input.allocatedAmount) || input.allocatedAmount <= 0) {
    return { success: false, error: "Budget amount must be greater than zero." };
  }
  const budget = await store.addBudget(input);
  const budgets = await store.getBudgets();
  revalidatePath("/budgets");
  revalidatePath("/accounts");
  revalidatePath("/");

  return { success: true, budget, budgets };
}

export async function updateBudgetAction(input: {
  id: string;
  allocatedAmount: number;
  period: "monthly" | "weekly" | "yearly";
  alertThresholdPct?: number;
}) {
  if (!input.id || !Number.isFinite(input.allocatedAmount) || input.allocatedAmount <= 0) {
    return { success: false, error: "Budget limit must be a positive number." };
  }

  const budget = await store.updateBudget(input.id, {
    allocatedAmount: input.allocatedAmount,
    period: input.period,
    alertThresholdPct: input.alertThresholdPct,
  });
  if (!budget) {
    return { success: false, error: "Budget cap not found." };
  }

  const budgets = await store.getBudgets();
  revalidatePath("/budgets");
  revalidatePath("/accounts");
  revalidatePath("/");

  return { success: true, budget, budgets };
}

export async function deleteBudgetAction(id: string) {
  await store.deleteBudget(id);
  const budgets = await store.getBudgets();
  revalidatePath("/budgets");
  revalidatePath("/accounts");
  revalidatePath("/");

  return { success: true, budgets };
}

export async function getSpendingAnomaliesAction(): Promise<SpendingAnomalyItem[]> {
  const [budgets, transactions, categories] = await Promise.all([
    store.getBudgets(),
    store.getTransactions(),
    store.getCategories(),
  ]);

  const childrenByParent = new Map<string, string[]>();
  for (const cat of categories) {
    if (cat.parentId) {
      const list = childrenByParent.get(cat.parentId) || [];
      list.push(cat.id);
      childrenByParent.set(cat.parentId, list);
    }
  }

  const anomalies: SpendingAnomalyItem[] = [];
  const todayIso = new Date().toISOString().split("T")[0];

  // 1. Flag budget overruns (high) and near-cap warnings (medium)
  for (const b of budgets) {
    if (b.status !== "overrun" && b.status !== "warning") continue;

    const matchIds = new Set<string>([
      b.categoryId,
      ...(childrenByParent.get(b.categoryId) || []),
    ]);

    // Find the most recent posted debit in this category or its direct sub-categories
    const matchingTx = transactions.find(
      (tx) =>
        tx.status === "posted" &&
        !tx.isReversal &&
        tx.ledgerEntries.some(
          (le) => le.categoryId && matchIds.has(le.categoryId) && le.entryType === "debit"
        )
    );

    const displayCatName = formatCategoryDisplayLabel(b.categoryId, categories);
    const labelPrefix = b.parentCategoryId ? "Sub-cap" : "Budget";

    if (b.status === "overrun") {
      const overPct = Math.round(b.percentageSpent - 100);
      anomalies.push({
        id: `anom-budget-${b.id}`,
        date: matchingTx?.date || todayIso,
        merchant: matchingTx?.merchant || `${displayCatName} Spend`,
        categoryName: displayCatName,
        amount: -b.spentAmount,
        anomalyType: `${labelPrefix} Overrun (+${overPct}% over ${b.period} cap)`,
        severity: "high",
      });
    } else if (b.status === "warning") {
      const usedPct = Math.round(b.percentageSpent);
      anomalies.push({
        id: `anom-budget-${b.id}`,
        date: matchingTx?.date || todayIso,
        merchant: matchingTx?.merchant || `${displayCatName} Spend`,
        categoryName: displayCatName,
        amount: -b.spentAmount,
        anomalyType: `Approaching ${b.parentCategoryId ? "sub-cap" : b.period} limit (${usedPct}% vs ${b.alertThresholdPct}% alert)`,
        severity: "medium",
      });
    }
  }

  // 2. Flag unclassified posted transactions (low)
  for (const tx of transactions) {
    if (tx.status !== "posted" || tx.isReversal) continue;
    const hasUnclassified = tx.ledgerEntries.some(
      (le) => !le.categoryId || le.categoryName === "Uncategorized"
    );
    if (hasUnclassified) {
      anomalies.push({
        id: `anom-unclassified-${tx.id}`,
        date: tx.date,
        merchant: tx.merchant || tx.cleanDescription,
        categoryName: "Uncategorized",
        amount: parseFloat(tx.amount),
        anomalyType: "Unclassified Transaction without Rule Match",
        severity: "low",
      });
    }
  }

  return anomalies;
}
