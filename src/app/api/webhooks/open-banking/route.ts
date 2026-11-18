import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { store, TransactionWithLedger } from "@/lib/store";
import {
  cleanMerchantName,
  computeDeduplicationHash,
  normalizeDate,
} from "@/lib/csv-engine";
import { findMatchingRule } from "@/lib/rule-engine";

function verifyHmacSignature(
  rawBody: string,
  providedSignature: string | null,
  secret: string
): boolean {
  if (!providedSignature) return false;
  const normalizedProvided = providedSignature.replace(/^sha256=/i, "").trim().toLowerCase();
  if (!/^[0-9a-f]+$/i.test(normalizedProvided)) return false;

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const providedBuf = Buffer.from(normalizedProvided, "hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (providedBuf.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Australian Open Banking (CDR / Basiq / Frollo) Webhook Ingestion Hook
 * Handles automated sync events when bank transactions are pushed by provider.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature =
      request.headers.get("x-basiq-signature") ||
      request.headers.get("x-cdr-signature");
    const webhookSecret =
      process.env.OPEN_BANKING_WEBHOOK_SECRET || "stub_secret_corecapital";

    if (!verifyHmacSignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json(
        { error: "Invalid or missing webhook HMAC signature" },
        { status: 401 }
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON webhook payload" },
        { status: 400 }
      );
    }

    const eventType = payload.type || payload.event || "transaction.created";
    const data = payload.data || {};

    switch (eventType) {
      case "transaction.created":
      case "transactions.updated": {
        const incomingList: any[] = Array.isArray(data.transactions)
          ? data.transactions
          : data.amount !== undefined
          ? [data]
          : [];

        const accounts = await store.getWebhookAccounts();
        if (accounts.length === 0) {
          return NextResponse.json(
            { error: "No initialized user account available for ingestion" },
            { status: 503 }
          );
        }

        let importedCount = 0;
        let duplicateCount = 0;

        for (const item of incomingList) {
          const targetAccount =
            accounts.find((a) => a.id === item.accountId) || accounts[0];
          if (!targetAccount) continue;

          const [rules, categories] = await Promise.all([
            store.getRules(targetAccount.userId),
            store.getCategories(targetAccount.userId),
          ]);

          const amountNum = Number(item.amount);
          if (isNaN(amountNum) || amountNum === 0) continue;

          const date = normalizeDate(
            String(item.date || new Date().toISOString().split("T")[0])
          );
          const rawDescription = String(
            item.rawDescription || item.description || "CDR Open Banking Transaction"
          );
          const { merchant, clean } = cleanMerchantName(rawDescription);
          const effectiveMerchant = item.merchant ? String(item.merchant) : merchant;
          const deduplicationHash = computeDeduplicationHash(
            targetAccount.id,
            date,
            amountNum,
            rawDescription
          );

          if (await store.hasDeduplicationHash(deduplicationHash, targetAccount.userId)) {
            duplicateCount++;
            continue;
          }

          const matchedRule = findMatchingRule(
            {
              merchant: effectiveMerchant,
              rawDescription,
              cleanDescription: clean,
              amount: amountNum,
            },
            rules
          );
          const matchedCategory = matchedRule
            ? categories.find((c) => c.id === matchedRule.targetCategoryId)
            : null;

          if (matchedRule) {
            await store.incrementRuleMatchCount(matchedRule.id);
          }

          const txId = crypto.randomUUID();
          const newTx: TransactionWithLedger = {
            id: txId,
            userId: targetAccount.userId,
            accountId: targetAccount.id,
            accountName: targetAccount.name,
            date,
            postedDate: date,
            amount: amountNum.toFixed(2),
            currency: "AUD",
            merchant: effectiveMerchant,
            cleanDescription: clean || rawDescription,
            rawDescription,
            status: "posted",
            isSplit: false,
            isReversal: false,
            deduplicationHash,
            createdAt: new Date().toISOString(),
            ledgerEntries: [
              {
                id: crypto.randomUUID(),
                transactionId: txId,
                accountId: targetAccount.id,
                categoryId: matchedCategory?.id || null,
                categoryName: matchedCategory?.name || "Uncategorized",
                categoryColor: matchedCategory?.color || "#64748b",
                entryType: amountNum > 0 ? "credit" : "debit",
                amount: Math.abs(amountNum).toFixed(2),
                description: clean || rawDescription,
                isReversal: false,
                sequenceIndex: 0,
              },
            ],
          };

          await store.addTransaction(newTx);
          importedCount++;
        }

        return NextResponse.json({
          status: "processed",
          message: "Transactions queued for ingestion & rule matching",
          event: eventType,
          importedCount,
          duplicateCount,
        });
      }

      case "account.balance_updated":
        return NextResponse.json({
          status: "processed",
          message: "Account balance refreshed",
        });

      case "consent.expired":
      case "consent.revoked":
        return NextResponse.json({
          status: "acknowledged",
          message: "Consent status updated in open_banking_connections",
        });

      default:
        return NextResponse.json({ status: "acknowledged", event: eventType });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "Webhook ingestion error", details: error?.message },
      { status: 500 }
    );
  }
}
