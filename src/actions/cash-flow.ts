"use server";

import { revalidatePath } from "next/cache";
import {
  AccountRecord,
  CashFlowFrequency,
  CashFlowScheduledItemRecord,
  store,
  SubscriptionItem,
} from "@/lib/store";
import { formatCurrency } from "@/lib/utils";
import { getSubscriptionsAction } from "@/actions/subscriptions";

export type { CashFlowFrequency, CashFlowScheduledItemRecord };

export interface CashFlowDataPoint {
  date: string;
  formattedDate: string;
  projectedBalance: number;
  inflow: number;
  outflow: number;
  eventDescription?: string;
}

export interface CashFlowProjectionResult {
  startingBalance: number;
  endingBalance: number;
  lowestBalance: number;
  netChange: number;
  scheduledIncomeCount: number;
  scheduledIncomeTotal: number;
  scheduledExpenseCount: number;
  scheduledExpenseTotal: number;
  baseCurrency: string;
  points: CashFlowDataPoint[];
}

export interface CashFlowPageData {
  projection30: CashFlowProjectionResult;
  projection90: CashFlowProjectionResult;
  scheduledItems: CashFlowScheduledItemRecord[];
  accounts: AccountRecord[];
  baseCurrency: string;
}

const LIQUID_ACCOUNT_TYPES = new Set(["checking", "savings", "offset"]);
const VALID_FREQUENCIES = new Set<CashFlowFrequency>([
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "annually",
  "one_off",
]);

function formatLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((part) => parseInt(part, 10));
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}

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

