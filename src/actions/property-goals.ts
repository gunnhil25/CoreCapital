"use server";

import { revalidatePath } from "next/cache";
import {
  calculateFhssRelease,
  calculateDhoasEntitlement,
  calculateStampDuty,
  DhoasCalculationResult,
  DhoasConfigMode,
  getAustralianStateInfo,
  getLocationDisplayLabel,
  isAustralianStateCode,
  PropertyLocationCode,
} from "@/lib/australian-finance";
import { store, FhssContributionRecord } from "@/lib/store";

export type { FhssContributionRecord };

export interface PropertyGoalData {
  goalName: string;
  targetDate: string;
  targetYear: number;
  locationCode: PropertyLocationCode;
  targetCity: string;
  customLocationName: string | null;
  locationLabel: string;
  isFirstHomeBuyer: boolean;
  targetPrice: number;
  depositPct: number;
  targetDepositAmount: number;
  stampDuty: number;
  customStampDuty: number | null;
  conveyancingFees: number;
  estimatedLmi: number;
  totalRequiredCash: number;
  useLiveLiquidSavings: boolean;
  currentSavingsAllocated: number;
  liveLiquidAccountSavings: number;
  currentCashSavings: number;
  monthlySavingsPace: number;
  useFhss: boolean;
  fhssMarginalTaxRatePct: number;
  fhssReleaseEstimate: number;
  useDhoas: boolean;
  dhoasMode: DhoasConfigMode;
  dhoasEnlistmentDate: string;
  dhoasServiceType: "permanent" | "reserve";
  dhoasMonthlySubsidy: number | null;
  dhoasLoanCap: number | null;
  dhoasLumpSumAmount: number;
  totalCapitalReady: number;
  netGap: number;
  monthsUntilTarget: number;
  isTargetDatePast: boolean;
  requiredMonthlySavingsRate: number;
  notes: string | null;
}

export interface PropertyGoalModelResponse {
  hasGoal: boolean;
  goal: PropertyGoalData | null;
  liveLiquidAccountSavings: number;
  baseCurrency: string;
  fhss: ReturnType<typeof calculateFhssRelease>;
  dhoas: DhoasCalculationResult | null;
  contributions: FhssContributionRecord[];
}

export interface SavePropertyGoalInput {
  goalName: string;
  targetDate: string;
  locationCode: PropertyLocationCode;
  targetCity?: string;
  customLocationName?: string | null;
  isFirstHomeBuyer: boolean;
  targetPrice: number;
  depositPct: number;
  customStampDuty?: number | null;
  conveyancingFees: number;
  estimatedLmi: number;
  useLiveLiquidSavings: boolean;
  currentSavingsAllocated: number;
  monthlySavingsPace: number;
  useFhss: boolean;
  fhssMarginalTaxRatePct: number;
  useDhoas: boolean;
  dhoasMode: DhoasConfigMode;
  dhoasEnlistmentDate: string;
  dhoasServiceType: "permanent" | "reserve";
  dhoasMonthlySubsidy?: number | null;
  dhoasLoanCap?: number | null;
  dhoasLumpSumAmount: number;
  notes?: string | null;
}

const LIQUID_ACCOUNT_TYPES = new Set(["checking", "savings", "offset"]);
const VALID_DHOAS_MODES = new Set<DhoasConfigMode>([
  "auto",
  "tier1",
  "tier2",
  "tier3",
  "custom",
]);

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

