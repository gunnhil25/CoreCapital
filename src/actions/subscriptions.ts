"use server";

import { revalidatePath } from "next/cache";
import { store, SubscriptionItem } from "@/lib/store";

export type { SubscriptionItem };

export async function getSubscriptionsAction() {
  return store.getSubscriptions();
}

export async function createSubscriptionAction(input: {
  name: string;
  merchant?: string;
  amount: number;
  billingCycle: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annually";
  startDate: string;
  nextBillingDate: string;
  categoryName?: string;
}) {
  const subscription = await store.addSubscription(input);
  revalidatePath("/subscriptions");
  revalidatePath("/cash-flow");
  revalidatePath("/");

  return { success: true, subscription };
}

export async function toggleSubscriptionAction(id: string, isActive: boolean) {
  await store.toggleSubscription(id, isActive);
  revalidatePath("/subscriptions");
  revalidatePath("/cash-flow");
  revalidatePath("/");
  return { success: true };
}
