/**
 * Specialized Australian Financial & Housing Scheme Calculation Engine
 * Encompasses FHSS (First Home Super Saver), DHOAS (Defence Home Ownership Assistance Scheme),
 * State Stamp Duty (SA & VIC), and Subscription Annualization.
 */

// ============================================================================
// 1. FHSS (FIRST HOME SUPER SAVER SCHEME)
// ============================================================================
export const FHSS_LIMITS = {
  ANNUAL_CONCESSIONAL_CAP: 15000, // $15,000 per financial year
  LIFETIME_CAP: 50000,            // $50,000 maximum release limit across all years
  SUPER_CONTRIBUTION_TAX_RATE: 0.15, // 15% tax on concessional super contributions
  DEFAULT_SIC_RATE: 0.0715,       // Shortfall Interest Charge deemed earnings rate (~7.15% p.a.)
};

export interface FhssCalculationResult {
  totalContributed: number;
  concessionalTotal: number;
  nonConcessionalTotal: number;
  eligibleConcessionalAmount: number; // 85% of concessional contributions after 15% super tax
  estimatedTaxSaved: number;          // Income tax saved at marginal rate vs 15% super tax
  estimatedDeemedEarnings: number;    // Compounded deemed SIC earnings
  estimatedTotalReleaseAmount: number; // Maximum withdrawable for home deposit
  remainingAnnualCap: number;
  remainingLifetimeCap: number;
}

export function getAustralianFinancialYear(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed (6 = July)
  if (month >= 6) {
    return `${year}-${String(year + 1).slice(-2)}`;
  }
  return `${year - 1}-${String(year).slice(-2)}`;
}

/**
 * Calculates FHSS scheme release amount, tax savings, and deemed earnings
 */
export function calculateFhssRelease(
  contributions: Array<{
    amount: number;
    contributionType: "concessional" | "non_concessional";
    date: string;
    financialYear: string;
  }>,
  marginalTaxRate: number = 0.325, // Default 32.5% marginal tax bracket
  currentFy?: string
): FhssCalculationResult {
  // Group contributions by financial year to enforce the $15,000/FY cap
  const fyGroups: Record<string, { concessional: number; nonConcessional: number }> = {};
  const fyTotals: Record<string, number> = {};

  for (const c of contributions) {
    if (c.amount <= 0) continue;
    const fy = c.financialYear;
    if (!fyGroups[fy]) {
      fyGroups[fy] = { concessional: 0, nonConcessional: 0 };
    }
    fyTotals[fy] = (fyTotals[fy] || 0) + c.amount;

    if (c.contributionType === "concessional") {
      fyGroups[fy].concessional += c.amount;
    } else {
      fyGroups[fy].nonConcessional += c.amount;
    }
  }

  let concessionalTotal = 0;
  let nonConcessionalTotal = 0;
  let remainingLifetime = FHSS_LIMITS.LIFETIME_CAP;

  for (const fy of Object.keys(fyGroups).sort()) {
    if (remainingLifetime <= 0) break;
    const group = fyGroups[fy];
    const fyConcessional = Math.min(
      group.concessional,
      FHSS_LIMITS.ANNUAL_CONCESSIONAL_CAP,
      remainingLifetime
    );
    remainingLifetime -= fyConcessional;

    const remainingAnnualRoom = Math.max(0, FHSS_LIMITS.ANNUAL_CONCESSIONAL_CAP - fyConcessional);
    const fyNonConcessional = Math.min(
      group.nonConcessional,
      remainingAnnualRoom,
      remainingLifetime
    );
    remainingLifetime -= fyNonConcessional;

    concessionalTotal += fyConcessional;
    nonConcessionalTotal += fyNonConcessional;
  }

  const totalContributed = Math.min(
    concessionalTotal + nonConcessionalTotal,
    FHSS_LIMITS.LIFETIME_CAP
  );
  const eligibleConcessional =
    concessionalTotal * (1 - FHSS_LIMITS.SUPER_CONTRIBUTION_TAX_RATE);

  // Marginal tax rate savings (e.g. 32.5% - 15% = 17.5% net tax saving)
  const taxSavingRate = Math.max(0, marginalTaxRate - FHSS_LIMITS.SUPER_CONTRIBUTION_TAX_RATE);
  const estimatedTaxSaved = concessionalTotal * taxSavingRate;

  // Deemed earnings approximation (compounded SIC rate over average 2 years)
  const estimatedDeemedEarnings =
    eligibleConcessional * (Math.pow(1 + FHSS_LIMITS.DEFAULT_SIC_RATE / 12, 24) - 1);

  // Total release amount
  const estimatedTotalReleaseAmount =
    eligibleConcessional + nonConcessionalTotal + estimatedDeemedEarnings;

  const derivedFy = getAustralianFinancialYear();
  const effectiveFy =
    currentFy ||
    (fyTotals[derivedFy] === undefined && fyTotals["2026-27"] !== undefined
      ? "2026-27"
      : derivedFy);
  const currentFyTotal = fyTotals[effectiveFy] || 0;

  return {
    totalContributed,
    concessionalTotal,
    nonConcessionalTotal,
    eligibleConcessionalAmount: eligibleConcessional,
    estimatedTaxSaved,
    estimatedDeemedEarnings,
    estimatedTotalReleaseAmount,
    remainingAnnualCap: Math.max(0, FHSS_LIMITS.ANNUAL_CONCESSIONAL_CAP - currentFyTotal),
    remainingLifetimeCap: Math.max(0, FHSS_LIMITS.LIFETIME_CAP - totalContributed),
  };
}

