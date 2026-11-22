import {
  getClassificationRulesAction,
  getRuleSuggestionsAction,
} from "@/actions/rules";
import { getCategoriesAction, getTransactionsAction } from "@/actions/transactions";
import { RulesView, RulePreviewTransaction } from "@/components/rules/rules-view";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const [rules, categories, transactions, suggestions] = await Promise.all([
    getClassificationRulesAction(),
    getCategoriesAction(),
    getTransactionsAction(),
    getRuleSuggestionsAction(),
  ]);

  const recentTransactions: RulePreviewTransaction[] = transactions
    .filter((t) => t.status === "posted" && !t.isReversal)
    .slice(0, 100)
    .map((t) => ({
      id: t.id,
      date: t.date,
      merchant: t.merchant || null,
      cleanDescription: t.cleanDescription,
      rawDescription: t.rawDescription,
      amount: t.amount,
      categoryId: t.ledgerEntries[0]?.categoryId || null,
      categoryName: t.ledgerEntries[0]?.categoryName || "Uncategorized",
    }));

  return (
    <RulesView
      initialRules={rules}
      categories={categories}
      recentTransactions={recentTransactions}
      initialSuggestions={suggestions}
    />
  );
}
