/**
 * Specialized Australian Financial & Housing Scheme Calculation Engine
 * Encompasses FHSS (First Home Super Saver), DHOAS (Defence Home Ownership Assistance Scheme),
 * State Stamp Duty (All Australian States & Territories + Custom), and Subscription Annualization.
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
export type DhoasConfigMode = "auto" | "tier1" | "tier2" | "tier3" | "custom";

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

export interface DhoasCalculationOptions {
  mode?: DhoasConfigMode;
  customMonthlySubsidy?: number | null;
  customLoanCap?: number | null;
  lumpSumAmount?: number;
}

export interface DhoasCalculationResult {
  currentServiceYears: number;
  currentTier: DhoasTierInfo;
  targetYear: number;
  projectedYears: number;
  projectedTier: DhoasTierInfo;
  effectiveMonthlySubsidy: number;
  effectiveLoanCap: number;
  annualSubsidyValue: number;
  lumpSumAmount: number;
  mode: DhoasConfigMode;
  serviceType: "permanent" | "reserve";
  // Backwards-compatible aliases
  projected2029Years: number;
  projected2029Tier: DhoasTierInfo;
  annualSubsidyValue2029: number;
}

/**
 * Calculates current and projected DHOAS entitlement tiers for a configurable target date
 * and optional manual tier/subsidy/loan-cap/lump-sum overrides.
 */
export function calculateDhoasEntitlement(
  enlistmentDate: string,
  serviceType: "permanent" | "reserve" = "permanent",
  targetDate: string = "2029-07-01",
  options?: DhoasCalculationOptions
): DhoasCalculationResult {
  const now = new Date();
  const parsedStart = new Date(enlistmentDate);
  const start = isNaN(parsedStart.getTime()) ? now : parsedStart;

  const parsedTarget = new Date(targetDate);
  const target = isNaN(parsedTarget.getTime()) ? new Date("2029-07-01") : parsedTarget;

  const diffCurrentMs = now.getTime() - start.getTime();
  const currentServiceYears = Math.max(0, diffCurrentMs / (1000 * 60 * 60 * 24 * 365.25));

  const diffTargetMs = target.getTime() - start.getTime();
  const projectedYears = Math.max(0, diffTargetMs / (1000 * 60 * 60 * 24 * 365.25));

  // Determine current tier from service accrual
  let currentTierNumber = 0;
  if (currentServiceYears >= 12) currentTierNumber = 3;
  else if (currentServiceYears >= 8) currentTierNumber = 2;
  else if (currentServiceYears >= 4) currentTierNumber = 1;

  const mode: DhoasConfigMode = options?.mode ?? "auto";
  let projectedTier: DhoasTierInfo;

  if (mode === "tier1") {
    projectedTier = DHOAS_TIERS[1];
  } else if (mode === "tier2") {
    projectedTier = DHOAS_TIERS[2];
  } else if (mode === "tier3") {
    projectedTier = DHOAS_TIERS[3];
  } else if (mode === "custom") {
    projectedTier = {
      tier: 0,
      name: "Custom DHOAS Amount",
      minYears: 0,
      maxYears: 99,
      subsidisedLoanCap: Math.max(0, options?.customLoanCap ?? 0),
      estimatedMonthlySubsidy: Math.max(0, options?.customMonthlySubsidy ?? 0),
    };
  } else {
    let projectedTierNumber = 0;
    if (projectedYears >= 12) projectedTierNumber = 3;
    else if (projectedYears >= 8) projectedTierNumber = 2;
    else if (projectedYears >= 4) projectedTierNumber = 1;
    projectedTier = DHOAS_TIERS[projectedTierNumber];
  }

  const effectiveMonthlySubsidy =
    options?.customMonthlySubsidy != null && Number.isFinite(options.customMonthlySubsidy)
      ? Math.max(0, options.customMonthlySubsidy)
      : projectedTier.estimatedMonthlySubsidy;

  const effectiveLoanCap =
    options?.customLoanCap != null && Number.isFinite(options.customLoanCap)
      ? Math.max(0, options.customLoanCap)
      : projectedTier.subsidisedLoanCap;

  const annualSubsidyValue = Math.round(effectiveMonthlySubsidy * 12);
  const lumpSumAmount = Math.max(0, options?.lumpSumAmount ?? 0);
  const roundedProjectedYears = parseFloat(projectedYears.toFixed(1));
  const currentTier = DHOAS_TIERS[currentTierNumber];

  return {
    currentServiceYears: parseFloat(currentServiceYears.toFixed(1)),
    currentTier,
    targetYear: target.getFullYear(),
    projectedYears: roundedProjectedYears,
    projectedTier,
    effectiveMonthlySubsidy,
    effectiveLoanCap,
    annualSubsidyValue,
    lumpSumAmount,
    mode,
    serviceType,
    projected2029Years: roundedProjectedYears,
    projected2029Tier: projectedTier,
    annualSubsidyValue2029: annualSubsidyValue,
  };
}