// ============================================================================
// 2. DHOAS (DEFENCE HOME OWNERSHIP ASSISTANCE SCHEME)
// ============================================================================
export interface DhoasTierInfo {
  tier: number;
  name: string;
  minYears: number;
  maxYears: number;
  subsidisedLoanCap: number; // Tier 1: $386k, Tier 2: $579k, Tier 3: $772k (AHP indexed)
  estimatedMonthlySubsidy: number; // Approximate monthly subsidy payment at current average interest rates
}

export const DHOAS_TIERS: Record<number, DhoasTierInfo> = {
  0: {
    tier: 0,
    name: "Ineligible (< 4 Years)",
    minYears: 0,
    maxYears: 4,
    subsidisedLoanCap: 0,
    estimatedMonthlySubsidy: 0,
  },
  1: {
    tier: 1,
    name: "Tier 1 (4 - 7 Years Service)",
    minYears: 4,
    maxYears: 8,
    subsidisedLoanCap: 386000,
    estimatedMonthlySubsidy: 395,
  },
  2: {
    tier: 2,
    name: "Tier 2 (8 - 11 Years Service)",
    minYears: 8,
    maxYears: 12,
    subsidisedLoanCap: 579000,
    estimatedMonthlySubsidy: 592,
  },
  3: {
    tier: 3,
    name: "Tier 3 (12+ Years Service)",
    minYears: 12,
    maxYears: 99,
    subsidisedLoanCap: 772000,
    estimatedMonthlySubsidy: 790,
  },
};

/**
 * Calculates current and projected 2029 DHOAS entitlement tiers
 */
