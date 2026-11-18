import { getPropertyGoalModelAction } from "@/actions/property-goals";
import { PropertyGoalsView } from "@/components/property-goals/property-goals-view";

export const dynamic = "force-dynamic";

export default async function PropertyGoalsPage() {
  const initialData = await getPropertyGoalModelAction();

  return <PropertyGoalsView initialData={initialData} />;
}
