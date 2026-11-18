import { getSubscriptionsAction } from "@/actions/subscriptions";
import { SubscriptionsView } from "@/components/subscriptions/subscriptions-view";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const subscriptions = await getSubscriptionsAction();

  return <SubscriptionsView initialSubscriptions={subscriptions} />;
}