// ============================================================================
// 3. AUSTRALIAN STATE/TERRITORY & CUSTOM LOCATION STAMP DUTY CALCULATORS
// ============================================================================
export type AustralianStateCode = "NSW" | "VIC" | "QLD" | "SA" | "WA" | "TAS" | "ACT" | "NT";
export type PropertyLocationCode = AustralianStateCode | "CUSTOM";

export interface AustralianStateInfo {
  code: AustralianStateCode;
  name: string;
  defaultCity: string;
  defaultPrice: number;
  fhbNote: string;
}

export const AUSTRALIAN_STATES: AustralianStateInfo[] = [
  {
    code: "NSW",
    name: "New South Wales",
    defaultCity: "Sydney",
    defaultPrice: 1100000,
    fhbNote: "FHB exempt up to $800k, concessional sliding scale to $1M",
  },
  {
    code: "VIC",
    name: "Victoria",
    defaultCity: "Melbourne",
    defaultPrice: 950000,
    fhbNote: "FHB exempt up to $600k, concessional sliding scale to $750k",
  },
  {
    code: "QLD",
    name: "Queensland",
    defaultCity: "Brisbane",
    defaultPrice: 880000,
    fhbNote: "FHB exempt up to $700k, concessional sliding scale to $800k",
  },
  {
    code: "SA",
    name: "South Australia",
    defaultCity: "Adelaide",
    defaultPrice: 850000,
    fhbNote: "Standard residential scale modeled; eligible new FHB homes may qualify for full relief",
  },
  {
    code: "WA",
    name: "Western Australia",
    defaultCity: "Perth",
    defaultPrice: 780000,
    fhbNote: "FHB exempt up to $450k, concessional sliding scale to $600k",
  },
  {
    code: "TAS",
    name: "Tasmania",
    defaultCity: "Hobart",
    defaultPrice: 720000,
    fhbNote: "FHB exempt on eligible established homes up to $750k",
  },
  {
    code: "ACT",
    name: "Australian Capital Territory",
    defaultCity: "Canberra",
    defaultPrice: 920000,
    fhbNote: "Home Buyer Concession Scheme exempt up to $1M (income-tested)",
  },
  {
    code: "NT",
    name: "Northern Territory",
    defaultCity: "Darwin",
    defaultPrice: 600000,
    fhbNote: "NT residential conveyance scale applied",
  },
];

export function isAustralianStateCode(value: string): value is AustralianStateCode {
  return AUSTRALIAN_STATES.some((s) => s.code === value);
}

export function getAustralianStateInfo(code: AustralianStateCode): AustralianStateInfo {
  return AUSTRALIAN_STATES.find((s) => s.code === code) || AUSTRALIAN_STATES[3];
}

export function getLocationDisplayLabel(
  locationCode: PropertyLocationCode,
  targetCity?: string | null
): string {
  const trimmed = targetCity?.trim() || "";
  if (locationCode === "CUSTOM") {
    return trimmed || "Custom Location";
  }
  const state = getAustralianStateInfo(locationCode);
  const city = trimmed || state.defaultCity;
  if (
    city.toUpperCase().endsWith(`, ${locationCode}`) ||
    city.toUpperCase().endsWith(`(${locationCode})`)
  ) {
    return city;
  }
  return `${city}, ${locationCode}`;
}

