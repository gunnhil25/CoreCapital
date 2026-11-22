import { getTransactionsPageDataAction } from "@/actions/transactions";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ action?: string; tab?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const data = await getTransactionsPageDataAction();

  return (
    <TransactionsView
      initialTransactions={data.transactions}
      initialAuditLogs={data.auditLogs}
      accounts={data.accounts}
      categories={data.categories}
      baseCurrency={data.baseCurrency}
      initialOpenNewModal={resolvedParams?.action === "new"}
      initialTab={resolvedParams?.tab === "ledger" ? "ledger" : "transactions"}
    />
  );
}
