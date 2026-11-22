"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import {
  AccountRecord,
  AuditLogItem,
  CategoryRecord,
  store,
  TransactionWithLedger,
} from "@/lib/store";
import { computeDeduplicationHash } from "@/lib/csv-engine";
import { formatCategoryDisplayLabel } from "@/lib/category-utils";

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

export interface EditTransactionInput {
  transactionId: string;
  accountId: string;
  date: string;
  amount: number; // positive = credit/inflow, negative = debit/outflow
  cleanDescription: string;
  merchant?: string;
  categoryId?: string;
  isSplit?: boolean;
  splits?: SplitItemInput[];
  notes?: string;
  editReason?: string;
}

export interface TransactionsPageData {
  transactions: TransactionWithLedger[];
  auditLogs: AuditLogItem[];
  accounts: AccountRecord[];
  categories: CategoryRecord[];
  baseCurrency: string;
}

function formatLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function computeReversalHash(
  originalTxId: string,
  reversalTxId: string,
  reversalAmount: number,
  reason: string
): string {
  return crypto
    .createHash("sha256")
    .update(
      `REVERSAL|${originalTxId}|${reversalTxId}|${reversalAmount.toFixed(2)}|${reason.trim()}`
    )
    .digest("hex");
}

function computeFallbackLedgerHash(tx: TransactionWithLedger): string {
  return crypto
    .createHash("sha256")
    .update(
      `LEDGER|${tx.id}|${tx.date}|${tx.amount}|${tx.rawDescription || tx.cleanDescription}`
    )
    .digest("hex");
}

function revalidateLedgerDependentPaths() {
  revalidatePath("/transactions");
  revalidatePath("/budgets");
  revalidatePath("/property-goals");
  revalidatePath("/cash-flow");
  revalidatePath("/subscriptions");
  revalidatePath("/");
}

function buildLedgerEntriesForTx(params: {
  transactionId: string;
  accountId: string;
  amount: number;
  cleanDescription: string;
  categoryId?: string;
  isSplit: boolean;
  splits: SplitItemInput[];
  categories: CategoryRecord[];
}): { entries?: TransactionWithLedger["ledgerEntries"]; error?: string } {
  const {
    transactionId,
    accountId,
    amount,
    cleanDescription,
    categoryId,
    isSplit,
    splits,
    categories,
  } = params;

  if (isSplit) {
    if (!splits || splits.length < 2) {
      return { error: "Split transactions require at least 2 split items." };
    }
    for (const s of splits) {
      if (!Number.isFinite(s.amount) || s.amount <= 0) {
        return { error: "Every split item must have a positive amount." };
      }
    }
    const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
    const absAmount = Math.abs(amount);

    if (Math.abs(splitTotal - absAmount) > 0.01) {
      return {
        error: `Split sum ($${splitTotal.toFixed(2)}) must equal transaction absolute amount ($${absAmount.toFixed(2)}).`,
      };
    }

    return {
      entries: splits.map((split, idx) => {
        const cat = categories.find((c) => c.id === split.categoryId);
        return {
          id: crypto.randomUUID(),
          transactionId,
          accountId,
          categoryId: split.categoryId || null,
          categoryName: cat ? formatCategoryDisplayLabel(cat.id, categories) : "Uncategorized",
          categoryColor: cat?.color || "#64748b",
          entryType: amount > 0 ? "credit" : "debit",
          amount: split.amount.toFixed(2),
          description: split.description || cleanDescription,
          isReversal: false,
          sequenceIndex: idx,
        };
      }),
    };
  }

  const cat = categories.find((c) => c.id === categoryId);
  return {
    entries: [
      {
        id: crypto.randomUUID(),
        transactionId,
        accountId,
        categoryId: categoryId || null,
        categoryName: cat ? formatCategoryDisplayLabel(cat.id, categories) : "Uncategorized",
        categoryColor: cat?.color || "#64748b",
        entryType: amount > 0 ? "credit" : "debit",
        amount: Math.abs(amount).toFixed(2),
        description: cleanDescription,
        isReversal: false,
        sequenceIndex: 0,
      },
    ],
  };
}