/**
 * New South Wales (Sydney) Stamp Duty calculation
 */
export function calculateNewSouthWalesStampDuty(
  propertyPrice: number,
  isFirstHomeBuyer: boolean = true
): number {
  if (propertyPrice <= 0) return 0;

  let standardDuty = 0;
  if (propertyPrice <= 17000) {
    standardDuty = Math.round(propertyPrice * 0.0125);
  } else if (propertyPrice <= 36000) {
    standardDuty = Math.round(212 + (propertyPrice - 17000) * 0.015);
  } else if (propertyPrice <= 97000) {
    standardDuty = Math.round(497 + (propertyPrice - 36000) * 0.0175);
  } else if (propertyPrice <= 364000) {
    standardDuty = Math.round(1564 + (propertyPrice - 97000) * 0.035);
  } else if (propertyPrice <= 1212000) {
    standardDuty = Math.round(10909 + (propertyPrice - 364000) * 0.045);
  } else {
    standardDuty = Math.round(49069 + (propertyPrice - 1212000) * 0.055);
  }

  if (isFirstHomeBuyer) {
    if (propertyPrice <= 800000) return 0;
    if (propertyPrice <= 1000000) {
      return Math.round(standardDuty * ((propertyPrice - 800000) / 200000));
    }
  }

  return standardDuty;
}

/**
 * Queensland (Brisbane) Stamp Duty calculation
 */
export function calculateQueenslandStampDuty(
  propertyPrice: number,
  isFirstHomeBuyer: boolean = true
): number {
  if (propertyPrice <= 0) return 0;

  let standardDuty = 0;
  if (propertyPrice <= 350000) {
    standardDuty = Math.round(propertyPrice * 0.01);
  } else if (propertyPrice <= 540000) {
    standardDuty = Math.round(3500 + (propertyPrice - 350000) * 0.035);
  } else if (propertyPrice <= 1000000) {
    standardDuty = Math.round(10150 + (propertyPrice - 540000) * 0.045);
  } else {
    standardDuty = Math.round(30850 + (propertyPrice - 1000000) * 0.0575);
  }

  if (isFirstHomeBuyer) {
    if (propertyPrice <= 700000) return 0;
    if (propertyPrice <= 800000) {
      return Math.round(standardDuty * ((propertyPrice - 700000) / 100000));
    }
  }

  return standardDuty;
}

/**
 * South Australia (Adelaide) Stamp Duty calculation
 * (Note: SA offers first home buyer stamp duty relief on eligible new homes, with sliding scale on existing)
 */
