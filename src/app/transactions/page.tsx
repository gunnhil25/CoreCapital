import { getTransactionsAction, getAccountsAction, getCategoriesAction } from "@/actions/transactions";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ action?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const [transactions, accounts, categories] = await Promise.all([
    getTransactionsAction(),
    getAccountsAction(),
    getCategoriesAction(),
  ]);

  return (
    <TransactionsView
      initialTransactions={transactions}
      accounts={accounts}
      categories={categories}
      initialOpenNewModal={resolvedParams?.action === "new"}
    />
  );
}
