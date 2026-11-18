import { getCashFlowProjectionAction } from "@/actions/cash-flow";
import { CashFlowView } from "@/components/cash-flow/cash-flow-view";

export const dynamic = "force-dynamic";

export default async function CashFlowPage() {
  const initial30Day = await getCashFlowProjectionAction(30);
  const initial90Day = await getCashFlowProjectionAction(90);

  return <CashFlowView initial30Day={initial30Day} initial90Day={initial90Day} />;
}