function buildOffsettingReversalTransaction(
  originalTx: TransactionWithLedger,
  reason: string,
  createdAtIso: string
): TransactionWithLedger {
  const originalAmountNum = parseFloat(originalTx.amount);
  const reversalAmount = -originalAmountNum;
  const reversalTxId = crypto.randomUUID();
  const todayIso = formatLocalIsoDate(new Date());
  const trimmedReason = reason.trim();

  const reversalLedgerEntries: TransactionWithLedger["ledgerEntries"] =
    originalTx.ledgerEntries.map((entry, idx) => ({
      id: crypto.randomUUID(),
      transactionId: reversalTxId,
      accountId: entry.accountId,
      categoryId: entry.categoryId,
      categoryName: entry.categoryName,
      categoryColor: entry.categoryColor,
      entryType: entry.entryType === "debit" ? "credit" : "debit",
      amount: entry.amount,
      description: `REVERSAL: ${entry.description || originalTx.cleanDescription} [${trimmedReason}]`,
      isReversal: true,
      reversedEntryId: entry.id,
      sequenceIndex: idx,
    }));

  return {
    id: reversalTxId,
    userId: originalTx.userId,
    accountId: originalTx.accountId,
    accountName: originalTx.accountName,
    date: todayIso,
    postedDate: todayIso,
    amount: reversalAmount.toFixed(2),
    currency: originalTx.currency,
    merchant: originalTx.merchant,
    cleanDescription: `REVERSAL: ${originalTx.cleanDescription}`,
    rawDescription: `REVERSAL ENTRY FOR TX ${originalTx.id} - REASON: ${trimmedReason}`,
    status: "posted",
    isSplit: originalTx.isSplit,
    isReversal: true,
    reversesTransactionId: originalTx.id,
    reversalReason: trimmedReason,
    deduplicationHash: computeReversalHash(
      originalTx.id,
      reversalTxId,
      reversalAmount,
      trimmedReason
    ),
    notes: `Reversed original transaction ${originalTx.id}: ${trimmedReason}`,
    createdAt: createdAtIso,
    ledgerEntries: reversalLedgerEntries,
  };
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

    if (!accountId || !date || !cleanDescription.trim() || !Number.isFinite(amount) || amount === 0) {
      return { success: false, error: "Invalid account, date, description, or amount provided." };
    }

    const [accounts, categories, activeUserId] = await Promise.all([
      store.getAccounts(),
      store.getCategories(),
      store.getVerifiedSessionUserId(),
    ]);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      return { success: false, error: "Account not found." };
    }

    const activeUser = activeUserId ? await store.getUserById(activeUserId) : undefined;
    const baseCurrency = activeUser?.baseCurrency || "AUD";

    const trimmedDesc = cleanDescription.trim();
    const effectiveRawDesc = rawDescription || trimmedDesc;
    const effectiveMerchant =
      merchant?.trim() || trimmedDesc.split(" ").slice(0, 3).join(" ");
    const deduplicationHash = computeDeduplicationHash(
      accountId,
      date,
      amount,
      effectiveRawDesc
    );

    const transactionId = crypto.randomUUID();
    const useSplit = Boolean(isSplit && splits.length > 0);
    const built = buildLedgerEntriesForTx({
      transactionId,
      accountId,
      amount,
      cleanDescription: trimmedDesc,
      categoryId,
      isSplit: useSplit,
      splits,
      categories,
    });
    if (built.error || !built.entries) {
      return { success: false, error: built.error || "Invalid ledger entries." };
    }

    const newTransaction: TransactionWithLedger = {
      id: transactionId,
      userId: account.userId,
      accountId,
      accountName: account.name,
      date,
      postedDate: date,
      amount: amount.toFixed(2),
      currency: baseCurrency,
      merchant: effectiveMerchant,
      cleanDescription: trimmedDesc,
      rawDescription: effectiveRawDesc,
      status: "posted",
      isSplit: useSplit,
      isReversal: false,
      deduplicationHash,
      notes: notes?.trim() || null,
      createdAt: new Date().toISOString(),
      ledgerEntries: built.entries,
    };

    await store.addTransaction(newTransaction);
    revalidateLedgerDependentPaths();

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
      return {
        success: false,
        error: "A valid audit reason is required to reverse a transaction.",
      };
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

    const reversalTx = buildOffsettingReversalTransaction(
      originalTx,
      reason,
      new Date().toISOString()
    );

    await store.addTransaction(reversalTx);
    await store.markTransactionReversed(originalTx.id);
    revalidateLedgerDependentPaths();

    return { success: true, reversalTransaction: reversalTx };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to reverse transaction." };
  }
}

/**
 * Edits an active transaction while preserving immutable ledger guarantees:
 * atomically posts an offsetting reversal of the original entry, marks the original
 * reversed, and posts the updated replacement entry with full audit logging.
 */
