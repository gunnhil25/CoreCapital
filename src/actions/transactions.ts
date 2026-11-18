"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { store, TransactionWithLedger } from "@/lib/store";
import { computeDeduplicationHash } from "@/lib/csv-engine";

export interface SplitItemInput {
  categoryId: string;
  amount: number;
  description?: string;
}

export interface CreateTransactionInput {
  accountId: string;
  date: string;
  amount: number; // positive = credit/inflow, negative = debit/outflow
  cleanDescription: string;
  merchant?: string;
  rawDescription?: string;
  categoryId?: string; // used for single transaction
  isSplit?: boolean;
  splits?: SplitItemInput[]; // used for split transaction
  notes?: string;
}

/**
 * Creates a single or split transaction with atomic immutable ledger entries
 */
export async function createTransactionAction(input: CreateTransactionInput) {
  try {
    const {
      accountId,
      date,
      amount,
      cleanDescription,
      merchant,
      rawDescription,
      categoryId,
      isSplit = false,
      splits = [],
      notes,
    } = input;

    if (!accountId || !date || isNaN(amount) || amount === 0) {
      return { success: false, error: "Invalid account, date, or amount provided." };
    }

    const accounts = await store.getAccounts();
    const categories = await store.getCategories();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      return { success: false, error: "Account not found." };
    }

    const effectiveRawDesc = rawDescription || cleanDescription;
    const effectiveMerchant = merchant || cleanDescription.split(" ").slice(0, 3).join(" ");
    const deduplicationHash = computeDeduplicationHash(accountId, date, amount, effectiveRawDesc);

    // Validate Split Transaction Math
    let ledgerItems: TransactionWithLedger["ledgerEntries"] = [];
    const transactionId = crypto.randomUUID();

    if (isSplit && splits.length > 0) {
      const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
      const absAmount = Math.abs(amount);

      if (Math.abs(splitTotal - absAmount) > 0.01) {
        return {
          success: false,
          error: `Split sum ($${splitTotal.toFixed(2)}) must equal transaction absolute amount ($${absAmount.toFixed(2)}).`,
        };
      }

      ledgerItems = splits.map((split, idx) => {
        const cat = categories.find((c) => c.id === split.categoryId);
        return {
          id: crypto.randomUUID(),
          transactionId,
          accountId,
          categoryId: split.categoryId,
          categoryName: cat?.name || "Uncategorized",
          categoryColor: cat?.color || "#64748b",
          entryType: amount > 0 ? "credit" : "debit",
          amount: split.amount.toFixed(2),
          description: split.description || cleanDescription,
          isReversal: false,
          sequenceIndex: idx,
        };
      });
    } else {
      // Single Transaction
      const cat = categories.find((c) => c.id === categoryId);
      ledgerItems = [
        {
          id: crypto.randomUUID(),
          transactionId,
          accountId,
          categoryId: categoryId || null,
          categoryName: cat?.name || "Uncategorized",
          categoryColor: cat?.color || "#64748b",
          entryType: amount > 0 ? "credit" : "debit",
          amount: Math.abs(amount).toFixed(2),
          description: cleanDescription,
          isReversal: false,
          sequenceIndex: 0,
        },
      ];
    }

    const newTransaction: TransactionWithLedger = {
      id: transactionId,
      userId: account.userId,
      accountId,
      accountName: account.name,
      date,
      postedDate: date,
      amount: amount.toFixed(2),
      currency: "AUD",
      merchant: effectiveMerchant,
      cleanDescription,
      rawDescription: effectiveRawDesc,
      status: "posted",
      isSplit,
      isReversal: false,
      deduplicationHash,
      notes: notes || null,
      createdAt: new Date().toISOString(),
      ledgerEntries: ledgerItems,
    };

    await store.addTransaction(newTransaction);

    revalidatePath("/transactions");
    revalidatePath("/budgets");
    revalidatePath("/property-goals");
    revalidatePath("/cash-flow");
    revalidatePath("/subscriptions");
    revalidatePath("/");

    return { success: true, transaction: newTransaction };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to log transaction." };
  }
}

/**
 * Enforces Architectural Principle 1: Immutable Ledger System
 * Reverses a transaction by posting an offsetting reversing entry. No hard SQL DELETE.
 */
export async function reverseTransactionAction(transactionId: string, reason: string) {
  try {
    if (!reason || reason.trim().length < 3) {
      return { success: false, error: "A valid audit reason is required to reverse a transaction." };
    }

    const originalTx = await store.getTransactionById(transactionId);
    if (!originalTx) {
      return { success: false, error: "Original transaction not found in ledger." };
    }

    if (originalTx.status === "reversed") {
      return { success: false, error: "This transaction has already been reversed." };
    }

    if (originalTx.isReversal) {
      return { success: false, error: "Cannot reverse a reversal entry." };
    }

    const originalAmountNum = parseFloat(originalTx.amount);
    const reversalAmount = -originalAmountNum;
    const reversalTxId = crypto.randomUUID();

    // Create offsetting ledger entries
    const reversalLedgerEntries: TransactionWithLedger["ledgerEntries"] = originalTx.ledgerEntries.map(
      (entry, idx) => ({
        id: crypto.randomUUID(),
        transactionId: reversalTxId,
        accountId: entry.accountId,
        categoryId: entry.categoryId,
        categoryName: entry.categoryName,
        categoryColor: entry.categoryColor,
        entryType: entry.entryType === "debit" ? "credit" : "debit",
        amount: entry.amount,
        description: `REVERSAL: ${entry.description || originalTx.cleanDescription} [${reason}]`,
        isReversal: true,
        reversedEntryId: entry.id,
        sequenceIndex: idx,
      })
    );

    const reversalTx: TransactionWithLedger = {
      id: reversalTxId,
      userId: originalTx.userId,
      accountId: originalTx.accountId,
      accountName: originalTx.accountName,
      date: new Date().toISOString().split("T")[0],
      postedDate: new Date().toISOString().split("T")[0],
      amount: reversalAmount.toFixed(2),
      currency: originalTx.currency,
      merchant: originalTx.merchant,
      cleanDescription: `REVERSAL: ${originalTx.cleanDescription}`,
      rawDescription: `REVERSAL ENTRY FOR TX ${originalTx.id} - REASON: ${reason}`,
      status: "posted",
      isSplit: originalTx.isSplit,
      isReversal: true,
      reversesTransactionId: originalTx.id,
      reversalReason: reason,
      deduplicationHash: null,
      notes: `Reversed original transaction ${originalTx.id}: ${reason}`,
      createdAt: new Date().toISOString(),
      ledgerEntries: reversalLedgerEntries,
    };

    // Add reversing entry to ledger and mark original as reversed
    await store.addTransaction(reversalTx);
    await store.markTransactionReversed(originalTx.id);

    revalidatePath("/transactions");
    revalidatePath("/budgets");
    revalidatePath("/property-goals");
    revalidatePath("/cash-flow");
    revalidatePath("/");

    return { success: true, reversalTransaction: reversalTx };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to reverse transaction." };
  }
}

/**
 * Retrieves transactions filtered by account, category, or search
 */
export async function getTransactionsAction(filters?: {
  accountId?: string;
  categoryId?: string;
  search?: string;
  status?: string;
}) {
  return store.getTransactions(filters);
}

export async function getAccountsAction() {
  return store.getAccounts();
}

export async function getCategoriesAction() {
  return store.getCategories();
}
