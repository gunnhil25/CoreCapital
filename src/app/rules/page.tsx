import { getClassificationRulesAction } from "@/actions/rules";
import { getCategoriesAction } from "@/actions/transactions";
import { RulesView } from "@/components/rules/rules-view";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const rules = await getClassificationRulesAction();
  const categories = await getCategoriesAction();

  return <RulesView initialRules={rules} categories={categories} />;
}