export async function getPropertyGoalModelAction(): Promise<PropertyGoalModelResponse> {
  const [goalConfig, contributions, accounts, activeUserId] = await Promise.all([
    store.getPropertyGoalConfig(),
    store.getFhssContributions(),
    store.getAccounts(),
    store.getVerifiedSessionUserId(),
  ]);

  const activeUser = activeUserId ? await store.getUserById(activeUserId) : undefined;
  const baseCurrency = activeUser?.baseCurrency || "AUD";

  const liveLiquidAccountSavings =
    Math.round(
      accounts
        .filter((a) => a.isActive && LIQUID_ACCOUNT_TYPES.has(a.accountType))
        .reduce((sum, a) => sum + (parseFloat(a.currentBalance) || 0), 0) * 100
    ) / 100;

  if (!goalConfig) {
    return {
      hasGoal: false,
      goal: null,
      liveLiquidAccountSavings,
      baseCurrency,
      fhss: calculateFhssRelease(contributions, 0.325),
      dhoas: null,
      contributions,
    };
  }

  const fhss = calculateFhssRelease(
    contributions,
    Math.max(0, goalConfig.fhssMarginalTaxRatePct) / 100
  );

  const dhoas = goalConfig.useDhoas
    ? calculateDhoasEntitlement(
        goalConfig.dhoasEnlistmentDate || "2021-03-01",
        goalConfig.dhoasServiceType,
        goalConfig.targetDate,
        {
          mode: goalConfig.dhoasMode,
          customMonthlySubsidy: goalConfig.dhoasMonthlySubsidy,
          customLoanCap: goalConfig.dhoasLoanCap,
          lumpSumAmount: goalConfig.dhoasLumpSumAmount,
        }
      )
    : null;

  const stampDuty = calculateStampDuty(
    goalConfig.locationCode,
    goalConfig.targetPrice,
    goalConfig.isFirstHomeBuyer,
    goalConfig.customStampDuty
  );

  const targetDepositAmount =
    Math.round(((goalConfig.targetPrice * goalConfig.depositPct) / 100) * 100) / 100;
  const totalRequiredCash =
    Math.round(
      (targetDepositAmount +
        stampDuty +
        goalConfig.conveyancingFees +
        goalConfig.estimatedLmi) *
        100
    ) / 100;

  const currentCashSavings = goalConfig.useLiveLiquidSavings
    ? liveLiquidAccountSavings
    : goalConfig.currentSavingsAllocated;

  const fhssReleaseAmount = goalConfig.useFhss ? fhss.estimatedTotalReleaseAmount : 0;
  const fhssReleaseEstimate = Math.round(fhssReleaseAmount);
  const dhoasLumpSumAmount = goalConfig.useDhoas
    ? Math.max(0, goalConfig.dhoasLumpSumAmount)
    : 0;

  const totalCapitalReady =
    Math.round((currentCashSavings + fhssReleaseAmount + dhoasLumpSumAmount) * 100) / 100;
  const netGap = Math.max(0, totalRequiredCash - totalCapitalReady);

  const targetTimestamp = new Date(`${goalConfig.targetDate}T00:00:00`).getTime();
  const rawMonths = isNaN(targetTimestamp)
    ? 1
    : Math.round((targetTimestamp - Date.now()) / (1000 * 60 * 60 * 24 * 30.4375));
  const isTargetDatePast = rawMonths <= 0;
  const monthsUntilTarget = Math.max(1, rawMonths);
  const requiredMonthlySavingsRate = Math.round(netGap / monthsUntilTarget);

  const locationLabel = getLocationDisplayLabel(
    goalConfig.locationCode,
    goalConfig.locationCode === "CUSTOM"
      ? goalConfig.customLocationName || goalConfig.targetCity
      : goalConfig.targetCity
  );

  return {
    hasGoal: true,
    goal: {
      goalName: goalConfig.goalName,
      targetDate: goalConfig.targetDate,
      targetYear: goalConfig.targetYear,
      locationCode: goalConfig.locationCode,
      targetCity: goalConfig.targetCity,
      customLocationName: goalConfig.customLocationName ?? null,
      locationLabel,
      isFirstHomeBuyer: goalConfig.isFirstHomeBuyer,
      targetPrice: goalConfig.targetPrice,
      depositPct: goalConfig.depositPct,
      targetDepositAmount,
      stampDuty,
      customStampDuty: goalConfig.customStampDuty,
      conveyancingFees: goalConfig.conveyancingFees,
      estimatedLmi: goalConfig.estimatedLmi,
      totalRequiredCash,
      useLiveLiquidSavings: goalConfig.useLiveLiquidSavings,
      currentSavingsAllocated: goalConfig.currentSavingsAllocated,
      liveLiquidAccountSavings,
      currentCashSavings,
      monthlySavingsPace: goalConfig.monthlySavingsPace,
      useFhss: goalConfig.useFhss,
      fhssMarginalTaxRatePct: goalConfig.fhssMarginalTaxRatePct,
      fhssReleaseEstimate,
      useDhoas: goalConfig.useDhoas,
      dhoasMode: goalConfig.dhoasMode,
      dhoasEnlistmentDate: goalConfig.dhoasEnlistmentDate,
      dhoasServiceType: goalConfig.dhoasServiceType,
      dhoasMonthlySubsidy: goalConfig.dhoasMonthlySubsidy,
      dhoasLoanCap: goalConfig.dhoasLoanCap,
      dhoasLumpSumAmount,
      totalCapitalReady,
      netGap: Math.round(netGap),
      monthsUntilTarget,
      isTargetDatePast,
      requiredMonthlySavingsRate,
      notes: goalConfig.notes ?? null,
    },
    liveLiquidAccountSavings,
    baseCurrency,
    fhss,
    dhoas,
    contributions,
  };
}