export function calculateDhoasEntitlement(
  enlistmentDate: string,
  serviceType: "permanent" | "reserve" = "permanent"
): {
  currentServiceYears: number;
  currentTier: DhoasTierInfo;
  projected2029Years: number;
  projected2029Tier: DhoasTierInfo;
  annualSubsidyValue2029: number;
} {
  const start = new Date(enlistmentDate);
  const now = new Date();
  const target2029 = new Date("2029-07-01");

  const diffCurrentMs = now.getTime() - start.getTime();
  const currentServiceYears = Math.max(0, diffCurrentMs / (1000 * 60 * 60 * 24 * 365.25));

  const diff2029Ms = target2029.getTime() - start.getTime();
  const projected2029Years = Math.max(0, diff2029Ms / (1000 * 60 * 60 * 24 * 365.25));

  // Determine current tier
  let currentTierNumber = 0;
  if (currentServiceYears >= 12) currentTierNumber = 3;
  else if (currentServiceYears >= 8) currentTierNumber = 2;
  else if (currentServiceYears >= 4) currentTierNumber = 1;

  // Determine 2029 tier
  let projectedTierNumber = 0;
  if (projected2029Years >= 12) projectedTierNumber = 3;
  else if (projected2029Years >= 8) projectedTierNumber = 2;
  else if (projected2029Years >= 4) projectedTierNumber = 1;

  const currentTier = DHOAS_TIERS[currentTierNumber];
  const projected2029Tier = DHOAS_TIERS[projectedTierNumber];

  return {
    currentServiceYears: parseFloat(currentServiceYears.toFixed(1)),
    currentTier,
    projected2029Years: parseFloat(projected2029Years.toFixed(1)),
    projected2029Tier,
    annualSubsidyValue2029: projected2029Tier.estimatedMonthlySubsidy * 12,
  };
}

// ============================================================================
// 3. STAMP DUTY CALCULATORS (ADELAIDE / SA & MELBOURNE / VIC)
// ============================================================================
/**
 * South Australia (Adelaide) Stamp Duty calculation
 * (Note: SA offers first home buyer stamp duty relief on eligible new homes, with sliding scale on existing)
 */
export function calculateSouthAustraliaStampDuty(propertyPrice: number, isFirstHomeBuyer: boolean = true): number {
  if (propertyPrice <= 0) return 0;

  // SA standard residential scale:
  // Over $500,000: $21,330 + $5.50 per $100 over $500k
  if (propertyPrice > 500000) {
    const base = 21330;
    const excess = propertyPrice - 500000;
    return Math.round(base + (excess / 100) * 5.5);
  } else if (propertyPrice > 300000) {
    const base = 11330;
    const excess = propertyPrice - 300000;
    return Math.round(base + (excess / 100) * 5.0);
  } else {
    return Math.round((propertyPrice / 100) * 3.8);
  }
}

/**
 * Victoria (Melbourne) Stamp Duty calculation
 * (Note: VIC First Home Buyer duty exemption up to $600k, concession up to $750k)
 */
export function calculateVictoriaStampDuty(propertyPrice: number, isFirstHomeBuyer: boolean = true): number {
  if (propertyPrice <= 0) return 0;

  if (isFirstHomeBuyer) {
    if (propertyPrice <= 600000) return 0; // 100% exempt under $600k
    if (propertyPrice <= 750000) {
      // Concession sliding scale between $600k and $750k
      const standardDuty = calculateVictoriaStampDuty(propertyPrice, false);
      const concessionDiscount = (750000 - propertyPrice) / 150000;
      return Math.round(standardDuty * (1 - concessionDiscount));
    }
  }

  // Standard VIC duty scale:
  // Over $960,000: 5.5%
  // $440k to $960k: $18,070 + 6% over $440k
  if (propertyPrice > 440000) {
    const base = 18070;
    const excess = propertyPrice - 440000;
    return Math.round(base + excess * 0.06);
  } else {
    return Math.round(propertyPrice * 0.04);
  }
}

// ============================================================================
// 4. SUBSCRIPTION ANNUALIZATION
// ============================================================================
export function calculateAnnualizedSubscriptionCost(
  amount: number,
  billingCycle: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annually"
): number {
  switch (billingCycle) {
    case "weekly":
      return Math.round(amount * 52 * 100) / 100;
    case "fortnightly":
      return Math.round(amount * 26 * 100) / 100;
    case "monthly":
      return Math.round(amount * 12 * 100) / 100;
    case "quarterly":
      return Math.round(amount * 4 * 100) / 100;
    case "annually":
      return Math.round(amount * 100) / 100;
    default:
      return Math.round(amount * 12 * 100) / 100;
  }
}
