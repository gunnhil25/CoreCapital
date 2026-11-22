import { getCashFlowPageDataAction } from "@/actions/cash-flow";
import { CashFlowView } from "@/components/cash-flow/cash-flow-view";

export const dynamic = "force-dynamic";

export default async function CashFlowPage() {
  const initialData = await getCashFlowPageDataAction();

  return <CashFlowView initialData={initialData} />;
}