export async function editTransactionAction(input: EditTransactionInput) {
  try {
    const {
      transactionId,
      accountId,
      date,
      amount,
      cleanDescription,
      merchant,
      categoryId,
      isSplit = false,
      splits = [],
      notes,
      editReason,
    } = input;

    const originalTx = await store.getTransactionById(transactionId);
    if (!originalTx) {
      return { success: false, error: "Original transaction not found in ledger." };
    }

    if (originalTx.status === "reversed") {
      return { success: false, error: "Cannot edit a reversed transaction." };
    }

    if (originalTx.isReversal) {
      return { success: false, error: "Cannot edit a reversal entry." };
    }

    const trimmedDesc = cleanDescription.trim();
    if (!accountId || !date || !trimmedDesc || !Number.isFinite(amount) || amount === 0) {
      return {
        success: false,
        error: "Invalid account, date, description, or amount provided.",
      };
    }

    const [accounts, categories, activeUserId] = await Promise.all([
      store.getAccounts(),
      store.getCategories(),
      store.getVerifiedSessionUserId(),
    ]);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      return { success: false, error: "Target account not found." };
    }

    const activeUser = activeUserId ? await store.getUserById(activeUserId) : undefined;
    const baseCurrency = activeUser?.baseCurrency || originalTx.currency || "AUD";

    const replacementTxId = crypto.randomUUID();
    const built = buildLedgerEntriesForTx({
      transactionId: replacementTxId,
      accountId,
      amount,
      cleanDescription: trimmedDesc,
      categoryId,
      isSplit: Boolean(isSplit),
      splits,
      categories,
    });
    if (built.error || !built.entries) {
      return { success: false, error: built.error || "Invalid split breakdown." };
    }

    const effectiveReason = editReason?.trim() || "Transaction edited by user";
    const nowMs = Date.now();
    const reversalCreatedAt = new Date(nowMs).toISOString();
    const replacementCreatedAt = new Date(nowMs + 1).toISOString();

    const reversalTx = buildOffsettingReversalTransaction(
      originalTx,
      effectiveReason,
      reversalCreatedAt
    );

    const resolvedMerchant =
      merchant !== undefined
        ? merchant.trim() || null
        : originalTx.merchant || trimmedDesc.split(" ").slice(0, 3).join(" ");

    const resolvedNotes =
      notes !== undefined ? notes.trim() || null : originalTx.notes ?? null;

    const replacementTx: TransactionWithLedger = {
      id: replacementTxId,
      userId: account.userId,
      accountId,
      accountName: account.name,
      date,
      postedDate: date,
      amount: amount.toFixed(2),
      currency: baseCurrency,
      merchant: resolvedMerchant,
      cleanDescription: trimmedDesc,
      rawDescription: trimmedDesc,
      status: "posted",
      isSplit: Boolean(isSplit),
      isReversal: false,
      deduplicationHash: computeDeduplicationHash(accountId, date, amount, trimmedDesc),
      notes: resolvedNotes,
      createdAt: replacementCreatedAt,
      ledgerEntries: built.entries,
    };

    await store.replaceTransactionImmutably({
      originalTransactionId: originalTx.id,
      reversalTx,
      replacementTx,
      editReason: effectiveReason,
    });

    revalidateLedgerDependentPaths();

    return {
      success: true,
      transaction: replacementTx,
      reversalTransaction: reversalTx,
      originalTransactionId: originalTx.id,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to edit transaction." };
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

/**
 * Retrieves separated page bundle with deterministic hash fallback for all ledger records
 */
export async function getTransactionsPageDataAction(): Promise<TransactionsPageData> {
  const [rawTransactions, auditLogs, accounts, categories, activeUserId] =
    await Promise.all([
      store.getTransactions(),
      store.getAuditLogs(),
      store.getAccounts(),
      store.getCategories(),
      store.getVerifiedSessionUserId(),
    ]);

  const activeUser = activeUserId ? await store.getUserById(activeUserId) : undefined;
  const baseCurrency = activeUser?.baseCurrency || "AUD";

  const transactions = rawTransactions.map((tx) => ({
    ...tx,
    deduplicationHash: tx.deduplicationHash || computeFallbackLedgerHash(tx),
  }));

  return {
    transactions,
    auditLogs,
    accounts,
    categories,
    baseCurrency,
  };
}

export async function getAccountsAction() {
  return store.getAccounts();
}

export async function getCategoriesAction() {
  return store.getCategories();
}