export function calculateSouthAustraliaStampDuty(
  propertyPrice: number,
  isFirstHomeBuyer: boolean = true
): number {
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
export function calculateVictoriaStampDuty(
  propertyPrice: number,
  isFirstHomeBuyer: boolean = true
): number {
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

/**
 * Western Australia (Perth) Stamp Duty calculation
 */
export function calculateWesternAustraliaStampDuty(
  propertyPrice: number,
  isFirstHomeBuyer: boolean = true
): number {
  if (propertyPrice <= 0) return 0;

  let standardDuty = 0;
  if (propertyPrice <= 120000) {
    standardDuty = Math.round(propertyPrice * 0.019);
  } else if (propertyPrice <= 150000) {
    standardDuty = Math.round(2280 + (propertyPrice - 120000) * 0.0285);
  } else if (propertyPrice <= 360000) {
    standardDuty = Math.round(3135 + (propertyPrice - 150000) * 0.038);
  } else if (propertyPrice <= 725000) {
    standardDuty = Math.round(11115 + (propertyPrice - 360000) * 0.0475);
  } else {
    standardDuty = Math.round(28453 + (propertyPrice - 725000) * 0.0515);
  }

  if (isFirstHomeBuyer) {
    if (propertyPrice <= 450000) return 0;
    if (propertyPrice <= 600000) {
      return Math.min(standardDuty, Math.round(((propertyPrice - 450000) / 100) * 15.01));
    }
  }

  return standardDuty;
}

/**
 * Tasmania (Hobart) Stamp Duty calculation
 */
export function calculateTasmaniaStampDuty(
  propertyPrice: number,
  isFirstHomeBuyer: boolean = true
): number {
  if (propertyPrice <= 0) return 0;

  if (isFirstHomeBuyer && propertyPrice <= 750000) {
    return 0;
  }

  if (propertyPrice <= 3000) return 50;
  if (propertyPrice <= 25000) return Math.round(50 + (propertyPrice - 3000) * 0.0175);
  if (propertyPrice <= 75000) return Math.round(435 + (propertyPrice - 25000) * 0.0225);
  if (propertyPrice <= 200000) return Math.round(1560 + (propertyPrice - 75000) * 0.035);
  if (propertyPrice <= 375000) return Math.round(5935 + (propertyPrice - 200000) * 0.04);
  if (propertyPrice <= 725000) return Math.round(12935 + (propertyPrice - 375000) * 0.0425);
  return Math.round(27810 + (propertyPrice - 725000) * 0.045);
}

/**
 * Australian Capital Territory (Canberra) Stamp Duty calculation
 */
export function calculateActStampDuty(
  propertyPrice: number,
  isFirstHomeBuyer: boolean = true
): number {
  if (propertyPrice <= 0) return 0;

  if (isFirstHomeBuyer && propertyPrice <= 1000000) {
    return 0;
  }

  if (propertyPrice <= 260000) return Math.round(propertyPrice * 0.0049);
  if (propertyPrice <= 300000) return Math.round(1274 + (propertyPrice - 260000) * 0.022);
  if (propertyPrice <= 500000) return Math.round(2154 + (propertyPrice - 300000) * 0.034);
  if (propertyPrice <= 750000) return Math.round(8954 + (propertyPrice - 500000) * 0.0432);
  if (propertyPrice <= 1000000) return Math.round(19754 + (propertyPrice - 750000) * 0.059);
  if (propertyPrice <= 1455000) return Math.round(34504 + (propertyPrice - 1000000) * 0.064);
  return Math.round(propertyPrice * 0.0454);
}

/**
 * Northern Territory (Darwin) Stamp Duty calculation
 */
export function calculateNorthernTerritoryStampDuty(
  propertyPrice: number,
  _isFirstHomeBuyer: boolean = true
): number {
  if (propertyPrice <= 0) return 0;

  if (propertyPrice <= 525000) {
    const v = propertyPrice / 1000;
    return Math.round(0.06571441 * v * v + 15 * v);
  }
  if (propertyPrice <= 3000000) {
    return Math.round(propertyPrice * 0.0495);
  }
  return Math.round(propertyPrice * 0.0575);
}

/**
 * Unified stamp duty / transfer tax calculator across all Australian states & territories
 * as well as custom non-Australian locations (optional manual override).
 */
export function calculateStampDuty(
  locationCode: PropertyLocationCode,
  propertyPrice: number,
  isFirstHomeBuyer: boolean = true,
  customStampDuty?: number | null
): number {
  if (customStampDuty !== null && customStampDuty !== undefined && Number.isFinite(customStampDuty)) {
    return Math.max(0, Math.round(customStampDuty));
  }
  if (locationCode === "CUSTOM" || propertyPrice <= 0) {
    return 0;
  }

  switch (locationCode) {
    case "NSW":
      return calculateNewSouthWalesStampDuty(propertyPrice, isFirstHomeBuyer);
    case "VIC":
      return calculateVictoriaStampDuty(propertyPrice, isFirstHomeBuyer);
    case "QLD":
      return calculateQueenslandStampDuty(propertyPrice, isFirstHomeBuyer);
    case "SA":
      return calculateSouthAustraliaStampDuty(propertyPrice, isFirstHomeBuyer);
    case "WA":
      return calculateWesternAustraliaStampDuty(propertyPrice, isFirstHomeBuyer);
    case "TAS":
      return calculateTasmaniaStampDuty(propertyPrice, isFirstHomeBuyer);
    case "ACT":
      return calculateActStampDuty(propertyPrice, isFirstHomeBuyer);
    case "NT":
      return calculateNorthernTerritoryStampDuty(propertyPrice, isFirstHomeBuyer);
    default:
      return 0;
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
