"use server";

import { revalidatePath } from "next/cache";
import { store, BudgetItem } from "@/lib/store";

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
}) {
  const budget = await store.addBudget(input);
  revalidatePath("/budgets");
  revalidatePath("/");

  return { success: true, budget };
}

export async function getSpendingAnomaliesAction(): Promise<SpendingAnomalyItem[]> {
  const [budgets, transactions] = await Promise.all([
    store.getBudgets(),
    store.getTransactions(),
  ]);

  const anomalies: SpendingAnomalyItem[] = [];
  const todayIso = new Date().toISOString().split("T")[0];

  // 1. Flag budget overruns (high) and near-cap warnings (medium)
  for (const b of budgets) {
    if (b.status !== "overrun" && b.status !== "warning") continue;

    // Find the most recent posted debit in this category if present
    const matchingTx = transactions.find(
      (tx) =>
        tx.status === "posted" &&
        !tx.isReversal &&
        tx.ledgerEntries.some(
          (le) => le.categoryId === b.categoryId && le.entryType === "debit"
        )
    );

    if (b.status === "overrun") {
      const overPct = Math.round(b.percentageSpent - 100);
      anomalies.push({
        id: `anom-budget-${b.id}`,
        date: matchingTx?.date || todayIso,
        merchant: matchingTx?.merchant || `${b.categoryName} Spend`,
        categoryName: b.categoryName,
        amount: -b.spentAmount,
        anomalyType: `Budget Overrun (+${overPct}% over ${b.period} cap)`,
        severity: "high",
      });
    } else if (b.status === "warning") {
      const usedPct = Math.round(b.percentageSpent);
      anomalies.push({
        id: `anom-budget-${b.id}`,
        date: matchingTx?.date || todayIso,
        merchant: matchingTx?.merchant || `${b.categoryName} Spend`,
        categoryName: b.categoryName,
        amount: -b.spentAmount,
        anomalyType: `Approaching ${b.period} cap (${usedPct}% utilized)`,
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
