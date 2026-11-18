"use server";

import { revalidatePath } from "next/cache";
import {
  calculateFhssRelease,
  calculateDhoasEntitlement,
  calculateSouthAustraliaStampDuty,
  calculateVictoriaStampDuty,
} from "@/lib/australian-finance";
import { store, FhssContributionRecord } from "@/lib/store";

export type { FhssContributionRecord };

export interface PropertyGoalData {
  targetYear: number;
  targetCity: "Adelaide" | "Melbourne";
  targetPrice: number;
  depositPct: number;
  targetDepositAmount: number;
  currentCashSavings: number;
  monthlySavingsPace: number;
  stampDuty: number;
  conveyancingFees: number;
  totalRequiredCash: number;
  fhssReleaseEstimate: number;
  netGap: number;
  monthsUntil2029: number;
  requiredMonthlySavingsRate: number;
}

const LIQUID_ACCOUNT_TYPES = new Set(["checking", "savings", "offset"]);

export async function getPropertyGoalModelAction(): Promise<{
  goal: PropertyGoalData;
  fhss: ReturnType<typeof calculateFhssRelease>;
  dhoas: ReturnType<typeof calculateDhoasEntitlement>;
  contributions: FhssContributionRecord[];
}> {
  const [goalConfig, contributions, accounts] = await Promise.all([
    store.getPropertyGoalConfig(),
    store.getFhssContributions(),
    store.getAccounts(),
  ]);

  const currentCashSavings = Math.round(
    accounts
      .filter((a) => a.isActive && LIQUID_ACCOUNT_TYPES.has(a.accountType))
      .reduce((sum, a) => sum + (parseFloat(a.currentBalance) || 0), 0) * 100
  ) / 100;

  const fhss = calculateFhssRelease(contributions, 0.325);
  const dhoas = calculateDhoasEntitlement(goalConfig.enlistmentDate, "permanent");

  const stampDuty =
    goalConfig.targetCity === "Adelaide"
      ? calculateSouthAustraliaStampDuty(goalConfig.targetPrice, true)
      : calculateVictoriaStampDuty(goalConfig.targetPrice, true);

  const conveyancingFees = 3850;
  const targetDepositAmount = (goalConfig.targetPrice * goalConfig.depositPct) / 100;
  const totalRequiredCash = targetDepositAmount + stampDuty + conveyancingFees;
  const totalFundsAvailable = currentCashSavings + fhss.estimatedTotalReleaseAmount;
  const netGap = Math.max(0, totalRequiredCash - totalFundsAvailable);

  const monthsUntil2029 = Math.max(
    1,
    Math.round(
      (new Date("2029-07-01").getTime() - new Date().getTime()) /
        (1000 * 60 * 60 * 24 * 30.4)
    )
  );

  const requiredMonthlySavingsRate = Math.round(netGap / monthsUntil2029);

  return {
    goal: {
      targetYear: goalConfig.targetYear,
      targetCity: goalConfig.targetCity,
      targetPrice: goalConfig.targetPrice,
      depositPct: goalConfig.depositPct,
      targetDepositAmount,
      currentCashSavings,
      monthlySavingsPace: goalConfig.monthlySavingsPace,
      stampDuty,
      conveyancingFees,
      totalRequiredCash,
      fhssReleaseEstimate: Math.round(fhss.estimatedTotalReleaseAmount),
      netGap: Math.round(netGap),
      monthsUntil2029,
      requiredMonthlySavingsRate,
    },
    fhss,
    dhoas,
    contributions,
  };
}

export async function updatePropertyGoalAction(input: {
  targetCity: "Adelaide" | "Melbourne";
  targetPrice: number;
  depositPct: number;
}) {
  await store.updatePropertyGoalConfig(input);

  revalidatePath("/property-goals");
  revalidatePath("/");

  const data = await getPropertyGoalModelAction();
  return { success: true, data };
}

export async function addFhssContributionAction(input: {
  amount: number;
  financialYear: string;
  contributionType: "concessional" | "non_concessional";
  fundName: string;
  bpayRef?: string;
}) {
  const newRecord = await store.addFhssContribution(input);

  revalidatePath("/property-goals");
  revalidatePath("/");

  return { success: true, contribution: newRecord };
}