function isScheduledItemDueOnDate(
  item: CashFlowScheduledItemRecord,
  curDate: Date
): boolean {
  if (!item.isActive || item.amount <= 0) return false;

  const anchor = new Date(`${item.nextOccurrenceDate}T00:00:00`);
  if (isNaN(anchor.getTime())) return false;

  const curMidnight = new Date(curDate.getFullYear(), curDate.getMonth(), curDate.getDate());
  const anchorMidnight = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (curMidnight < anchorMidnight) return false;

  if (item.endDate) {
    const endParsed = new Date(`${item.endDate}T00:00:00`);
    if (!isNaN(endParsed.getTime())) {
      const endMidnight = new Date(
        endParsed.getFullYear(),
        endParsed.getMonth(),
        endParsed.getDate()
      );
      if (curMidnight > endMidnight) return false;
    }
  }

  const diffDays = Math.round(
    (curMidnight.getTime() - anchorMidnight.getTime()) / (1000 * 60 * 60 * 24)
  );

  switch (item.frequency) {
    case "one_off":
      return diffDays === 0;
    case "weekly":
      return diffDays % 7 === 0;
    case "fortnightly":
      return diffDays % 14 === 0;
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
      return monthDiff >= 0 && monthDiff % 3 === 0 && curDate.getDate() === targetDay;
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

function buildCashFlowProjection(
  days: 30 | 90,
  accounts: AccountRecord[],
  subscriptions: SubscriptionItem[],
  scheduledItems: CashFlowScheduledItemRecord[],
  baseCurrency: string
): CashFlowProjectionResult {
  const startingBalance =
    Math.round(
      accounts
        .filter((a) => a.isActive && LIQUID_ACCOUNT_TYPES.has(a.accountType))
        .reduce((sum, a) => sum + (parseFloat(a.currentBalance) || 0), 0) * 100
    ) / 100;

  const activeSubs = subscriptions.filter((s) => s.isActive && s.amount > 0);
  const activeScheduled = scheduledItems.filter((item) => item.isActive && item.amount > 0);

  let runningBalance = startingBalance;
  let lowestBalance = startingBalance;
  let scheduledIncomeCount = 0;
  let scheduledIncomeTotal = 0;
  let scheduledExpenseCount = 0;
  let scheduledExpenseTotal = 0;

  const points: CashFlowDataPoint[] = [];
  const today = new Date();

  for (let i = 0; i <= days; i++) {
    const curDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const isoDate = formatLocalIsoDate(curDate);
    const formatted = new Intl.DateTimeFormat("en-AU", {
      day: "numeric",
      month: "short",
    }).format(curDate);

    let dayInflow = 0;
    let dayOutflow = 0;
    const notes: string[] = [];

    // User-configured scheduled cash flow items
    const dueItems = activeScheduled.filter((item) =>
      isScheduledItemDueOnDate(item, curDate)
    );
    for (const item of dueItems) {
      if (item.type === "income") {
        dayInflow += item.amount;
        scheduledIncomeCount += 1;
        scheduledIncomeTotal += item.amount;
        notes.push(`${item.name} (+${formatCurrency(item.amount, baseCurrency)})`);
      } else {
        dayOutflow += item.amount;
        scheduledExpenseCount += 1;
        scheduledExpenseTotal += item.amount;
        notes.push(`${item.name} (-${formatCurrency(item.amount, baseCurrency)})`);
      }
    }

    // Active subscriptions scheduled on this date
    const dueSubs = activeSubs.filter((sub) => isSubscriptionDueOnDate(sub, curDate));
    if (dueSubs.length > 0) {
      const subTotal = dueSubs.reduce((sum, s) => sum + s.amount, 0);
      dayOutflow += subTotal;
      scheduledExpenseCount += dueSubs.length;
      scheduledExpenseTotal += subTotal;
      notes.push(
        `Subscriptions: ${dueSubs.map((s) => s.name).join(", ")} (-${formatCurrency(
          subTotal,
          baseCurrency
        )})`
      );
    }

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
    scheduledIncomeCount,
    scheduledIncomeTotal: Math.round(scheduledIncomeTotal * 100) / 100,
    scheduledExpenseCount,
    scheduledExpenseTotal: Math.round(scheduledExpenseTotal * 100) / 100,
    baseCurrency,
    points,
  };
}

export async function getCashFlowProjectionAction(
  days: 30 | 90 = 30
): Promise<CashFlowProjectionResult> {
  const [accounts, subscriptions, scheduledItems, activeUserId] = await Promise.all([
    store.getAccounts(),
    getSubscriptionsAction(),
    store.getCashFlowScheduledItems(),
    store.getVerifiedSessionUserId(),
  ]);

  const activeUser = activeUserId ? await store.getUserById(activeUserId) : undefined;
  const baseCurrency = activeUser?.baseCurrency || "AUD";

  return buildCashFlowProjection(days, accounts, subscriptions, scheduledItems, baseCurrency);
}

export async function getCashFlowPageDataAction(): Promise<CashFlowPageData> {
  const [accounts, subscriptions, scheduledItems, activeUserId] = await Promise.all([
    store.getAccounts(),
    getSubscriptionsAction(),
    store.getCashFlowScheduledItems(),
    store.getVerifiedSessionUserId(),
  ]);

  const activeUser = activeUserId ? await store.getUserById(activeUserId) : undefined;
  const baseCurrency = activeUser?.baseCurrency || "AUD";

  return {
    projection30: buildCashFlowProjection(
      30,
      accounts,
      subscriptions,
      scheduledItems,
      baseCurrency
    ),
    projection90: buildCashFlowProjection(
      90,
      accounts,
      subscriptions,
      scheduledItems,
      baseCurrency
    ),
    scheduledItems,
    accounts,
    baseCurrency,
  };
}

export async function createCashFlowItemAction(input: {
  accountId?: string;
  name: string;
  type: "income" | "expense";
  amount: number;
  frequency: CashFlowFrequency;
  nextOccurrenceDate: string;
  endDate?: string | null;
}): Promise<{
  success: boolean;
  error?: string;
  item?: CashFlowScheduledItemRecord;
  data?: CashFlowPageData;
}> {
  const name = input.name.trim();
  if (!name) {
    return { success: false, error: "Please enter a name for the scheduled item." };
  }
  if (input.type !== "income" && input.type !== "expense") {
    return { success: false, error: "Item type must be income or expense." };
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { success: false, error: "Amount must be greater than zero." };
  }
  if (!VALID_FREQUENCIES.has(input.frequency)) {
    return { success: false, error: "Please choose a valid frequency." };
  }
  if (!isValidIsoDate(input.nextOccurrenceDate)) {
    return {
      success: false,
      error: "Please enter a valid next occurrence date (YYYY-MM-DD).",
    };
  }

  const cleanEndDate = input.endDate?.trim() || null;
  if (cleanEndDate) {
    if (!isValidIsoDate(cleanEndDate)) {
      return { success: false, error: "Please enter a valid end date (YYYY-MM-DD)." };
    }
    if (cleanEndDate < input.nextOccurrenceDate) {
      return {
        success: false,
        error: "End date must be on or after the next occurrence date.",
      };
    }
  }

  try {
    const item = await store.addCashFlowScheduledItem({
      accountId: input.accountId,
      name,
      type: input.type,
      amount: input.amount,
      frequency: input.frequency,
      nextOccurrenceDate: input.nextOccurrenceDate,
      endDate: cleanEndDate,
    });

    revalidatePath("/cash-flow");
    revalidatePath("/");

    const data = await getCashFlowPageDataAction();
    return { success: true, item, data };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to save scheduled cash flow item.",
    };
  }
}

export async function toggleCashFlowItemAction(
  id: string,
  isActive: boolean
): Promise<{ success: boolean; data?: CashFlowPageData }> {
  await store.toggleCashFlowScheduledItem(id, isActive);
  revalidatePath("/cash-flow");
  revalidatePath("/");

  const data = await getCashFlowPageDataAction();
  return { success: true, data };
}

export async function deleteCashFlowItemAction(
  id: string
): Promise<{ success: boolean; data?: CashFlowPageData }> {
  await store.deleteCashFlowScheduledItem(id);
  revalidatePath("/cash-flow");
  revalidatePath("/");

  const data = await getCashFlowPageDataAction();
  return { success: true, data };
}
