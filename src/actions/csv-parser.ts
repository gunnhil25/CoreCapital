"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { store, TransactionWithLedger } from "@/lib/store";
import {
  parseBankStatementCsv,
  computeFileHash,
  SupportedBankFormat,
} from "@/lib/csv-engine";
import {
  findMatchingRule,
  generateRuleSuggestions,
  type RuleSuggestion,
} from "@/lib/rule-engine";
import { formatCategoryDisplayLabel } from "@/lib/category-utils";

export interface ImportCsvResult {
  success: boolean;
  batchId?: string;
  fileName?: string;
  totalRows?: number;
  importedCount?: number;
  duplicateCount?: number;
  unclassifiedCount?: number;
  suggestions?: RuleSuggestion[];
  error?: string;
}

/**
 * Server Action: Parses bank statement CSV, executes deduplication,
 * evaluates classification rules, and commits records to the immutable ledger.
 */
export async function importBankStatementCsvAction(formData: FormData): Promise<ImportCsvResult> {
  try {
    const file = formData.get("file") as File | null;
    const accountId = formData.get("accountId") as string | null;
    const bankFormat = (formData.get("bankFormat") as SupportedBankFormat) || "auto";

    if (!file || !accountId) {
      return { success: false, error: "Missing statement file or target account." };
    }

    const accounts = await store.getAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      return { success: false, error: "Target account not found." };
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileHash = computeFileHash(fileBuffer);
    const csvContent = fileBuffer.toString("utf-8");

    // Parse rows based on Australian bank schema
    const parsedRows = parseBankStatementCsv(csvContent, accountId, bankFormat);
    if (parsedRows.length === 0) {
      return { success: false, error: "No valid transaction rows found in the uploaded statement." };
    }

    const rules = await store.getRules();
    const categories = await store.getCategories();
    const batchId = crypto.randomUUID();

    let importedCount = 0;
    let duplicateCount = 0;
    let unclassifiedCount = 0;

    for (const row of parsedRows) {
      // Check deduplication hash
      if (await store.hasDeduplicationHash(row.deduplicationHash)) {
        duplicateCount++;
        continue;
      }

      // Automatically evaluate classification rules
      const matchedRule = findMatchingRule(row, rules);
      const matchedCategory = matchedRule
        ? categories.find((c) => c.id === matchedRule.targetCategoryId)
        : null;

      if (matchedRule) {
        await store.incrementRuleMatchCount(matchedRule.id);
      } else {
        unclassifiedCount++;
      }

      const txId = crypto.randomUUID();
      const ledgerEntryId = crypto.randomUUID();

      const newTx: TransactionWithLedger = {
        id: txId,
        userId: account.userId,
        accountId: account.id,
        accountName: account.name,
        importBatchId: batchId,
        date: row.date,
        postedDate: row.date,
        amount: row.amount.toFixed(2),
        currency: "AUD",
        merchant: row.merchant,
        cleanDescription: row.cleanDescription,
        rawDescription: row.rawDescription,
        status: "posted",
        isSplit: false,
        isReversal: false,
        deduplicationHash: row.deduplicationHash,
        createdAt: new Date().toISOString(),
        ledgerEntries: [
          {
            id: ledgerEntryId,
            transactionId: txId,
            accountId: account.id,
            categoryId: matchedCategory?.id || null,
            categoryName: matchedCategory
              ? formatCategoryDisplayLabel(matchedCategory.id, categories)
              : "Uncategorized",
            categoryColor: matchedCategory?.color || "#64748b",
            entryType: row.amount > 0 ? "credit" : "debit",
            amount: Math.abs(row.amount).toFixed(2),
            description: row.cleanDescription,
            isReversal: false,
            sequenceIndex: 0,
          },
        ],
      };

      await store.addTransaction(newTx);
      importedCount++;
    }

    // Save batch summary
    await store.addImportBatch({
      id: batchId,
      userId: account.userId,
      accountId: account.id,
      fileName: file.name,
      fileHash,
      bankFormat,
      totalRows: parsedRows.length,
      importedRows: importedCount,
      duplicateRows: duplicateCount,
      status: "completed",
      importedAt: new Date().toISOString(),
    });

    revalidatePath("/transactions");
    revalidatePath("/ingest");
    revalidatePath("/budgets");
    revalidatePath("/rules");
    revalidatePath("/accounts");
    revalidatePath("/");

    const [updatedTransactions, updatedRules] = await Promise.all([
      store.getTransactions(),
      store.getRules(),
    ]);
    const suggestions = generateRuleSuggestions({
      transactions: updatedTransactions,
      rules: updatedRules,
      categories,
      onlyBatchId: batchId,
    });

    return {
      success: true,
      batchId,
      fileName: file.name,
      totalRows: parsedRows.length,
      importedCount,
      duplicateCount,
      unclassifiedCount,
      suggestions,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to process bank statement." };
  }
}

export async function getImportBatchesAction() {
  return store.getBatches();
}
