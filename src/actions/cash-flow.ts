"use server";

import { store, SubscriptionItem } from "@/lib/store";
import { getSubscriptionsAction } from "@/actions/subscriptions";

export interface CashFlowDataPoint {
  date: string;
  formattedDate: string;
  projectedBalance: number;
  inflow: number;
  outflow: number;
  eventDescription?: string;
}

const LIQUID_ACCOUNT_TYPES = new Set(["checking", "savings", "offset"]);

function isSubscriptionDueOnDate(sub: SubscriptionItem, curDate: Date): boolean {
  if (!sub.isActive) return false;

  const anchor = new Date(`${sub.nextBillingDate}T00:00:00`);
  if (isNaN(anchor.getTime())) return false;

  const curMidnight = new Date(curDate.getFullYear(), curDate.getMonth(), curDate.getDate());
  const anchorMidnight = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const diffDays = Math.round(
    (curMidnight.getTime() - anchorMidnight.getTime()) / (1000 * 60 * 60 * 24)
  );

  switch (sub.billingCycle) {
    case "weekly":
      return ((diffDays % 7) + 7) % 7 === 0;
    case "fortnightly":
      return ((diffDays % 14) + 14) % 14 === 0;
    case "monthly": {
      const lastDayOfMonth = new Date(
        curDate.getFullYear(),
        curDate.getMonth() + 1,
        0
      ).getDate();
      const targetDay = Math.min(anchor.getDate(), lastDayOfMonth);
      return curDate.getDate() === targetDay;
    }
    case "quarterly": {
      const monthDiff =
        (curDate.getFullYear() - anchor.getFullYear()) * 12 +
        (curDate.getMonth() - anchor.getMonth());
      const lastDayOfMonth = new Date(
        curDate.getFullYear(),
        curDate.getMonth() + 1,
        0
      ).getDate();
      const targetDay = Math.min(anchor.getDate(), lastDayOfMonth);
      return ((monthDiff % 3) + 3) % 3 === 0 && curDate.getDate() === targetDay;
    }
    case "annually":
      return (
        curDate.getMonth() === anchor.getMonth() &&
        curDate.getDate() === anchor.getDate()
      );
    default:
      return false;
  }
}

export async function getCashFlowProjectionAction(days: 30 | 90 = 30): Promise<{
  startingBalance: number;
  endingBalance: number;
  lowestBalance: number;
  netChange: number;
  points: CashFlowDataPoint[];
}> {
  const [accounts, subscriptions] = await Promise.all([
    store.getAccounts(),
    getSubscriptionsAction(),
  ]);

  const startingBalance =
    Math.round(
      accounts
        .filter((a) => a.isActive && LIQUID_ACCOUNT_TYPES.has(a.accountType))
        .reduce((sum, a) => sum + (parseFloat(a.currentBalance) || 0), 0) * 100
    ) / 100;

  const activeSubs = subscriptions.filter((s) => s.isActive);

  let runningBalance = startingBalance;
  let lowestBalance = startingBalance;

  const points: CashFlowDataPoint[] = [];
  const today = new Date();

  for (let i = 0; i <= days; i++) {
    const curDate = new Date(today);
    curDate.setDate(today.getDate() + i);

    const isoDate = curDate.toISOString().split("T")[0];
    const formatted = new Intl.DateTimeFormat("en-AU", {
      day: "numeric",
      month: "short",
    }).format(curDate);

    let dayInflow = 0;
    let dayOutflow = 0;
    const notes: string[] = [];

    // Fortnightly salary simulation (every 14 days starting on day 4)
    if (i > 0 && i % 14 === 4) {
      dayInflow += 3850.0;
      notes.push("Defence Force Salary (+$3,850.00)");
    }

    // Rent on 1st of month (or day 20 if month has no 1st in short window)
    if (curDate.getDate() === 1 || (days <= 30 && i === 20)) {
      dayOutflow += 1650.0;
      notes.push("Monthly Rent (-$1,650.00)");
    }

    // Active subscriptions scheduled on this date
    const dueSubs = activeSubs.filter((sub) => isSubscriptionDueOnDate(sub, curDate));
    if (dueSubs.length > 0) {
      const subTotal = dueSubs.reduce((sum, s) => sum + s.amount, 0);
      dayOutflow += subTotal;
      notes.push(
        `Subscriptions: ${dueSubs.map((s) => s.name).join(", ")} (-$${subTotal.toFixed(2)})`
      );
    }

    // Baseline daily expenses
    dayOutflow += 42.0;

    runningBalance = runningBalance + dayInflow - dayOutflow;
    if (runningBalance < lowestBalance) {
      lowestBalance = runningBalance;
    }

    points.push({
      date: isoDate,
      formattedDate: formatted,
      projectedBalance: Math.round(runningBalance * 100) / 100,
      inflow: Math.round(dayInflow * 100) / 100,
      outflow: Math.round(dayOutflow * 100) / 100,
      eventDescription: notes.length > 0 ? notes.join(" & ") : undefined,
    });
  }

  return {
    startingBalance,
    endingBalance: Math.round(runningBalance * 100) / 100,
    lowestBalance: Math.round(lowestBalance * 100) / 100,
    netChange: Math.round((runningBalance - startingBalance) * 100) / 100,
    points,
  };
}