export async function savePropertyGoalAction(input: SavePropertyGoalInput): Promise<{
  success: boolean;
  error?: string;
  data?: PropertyGoalModelResponse;
}> {
  if (!Number.isFinite(input.targetPrice) || input.targetPrice <= 0) {
    return { success: false, error: "Target property price must be greater than zero." };
  }
  if (!Number.isFinite(input.depositPct) || input.depositPct < 0 || input.depositPct > 100) {
    return { success: false, error: "Target deposit percentage must be between 0% and 100%." };
  }
  if (!isValidIsoDate(input.targetDate)) {
    return { success: false, error: "Please select a valid target purchase date (YYYY-MM-DD)." };
  }
  if (input.locationCode !== "CUSTOM" && !isAustralianStateCode(input.locationCode)) {
    return { success: false, error: "Invalid property location selected." };
  }
  if (!VALID_DHOAS_MODES.has(input.dhoasMode)) {
    return { success: false, error: "Invalid DHOAS configuration mode." };
  }

  const nonNegativePairs: Array<[string, number]> = [
    ["Conveyancing & closing fees", input.conveyancingFees],
    ["Estimated LMI", input.estimatedLmi],
    ["Allocated savings", input.currentSavingsAllocated],
    ["Planned monthly savings", input.monthlySavingsPace],
    ["DHOAS lump sum amount", input.dhoasLumpSumAmount],
  ];
  for (const [label, value] of nonNegativePairs) {
    if (!Number.isFinite(value) || value < 0) {
      return { success: false, error: `${label} must be a non-negative number.` };
    }
  }

  if (
    !Number.isFinite(input.fhssMarginalTaxRatePct) ||
    input.fhssMarginalTaxRatePct < 0 ||
    input.fhssMarginalTaxRatePct > 60
  ) {
    return {
      success: false,
      error: "FHSS marginal tax rate must be between 0% and 60%.",
    };
  }

  if (
    input.customStampDuty != null &&
    (!Number.isFinite(input.customStampDuty) || input.customStampDuty < 0)
  ) {
    return { success: false, error: "Custom stamp duty / transfer tax cannot be negative." };
  }
  if (
    input.dhoasMonthlySubsidy != null &&
    (!Number.isFinite(input.dhoasMonthlySubsidy) || input.dhoasMonthlySubsidy < 0)
  ) {
    return { success: false, error: "DHOAS monthly subsidy amount cannot be negative." };
  }
  if (
    input.dhoasLoanCap != null &&
    (!Number.isFinite(input.dhoasLoanCap) || input.dhoasLoanCap < 0)
  ) {
    return { success: false, error: "DHOAS subsidised loan cap cannot be negative." };
  }

  const targetYear = parseInt(input.targetDate.slice(0, 4), 10);
  const rawCity = input.targetCity?.trim() || "";
  const rawCustom = input.customLocationName?.trim() || "";

  const normalizedCity =
    input.locationCode === "CUSTOM"
      ? rawCustom || rawCity || "Custom Location"
      : rawCity || getAustralianStateInfo(input.locationCode).defaultCity;

  const normalizedCustomName =
    input.locationCode === "CUSTOM" ? rawCustom || rawCity || "Custom Location" : null;

  const enlistmentDate =
    input.dhoasEnlistmentDate && isValidIsoDate(input.dhoasEnlistmentDate)
      ? input.dhoasEnlistmentDate
      : "2021-03-01";

  try {
    await store.savePropertyGoalConfig({
      goalName: input.goalName.trim() || "Mortgage Deposit Goal",
      targetDate: input.targetDate,
      targetYear,
      locationCode: input.locationCode,
      targetCity: normalizedCity,
      customLocationName: normalizedCustomName,
      isFirstHomeBuyer: input.locationCode === "CUSTOM" ? false : Boolean(input.isFirstHomeBuyer),
      targetPrice: Math.round(input.targetPrice * 100) / 100,
      depositPct: Math.round(input.depositPct * 100) / 100,
      customStampDuty:
        input.customStampDuty != null ? Math.round(input.customStampDuty * 100) / 100 : null,
      conveyancingFees: Math.round(input.conveyancingFees * 100) / 100,
      estimatedLmi: Math.round(input.estimatedLmi * 100) / 100,
      useLiveLiquidSavings: Boolean(input.useLiveLiquidSavings),
      currentSavingsAllocated: Math.round(input.currentSavingsAllocated * 100) / 100,
      monthlySavingsPace: Math.round(input.monthlySavingsPace * 100) / 100,
      useFhss: Boolean(input.useFhss),
      fhssMarginalTaxRatePct: Math.round(input.fhssMarginalTaxRatePct * 100) / 100,
      useDhoas: Boolean(input.useDhoas),
      dhoasMode: input.dhoasMode,
      dhoasEnlistmentDate: enlistmentDate,
      dhoasServiceType: input.dhoasServiceType === "reserve" ? "reserve" : "permanent",
      dhoasMonthlySubsidy:
        input.dhoasMonthlySubsidy != null
          ? Math.round(input.dhoasMonthlySubsidy * 100) / 100
          : null,
      dhoasLoanCap:
        input.dhoasLoanCap != null ? Math.round(input.dhoasLoanCap * 100) / 100 : null,
      dhoasLumpSumAmount: Math.round(input.dhoasLumpSumAmount * 100) / 100,
      notes: input.notes?.trim() || null,
    });

    revalidatePath("/property-goals");
    revalidatePath("/");

    const data = await getPropertyGoalModelAction();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save property goal.",
    };
  }
}

export async function deletePropertyGoalAction(): Promise<{
  success: boolean;
  error?: string;
  data?: PropertyGoalModelResponse;
}> {
  try {
    await store.deletePropertyGoalConfig();
    revalidatePath("/property-goals");
    revalidatePath("/");

    const data = await getPropertyGoalModelAction();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to remove property goal.",
    };
  }
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

  const data = await getPropertyGoalModelAction();
  return { success: true, contribution: newRecord, data };
}

export async function deleteFhssContributionAction(id: string): Promise<{
  success: boolean;
  error?: string;
  data?: PropertyGoalModelResponse;
}> {
  try {
    await store.deleteFhssContribution(id);
    revalidatePath("/property-goals");
    revalidatePath("/");

    const data = await getPropertyGoalModelAction();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to remove FHSS contribution.",
    };
  }
}
