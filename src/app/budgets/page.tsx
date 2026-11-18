import { getBudgetsAction, getSpendingAnomaliesAction } from "@/actions/budgets";
import { getCategoriesAction } from "@/actions/transactions";
import { BudgetsView } from "@/components/budgets/budgets-view";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const budgets = await getBudgetsAction();
  const anomalies = await getSpendingAnomaliesAction();
  const categories = await getCategoriesAction();

  return (
    <BudgetsView
      initialBudgets={budgets}
      anomalies={anomalies}
      categories={categories}
    />
  );
}
