import crypto from "crypto";
import path from "path";
import { desc, eq, asc, and, sql, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, checkDbConnection } from "@/db";
import {
  users,
  accounts,
  categories,
  classificationRules,
  importBatches,
  transactions,
  ledgerEntries,
  auditLogs,
  budgets,
  subscriptions,
  cashFlowScheduledItems,
  propertyGoals,
  fhssContributions,
} from "@/db/schema";
import { defaultAccounts, defaultCategories, defaultRules } from "./initial-data";
import { computeDeduplicationHash } from "./csv-engine";
import {
  calculateAnnualizedSubscriptionCost,
  calculateStampDuty,
  DhoasConfigMode,
  isAustralianStateCode,
  PropertyLocationCode,
} from "./australian-finance";
import { getSessionPayload, hashPassword } from "./auth";
import { formatCategoryDisplayLabel } from "./category-utils";

export const DEFAULT_USER_ID = "usr-00000000-0000-0000-0000-000000000000";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deterministically converts non-UUID string identifiers (e.g. "cat-1", "tx-1")
 * into valid RFC-4122 UUIDs for PostgreSQL uuid columns. Passes valid UUIDs through unchanged.
 */
export function toUuid(id: string): string {
  if (UUID_REGEX.test(id)) return id.toLowerCase();
  const hex = crypto.createHash("sha256").update(id).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: "admin" | "user";
  isActive: boolean;
  sessionVersion: number;
  baseCurrency: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountRecord {
  id: string;
  userId: string;
  name: string;
  institution: string;
  accountType: string;
  accountNumberLast4: string;
  currency: string;
  currentBalance: string;
  isOffsetAccount: boolean;
  interestRatePct: string;
  isActive: boolean;
}

export interface CategoryRecord {
  id: string;
  userId: string;
  name: string;
  slug: string;
  parentId: string | null;
  type: string;
  color: string;
  icon: string;
  sortOrder: number;
}

export interface RuleRecord {
  id: string;
  userId: string;
  name: string;
  priority: number;
  field: string;
  matchType: string;
  matchValue: string;
  targetCategoryId: string;
  autoApply: boolean;
  isActive: boolean;
  matchCount: number;
}

export interface TransactionWithLedger {
  id: string;
  userId: string;
  accountId: string;
  accountName?: string;
  importBatchId?: string | null;
  date: string;
  postedDate?: string | null;
  amount: string; // numeric(12, 2)
  currency: string;
  merchant?: string | null;
  cleanDescription: string;
  rawDescription: string;
  status: "pending" | "posted" | "reversed";
  isSplit: boolean;
  isReversal: boolean;
  reversesTransactionId?: string | null;
  reversalReason?: string | null;
  deduplicationHash?: string | null;
  notes?: string | null;
  createdAt: string;
  ledgerEntries: {
    id: string;
    transactionId: string;
    accountId: string;
    categoryId?: string | null;
    categoryName?: string;
    categoryColor?: string;
    entryType: "debit" | "credit";
    amount: string;
    description?: string | null;
    isReversal: boolean;
    reversedEntryId?: string | null;
    sequenceIndex: number;
  }[];
}

export interface BudgetItem {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  parentCategoryId: string | null;
  parentCategoryName: string | null;
  alertThresholdPct: number;
  period: "monthly" | "weekly" | "yearly";
  allocatedAmount: number;
  spentAmount: number;
  remainingAmount: number;
  percentageSpent: number;
  status: "normal" | "warning" | "overrun";
}

export interface CategoryUsageCount {
  transactions: number;
  rules: number;
  budgets: number;
}

export interface SubscriptionItem {
  id: string;
  userId?: string;
  name: string;
  merchant?: string;
  amount: number;
  billingCycle: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annually";
  annualizedAmount: number;
  startDate: string;
  nextBillingDate: string;
  categoryId?: string;
  categoryName?: string;
  categoryColor?: string;
  isActive: boolean;
  notes?: string;
}

export interface FhssContributionRecord {
  id: string;
  userId?: string;
  amount: number;
  contributionType: "concessional" | "non_concessional";
  date: string;
  financialYear: string;
  fundName: string;
  bpayRef?: string;
}

export type CashFlowFrequency =
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "quarterly"
  | "annually"
  | "one_off";

export interface CashFlowScheduledItemRecord {
  id: string;
  userId: string;
  accountId: string;
  accountName?: string;
  name: string;
  type: "income" | "expense";
  amount: number;
  frequency: CashFlowFrequency;
  startDate: string;
  endDate?: string | null;
  nextOccurrenceDate: string;
  isActive: boolean;
}

export interface PropertyGoalConfig {
  userId?: string;
  goalName: string;
  targetDate: string; // YYYY-MM-DD
  targetYear: number;
  locationCode: PropertyLocationCode;
  targetCity: string;
  customLocationName?: string | null;
  isFirstHomeBuyer: boolean;
  targetPrice: number;
  depositPct: number;
  customStampDuty: number | null;
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
  dhoasMonthlySubsidy: number | null;
  dhoasLoanCap: number | null;
  dhoasLumpSumAmount: number;
  notes?: string | null;
}

export interface ImportBatchItem {
  id: string;
  userId: string;
  accountId: string;
  fileName: string;
  fileHash: string;
  bankFormat: string;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  status: string;
  importedAt: string;
}

export interface AuditLogItem {
  id: string;
  userId?: string;
  entityType: string;
  entityId: string;
  action: string;
  reason: string;
  timestamp: string;
}

// Historical baseline offsets for demo budgets (identified by startDate === "2026-10-01")
const DEMO_BUDGET_BASELINES_BY_SLUG: Record<string, number> = {
  groceries: 528.3, // + $114.20 from demo tx-2 = $642.50
  dining: 385.0,
  utilities: 210.0,
  subscriptions: 78.48,
  transport: 295.4,
};

// In-memory state used as fallback when PostgreSQL is unavailable or in test/E2E mode.
// Stored on globalThis so Next.js dev/standalone route chunks share one consistent workspace.
interface InMemoryStoreState {
  users: UserRecord[];
  accounts: AccountRecord[];
  categories: CategoryRecord[];
  rules: RuleRecord[];
  transactions: TransactionWithLedger[];
  batches: ImportBatchItem[];
  auditLogs: AuditLogItem[];
  budgetConfigs: Array<{
    id: string;
    userId: string;
    categoryId: string;
    categoryName: string;
    categorySlug: string;
    categoryColor: string;
    period: "monthly" | "weekly" | "yearly";
    allocatedAmount: number;
    alertThresholdPct: number;
    startDate: string;
  }>;
  subscriptions: SubscriptionItem[];
  cashFlowItems: CashFlowScheduledItemRecord[];
  goalConfigs: Map<string, PropertyGoalConfig>;
  fhssContributions: FhssContributionRecord[];
  initializedForTest: boolean;
}

const globalForStore = globalThis as typeof globalThis & {
  __coreCapitalInMemoryStore?: InMemoryStoreState;
};

const memStore: InMemoryStoreState =
  globalForStore.__coreCapitalInMemoryStore ??
  (globalForStore.__coreCapitalInMemoryStore = {
    users: [],
    accounts: [],
    categories: [],
    rules: [],
    transactions: [],
    batches: [],
    auditLogs: [],
    budgetConfigs: [],
    subscriptions: [],
    cashFlowItems: [],
    goalConfigs: new Map<string, PropertyGoalConfig>(),
    fhssContributions: [],
    initializedForTest: false,
  });

const inMemoryUsers = memStore.users;
const inMemoryAccounts = memStore.accounts;
const inMemoryCategories = memStore.categories;
const inMemoryRules = memStore.rules;
const inMemoryTransactions = memStore.transactions;
const inMemoryBatches = memStore.batches;
const inMemoryAuditLogs = memStore.auditLogs;
const inMemoryBudgetConfigs = memStore.budgetConfigs;
const inMemorySubscriptions = memStore.subscriptions;
const inMemoryCashFlowItems = memStore.cashFlowItems;
const inMemoryGoalConfigs = memStore.goalConfigs;
const inMemoryFhssContributions = memStore.fhssContributions;

function formatLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function slugifyCategoryName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "category";
}

function createDemoWorkspacePayload(userId: string, preserveLegacyTestIds: boolean) {
  const catMap = new Map<string, { id: string; name: string; slug: string; color: string }>();

  const seededCategories: CategoryRecord[] = defaultCategories.map((c, idx) => {
    const id = preserveLegacyTestIds ? c.id : crypto.randomUUID();
    catMap.set(c.id, { id, name: c.name, slug: c.slug, color: c.color });
    return {
      id,
      userId,
      name: c.name,
      slug: c.slug,
      parentId: null,
      type: c.type,
      color: c.color,
      icon: c.icon,
      sortOrder: idx * 10,
    };
  });

  const accMap = new Map<string, { id: string; name: string }>();
  const seededAccounts: AccountRecord[] = defaultAccounts.map((a) => {
    const id = preserveLegacyTestIds ? a.id : crypto.randomUUID();
    accMap.set(a.id, { id, name: a.name });
    return {
      id,
      userId,
      name: a.name,
      institution: a.institution,
      accountType: a.accountType,
      accountNumberLast4: a.accountNumberLast4,
      currency: a.currency,
      currentBalance: a.currentBalance,
      isOffsetAccount: a.isOffsetAccount,
      interestRatePct: a.interestRatePct,
      isActive: a.isActive,
    };
  });

  const seededRules: RuleRecord[] = defaultRules.map((r) => ({
    id: preserveLegacyTestIds ? r.id : crypto.randomUUID(),
    userId,
    name: r.name,
    priority: r.priority,
    field: r.field,
    matchType: r.matchType,
    matchValue: r.matchValue,
    targetCategoryId: catMap.get(r.targetCategoryId)?.id || seededCategories[0].id,
    autoApply: r.autoApply,
    isActive: r.isActive,
    matchCount: r.matchCount,
  }));

  const acc1 = accMap.get("acc-11111111-1111-1111-1111-111111111111")!;
  const acc2 = accMap.get("acc-22222222-2222-2222-2222-222222222222")!;
  const cat1 = catMap.get("cat-1")!;
  const cat2 = catMap.get("cat-2")!;
  const cat5 = catMap.get("cat-5")!;
  const cat6 = catMap.get("cat-6")!;
  const cat7 = catMap.get("cat-7")!;
  const cat8 = catMap.get("cat-8")!;
  const cat9 = catMap.get("cat-9")!;
  const cat10 = catMap.get("cat-10")!;

  const tx1Id = preserveLegacyTestIds ? "tx-1" : crypto.randomUUID();
  const tx2Id = preserveLegacyTestIds ? "tx-2" : crypto.randomUUID();
  const tx3Id = preserveLegacyTestIds ? "tx-3" : crypto.randomUUID();

  const seededTransactions: TransactionWithLedger[] = [
    {
      id: tx1Id,
      userId,
      accountId: acc1.id,
      accountName: acc1.name,
      date: "2026-10-10",
      postedDate: "2026-10-10",
      amount: "3850.00",
      currency: "AUD",
      merchant: "Defence Force Payroll",
      cleanDescription: "Defence Force Payroll",
      rawDescription: "DIRECT CREDIT DEFENCE PAYROLL",
      status: "posted",
      isSplit: false,
      isReversal: false,
      deduplicationHash: computeDeduplicationHash(
        acc1.id,
        "2026-10-10",
        3850.0,
        "DIRECT CREDIT DEFENCE PAYROLL"
      ),
      createdAt: new Date("2026-10-10T09:00:00Z").toISOString(),
      ledgerEntries: [
        {
          id: preserveLegacyTestIds ? "led-1" : crypto.randomUUID(),
          transactionId: tx1Id,
          accountId: acc1.id,
          categoryId: cat1.id,
          categoryName: cat1.name,
          categoryColor: cat1.color,
          entryType: "credit",
          amount: "3850.00",
          description: "Fortnightly Salary",
          isReversal: false,
          sequenceIndex: 0,
        },
      ],
    },
    {
      id: tx2Id,
      userId,
      accountId: acc1.id,
      accountName: acc1.name,
      date: "2026-10-08",
      postedDate: "2026-10-08",
      amount: "-164.20",
      currency: "AUD",
      merchant: "Woolworths Unley",
      cleanDescription: "Woolworths Unley SA",
      rawDescription: "VISA PURCHASE WOOLWORTHS UNLEY SA AUS",
      status: "posted",
      isSplit: true,
      isReversal: false,
      deduplicationHash: computeDeduplicationHash(
        acc1.id,
        "2026-10-08",
        -164.2,
        "VISA PURCHASE WOOLWORTHS UNLEY SA AUS"
      ),
      createdAt: new Date("2026-10-08T14:30:00Z").toISOString(),
      ledgerEntries: [
        {
          id: preserveLegacyTestIds ? "led-2" : crypto.randomUUID(),
          transactionId: tx2Id,
          accountId: acc1.id,
          categoryId: cat2.id,
          categoryName: cat2.name,
          categoryColor: cat2.color,
          entryType: "debit",
          amount: "114.20",
          description: "Weekly Fresh Groceries",
          isReversal: false,
          sequenceIndex: 0,
        },
        {
          id: preserveLegacyTestIds ? "led-3" : crypto.randomUUID(),
          transactionId: tx2Id,
          accountId: acc1.id,
          categoryId: cat9.id,
          categoryName: cat9.name,
          categoryColor: cat9.color,
          entryType: "debit",
          amount: "50.00",
          description: "Cleaning & Kitchen Items",
          isReversal: false,
          sequenceIndex: 1,
        },
      ],
    },
    {
      id: tx3Id,
      userId,
      accountId: acc2.id,
      accountName: acc2.name,
      date: "2026-10-01",
      postedDate: "2026-10-01",
      amount: "-1250.00",
      currency: "AUD",
      merchant: "ADF Super FHSS BPAY",
      cleanDescription: "ATO Super BPAY (FHSS Voluntary)",
      rawDescription: "BPAY TO ADF SUPER FHSS VOLUNTARY CONTRIB",
      status: "posted",
      isSplit: false,
      isReversal: false,
      deduplicationHash: computeDeduplicationHash(
        acc2.id,
        "2026-10-01",
        -1250.0,
        "BPAY TO ADF SUPER FHSS VOLUNTARY CONTRIB"
      ),
      createdAt: new Date("2026-10-01T10:00:00Z").toISOString(),
      ledgerEntries: [
        {
          id: preserveLegacyTestIds ? "led-4" : crypto.randomUUID(),
          transactionId: tx3Id,
          accountId: acc2.id,
          categoryId: cat8.id,
          categoryName: cat8.name,
          categoryColor: cat8.color,
          entryType: "debit",
          amount: "1250.00",
          description: "FHSS FY26-27 Voluntary Concessional",
          isReversal: false,
          sequenceIndex: 0,
        },
      ],
    },
  ];

  const seededBatches: ImportBatchItem[] = [
    {
      id: preserveLegacyTestIds ? "batch-1" : crypto.randomUUID(),
      userId,
      accountId: acc1.id,
      fileName: "CBA_October_Statement.csv",
      fileHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      bankFormat: "commbank",
      totalRows: 24,
      importedRows: 23,
      duplicateRows: 1,
      status: "completed",
      importedAt: new Date("2026-10-09T08:00:00Z").toISOString(),
    },
  ];

  const seededBudgets = [
    {
      id: preserveLegacyTestIds ? "bud-1" : crypto.randomUUID(),
      userId,
      categoryId: cat2.id,
      categoryName: cat2.name,
      categorySlug: cat2.slug,
      categoryColor: cat2.color,
      period: "monthly" as const,
      allocatedAmount: 850.0,
      alertThresholdPct: 80,
      startDate: "2026-10-01",
    },
    {
      id: preserveLegacyTestIds ? "bud-2" : crypto.randomUUID(),
      userId,
      categoryId: catMap.get("cat-3")!.id,
      categoryName: catMap.get("cat-3")!.name,
      categorySlug: catMap.get("cat-3")!.slug,
      categoryColor: catMap.get("cat-3")!.color,
      period: "monthly" as const,
      allocatedAmount: 400.0,
      alertThresholdPct: 80,
      startDate: "2026-10-01",
    },
    {
      id: preserveLegacyTestIds ? "bud-3" : crypto.randomUUID(),
      userId,
      categoryId: cat5.id,
      categoryName: cat5.name,
      categorySlug: cat5.slug,
      categoryColor: cat5.color,
      period: "monthly" as const,
      allocatedAmount: 350.0,
      alertThresholdPct: 80,
      startDate: "2026-10-01",
    },
    {
      id: preserveLegacyTestIds ? "bud-4" : crypto.randomUUID(),
      userId,
      categoryId: cat6.id,
      categoryName: cat6.name,
      categorySlug: cat6.slug,
      categoryColor: cat6.color,
      period: "monthly" as const,
      allocatedAmount: 80.0,
      alertThresholdPct: 80,
      startDate: "2026-10-01",
    },
    {
      id: preserveLegacyTestIds ? "bud-5" : crypto.randomUUID(),
      userId,
      categoryId: cat7.id,
      categoryName: cat7.name,
      categorySlug: cat7.slug,
      categoryColor: cat7.color,
      period: "monthly" as const,
      allocatedAmount: 250.0,
      alertThresholdPct: 80,
      startDate: "2026-10-01",
    },
  ];

  const seededSubscriptions: SubscriptionItem[] = [
    {
      id: preserveLegacyTestIds ? "sub-1" : crypto.randomUUID(),
      userId,
      name: "Netflix Standard Plan",
      merchant: "Netflix",
      amount: 22.99,
      billingCycle: "monthly",
      annualizedAmount: calculateAnnualizedSubscriptionCost(22.99, "monthly"),
      startDate: "2024-03-15",
      nextBillingDate: "2026-11-15",
      categoryId: cat6.id,
      categoryName: cat6.name,
      categoryColor: cat6.color,
      isActive: true,
    },
    {
      id: preserveLegacyTestIds ? "sub-2" : crypto.randomUUID(),
      userId,
      name: "Anytime Fitness Adelaide",
      merchant: "Anytime Fitness",
      amount: 19.95,
      billingCycle: "weekly",
      annualizedAmount: calculateAnnualizedSubscriptionCost(19.95, "weekly"),
      startDate: "2025-01-10",
      nextBillingDate: "2026-10-18",
      categoryId: cat10.id,
      categoryName: cat10.name,
      categoryColor: cat10.color,
      isActive: true,
    },
    {
      id: preserveLegacyTestIds ? "sub-3" : crypto.randomUUID(),
      userId,
      name: "Proxmox Backup / Cloud VPS",
      merchant: "Hetzner Cloud",
      amount: 14.5,
      billingCycle: "monthly",
      annualizedAmount: calculateAnnualizedSubscriptionCost(14.5, "monthly"),
      startDate: "2025-06-01",
      nextBillingDate: "2026-11-01",
      categoryId: cat5.id,
      categoryName: cat5.name,
      categoryColor: cat5.color,
      isActive: true,
    },
    {
      id: preserveLegacyTestIds ? "sub-4" : crypto.randomUUID(),
      userId,
      name: "Spotify Duo",
      merchant: "Spotify",
      amount: 20.99,
      billingCycle: "monthly",
      annualizedAmount: calculateAnnualizedSubscriptionCost(20.99, "monthly"),
      startDate: "2023-11-01",
      nextBillingDate: "2026-11-01",
      categoryId: cat6.id,
      categoryName: cat6.name,
      categoryColor: cat6.color,
      isActive: true,
    },
    {
      id: preserveLegacyTestIds ? "sub-5" : crypto.randomUUID(),
      userId,
      name: "RAA Roadside Assistance (Adelaide)",
      merchant: "RAA Insurance",
      amount: 135.0,
      billingCycle: "annually",
      annualizedAmount: calculateAnnualizedSubscriptionCost(135.0, "annually"),
      startDate: "2025-08-20",
      nextBillingDate: "2027-08-20",
      categoryId: cat7.id,
      categoryName: cat7.name,
      categoryColor: cat7.color,
      isActive: true,
    },
  ];

  const seededGoal: PropertyGoalConfig = {
    userId,
    goalName: "First Home Deposit Goal",
    targetDate: "2029-07-01",
    targetYear: 2029,
    locationCode: "SA",
    targetCity: "Adelaide",
    customLocationName: null,
    isFirstHomeBuyer: true,
    targetPrice: 850000,
    depositPct: 20,
    customStampDuty: null,
    conveyancingFees: 3850,
    estimatedLmi: 0,
    useLiveLiquidSavings: true,
    currentSavingsAllocated: 0,
    monthlySavingsPace: 2100,
    useFhss: true,
    fhssMarginalTaxRatePct: 32.5,
    useDhoas: true,
    dhoasMode: "auto",
    dhoasEnlistmentDate: "2021-03-01",
    dhoasServiceType: "permanent",
    dhoasMonthlySubsidy: null,
    dhoasLoanCap: null,
    dhoasLumpSumAmount: 0,
    notes: null,
  };

  const seededFhss: FhssContributionRecord[] = [
    {
      id: preserveLegacyTestIds ? "fhss-1" : crypto.randomUUID(),
      userId,
      amount: 15000,
      contributionType: "concessional",
      date: "2025-05-12",
      financialYear: "2024-25",
      fundName: "ADF Super",
      bpayRef: "BPAY-99214-4412",
    },
    {
      id: preserveLegacyTestIds ? "fhss-2" : crypto.randomUUID(),
      userId,
      amount: 15000,
      contributionType: "concessional",
      date: "2026-04-18",
      financialYear: "2025-26",
      fundName: "ADF Super",
      bpayRef: "BPAY-99214-5109",
    },
  ];

  const today = new Date();
  const payDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 4);
  const rentDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const todayIso = formatLocalIsoDate(today);

  const seededCashFlowItems: CashFlowScheduledItemRecord[] = [
    {
      id: preserveLegacyTestIds ? "cf-1" : crypto.randomUUID(),
      userId,
      accountId: acc1.id,
      accountName: acc1.name,
      name: "Defence Force Salary",
      type: "income",
      amount: 3850,
      frequency: "fortnightly",
      startDate: todayIso,
      endDate: null,
      nextOccurrenceDate: formatLocalIsoDate(payDate),
      isActive: true,
    },
    {
      id: preserveLegacyTestIds ? "cf-2" : crypto.randomUUID(),
      userId,
      accountId: acc1.id,
      accountName: acc1.name,
      name: "Monthly Rent",
      type: "expense",
      amount: 1650,
      frequency: "monthly",
      startDate: todayIso,
      endDate: null,
      nextOccurrenceDate: formatLocalIsoDate(rentDate),
      isActive: true,
    },
  ];

  return {
    seededCategories,
    seededAccounts,
    seededRules,
    seededTransactions,
    seededBatches,
    seededBudgets,
    seededSubscriptions,
    seededCashFlowItems,
    seededGoal,
    seededFhss,
  };
}

function createCleanWorkspacePayload(userId: string) {
  const catMap = new Map<string, string>();
  const seededCategories: CategoryRecord[] = defaultCategories.map((c, idx) => {
    const id = crypto.randomUUID();
    catMap.set(c.id, id);
    return {
      id,
      userId,
      name: c.name,
      slug: c.slug,
      parentId: null,
      type: c.type,
      color: c.color,
      icon: c.icon,
      sortOrder: idx * 10,
    };
  });

  const seededAccounts: AccountRecord[] = [
    {
      id: crypto.randomUUID(),
      userId,
      name: "Primary Checking",
      institution: "Australian Bank",
      accountType: "checking",
      accountNumberLast4: "0001",
      currency: "AUD",
      currentBalance: "0.00",
      isOffsetAccount: false,
      interestRatePct: "0.00",
      isActive: true,
    },
  ];

  const seededRules: RuleRecord[] = defaultRules.map((r) => ({
    id: crypto.randomUUID(),
    userId,
    name: r.name,
    priority: r.priority,
    field: r.field,
    matchType: r.matchType,
    matchValue: r.matchValue,
    targetCategoryId: catMap.get(r.targetCategoryId) || seededCategories[0].id,
    autoApply: r.autoApply,
    isActive: r.isActive,
    matchCount: 0,
  }));

  return {
    seededCategories,
    seededAccounts,
    seededRules,
  };
}

function seedInMemoryWorkspace(
  userId: string,
  seedMode: "clean" | "demo",
  preserveLegacyTestIds: boolean = false
): void {
  if (seedMode === "demo") {
    const demo = createDemoWorkspacePayload(userId, preserveLegacyTestIds);
    inMemoryCategories.push(...demo.seededCategories);
    inMemoryAccounts.push(...demo.seededAccounts);
    inMemoryRules.push(...demo.seededRules);
    inMemoryTransactions.push(...demo.seededTransactions);
    inMemoryBatches.push(...demo.seededBatches);
    inMemoryBudgetConfigs.push(...demo.seededBudgets);
    inMemorySubscriptions.push(...demo.seededSubscriptions);
    inMemoryCashFlowItems.push(...demo.seededCashFlowItems);
    inMemoryGoalConfigs.set(userId, demo.seededGoal);
    inMemoryFhssContributions.push(...demo.seededFhss);
    inMemoryAuditLogs.push({
      id: crypto.randomUUID(),
      userId,
      entityType: "account",
      entityId: userId,
      action: "INSERT",
      reason: "Initialized demo workspace",
      timestamp: new Date().toISOString(),
    });
  } else {
    const clean = createCleanWorkspacePayload(userId);
    inMemoryCategories.push(...clean.seededCategories);
    inMemoryAccounts.push(...clean.seededAccounts);
    inMemoryRules.push(...clean.seededRules);
  }
}

// Initialize a default admin + demo workspace ONLY during automated test runs so
// existing ledger unit tests start ready, while dev/docker instances launch /setup.
if (process.env.NODE_ENV === "test" && !memStore.initializedForTest) {
  memStore.initializedForTest = true;
  const nowIso = new Date().toISOString();
  inMemoryUsers.push({
    id: DEFAULT_USER_ID,
    email: "admin@corecapital.local",
    name: "CoreCapital Test Admin",
    passwordHash: hashPassword("TestAdmin123!"),
    role: "admin",
    isActive: true,
    sessionVersion: 1,
    baseCurrency: "AUD",
    lastLoginAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  seedInMemoryWorkspace(DEFAULT_USER_ID, "demo", true);
}

let migratePromise: Promise<void> | null = null;
let hasMigratedDb = false;

/**
 * Ensures PostgreSQL schema migrations are applied when a fresh database is started.
 * Intentionally does NOT auto-insert a default user so first-run /setup handles admin creation.
 */
async function ensureMigrated(): Promise<void> {
  if (hasMigratedDb) return;
  if (migratePromise) return migratePromise;

  migratePromise = (async () => {
    const reg = (await db.execute(
      sql`SELECT to_regclass('public.users') AS users_tbl, to_regclass('drizzle.__drizzle_migrations') AS mig_tbl`
    )) as unknown as Array<{ users_tbl?: string | null; mig_tbl?: string | null }>;

    const hasUsersTable = Boolean(reg[0]?.users_tbl);
    const hasMigrationsTable = Boolean(reg[0]?.mig_tbl);

    if (!hasUsersTable || hasMigrationsTable) {
      await migrate(db, {
        migrationsFolder: path.join(process.cwd(), "src/db/migrations"),
      });
    } else {
      // Legacy db:push databases without __drizzle_migrations table: apply idempotent schema extensions
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "goal_name" varchar(150) DEFAULT 'Mortgage Deposit Goal' NOT NULL`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "target_date" date DEFAULT '2029-07-01' NOT NULL`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "location_code" varchar(20) DEFAULT 'SA' NOT NULL`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "custom_location_name" varchar(150)`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "is_first_home_buyer" boolean DEFAULT true NOT NULL`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "custom_stamp_duty" numeric(12, 2)`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "use_live_liquid_savings" boolean DEFAULT true NOT NULL`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "use_fhss" boolean DEFAULT false NOT NULL`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "fhss_marginal_tax_rate_pct" numeric(5, 2) DEFAULT '32.50' NOT NULL`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "use_dhoas" boolean DEFAULT false NOT NULL`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_mode" varchar(20) DEFAULT 'auto' NOT NULL`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_enlistment_date" date`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_service_type" varchar(20) DEFAULT 'permanent' NOT NULL`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_monthly_subsidy" numeric(12, 2)`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_loan_cap" numeric(12, 2)`);
      await db.execute(sql`ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_lump_sum_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL`);
      await db.execute(sql`UPDATE "property_goals" SET "location_code" = 'VIC' WHERE "target_city" = 'Melbourne' AND "location_code" = 'SA'`);
      await db.execute(sql`UPDATE "property_goals" SET "target_date" = make_date("target_year", 7, 1) WHERE "target_year" <> 2029`);
      await db.execute(sql`ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL`);
    }
    hasMigratedDb = true;
  })().finally(() => {
    migratePromise = null;
  });

  return migratePromise;
}

async function isDbReady(): Promise<boolean> {
  const connected = await checkDbConnection();
  if (!connected) return false;
  try {
    await ensureMigrated();
    return true;
  } catch (error) {
    console.error("[CoreCapital] Database migration check failed:", error);
    return false;
  }
}

async function seedDbWorkspace(userId: string, seedMode: "clean" | "demo"): Promise<void> {
  const dbUserId = toUuid(userId);

  if (seedMode === "demo") {
    const demo = createDemoWorkspacePayload(dbUserId, false);
    if (demo.seededCategories.length > 0) {
      await db.insert(categories).values(
        demo.seededCategories.map((c) => ({
          id: toUuid(c.id),
          userId: dbUserId,
          name: c.name,
          slug: c.slug,
          parentId: c.parentId ? toUuid(c.parentId) : null,
          type: c.type,
          color: c.color,
          icon: c.icon,
          isSystem: true,
          sortOrder: c.sortOrder,
        }))
      );
    }

    if (demo.seededAccounts.length > 0) {
      await db.insert(accounts).values(
        demo.seededAccounts.map((a) => ({
          id: toUuid(a.id),
          userId: dbUserId,
          name: a.name,
          institution: a.institution,
          accountType: a.accountType,
          accountNumberLast4: a.accountNumberLast4,
          currency: a.currency,
          currentBalance: a.currentBalance,
          isOffsetAccount: a.isOffsetAccount,
          interestRatePct: a.interestRatePct,
          isActive: a.isActive,
        }))
      );
    }

    if (demo.seededRules.length > 0) {
      await db.insert(classificationRules).values(
        demo.seededRules.map((r) => ({
          id: toUuid(r.id),
          userId: dbUserId,
          name: r.name,
          priority: r.priority,
          field: r.field,
          matchType: r.matchType,
          matchValue: r.matchValue,
          targetCategoryId: toUuid(r.targetCategoryId),
          autoApply: r.autoApply,
          isActive: r.isActive,
          matchCount: r.matchCount,
        }))
      );
    }

    if (demo.seededBatches.length > 0) {
      await db.insert(importBatches).values(
        demo.seededBatches.map((b) => ({
          id: toUuid(b.id),
          userId: dbUserId,
          accountId: toUuid(b.accountId),
          fileName: b.fileName,
          fileHash: b.fileHash,
          bankFormat: b.bankFormat,
          totalRows: b.totalRows,
          importedRows: b.importedRows,
          duplicateRows: b.duplicateRows,
          status: b.status,
          importedAt: new Date(b.importedAt),
        }))
      );
    }

    for (const tx of demo.seededTransactions) {
      const dbTxId = toUuid(tx.id);
      const dbAccountId = toUuid(tx.accountId);
      await db.insert(transactions).values({
        id: dbTxId,
        userId: dbUserId,
        accountId: dbAccountId,
        importBatchId: tx.importBatchId ? toUuid(tx.importBatchId) : null,
        date: tx.date,
        postedDate: tx.postedDate || tx.date,
        amount: tx.amount,
        currency: tx.currency,
        merchant: tx.merchant || null,
        cleanDescription: tx.cleanDescription,
        rawDescription: tx.rawDescription,
        status: tx.status,
        isSplit: tx.isSplit,
        isReversal: tx.isReversal,
        deduplicationHash: tx.deduplicationHash || null,
        createdAt: new Date(tx.createdAt),
      });

      await db.insert(ledgerEntries).values(
        tx.ledgerEntries.map((le) => ({
          id: toUuid(le.id),
          transactionId: dbTxId,
          accountId: dbAccountId,
          categoryId: le.categoryId ? toUuid(le.categoryId) : null,
          entryType: le.entryType,
          amount: le.amount,
          description: le.description || null,
          isReversal: le.isReversal,
          sequenceIndex: le.sequenceIndex,
        }))
      );
    }

    if (demo.seededBudgets.length > 0) {
      await db.insert(budgets).values(
        demo.seededBudgets.map((b) => ({
          id: toUuid(b.id),
          userId: dbUserId,
          categoryId: toUuid(b.categoryId),
          period: b.period,
          amount: b.allocatedAmount.toFixed(2),
          alertThresholdPct: b.alertThresholdPct,
          startDate: b.startDate,
        }))
      );
    }

    if (demo.seededSubscriptions.length > 0) {
      await db.insert(subscriptions).values(
        demo.seededSubscriptions.map((s) => ({
          id: toUuid(s.id),
          userId: dbUserId,
          categoryId: s.categoryId ? toUuid(s.categoryId) : null,
          name: s.name,
          merchant: s.merchant || null,
          amount: s.amount.toFixed(2),
          billingCycle: s.billingCycle,
          annualizedAmount: s.annualizedAmount.toFixed(2),
          startDate: s.startDate,
          nextBillingDate: s.nextBillingDate,
          isActive: s.isActive,
        }))
      );
    }

    if (demo.seededCashFlowItems.length > 0) {
      await db.insert(cashFlowScheduledItems).values(
        demo.seededCashFlowItems.map((cf) => ({
          id: toUuid(cf.id),
          userId: dbUserId,
          accountId: toUuid(cf.accountId),
          name: cf.name,
          type: cf.type,
          amount: cf.amount.toFixed(2),
          frequency: cf.frequency,
          startDate: cf.startDate,
          endDate: cf.endDate ?? null,
          nextOccurrenceDate: cf.nextOccurrenceDate,
          isActive: cf.isActive,
        }))
      );
    }

    const initialStampDuty = calculateStampDuty(
      demo.seededGoal.locationCode,
      demo.seededGoal.targetPrice,
      demo.seededGoal.isFirstHomeBuyer,
      demo.seededGoal.customStampDuty
    );
    await db.insert(propertyGoals).values({
      id: crypto.randomUUID(),
      userId: dbUserId,
      goalName: demo.seededGoal.goalName,
      targetDate: demo.seededGoal.targetDate,
      targetYear: demo.seededGoal.targetYear,
      locationCode: demo.seededGoal.locationCode,
      targetCity: demo.seededGoal.targetCity,
      customLocationName: demo.seededGoal.customLocationName ?? null,
      isFirstHomeBuyer: demo.seededGoal.isFirstHomeBuyer,
      targetPropertyPrice: demo.seededGoal.targetPrice.toFixed(2),
      targetDepositPct: demo.seededGoal.depositPct.toFixed(2),
      targetDepositAmount: (
        (demo.seededGoal.targetPrice * demo.seededGoal.depositPct) /
        100
      ).toFixed(2),
      estimatedStampDuty: initialStampDuty.toFixed(2),
      customStampDuty:
        demo.seededGoal.customStampDuty !== null
          ? demo.seededGoal.customStampDuty.toFixed(2)
          : null,
      estimatedLmi: demo.seededGoal.estimatedLmi.toFixed(2),
      estimatedConveyancingAndFees: demo.seededGoal.conveyancingFees.toFixed(2),
      useLiveLiquidSavings: demo.seededGoal.useLiveLiquidSavings,
      currentSavingsAllocated: demo.seededGoal.currentSavingsAllocated.toFixed(2),
      monthlySavingsContribution: demo.seededGoal.monthlySavingsPace.toFixed(2),
      useFhss: demo.seededGoal.useFhss,
      fhssMarginalTaxRatePct: demo.seededGoal.fhssMarginalTaxRatePct.toFixed(2),
      useDhoas: demo.seededGoal.useDhoas,
      dhoasMode: demo.seededGoal.dhoasMode,
      dhoasEnlistmentDate: demo.seededGoal.dhoasEnlistmentDate,
      dhoasServiceType: demo.seededGoal.dhoasServiceType,
      dhoasMonthlySubsidy:
        demo.seededGoal.dhoasMonthlySubsidy !== null
          ? demo.seededGoal.dhoasMonthlySubsidy.toFixed(2)
          : null,
      dhoasLoanCap:
        demo.seededGoal.dhoasLoanCap !== null
          ? demo.seededGoal.dhoasLoanCap.toFixed(2)
          : null,
      dhoasLumpSumAmount: demo.seededGoal.dhoasLumpSumAmount.toFixed(2),
      notes: demo.seededGoal.notes ?? null,
    });

    if (demo.seededFhss.length > 0) {
      await db.insert(fhssContributions).values(
        demo.seededFhss.map((c) => ({
          id: toUuid(c.id),
          userId: dbUserId,
          financialYear: c.financialYear,
          contributionDate: c.date,
          amount: c.amount.toFixed(2),
          contributionType: c.contributionType,
          superFundName: c.fundName,
          bpayReference: c.bpayRef || null,
        }))
      );
    }
  } else {
    const clean = createCleanWorkspacePayload(dbUserId);
    await db.insert(categories).values(
      clean.seededCategories.map((c) => ({
        id: toUuid(c.id),
        userId: dbUserId,
        name: c.name,
        slug: c.slug,
        parentId: c.parentId ? toUuid(c.parentId) : null,
        type: c.type,
        color: c.color,
        icon: c.icon,
        isSystem: true,
        sortOrder: c.sortOrder,
      }))
    );

    await db.insert(accounts).values(
      clean.seededAccounts.map((a) => ({
        id: toUuid(a.id),
        userId: dbUserId,
        name: a.name,
        institution: a.institution,
        accountType: a.accountType,
        accountNumberLast4: a.accountNumberLast4,
        currency: a.currency,
        currentBalance: a.currentBalance,
        isOffsetAccount: a.isOffsetAccount,
        interestRatePct: a.interestRatePct,
        isActive: a.isActive,
      }))
    );

    await db.insert(classificationRules).values(
      clean.seededRules.map((r) => ({
        id: toUuid(r.id),
        userId: dbUserId,
        name: r.name,
        priority: r.priority,
        field: r.field,
        matchType: r.matchType,
        matchValue: r.matchValue,
        targetCategoryId: toUuid(r.targetCategoryId),
        autoApply: r.autoApply,
        isActive: r.isActive,
        matchCount: r.matchCount,
      }))
    );
  }
}

function wipeInMemoryUserWorkspace(userId: string): void {
  const removeMatching = <T extends { userId?: string }>(arr: T[]) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].userId === userId) {
        arr.splice(i, 1);
      }
    }
  };

  removeMatching(inMemoryTransactions);
  removeMatching(inMemoryBatches);
  removeMatching(inMemoryBudgetConfigs);
  removeMatching(inMemorySubscriptions);
  removeMatching(inMemoryCashFlowItems);
  removeMatching(inMemoryFhssContributions);
  removeMatching(inMemoryRules);
  removeMatching(inMemoryAccounts);
  removeMatching(inMemoryCategories);
  removeMatching(inMemoryAuditLogs);
  inMemoryGoalConfigs.delete(userId);
}

async function wipeDbUserWorkspace(userId: string): Promise<void> {
  const dbUserId = toUuid(userId);
  await db.delete(transactions).where(eq(transactions.userId, dbUserId));
  await db.delete(importBatches).where(eq(importBatches.userId, dbUserId));
  await db.delete(budgets).where(eq(budgets.userId, dbUserId));
  await db.delete(subscriptions).where(eq(subscriptions.userId, dbUserId));
  await db.delete(cashFlowScheduledItems).where(eq(cashFlowScheduledItems.userId, dbUserId));
  await db.delete(propertyGoals).where(eq(propertyGoals.userId, dbUserId));
  await db.delete(fhssContributions).where(eq(fhssContributions.userId, dbUserId));
  await db.delete(classificationRules).where(eq(classificationRules.userId, dbUserId));
  await db.delete(accounts).where(eq(accounts.userId, dbUserId));
  await db.delete(categories).where(eq(categories.userId, dbUserId));
  await db.delete(auditLogs).where(eq(auditLogs.userId, dbUserId));
}

function clampBudgetThreshold(pct?: number): number {
  if (pct === undefined || !Number.isFinite(pct)) return 80;
  return Math.min(100, Math.max(10, Math.round(pct)));
}

function buildBudgetItem(
  cfg: {
    id: string;
    categoryId: string;
    categoryName: string;
    categorySlug: string;
    categoryColor: string;
    parentCategoryId?: string | null;
    parentCategoryName?: string | null;
    alertThresholdPct?: number;
    period: "monthly" | "weekly" | "yearly";
    allocatedAmount: number;
    startDate: string;
  },
  allTransactions: TransactionWithLedger[],
  matchingCategoryIds?: Set<string>
): BudgetItem {
  const baseline =
    cfg.startDate === "2026-10-01" && !cfg.parentCategoryId
      ? DEMO_BUDGET_BASELINES_BY_SLUG[cfg.categorySlug] ?? 0
      : 0;
  const matchSet = matchingCategoryIds || new Set([toUuid(cfg.categoryId)]);
  const alertThresholdPct = clampBudgetThreshold(cfg.alertThresholdPct);

  let ledgerNet = 0;
  for (const tx of allTransactions) {
    for (const entry of tx.ledgerEntries) {
      const entryCatMatch =
        entry.categoryId && matchSet.has(toUuid(entry.categoryId));
      if (!entryCatMatch) continue;

      const amt = parseFloat(entry.amount) || 0;
      if (!entry.isReversal && entry.entryType === "debit") {
        ledgerNet += amt;
      } else if (entry.isReversal && entry.entryType === "credit") {
        ledgerNet -= amt;
      }
    }
  }

  const spentAmount = Math.max(0, Math.round((baseline + ledgerNet) * 100) / 100);
  const remainingAmount = Math.round((cfg.allocatedAmount - spentAmount) * 100) / 100;
  const percentageSpent =
    cfg.allocatedAmount > 0
      ? Math.round((spentAmount / cfg.allocatedAmount) * 1000) / 10
      : 0;

  let status: "normal" | "warning" | "overrun" = "normal";
  if (percentageSpent > 100) {
    status = "overrun";
  } else if (percentageSpent >= alertThresholdPct) {
    status = "warning";
  }

  return {
    id: cfg.id,
    categoryId: cfg.categoryId,
    categoryName: cfg.categoryName,
    categoryColor: cfg.categoryColor,
    parentCategoryId: cfg.parentCategoryId ?? null,
    parentCategoryName: cfg.parentCategoryName ?? null,
    alertThresholdPct,
    period: cfg.period,
    allocatedAmount: cfg.allocatedAmount,
    spentAmount,
    remainingAmount,
    percentageSpent,
    status,
  };
}

function filterTransactions(
  source: TransactionWithLedger[],
  filters?: {
    accountId?: string;
    categoryId?: string;
    search?: string;
    status?: string;
  }
): TransactionWithLedger[] {
  let list = [...source];

  if (filters?.accountId && filters.accountId !== "all") {
    list = list.filter((t) => t.accountId === filters.accountId);
  }

  if (filters?.categoryId && filters.categoryId !== "all") {
    list = list.filter((t) =>
      t.ledgerEntries.some((le) => le.categoryId === filters.categoryId)
    );
  }

  if (filters?.status && filters.status !== "all") {
    list = list.filter((t) => t.status === filters.status);
  }

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    list = list.filter(
      (t) =>
        t.cleanDescription.toLowerCase().includes(q) ||
        (t.merchant && t.merchant.toLowerCase().includes(q)) ||
        t.rawDescription.toLowerCase().includes(q)
    );
  }

  return list.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return 0;
  });
}

function mapDbUser(u: typeof users.$inferSelect): UserRecord {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    passwordHash: u.passwordHash,
    role: u.role === "admin" ? "admin" : "user",
    isActive: u.isActive,
    sessionVersion: u.sessionVersion,
    baseCurrency: u.baseCurrency,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

type DbTransactionExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertDbTransactionWithLedger(
  trx: DbTransactionExecutor,
  tx: TransactionWithLedger
): Promise<{ dbTxId: string; dbUserId: string; dbAccountId: string }> {
  const dbTxId = toUuid(tx.id);
  const dbUserId = toUuid(tx.userId);
  const dbAccountId = toUuid(tx.accountId);

  await trx.insert(transactions).values({
    id: dbTxId,
    userId: dbUserId,
    accountId: dbAccountId,
    importBatchId: tx.importBatchId ? toUuid(tx.importBatchId) : null,
    date: tx.date,
    postedDate: tx.postedDate || tx.date,
    amount: tx.amount,
    currency: tx.currency,
    merchant: tx.merchant || null,
    cleanDescription: tx.cleanDescription,
    rawDescription: tx.rawDescription,
    status: tx.status,
    isSplit: tx.isSplit,
    isReversal: tx.isReversal,
    reversesTransactionId: tx.reversesTransactionId
      ? toUuid(tx.reversesTransactionId)
      : null,
    reversalReason: tx.reversalReason || null,
    deduplicationHash: tx.deduplicationHash || null,
    notes: tx.notes || null,
    createdAt: new Date(tx.createdAt),
  });

  if (tx.ledgerEntries.length > 0) {
    await trx.insert(ledgerEntries).values(
      tx.ledgerEntries.map((le) => ({
        id: toUuid(le.id),
        transactionId: dbTxId,
        accountId: dbAccountId,
        categoryId: le.categoryId ? toUuid(le.categoryId) : null,
        entryType: le.entryType,
        amount: le.amount,
        description: le.description || null,
        isReversal: le.isReversal,
        reversedEntryId: le.reversedEntryId ? toUuid(le.reversedEntryId) : null,
        sequenceIndex: le.sequenceIndex,
      }))
    );
  }

  await trx
    .update(accounts)
    .set({
      currentBalance: sql`${accounts.currentBalance} + ${tx.amount}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, dbAccountId));

  return { dbTxId, dbUserId, dbAccountId };
}

function applyInMemoryAccountBalanceDelta(
  userId: string,
  accountId: string,
  amountStr: string
): void {
  const account = inMemoryAccounts.find(
    (a) => a.id === accountId && a.userId === userId
  );
  if (account) {
    const nextBalance =
      (parseFloat(account.currentBalance) || 0) + (parseFloat(amountStr) || 0);
    account.currentBalance = nextBalance.toFixed(2);
  }
}

export const store = {
  isDbReady,

  getVerifiedSessionUserId: async (): Promise<string | null> => {
    const session = await getSessionPayload();
    if (session) {
      const user = await store.getUserById(session.userId);
      if (user && user.isActive && user.sessionVersion === session.sessionVersion) {
        return user.id;
      }
      return null;
    }

    if (process.env.NODE_ENV === "test") {
      return inMemoryUsers[0]?.id || null;
    }

    return null;
  },

  resolveActiveUserId: async (explicitUserId?: string): Promise<string | null> => {
    if (explicitUserId) return explicitUserId;
    return store.getVerifiedSessionUserId();
  },

  getWebhookAccounts: async (): Promise<AccountRecord[]> => {
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(accounts)
        .where(eq(accounts.isActive, true))
        .orderBy(asc(accounts.name));
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        institution: r.institution,
        accountType: r.accountType,
        accountNumberLast4: r.accountNumberLast4 || "",
        currency: r.currency,
        currentBalance: r.currentBalance,
        isOffsetAccount: r.isOffsetAccount,
        interestRatePct: r.interestRatePct || "0.00",
        isActive: r.isActive,
      }));
    }
    return inMemoryAccounts.filter((a) => a.isActive).map((a) => ({ ...a }));
  },

  getUserCount: async (): Promise<number> => {
    if (await isDbReady()) {
      const res = await db.select({ count: sql<number>`count(*)::int` }).from(users);
      return res[0]?.count ?? 0;
    }
    return inMemoryUsers.length;
  },

  getUsers: async (): Promise<Omit<UserRecord, "passwordHash">[]> => {
    if (await isDbReady()) {
      const rows = await db.select().from(users).orderBy(asc(users.createdAt));
      return rows.map((u) => {
        const mapped = mapDbUser(u);
        const { passwordHash: _ph, ...safe } = mapped;
        return safe;
      });
    }
    return inMemoryUsers.map(({ passwordHash: _ph, ...safe }) => ({ ...safe }));
  },

  getUserById: async (id: string): Promise<UserRecord | undefined> => {
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, toUuid(id)))
        .limit(1);
      return rows[0] ? mapDbUser(rows[0]) : undefined;
    }
    return inMemoryUsers.find((u) => u.id === id);
  },

  getUserByEmail: async (email: string): Promise<UserRecord | undefined> => {
    const normalized = email.trim().toLowerCase();
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1);
      return rows[0] ? mapDbUser(rows[0]) : undefined;
    }
    return inMemoryUsers.find((u) => u.email.toLowerCase() === normalized);
  },

  createUserWithWorkspace: async (input: {
    name: string;
    email: string;
    passwordHash: string;
    role: "admin" | "user";
    baseCurrency?: string;
    seedMode: "clean" | "demo";
  }): Promise<UserRecord> => {
    const userId = crypto.randomUUID();
    const normalizedEmail = input.email.trim().toLowerCase();
    const baseCurrency = (input.baseCurrency || "AUD").toUpperCase();
    const now = new Date();

    const newUser: UserRecord = {
      id: userId,
      email: normalizedEmail,
      name: input.name.trim(),
      passwordHash: input.passwordHash,
      role: input.role,
      isActive: true,
      sessionVersion: 1,
      baseCurrency,
      lastLoginAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    if (await isDbReady()) {
      await db.insert(users).values({
        id: userId,
        email: newUser.email,
        name: newUser.name,
        passwordHash: newUser.passwordHash,
        role: newUser.role,
        isActive: true,
        sessionVersion: 1,
        baseCurrency: newUser.baseCurrency,
        lastLoginAt: now,
      });
      await seedDbWorkspace(userId, input.seedMode);
      return newUser;
    }

    inMemoryUsers.push(newUser);
    seedInMemoryWorkspace(userId, input.seedMode, false);
    return { ...newUser };
  },

  updateUser: async (
    userId: string,
    updates: {
      name?: string;
      email?: string;
      baseCurrency?: string;
      role?: "admin" | "user";
      isActive?: boolean;
      passwordHash?: string;
      bumpSession?: boolean;
    }
  ): Promise<UserRecord | null> => {
    if (await isDbReady()) {
      const existing = await store.getUserById(userId);
      if (!existing) return null;

      const nextSessionVersion = updates.bumpSession
        ? existing.sessionVersion + 1
        : existing.sessionVersion;

      const [updated] = await db
        .update(users)
        .set({
          name: updates.name !== undefined ? updates.name.trim() : existing.name,
          email:
            updates.email !== undefined ? updates.email.trim().toLowerCase() : existing.email,
          baseCurrency:
            updates.baseCurrency !== undefined
              ? updates.baseCurrency.toUpperCase()
              : existing.baseCurrency,
          role: updates.role !== undefined ? updates.role : existing.role,
          isActive: updates.isActive !== undefined ? updates.isActive : existing.isActive,
          passwordHash:
            updates.passwordHash !== undefined ? updates.passwordHash : existing.passwordHash,
          sessionVersion: nextSessionVersion,
          updatedAt: new Date(),
        })
        .where(eq(users.id, toUuid(userId)))
        .returning();

      return updated ? mapDbUser(updated) : null;
    }

    const user = inMemoryUsers.find((u) => u.id === userId);
    if (!user) return null;

    if (updates.name !== undefined) user.name = updates.name.trim();
    if (updates.email !== undefined) user.email = updates.email.trim().toLowerCase();
    if (updates.baseCurrency !== undefined) user.baseCurrency = updates.baseCurrency.toUpperCase();
    if (updates.role !== undefined) user.role = updates.role;
    if (updates.isActive !== undefined) user.isActive = updates.isActive;
    if (updates.passwordHash !== undefined) user.passwordHash = updates.passwordHash;
    if (updates.bumpSession) user.sessionVersion += 1;
    user.updatedAt = new Date().toISOString();

    return { ...user };
  },

  updateLastLogin: async (userId: string): Promise<void> => {
    const now = new Date();
    if (await isDbReady()) {
      await db
        .update(users)
        .set({ lastLoginAt: now })
        .where(eq(users.id, toUuid(userId)));
      return;
    }
    const user = inMemoryUsers.find((u) => u.id === userId);
    if (user) {
      user.lastLoginAt = now.toISOString();
    }
  },

  resetUserWorkspace: async (
    userId: string,
    seedMode: "clean" | "demo"
  ): Promise<void> => {
    if (await isDbReady()) {
      await wipeDbUserWorkspace(userId);
      await seedDbWorkspace(userId, seedMode);
      return;
    }

    wipeInMemoryUserWorkspace(userId);
    seedInMemoryWorkspace(userId, seedMode, false);
  },

  deleteUser: async (userId: string): Promise<void> => {
    if (await isDbReady()) {
      await wipeDbUserWorkspace(userId);
      await db.delete(users).where(eq(users.id, toUuid(userId)));
      return;
    }

    wipeInMemoryUserWorkspace(userId);
    const idx = inMemoryUsers.findIndex((u) => u.id === userId);
    if (idx !== -1) {
      inMemoryUsers.splice(idx, 1);
    }
  },

  clearAllUsersForTest: async (): Promise<void> => {
    inMemoryUsers.length = 0;
    inMemoryAccounts.length = 0;
    inMemoryCategories.length = 0;
    inMemoryRules.length = 0;
    inMemoryTransactions.length = 0;
    inMemoryBatches.length = 0;
    inMemoryAuditLogs.length = 0;
    inMemoryBudgetConfigs.length = 0;
    inMemorySubscriptions.length = 0;
    inMemoryCashFlowItems.length = 0;
    inMemoryGoalConfigs.clear();
    inMemoryFhssContributions.length = 0;
  },

  getAccounts: async (explicitUserId?: string): Promise<AccountRecord[]> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, toUuid(userId)), eq(accounts.isActive, true)))
        .orderBy(asc(accounts.name));
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        institution: r.institution,
        accountType: r.accountType,
        accountNumberLast4: r.accountNumberLast4 || "",
        currency: r.currency,
        currentBalance: r.currentBalance,
        isOffsetAccount: r.isOffsetAccount,
        interestRatePct: r.interestRatePct || "0.00",
        isActive: r.isActive,
      }));
    }
    return inMemoryAccounts
      .filter((a) => a.userId === userId && a.isActive)
      .map((a) => ({ ...a }));
  },

  getAllAccounts: async (explicitUserId?: string): Promise<AccountRecord[]> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, toUuid(userId)))
        .orderBy(desc(accounts.isActive), asc(accounts.name));
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        institution: r.institution,
        accountType: r.accountType,
        accountNumberLast4: r.accountNumberLast4 || "",
        currency: r.currency,
        currentBalance: r.currentBalance,
        isOffsetAccount: r.isOffsetAccount,
        interestRatePct: r.interestRatePct || "0.00",
        isActive: r.isActive,
      }));
    }
    return inMemoryAccounts
      .filter((a) => a.userId === userId)
      .sort((a, b) =>
        a.isActive !== b.isActive ? (a.isActive ? -1 : 1) : a.name.localeCompare(b.name)
      )
      .map((a) => ({ ...a }));
  },

  getCategories: async (explicitUserId?: string): Promise<CategoryRecord[]> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(categories)
        .where(eq(categories.userId, toUuid(userId)))
        .orderBy(asc(categories.sortOrder), asc(categories.name));
      return rows.map((c) => ({
        id: c.id,
        userId: c.userId || userId,
        name: c.name,
        slug: c.slug,
        parentId: c.parentId ?? null,
        type: c.type,
        color: c.color,
        icon: c.icon,
        sortOrder: c.sortOrder ?? 0,
      }));
    }
    return inMemoryCategories
      .filter((c) => c.userId === userId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((c) => ({ ...c }));
  },

  getRules: async (explicitUserId?: string) => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(classificationRules)
        .where(eq(classificationRules.userId, toUuid(userId)))
        .orderBy(asc(classificationRules.priority));
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        priority: r.priority,
        field: r.field,
        matchType: r.matchType,
        matchValue: r.matchValue,
        targetCategoryId: r.targetCategoryId,
        autoApply: r.autoApply,
        isActive: r.isActive,
        matchCount: r.matchCount,
      }));
    }
    return inMemoryRules
      .filter((r) => r.userId === userId)
      .map((r) => ({ ...r }));
  },

  getBatches: async (explicitUserId?: string): Promise<ImportBatchItem[]> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(importBatches)
        .where(eq(importBatches.userId, toUuid(userId)))
        .orderBy(desc(importBatches.importedAt));
      return rows.map((b) => ({
        id: b.id,
        userId: b.userId,
        accountId: b.accountId,
        fileName: b.fileName,
        fileHash: b.fileHash,
        bankFormat: b.bankFormat,
        totalRows: b.totalRows,
        importedRows: b.importedRows,
        duplicateRows: b.duplicateRows,
        status: b.status,
        importedAt: b.importedAt.toISOString(),
      }));
    }
    return inMemoryBatches.filter((b) => b.userId === userId).map((b) => ({ ...b }));
  },

  getAuditLogs: async (explicitUserId?: string): Promise<AuditLogItem[]> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.userId, toUuid(userId)))
        .orderBy(desc(auditLogs.timestamp))
        .limit(100);
      return rows.map((a) => ({
        id: a.id,
        userId: a.userId || undefined,
        entityType: a.entityType,
        entityId: a.entityId,
        action: a.action,
        reason: a.reason || "",
        timestamp: a.timestamp.toISOString(),
      }));
    }
    return inMemoryAuditLogs.filter((a) => !a.userId || a.userId === userId);
  },

  getTransactions: async (
    filters?: {
      accountId?: string;
      categoryId?: string;
      search?: string;
      status?: string;
    },
    explicitUserId?: string
  ): Promise<TransactionWithLedger[]> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const [txRows, entryRows, accountRows, categoryRows] = await Promise.all([
        db
          .select()
          .from(transactions)
          .where(eq(transactions.userId, dbUserId))
          .orderBy(desc(transactions.date), desc(transactions.createdAt)),
        db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.sequenceIndex)),
        db.select().from(accounts).where(eq(accounts.userId, dbUserId)),
        db.select().from(categories).where(eq(categories.userId, dbUserId)),
      ]);

      const accMap = new Map(accountRows.map((a) => [a.id, a.name]));
      const catMap = new Map(categoryRows.map((c) => [c.id, c]));
      const entryMap = new Map<string, TransactionWithLedger["ledgerEntries"]>();

      for (const le of entryRows) {
        const cat = le.categoryId ? catMap.get(le.categoryId) : undefined;
        const parent = cat?.parentId ? catMap.get(cat.parentId) : undefined;
        const categoryDisplayName = cat
          ? parent
            ? `${parent.name} › ${cat.name}`
            : cat.name
          : "Uncategorized";
        const list = entryMap.get(le.transactionId) || [];
        list.push({
          id: le.id,
          transactionId: le.transactionId,
          accountId: le.accountId,
          categoryId: le.categoryId,
          categoryName: categoryDisplayName,
          categoryColor: cat?.color || "#64748b",
          entryType: le.entryType as "debit" | "credit",
          amount: le.amount,
          description: le.description,
          isReversal: le.isReversal,
          reversedEntryId: le.reversedEntryId,
          sequenceIndex: le.sequenceIndex,
        });
        entryMap.set(le.transactionId, list);
      }

      const mapped: TransactionWithLedger[] = txRows.map((t) => ({
        id: t.id,
        userId: t.userId,
        accountId: t.accountId,
        accountName: accMap.get(t.accountId) || "Account",
        importBatchId: t.importBatchId,
        date: t.date,
        postedDate: t.postedDate,
        amount: t.amount,
        currency: t.currency,
        merchant: t.merchant,
        cleanDescription: t.cleanDescription,
        rawDescription: t.rawDescription,
        status: t.status as "pending" | "posted" | "reversed",
        isSplit: t.isSplit,
        isReversal: t.isReversal,
        reversesTransactionId: t.reversesTransactionId,
        reversalReason: t.reversalReason,
        deduplicationHash: t.deduplicationHash,
        notes: t.notes,
        createdAt: t.createdAt.toISOString(),
        ledgerEntries: entryMap.get(t.id) || [],
      }));

      return filterTransactions(mapped, filters);
    }

    const memCatMap = new Map(
      inMemoryCategories.filter((c) => c.userId === userId).map((c) => [c.id, c])
    );
    const userTx = inMemoryTransactions
      .filter((t) => t.userId === userId)
      .map((t) => ({
        ...t,
        ledgerEntries: t.ledgerEntries.map((le) => {
          const cat = le.categoryId ? memCatMap.get(le.categoryId) : undefined;
          if (!cat) return le;
          const parent = cat.parentId ? memCatMap.get(cat.parentId) : undefined;
          return {
            ...le,
            categoryName: parent ? `${parent.name} › ${cat.name}` : cat.name,
            categoryColor: cat.color,
          };
        }),
      }));
    return filterTransactions(userTx, filters);
  },

  getTransactionById: async (
    id: string,
    explicitUserId?: string
  ): Promise<TransactionWithLedger | undefined> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return undefined;
    if (await isDbReady()) {
      const list = await store.getTransactions(undefined, userId);
      return list.find((t) => t.id === id || t.id === toUuid(id));
    }
    return inMemoryTransactions.find((t) => t.id === id && t.userId === userId);
  },

  addTransaction: async (tx: TransactionWithLedger): Promise<void> => {
    if (await isDbReady()) {
      await db.transaction(async (trx) => {
        const { dbTxId, dbUserId } = await insertDbTransactionWithLedger(trx, tx);
        await trx.insert(auditLogs).values({
          id: crypto.randomUUID(),
          userId: dbUserId,
          entityType: "transaction",
          entityId: dbTxId,
          action: tx.isReversal ? "REVERSAL" : tx.isSplit ? "SPLIT" : "INSERT",
          reason: tx.reversalReason || "Transaction entry",
        });
      });
      return;
    }

    inMemoryTransactions.unshift(tx);
    applyInMemoryAccountBalanceDelta(tx.userId, tx.accountId, tx.amount);

    inMemoryAuditLogs.unshift({
      id: crypto.randomUUID(),
      userId: tx.userId,
      entityType: "transaction",
      entityId: tx.id,
      action: tx.isReversal ? "REVERSAL" : tx.isSplit ? "SPLIT" : "INSERT",
      reason: tx.reversalReason || "Transaction entry",
      timestamp: new Date().toISOString(),
    });
  },

  markTransactionReversed: async (
    transactionId: string,
    explicitUserId?: string
  ): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return;
    if (await isDbReady()) {
      await db
        .update(transactions)
        .set({ status: "reversed", updatedAt: new Date() })
        .where(
          and(
            eq(transactions.id, toUuid(transactionId)),
            eq(transactions.userId, toUuid(userId))
          )
        );
      return;
    }

    const tx = inMemoryTransactions.find(
      (t) => t.id === transactionId && t.userId === userId
    );
    if (tx) {
      tx.status = "reversed";
    }
  },

  replaceTransactionImmutably: async (params: {
    originalTransactionId: string;
    reversalTx: TransactionWithLedger;
    replacementTx: TransactionWithLedger;
    editReason: string;
  }): Promise<void> => {
    const { originalTransactionId, reversalTx, replacementTx, editReason } = params;

    if (await isDbReady()) {
      const dbOrigId = toUuid(originalTransactionId);
      const dbUserId = toUuid(replacementTx.userId);

      await db.transaction(async (trx) => {
        const updatedOrig = await trx
          .update(transactions)
          .set({ status: "reversed", updatedAt: new Date() })
          .where(
            and(
              eq(transactions.id, dbOrigId),
              eq(transactions.userId, dbUserId),
              eq(transactions.status, "posted"),
              eq(transactions.isReversal, false)
            )
          )
          .returning({ id: transactions.id });

        if (updatedOrig.length === 0) {
          throw new Error("Original transaction is already reversed or unavailable for edit.");
        }

        const revInserted = await insertDbTransactionWithLedger(trx, reversalTx);
        await trx.insert(auditLogs).values({
          id: crypto.randomUUID(),
          userId: revInserted.dbUserId,
          entityType: "transaction",
          entityId: revInserted.dbTxId,
          action: "REVERSAL",
          previousState: { reversesTransactionId: originalTransactionId },
          reason: editReason,
          timestamp: new Date(reversalTx.createdAt),
        });

        const repInserted = await insertDbTransactionWithLedger(trx, replacementTx);
        await trx.insert(auditLogs).values({
          id: crypto.randomUUID(),
          userId: repInserted.dbUserId,
          entityType: "transaction",
          entityId: repInserted.dbTxId,
          action: "EDIT",
          previousState: { replacedTransactionId: originalTransactionId },
          reason: editReason,
          timestamp: new Date(replacementTx.createdAt),
        });
      });
      return;
    }

    const orig = inMemoryTransactions.find(
      (t) => t.id === originalTransactionId && t.userId === replacementTx.userId
    );
    if (!orig || orig.status !== "posted" || orig.isReversal) {
      throw new Error("Original transaction is already reversed or unavailable for edit.");
    }

    orig.status = "reversed";

    inMemoryTransactions.unshift(reversalTx);
    applyInMemoryAccountBalanceDelta(reversalTx.userId, reversalTx.accountId, reversalTx.amount);
    inMemoryAuditLogs.unshift({
      id: crypto.randomUUID(),
      userId: reversalTx.userId,
      entityType: "transaction",
      entityId: reversalTx.id,
      action: "REVERSAL",
      reason: editReason,
      timestamp: reversalTx.createdAt,
    });

    inMemoryTransactions.unshift(replacementTx);
    applyInMemoryAccountBalanceDelta(
      replacementTx.userId,
      replacementTx.accountId,
      replacementTx.amount
    );
    inMemoryAuditLogs.unshift({
      id: crypto.randomUUID(),
      userId: replacementTx.userId,
      entityType: "transaction",
      entityId: replacementTx.id,
      action: "EDIT",
      reason: editReason,
      timestamp: replacementTx.createdAt,
    });
  },

  hasDeduplicationHash: async (
    hash: string,
    explicitUserId?: string
  ): Promise<boolean> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return false;
    if (await isDbReady()) {
      const existing = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.deduplicationHash, hash),
            eq(transactions.userId, toUuid(userId))
          )
        )
        .limit(1);
      return existing.length > 0;
    }
    return inMemoryTransactions.some(
      (t) => t.deduplicationHash === hash && t.userId === userId
    );
  },

  updateLedgerEntryCategory: async (
    entryId: string,
    category: { id: string; name: string; color: string }
  ): Promise<void> => {
    if (await isDbReady()) {
      await db
        .update(ledgerEntries)
        .set({ categoryId: toUuid(category.id) })
        .where(eq(ledgerEntries.id, toUuid(entryId)));
      return;
    }

    for (const tx of inMemoryTransactions) {
      const entry = tx.ledgerEntries.find((le) => le.id === entryId);
      if (entry) {
        entry.categoryId = category.id;
        entry.categoryName = category.name;
        entry.categoryColor = category.color;
        break;
      }
    }
  },

  addRule: async (rule: RuleRecord): Promise<void> => {
    if (await isDbReady()) {
      await db.insert(classificationRules).values({
        id: toUuid(rule.id),
        userId: toUuid(rule.userId),
        name: rule.name,
        priority: rule.priority,
        field: rule.field,
        matchType: rule.matchType,
        matchValue: rule.matchValue,
        targetCategoryId: toUuid(rule.targetCategoryId),
        autoApply: rule.autoApply,
        isActive: rule.isActive,
        matchCount: rule.matchCount,
      });
      return;
    }
    inMemoryRules.push(rule);
  },

  incrementRuleMatchCount: async (ruleId: string): Promise<void> => {
    if (await isDbReady()) {
      await db
        .update(classificationRules)
        .set({
          matchCount: sql`${classificationRules.matchCount} + 1`,
          lastMatchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(classificationRules.id, toUuid(ruleId)));
      return;
    }

    const r = inMemoryRules.find((x) => x.id === ruleId);
    if (r) {
      r.matchCount = (r.matchCount || 0) + 1;
    }
  },

  updateRule: async (
    id: string,
    input: {
      name: string;
      priority: number;
      field: string;
      matchType: string;
      matchValue: string;
      targetCategoryId: string;
      isActive?: boolean;
    },
    explicitUserId?: string
  ): Promise<RuleRecord | null> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const trimmedName = input.name.trim();
    const trimmedVal = input.matchValue.trim();

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const [updated] = await db
        .update(classificationRules)
        .set({
          name: trimmedName,
          priority: input.priority || 100,
          field: input.field,
          matchType: input.matchType,
          matchValue: trimmedVal,
          targetCategoryId: toUuid(input.targetCategoryId),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(classificationRules.id, toUuid(id)),
            eq(classificationRules.userId, dbUserId)
          )
        )
        .returning();

      if (!updated) return null;
      return {
        id: updated.id,
        userId: updated.userId,
        name: updated.name,
        priority: updated.priority,
        field: updated.field,
        matchType: updated.matchType,
        matchValue: updated.matchValue,
        targetCategoryId: updated.targetCategoryId,
        autoApply: updated.autoApply,
        isActive: updated.isActive,
        matchCount: updated.matchCount,
      };
    }

    const rule = inMemoryRules.find((r) => r.id === id && r.userId === userId);
    if (!rule) return null;

    rule.name = trimmedName;
    rule.priority = input.priority || 100;
    rule.field = input.field;
    rule.matchType = input.matchType;
    rule.matchValue = trimmedVal;
    rule.targetCategoryId = input.targetCategoryId;
    if (input.isActive !== undefined) {
      rule.isActive = input.isActive;
    }

    return { ...rule };
  },

  toggleRuleActive: async (
    id: string,
    isActive: boolean,
    explicitUserId?: string
  ): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return;

    if (await isDbReady()) {
      await db
        .update(classificationRules)
        .set({ isActive, updatedAt: new Date() })
        .where(
          and(
            eq(classificationRules.id, toUuid(id)),
            eq(classificationRules.userId, toUuid(userId))
          )
        );
      return;
    }

    const rule = inMemoryRules.find((r) => r.id === id && r.userId === userId);
    if (rule) {
      rule.isActive = isActive;
    }
  },

  deleteRule: async (id: string, explicitUserId?: string): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    if (await isDbReady()) {
      await db
        .delete(classificationRules)
        .where(
          and(
            eq(classificationRules.id, toUuid(id)),
            eq(classificationRules.userId, toUuid(userId))
          )
        );
      return;
    }

    const idx = inMemoryRules.findIndex((r) => r.id === id && r.userId === userId);
    if (idx !== -1) {
      inMemoryRules.splice(idx, 1);
    }
  },

  addImportBatch: async (batch: ImportBatchItem): Promise<void> => {
    if (await isDbReady()) {
      await db.insert(importBatches).values({
        id: toUuid(batch.id),
        userId: toUuid(batch.userId),
        accountId: toUuid(batch.accountId),
        fileName: batch.fileName,
        fileHash: batch.fileHash,
        bankFormat: batch.bankFormat,
        totalRows: batch.totalRows,
        importedRows: batch.importedRows,
        duplicateRows: batch.duplicateRows,
        status: batch.status,
        importedAt: new Date(batch.importedAt),
      });
      return;
    }
    inMemoryBatches.unshift(batch);
  },

  getBudgets: async (explicitUserId?: string): Promise<BudgetItem[]> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    const allTransactions = await store.getTransactions(undefined, userId);

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const [budgetRows, categoryRows] = await Promise.all([
        db.select().from(budgets).where(eq(budgets.userId, dbUserId)),
        db.select().from(categories).where(eq(categories.userId, dbUserId)),
      ]);
      const catMap = new Map(categoryRows.map((c) => [c.id, c]));
      const childrenByParent = new Map<string, string[]>();
      for (const c of categoryRows) {
        if (c.parentId) {
          const list = childrenByParent.get(c.parentId) || [];
          list.push(toUuid(c.id));
          childrenByParent.set(c.parentId, list);
        }
      }

      return budgetRows.map((b) => {
        const cat = catMap.get(b.categoryId);
        const parent = cat?.parentId ? catMap.get(cat.parentId) : undefined;
        const matchSet = new Set<string>([
          toUuid(b.categoryId),
          ...(childrenByParent.get(b.categoryId) || []),
        ]);
        return buildBudgetItem(
          {
            id: b.id,
            categoryId: b.categoryId,
            categoryName: cat?.name || "Category",
            categorySlug: cat?.slug || "",
            categoryColor: cat?.color || "#0ea5e9",
            parentCategoryId: parent ? parent.id : null,
            parentCategoryName: parent ? parent.name : null,
            alertThresholdPct: b.alertThresholdPct ?? 80,
            period: (b.period as "monthly" | "weekly" | "yearly") || "monthly",
            allocatedAmount: parseFloat(b.amount),
            startDate: b.startDate,
          },
          allTransactions,
          matchSet
        );
      });
    }

    const userCats = inMemoryCategories.filter((c) => c.userId === userId);
    const catMap = new Map(userCats.map((c) => [c.id, c]));
    const childrenByParent = new Map<string, string[]>();
    for (const c of userCats) {
      if (c.parentId) {
        const list = childrenByParent.get(c.parentId) || [];
        list.push(toUuid(c.id));
        childrenByParent.set(c.parentId, list);
      }
    }

    return inMemoryBudgetConfigs
      .filter((cfg) => cfg.userId === userId)
      .map((cfg) => {
        const cat = catMap.get(cfg.categoryId);
        const parent = cat?.parentId ? catMap.get(cat.parentId) : undefined;
        const matchSet = new Set<string>([
          toUuid(cfg.categoryId),
          ...(childrenByParent.get(cfg.categoryId) || []),
        ]);
        return buildBudgetItem(
          cat
            ? {
                ...cfg,
                categoryName: cat.name,
                categoryColor: cat.color,
                parentCategoryId: parent ? parent.id : null,
                parentCategoryName: parent ? parent.name : null,
              }
            : {
                ...cfg,
                parentCategoryId: null,
                parentCategoryName: null,
              },
          allTransactions,
          matchSet
        );
      });
  },

  addBudget: async (
    input: {
      categoryId: string;
      categoryName: string;
      categoryColor?: string;
      allocatedAmount: number;
      period: "monthly" | "weekly" | "yearly";
      alertThresholdPct?: number;
    },
    explicitUserId?: string
  ): Promise<BudgetItem> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const userCats = await store.getCategories(userId);
    const cat = userCats.find(
      (c) => c.id === input.categoryId || toUuid(c.id) === toUuid(input.categoryId)
    );
    const resolvedCategoryId = cat?.id || input.categoryId;
    const parent = cat?.parentId
      ? userCats.find((c) => c.id === cat.parentId)
      : undefined;
    const matchSet = new Set<string>([
      toUuid(resolvedCategoryId),
      ...userCats
        .filter((c) => c.parentId === resolvedCategoryId)
        .map((c) => toUuid(c.id)),
    ]);
    const alertThresholdPct = clampBudgetThreshold(input.alertThresholdPct);
    const startDate = new Date().toISOString().split("T")[0];

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const dbCatId = toUuid(resolvedCategoryId);
      const existingRows = await db
        .select()
        .from(budgets)
        .where(and(eq(budgets.userId, dbUserId), eq(budgets.categoryId, dbCatId)))
        .limit(1);

      let budgetId: string;
      let effectiveStartDate = startDate;
      if (existingRows.length > 0) {
        budgetId = existingRows[0].id;
        effectiveStartDate = existingRows[0].startDate;
        await db
          .update(budgets)
          .set({
            period: input.period,
            amount: input.allocatedAmount.toFixed(2),
            alertThresholdPct,
            updatedAt: new Date(),
          })
          .where(eq(budgets.id, budgetId));
      } else {
        budgetId = crypto.randomUUID();
        await db.insert(budgets).values({
          id: budgetId,
          userId: dbUserId,
          categoryId: dbCatId,
          period: input.period,
          amount: input.allocatedAmount.toFixed(2),
          alertThresholdPct,
          startDate,
        });
      }

      const allTransactions = await store.getTransactions(undefined, userId);
      return buildBudgetItem(
        {
          id: budgetId,
          categoryId: resolvedCategoryId,
          categoryName: cat?.name || input.categoryName,
          categorySlug: cat?.slug || "",
          categoryColor: cat?.color || input.categoryColor || "#0ea5e9",
          parentCategoryId: parent ? parent.id : null,
          parentCategoryName: parent ? parent.name : null,
          alertThresholdPct,
          period: input.period,
          allocatedAmount: input.allocatedAmount,
          startDate: effectiveStartDate,
        },
        allTransactions,
        matchSet
      );
    }

    const existingCfg = inMemoryBudgetConfigs.find(
      (cfg) =>
        cfg.userId === userId &&
        (cfg.categoryId === resolvedCategoryId ||
          toUuid(cfg.categoryId) === toUuid(resolvedCategoryId))
    );

    let cfg: (typeof inMemoryBudgetConfigs)[number];
    if (existingCfg) {
      existingCfg.categoryName = cat?.name || input.categoryName;
      existingCfg.categorySlug = cat?.slug || existingCfg.categorySlug;
      existingCfg.categoryColor =
        cat?.color || input.categoryColor || existingCfg.categoryColor;
      existingCfg.period = input.period;
      existingCfg.allocatedAmount = input.allocatedAmount;
      existingCfg.alertThresholdPct = alertThresholdPct;
      cfg = existingCfg;
    } else {
      cfg = {
        id: crypto.randomUUID(),
        userId,
        categoryId: resolvedCategoryId,
        categoryName: cat?.name || input.categoryName,
        categorySlug: cat?.slug || "",
        categoryColor: cat?.color || input.categoryColor || "#0ea5e9",
        period: input.period,
        allocatedAmount: input.allocatedAmount,
        alertThresholdPct,
        startDate,
      };
      inMemoryBudgetConfigs.push(cfg);
    }

    const allTransactions = await store.getTransactions(undefined, userId);
    return buildBudgetItem(
      {
        ...cfg,
        parentCategoryId: parent ? parent.id : null,
        parentCategoryName: parent ? parent.name : null,
      },
      allTransactions,
      matchSet
    );
  },

  updateBudget: async (
    id: string,
    input: {
      allocatedAmount: number;
      period: "monthly" | "weekly" | "yearly";
      alertThresholdPct?: number;
    },
    explicitUserId?: string
  ): Promise<BudgetItem | null> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const userCats = await store.getCategories(userId);
    const alertThresholdPct = clampBudgetThreshold(input.alertThresholdPct);

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const [updated] = await db
        .update(budgets)
        .set({
          amount: input.allocatedAmount.toFixed(2),
          period: input.period,
          alertThresholdPct,
          updatedAt: new Date(),
        })
        .where(and(eq(budgets.id, toUuid(id)), eq(budgets.userId, dbUserId)))
        .returning();

      if (!updated) return null;

      const cat = userCats.find((c) => toUuid(c.id) === toUuid(updated.categoryId));
      const parent = cat?.parentId
        ? userCats.find((c) => c.id === cat.parentId)
        : undefined;
      const matchSet = new Set<string>([
        toUuid(updated.categoryId),
        ...userCats
          .filter((c) => c.parentId && toUuid(c.parentId) === toUuid(updated.categoryId))
          .map((c) => toUuid(c.id)),
      ]);
      const allTransactions = await store.getTransactions(undefined, userId);

      return buildBudgetItem(
        {
          id: updated.id,
          categoryId: updated.categoryId,
          categoryName: cat?.name || "Category",
          categorySlug: cat?.slug || "",
          categoryColor: cat?.color || "#0ea5e9",
          parentCategoryId: parent ? parent.id : null,
          parentCategoryName: parent ? parent.name : null,
          alertThresholdPct: updated.alertThresholdPct ?? alertThresholdPct,
          period: (updated.period as "monthly" | "weekly" | "yearly") || "monthly",
          allocatedAmount: parseFloat(updated.amount),
          startDate: updated.startDate,
        },
        allTransactions,
        matchSet
      );
    }

    const cfg = inMemoryBudgetConfigs.find((b) => b.id === id && b.userId === userId);
    if (!cfg) return null;

    cfg.allocatedAmount = input.allocatedAmount;
    cfg.period = input.period;
    cfg.alertThresholdPct = alertThresholdPct;

    const cat = userCats.find((c) => c.id === cfg.categoryId);
    const parent = cat?.parentId
      ? userCats.find((c) => c.id === cat.parentId)
      : undefined;
    const matchSet = new Set<string>([
      toUuid(cfg.categoryId),
      ...userCats
        .filter((c) => c.parentId === cfg.categoryId)
        .map((c) => toUuid(c.id)),
    ]);
    const allTransactions = await store.getTransactions(undefined, userId);

    return buildBudgetItem(
      {
        ...cfg,
        categoryName: cat?.name || cfg.categoryName,
        categoryColor: cat?.color || cfg.categoryColor,
        parentCategoryId: parent ? parent.id : null,
        parentCategoryName: parent ? parent.name : null,
      },
      allTransactions,
      matchSet
    );
  },

  deleteBudget: async (id: string, explicitUserId?: string): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    if (await isDbReady()) {
      await db
        .delete(budgets)
        .where(and(eq(budgets.id, toUuid(id)), eq(budgets.userId, toUuid(userId))));
      return;
    }

    const idx = inMemoryBudgetConfigs.findIndex((b) => b.id === id && b.userId === userId);
    if (idx !== -1) {
      inMemoryBudgetConfigs.splice(idx, 1);
    }
  },

  getSubscriptions: async (explicitUserId?: string): Promise<SubscriptionItem[]> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const [subRows, catRows] = await Promise.all([
        db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.userId, dbUserId))
          .orderBy(asc(subscriptions.name)),
        db.select().from(categories).where(eq(categories.userId, dbUserId)),
      ]);
      const catMap = new Map(catRows.map((c) => [c.id, c]));

      return subRows.map((s) => {
        const cat = s.categoryId ? catMap.get(s.categoryId) : undefined;
        return {
          id: s.id,
          userId: s.userId,
          name: s.name,
          merchant: s.merchant || undefined,
          amount: parseFloat(s.amount),
          billingCycle: s.billingCycle as SubscriptionItem["billingCycle"],
          annualizedAmount: parseFloat(s.annualizedAmount),
          startDate: s.startDate,
          nextBillingDate: s.nextBillingDate,
          categoryId: s.categoryId || undefined,
          categoryName: cat?.name || "Subscriptions & SaaS",
          categoryColor: cat?.color || "#ec4899",
          isActive: s.isActive,
          notes: s.notes || undefined,
        };
      });
    }
    return inMemorySubscriptions
      .filter((s) => s.userId === userId)
      .map((s) => ({ ...s }));
  },

  addSubscription: async (
    input: {
      name: string;
      merchant?: string;
      amount: number;
      billingCycle: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annually";
      startDate: string;
      nextBillingDate: string;
      categoryName?: string;
    },
    explicitUserId?: string
  ): Promise<SubscriptionItem> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }
    const id = crypto.randomUUID();
    const annualized = calculateAnnualizedSubscriptionCost(input.amount, input.billingCycle);
    const cats = await store.getCategories(userId);
    const matchedCat = cats.find((c) => c.name === (input.categoryName || "Subscriptions & SaaS"));

    const newSub: SubscriptionItem = {
      id,
      userId,
      name: input.name,
      merchant: input.merchant || input.name,
      amount: input.amount,
      billingCycle: input.billingCycle,
      annualizedAmount: annualized,
      startDate: input.startDate,
      nextBillingDate: input.nextBillingDate,
      categoryId: matchedCat?.id,
      categoryName: matchedCat?.name || input.categoryName || "Subscriptions & SaaS",
      categoryColor: matchedCat?.color || "#ec4899",
      isActive: true,
    };

    if (await isDbReady()) {
      await db.insert(subscriptions).values({
        id,
        userId: toUuid(userId),
        categoryId: matchedCat ? toUuid(matchedCat.id) : null,
        name: newSub.name,
        merchant: newSub.merchant || null,
        amount: newSub.amount.toFixed(2),
        billingCycle: newSub.billingCycle,
        annualizedAmount: newSub.annualizedAmount.toFixed(2),
        startDate: newSub.startDate,
        nextBillingDate: newSub.nextBillingDate,
        isActive: true,
      });
    } else {
      inMemorySubscriptions.push(newSub);
    }

    return newSub;
  },

  toggleSubscription: async (
    id: string,
    isActive: boolean,
    explicitUserId?: string
  ): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return;
    if (await isDbReady()) {
      await db
        .update(subscriptions)
        .set({ isActive, updatedAt: new Date() })
        .where(
          and(
            eq(subscriptions.id, toUuid(id)),
            eq(subscriptions.userId, toUuid(userId))
          )
        );
      return;
    }

    const sub = inMemorySubscriptions.find((s) => s.id === id && s.userId === userId);
    if (sub) {
      sub.isActive = isActive;
    }
  },

  getPropertyGoalConfig: async (explicitUserId?: string): Promise<PropertyGoalConfig | null> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return null;

    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(propertyGoals)
        .where(eq(propertyGoals.userId, toUuid(userId)))
        .limit(1);
      if (rows.length === 0) return null;

      const g = rows[0];
      const rawLoc = g.locationCode || "";
      const locationCode: PropertyLocationCode =
        rawLoc === "CUSTOM"
          ? "CUSTOM"
          : isAustralianStateCode(rawLoc)
          ? rawLoc
          : g.targetCity === "Melbourne"
          ? "VIC"
          : "SA";
      const targetDate = g.targetDate || `${g.targetYear || 2029}-07-01`;
      const targetYear =
        g.targetYear || parseInt(targetDate.slice(0, 4), 10) || new Date().getFullYear() + 3;
      const validDhoasModes: DhoasConfigMode[] = ["auto", "tier1", "tier2", "tier3", "custom"];
      const dhoasMode: DhoasConfigMode = validDhoasModes.includes(g.dhoasMode as DhoasConfigMode)
        ? (g.dhoasMode as DhoasConfigMode)
        : "auto";

      return {
        userId,
        goalName: g.goalName || "Mortgage Deposit Goal",
        targetDate,
        targetYear,
        locationCode,
        targetCity: g.targetCity || (locationCode === "CUSTOM" ? "Custom Location" : "Adelaide"),
        customLocationName: g.customLocationName ?? null,
        isFirstHomeBuyer: g.isFirstHomeBuyer ?? true,
        targetPrice: parseFloat(g.targetPropertyPrice) || 0,
        depositPct: parseFloat(g.targetDepositPct) || 0,
        customStampDuty: g.customStampDuty !== null ? parseFloat(g.customStampDuty) : null,
        conveyancingFees: parseFloat(g.estimatedConveyancingAndFees) || 0,
        estimatedLmi: parseFloat(g.estimatedLmi) || 0,
        useLiveLiquidSavings: g.useLiveLiquidSavings ?? true,
        currentSavingsAllocated: parseFloat(g.currentSavingsAllocated) || 0,
        monthlySavingsPace: parseFloat(g.monthlySavingsContribution) || 0,
        useFhss: g.useFhss ?? false,
        fhssMarginalTaxRatePct: parseFloat(g.fhssMarginalTaxRatePct) || 32.5,
        useDhoas: g.useDhoas ?? false,
        dhoasMode,
        dhoasEnlistmentDate: g.dhoasEnlistmentDate || "2021-03-01",
        dhoasServiceType: g.dhoasServiceType === "reserve" ? "reserve" : "permanent",
        dhoasMonthlySubsidy:
          g.dhoasMonthlySubsidy !== null ? parseFloat(g.dhoasMonthlySubsidy) : null,
        dhoasLoanCap: g.dhoasLoanCap !== null ? parseFloat(g.dhoasLoanCap) : null,
        dhoasLumpSumAmount: parseFloat(g.dhoasLumpSumAmount) || 0,
        notes: g.notes ?? null,
      };
    }

    const existing = inMemoryGoalConfigs.get(userId);
    return existing ? { ...existing } : null;
  },

  savePropertyGoalConfig: async (
    input: Omit<PropertyGoalConfig, "userId">,
    explicitUserId?: string
  ): Promise<PropertyGoalConfig> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const saved: PropertyGoalConfig = {
      ...input,
      userId,
    };

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const stampDuty = calculateStampDuty(
        input.locationCode,
        input.targetPrice,
        input.isFirstHomeBuyer,
        input.customStampDuty
      );
      const depositAmount = (input.targetPrice * input.depositPct) / 100;

      const values = {
        goalName: input.goalName,
        targetDate: input.targetDate,
        targetYear: input.targetYear,
        locationCode: input.locationCode,
        targetCity: input.targetCity,
        customLocationName: input.customLocationName ?? null,
        isFirstHomeBuyer: input.isFirstHomeBuyer,
        targetPropertyPrice: input.targetPrice.toFixed(2),
        targetDepositPct: input.depositPct.toFixed(2),
        targetDepositAmount: depositAmount.toFixed(2),
        estimatedStampDuty: stampDuty.toFixed(2),
        customStampDuty:
          input.customStampDuty !== null ? input.customStampDuty.toFixed(2) : null,
        estimatedLmi: input.estimatedLmi.toFixed(2),
        estimatedConveyancingAndFees: input.conveyancingFees.toFixed(2),
        useLiveLiquidSavings: input.useLiveLiquidSavings,
        currentSavingsAllocated: input.currentSavingsAllocated.toFixed(2),
        monthlySavingsContribution: input.monthlySavingsPace.toFixed(2),
        useFhss: input.useFhss,
        fhssMarginalTaxRatePct: input.fhssMarginalTaxRatePct.toFixed(2),
        useDhoas: input.useDhoas,
        dhoasMode: input.dhoasMode,
        dhoasEnlistmentDate: input.dhoasEnlistmentDate || null,
        dhoasServiceType: input.dhoasServiceType,
        dhoasMonthlySubsidy:
          input.dhoasMonthlySubsidy !== null ? input.dhoasMonthlySubsidy.toFixed(2) : null,
        dhoasLoanCap: input.dhoasLoanCap !== null ? input.dhoasLoanCap.toFixed(2) : null,
        dhoasLumpSumAmount: input.dhoasLumpSumAmount.toFixed(2),
        notes: input.notes ?? null,
        updatedAt: new Date(),
      };

      const existingRows = await db
        .select({ id: propertyGoals.id })
        .from(propertyGoals)
        .where(eq(propertyGoals.userId, dbUserId))
        .limit(1);

      if (existingRows.length > 0) {
        await db
          .update(propertyGoals)
          .set(values)
          .where(eq(propertyGoals.userId, dbUserId));
      } else {
        await db.insert(propertyGoals).values({
          id: crypto.randomUUID(),
          userId: dbUserId,
          ...values,
        });
      }
      return saved;
    }

    inMemoryGoalConfigs.set(userId, saved);
    return { ...saved };
  },

  deletePropertyGoalConfig: async (explicitUserId?: string): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }
    if (await isDbReady()) {
      await db.delete(propertyGoals).where(eq(propertyGoals.userId, toUuid(userId)));
      return;
    }
    inMemoryGoalConfigs.delete(userId);
  },

  getFhssContributions: async (
    explicitUserId?: string
  ): Promise<FhssContributionRecord[]> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(fhssContributions)
        .where(eq(fhssContributions.userId, toUuid(userId)))
        .orderBy(asc(fhssContributions.contributionDate));
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        amount: parseFloat(r.amount),
        contributionType: r.contributionType as "concessional" | "non_concessional",
        date: r.contributionDate,
        financialYear: r.financialYear,
        fundName: r.superFundName,
        bpayRef: r.bpayReference || undefined,
      }));
    }
    return inMemoryFhssContributions
      .filter((c) => c.userId === userId)
      .map((c) => ({ ...c }));
  },

  addFhssContribution: async (
    input: {
      amount: number;
      financialYear: string;
      contributionType: "concessional" | "non_concessional";
      fundName: string;
      bpayRef?: string;
    },
    explicitUserId?: string
  ): Promise<FhssContributionRecord> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }
    const newRecord: FhssContributionRecord = {
      id: crypto.randomUUID(),
      userId,
      amount: input.amount,
      contributionType: input.contributionType,
      date: new Date().toISOString().split("T")[0],
      financialYear: input.financialYear,
      fundName: input.fundName || "ADF Super",
      bpayRef: input.bpayRef || `BPAY-${Math.floor(10000 + Math.random() * 90000)}`,
    };

    if (await isDbReady()) {
      await db.insert(fhssContributions).values({
        id: newRecord.id,
        userId: toUuid(userId),
        financialYear: newRecord.financialYear,
        contributionDate: newRecord.date,
        amount: newRecord.amount.toFixed(2),
        contributionType: newRecord.contributionType,
        superFundName: newRecord.fundName,
        bpayReference: newRecord.bpayRef || null,
      });
    } else {
      inMemoryFhssContributions.push(newRecord);
    }

    return newRecord;
  },

  deleteFhssContribution: async (id: string, explicitUserId?: string): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }
    if (await isDbReady()) {
      await db
        .delete(fhssContributions)
        .where(
          and(
            eq(fhssContributions.id, toUuid(id)),
            eq(fhssContributions.userId, toUuid(userId))
          )
        );
      return;
    }

    const idx = inMemoryFhssContributions.findIndex(
      (c) => c.id === id && c.userId === userId
    );
    if (idx !== -1) {
      inMemoryFhssContributions.splice(idx, 1);
    }
  },

  getCashFlowScheduledItems: async (
    explicitUserId?: string
  ): Promise<CashFlowScheduledItemRecord[]> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const [rows, accountRows] = await Promise.all([
        db
          .select()
          .from(cashFlowScheduledItems)
          .where(eq(cashFlowScheduledItems.userId, dbUserId))
          .orderBy(asc(cashFlowScheduledItems.nextOccurrenceDate)),
        db.select().from(accounts).where(eq(accounts.userId, dbUserId)),
      ]);
      const accMap = new Map(accountRows.map((a) => [a.id, a.name]));

      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        accountId: r.accountId,
        accountName: accMap.get(r.accountId) || "Account",
        name: r.name,
        type: r.type === "income" ? "income" : "expense",
        amount: parseFloat(r.amount) || 0,
        frequency: r.frequency as CashFlowFrequency,
        startDate: r.startDate,
        endDate: r.endDate ?? null,
        nextOccurrenceDate: r.nextOccurrenceDate,
        isActive: r.isActive,
      }));
    }

    const userAccounts = inMemoryAccounts.filter((a) => a.userId === userId);
    const accMap = new Map(userAccounts.map((a) => [a.id, a.name]));
    return inMemoryCashFlowItems
      .filter((item) => item.userId === userId)
      .sort((a, b) => a.nextOccurrenceDate.localeCompare(b.nextOccurrenceDate))
      .map((item) => ({
        ...item,
        accountName: accMap.get(item.accountId) || item.accountName || "Account",
      }));
  },

  addCashFlowScheduledItem: async (
    input: {
      accountId?: string;
      name: string;
      type: "income" | "expense";
      amount: number;
      frequency: CashFlowFrequency;
      nextOccurrenceDate: string;
      startDate?: string;
      endDate?: string | null;
    },
    explicitUserId?: string
  ): Promise<CashFlowScheduledItemRecord> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const userAccounts = await store.getAccounts(userId);
    const matchedAccount =
      (input.accountId ? userAccounts.find((a) => a.id === input.accountId) : undefined) ||
      userAccounts[0];
    if (!matchedAccount) {
      throw new Error("No active account found.");
    }

    const startDate = input.startDate || input.nextOccurrenceDate;
    const newItem: CashFlowScheduledItemRecord = {
      id: crypto.randomUUID(),
      userId,
      accountId: matchedAccount.id,
      accountName: matchedAccount.name,
      name: input.name.trim(),
      type: input.type,
      amount: Math.round(input.amount * 100) / 100,
      frequency: input.frequency,
      startDate,
      endDate: input.endDate ?? null,
      nextOccurrenceDate: input.nextOccurrenceDate,
      isActive: true,
    };

    if (await isDbReady()) {
      await db.insert(cashFlowScheduledItems).values({
        id: newItem.id,
        userId: toUuid(userId),
        accountId: toUuid(newItem.accountId),
        name: newItem.name,
        type: newItem.type,
        amount: newItem.amount.toFixed(2),
        frequency: newItem.frequency,
        startDate: newItem.startDate,
        endDate: newItem.endDate,
        nextOccurrenceDate: newItem.nextOccurrenceDate,
        isActive: true,
      });
    } else {
      inMemoryCashFlowItems.push(newItem);
    }

    return newItem;
  },

  toggleCashFlowScheduledItem: async (
    id: string,
    isActive: boolean,
    explicitUserId?: string
  ): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return;

    if (await isDbReady()) {
      await db
        .update(cashFlowScheduledItems)
        .set({ isActive, updatedAt: new Date() })
        .where(
          and(
            eq(cashFlowScheduledItems.id, toUuid(id)),
            eq(cashFlowScheduledItems.userId, toUuid(userId))
          )
        );
      return;
    }

    const item = inMemoryCashFlowItems.find((i) => i.id === id && i.userId === userId);
    if (item) {
      item.isActive = isActive;
    }
  },

  deleteCashFlowScheduledItem: async (
    id: string,
    explicitUserId?: string
  ): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return;

    if (await isDbReady()) {
      await db
        .delete(cashFlowScheduledItems)
        .where(
          and(
            eq(cashFlowScheduledItems.id, toUuid(id)),
            eq(cashFlowScheduledItems.userId, toUuid(userId))
          )
        );
      return;
    }

    const idx = inMemoryCashFlowItems.findIndex((i) => i.id === id && i.userId === userId);
    if (idx !== -1) {
      inMemoryCashFlowItems.splice(idx, 1);
    }
  },

  addCategory: async (
    input: {
      name: string;
      type: string;
      color: string;
      icon?: string;
      parentId?: string | null;
      sortOrder?: number;
    },
    explicitUserId?: string
  ): Promise<CategoryRecord> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const existing = await store.getCategories(userId);
    const maxOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), -10);
    const newCat: CategoryRecord = {
      id: crypto.randomUUID(),
      userId,
      name: input.name.trim(),
      slug: slugifyCategoryName(input.name),
      parentId: input.parentId || null,
      type: input.type,
      color: input.color,
      icon: input.icon || "Tag",
      sortOrder: input.sortOrder ?? maxOrder + 10,
    };

    if (await isDbReady()) {
      await db.insert(categories).values({
        id: newCat.id,
        userId: toUuid(userId),
        name: newCat.name,
        slug: newCat.slug,
        parentId: newCat.parentId ? toUuid(newCat.parentId) : null,
        type: newCat.type,
        color: newCat.color,
        icon: newCat.icon,
        isSystem: false,
        sortOrder: newCat.sortOrder,
      });
    } else {
      inMemoryCategories.push(newCat);
    }

    return newCat;
  },

  updateCategory: async (
    id: string,
    input: {
      name: string;
      type: string;
      color: string;
      icon?: string;
      parentId?: string | null;
    },
    explicitUserId?: string
  ): Promise<CategoryRecord | null> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const trimmedName = input.name.trim();
    const nextSlug = slugifyCategoryName(trimmedName);
    const nextParentId = input.parentId || null;

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const dbCatId = toUuid(id);
      const [updated] = await db
        .update(categories)
        .set({
          name: trimmedName,
          slug: nextSlug,
          type: input.type,
          color: input.color,
          icon: input.icon || "Tag",
          parentId: nextParentId ? toUuid(nextParentId) : null,
          updatedAt: new Date(),
        })
        .where(and(eq(categories.id, dbCatId), eq(categories.userId, dbUserId)))
        .returning();

      if (!updated) return null;

      // Keep direct sub-categories' type aligned when editing a top-level category
      if (!updated.parentId) {
        await db
          .update(categories)
          .set({ type: updated.type, updatedAt: new Date() })
          .where(and(eq(categories.parentId, dbCatId), eq(categories.userId, dbUserId)));
      }

      return {
        id: updated.id,
        userId: updated.userId || userId,
        name: updated.name,
        slug: updated.slug,
        parentId: updated.parentId ?? null,
        type: updated.type,
        color: updated.color,
        icon: updated.icon,
        sortOrder: updated.sortOrder ?? 0,
      };
    }

    const target = inMemoryCategories.find((c) => c.id === id && c.userId === userId);
    if (!target) return null;

    target.name = trimmedName;
    target.slug = nextSlug;
    target.type = input.type;
    target.color = input.color;
    target.icon = input.icon || target.icon || "Tag";
    target.parentId = nextParentId;

    if (!nextParentId) {
      for (const child of inMemoryCategories) {
        if (child.userId === userId && child.parentId === id) {
          child.type = input.type;
        }
      }
    }

    for (const b of inMemoryBudgetConfigs) {
      if (b.userId === userId && b.categoryId === id) {
        b.categoryName = trimmedName;
        b.categoryColor = input.color;
      }
    }

    return { ...target };
  },

  deleteCategory: async (id: string, explicitUserId?: string): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const dbCatId = toUuid(id);
      await db.transaction(async (trx) => {
        // Promote sub-categories to top-level before deleting parent
        await trx
          .update(categories)
          .set({ parentId: null, updatedAt: new Date() })
          .where(and(eq(categories.parentId, dbCatId), eq(categories.userId, dbUserId)));

        await trx
          .delete(categories)
          .where(and(eq(categories.id, dbCatId), eq(categories.userId, dbUserId)));
      });
      return;
    }

    for (const c of inMemoryCategories) {
      if (c.userId === userId && c.parentId === id) {
        c.parentId = null;
      }
    }

    const catIdx = inMemoryCategories.findIndex((c) => c.id === id && c.userId === userId);
    if (catIdx !== -1) {
      inMemoryCategories.splice(catIdx, 1);
    }

    for (const tx of inMemoryTransactions) {
      if (tx.userId !== userId) continue;
      for (const le of tx.ledgerEntries) {
        if (le.categoryId === id) {
          le.categoryId = null;
          le.categoryName = "Uncategorized";
          le.categoryColor = "#64748b";
        }
      }
    }

    for (let i = inMemoryBudgetConfigs.length - 1; i >= 0; i--) {
      if (
        inMemoryBudgetConfigs[i].userId === userId &&
        inMemoryBudgetConfigs[i].categoryId === id
      ) {
        inMemoryBudgetConfigs.splice(i, 1);
      }
    }

    for (let i = inMemoryRules.length - 1; i >= 0; i--) {
      if (inMemoryRules[i].userId === userId && inMemoryRules[i].targetCategoryId === id) {
        inMemoryRules.splice(i, 1);
      }
    }
  },

  reorderCategories: async (
    orderedIds: string[],
    explicitUserId?: string
  ): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      await db.transaction(async (trx) => {
        for (let idx = 0; idx < orderedIds.length; idx++) {
          await trx
            .update(categories)
            .set({ sortOrder: idx * 10, updatedAt: new Date() })
            .where(
              and(eq(categories.id, toUuid(orderedIds[idx])), eq(categories.userId, dbUserId))
            );
        }
      });
      return;
    }

    const orderMap = new Map(orderedIds.map((catId, idx) => [catId, idx * 10]));
    for (const c of inMemoryCategories) {
      if (c.userId === userId && orderMap.has(c.id)) {
        c.sortOrder = orderMap.get(c.id)!;
      }
    }
  },

  getCategoryUsageCounts: async (
    explicitUserId?: string
  ): Promise<Record<string, CategoryUsageCount>> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return {};

    const counts: Record<string, CategoryUsageCount> = {};
    const ensure = (catId: string) => {
      if (!counts[catId]) {
        counts[catId] = { transactions: 0, rules: 0, budgets: 0 };
      }
      return counts[catId];
    };

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const [txEntryRows, ruleRows, budgetRows] = await Promise.all([
        db
          .select({
            categoryId: ledgerEntries.categoryId,
            transactionId: ledgerEntries.transactionId,
          })
          .from(ledgerEntries)
          .innerJoin(transactions, eq(ledgerEntries.transactionId, transactions.id))
          .where(
            and(
              eq(transactions.userId, dbUserId),
              eq(transactions.status, "posted"),
              eq(transactions.isReversal, false)
            )
          ),
        db
          .select({ targetCategoryId: classificationRules.targetCategoryId })
          .from(classificationRules)
          .where(eq(classificationRules.userId, dbUserId)),
        db
          .select({ categoryId: budgets.categoryId })
          .from(budgets)
          .where(eq(budgets.userId, dbUserId)),
      ]);

      const txSetByCat = new Map<string, Set<string>>();
      for (const row of txEntryRows) {
        if (!row.categoryId) continue;
        let set = txSetByCat.get(row.categoryId);
        if (!set) {
          set = new Set<string>();
          txSetByCat.set(row.categoryId, set);
        }
        set.add(row.transactionId);
      }
      for (const [catId, set] of txSetByCat.entries()) {
        ensure(catId).transactions = set.size;
      }
      for (const r of ruleRows) {
        ensure(r.targetCategoryId).rules += 1;
      }
      for (const b of budgetRows) {
        ensure(b.categoryId).budgets += 1;
      }
      return counts;
    }

    const txSetByCat = new Map<string, Set<string>>();
    for (const tx of inMemoryTransactions) {
      if (tx.userId !== userId || tx.status !== "posted" || tx.isReversal) continue;
      for (const le of tx.ledgerEntries) {
        if (!le.categoryId) continue;
        let set = txSetByCat.get(le.categoryId);
        if (!set) {
          set = new Set<string>();
          txSetByCat.set(le.categoryId, set);
        }
        set.add(tx.id);
      }
    }
    for (const [catId, set] of txSetByCat.entries()) {
      ensure(catId).transactions = set.size;
    }
    for (const r of inMemoryRules) {
      if (r.userId === userId) {
        ensure(r.targetCategoryId).rules += 1;
      }
    }
    for (const b of inMemoryBudgetConfigs) {
      if (b.userId === userId) {
        ensure(b.categoryId).budgets += 1;
      }
    }

    return counts;
  },

  mergeCategory: async (
    sourceId: string,
    targetId: string,
    explicitUserId?: string
  ): Promise<{
    reassignedEntries: number;
    reassignedRules: number;
    reassignedSubscriptions: number;
    movedSubcategories: number;
  }> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }
    if (!sourceId || !targetId || sourceId === targetId || toUuid(sourceId) === toUuid(targetId)) {
      throw new Error("Cannot merge a category into itself.");
    }

    const userCats = await store.getCategories(userId);
    const source = userCats.find(
      (c) => c.id === sourceId || toUuid(c.id) === toUuid(sourceId)
    );
    const target = userCats.find(
      (c) => c.id === targetId || toUuid(c.id) === toUuid(targetId)
    );
    if (!source || !target) {
      throw new Error("Both source and replacement categories must exist.");
    }
    if (source.type !== target.type) {
      throw new Error("Categories can only be merged with another category of the same type.");
    }

    const targetWasChildOfSource =
      Boolean(target.parentId) && toUuid(target.parentId!) === toUuid(source.id);
    const childrenOfSource = userCats.filter(
      (c) => c.parentId && toUuid(c.parentId) === toUuid(source.id) && toUuid(c.id) !== toUuid(target.id)
    );
    const nextParentForChildren: string | null = targetWasChildOfSource
      ? target.id
      : target.parentId
      ? target.parentId
      : target.id;

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const dbSourceId = toUuid(source.id);
      const dbTargetId = toUuid(target.id);

      const summary = await db.transaction(async (trx) => {
        const userTxRows = await trx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.userId, dbUserId));
        const userTxIds = userTxRows.map((t) => t.id);

        let reassignedEntries = 0;
        if (userTxIds.length > 0) {
          const updatedEntries = await trx
            .update(ledgerEntries)
            .set({ categoryId: dbTargetId })
            .where(
              and(
                eq(ledgerEntries.categoryId, dbSourceId),
                inArray(ledgerEntries.transactionId, userTxIds)
              )
            )
            .returning({ id: ledgerEntries.id });
          reassignedEntries = updatedEntries.length;
        }

        const updatedRules = await trx
          .update(classificationRules)
          .set({ targetCategoryId: dbTargetId, updatedAt: new Date() })
          .where(
            and(
              eq(classificationRules.userId, dbUserId),
              eq(classificationRules.targetCategoryId, dbSourceId)
            )
          )
          .returning({ id: classificationRules.id });

        const updatedSubs = await trx
          .update(subscriptions)
          .set({ categoryId: dbTargetId, updatedAt: new Date() })
          .where(
            and(
              eq(subscriptions.userId, dbUserId),
              eq(subscriptions.categoryId, dbSourceId)
            )
          )
          .returning({ id: subscriptions.id });

        const relatedBudgets = await trx
          .select()
          .from(budgets)
          .where(
            and(
              eq(budgets.userId, dbUserId),
              inArray(budgets.categoryId, [dbSourceId, dbTargetId])
            )
          );
        const targetBudget = relatedBudgets.find((b) => b.categoryId === dbTargetId);
        const sourceBudget = relatedBudgets.find((b) => b.categoryId === dbSourceId);
        if (sourceBudget) {
          if (targetBudget) {
            await trx.delete(budgets).where(eq(budgets.id, sourceBudget.id));
          } else {
            await trx
              .update(budgets)
              .set({ categoryId: dbTargetId, updatedAt: new Date() })
              .where(eq(budgets.id, sourceBudget.id));
          }
        }

        if (targetWasChildOfSource) {
          await trx
            .update(categories)
            .set({ parentId: null, updatedAt: new Date() })
            .where(and(eq(categories.id, dbTargetId), eq(categories.userId, dbUserId)));
        }

        let movedSubcategories = 0;
        if (childrenOfSource.length > 0 && nextParentForChildren) {
          const updatedChildren = await trx
            .update(categories)
            .set({
              parentId: toUuid(nextParentForChildren),
              type: target.type,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(categories.userId, dbUserId),
                eq(categories.parentId, dbSourceId),
                inArray(
                  categories.id,
                  childrenOfSource.map((c) => toUuid(c.id))
                )
              )
            )
            .returning({ id: categories.id });
          movedSubcategories = updatedChildren.length;
        }

        await trx
          .delete(categories)
          .where(and(eq(categories.id, dbSourceId), eq(categories.userId, dbUserId)));

        await trx.insert(auditLogs).values({
          id: crypto.randomUUID(),
          userId: dbUserId,
          entityType: "category",
          entityId: dbTargetId,
          action: "MERGE",
          previousState: { sourceCategoryId: source.id, sourceCategoryName: source.name },
          newState: { targetCategoryId: target.id, targetCategoryName: target.name },
          reason: `Merged category "${source.name}" into "${target.name}"`,
        });

        return {
          reassignedEntries,
          reassignedRules: updatedRules.length,
          reassignedSubscriptions: updatedSubs.length,
          movedSubcategories,
        };
      });

      return summary;
    }

    // In-memory parity path
    const targetObj = inMemoryCategories.find(
      (c) => c.userId === userId && c.id === target.id
    )!;
    if (targetWasChildOfSource) {
      targetObj.parentId = null;
    }

    let movedSubcategories = 0;
    for (const c of inMemoryCategories) {
      if (
        c.userId === userId &&
        c.parentId === source.id &&
        c.id !== target.id
      ) {
        c.parentId = nextParentForChildren;
        c.type = target.type;
        movedSubcategories += 1;
      }
    }

    const userCatListAfterPromote = inMemoryCategories.filter((c) => c.userId === userId);
    const targetDisplayName = formatCategoryDisplayLabel(
      target.id,
      userCatListAfterPromote
    );

    let reassignedEntries = 0;
    for (const tx of inMemoryTransactions) {
      if (tx.userId !== userId) continue;
      for (const le of tx.ledgerEntries) {
        if (le.categoryId === source.id) {
          le.categoryId = target.id;
          le.categoryName = targetDisplayName;
          le.categoryColor = target.color;
          reassignedEntries += 1;
        }
      }
    }

    let reassignedRules = 0;
    for (const r of inMemoryRules) {
      if (r.userId === userId && r.targetCategoryId === source.id) {
        r.targetCategoryId = target.id;
        reassignedRules += 1;
      }
    }

    let reassignedSubscriptions = 0;
    for (const s of inMemorySubscriptions) {
      if (s.userId === userId && s.categoryId === source.id) {
        s.categoryId = target.id;
        s.categoryName = target.name;
        s.categoryColor = target.color;
        reassignedSubscriptions += 1;
      }
    }

    const targetBudgetIdx = inMemoryBudgetConfigs.findIndex(
      (b) => b.userId === userId && toUuid(b.categoryId) === toUuid(target.id)
    );
    const sourceBudgetIdx = inMemoryBudgetConfigs.findIndex(
      (b) => b.userId === userId && toUuid(b.categoryId) === toUuid(source.id)
    );
    if (sourceBudgetIdx !== -1) {
      if (targetBudgetIdx !== -1) {
        inMemoryBudgetConfigs.splice(sourceBudgetIdx, 1);
      } else {
        const sb = inMemoryBudgetConfigs[sourceBudgetIdx];
        sb.categoryId = target.id;
        sb.categoryName = target.name;
        sb.categorySlug = target.slug;
        sb.categoryColor = target.color;
      }
    }

    const srcIdx = inMemoryCategories.findIndex(
      (c) => c.userId === userId && c.id === source.id
    );
    if (srcIdx !== -1) {
      inMemoryCategories.splice(srcIdx, 1);
    }

    inMemoryAuditLogs.unshift({
      id: crypto.randomUUID(),
      userId,
      entityType: "category",
      entityId: target.id,
      action: "MERGE",
      reason: `Merged category "${source.name}" into "${target.name}"`,
      timestamp: new Date().toISOString(),
    });

    return {
      reassignedEntries,
      reassignedRules,
      reassignedSubscriptions,
      movedSubcategories,
    };
  },

  moveCategoryAndReorder: async (
    params: {
      categoryId: string;
      targetParentId?: string | null;
      orderedIds: string[];
    },
    explicitUserId?: string
  ): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const userCats = await store.getCategories(userId);
    const cat = userCats.find(
      (c) => c.id === params.categoryId || toUuid(c.id) === toUuid(params.categoryId)
    );
    if (!cat) {
      throw new Error("Category not found.");
    }

    if (params.targetParentId !== undefined && params.targetParentId !== null) {
      if (
        params.targetParentId === cat.id ||
        toUuid(params.targetParentId) === toUuid(cat.id)
      ) {
        throw new Error("A category cannot be its own parent.");
      }
      const hasChildren = userCats.some(
        (c) => c.parentId && toUuid(c.parentId) === toUuid(cat.id)
      );
      if (hasChildren) {
        throw new Error(
          "Cannot nest a category that already contains sub-categories."
        );
      }
      const parent = userCats.find(
        (c) =>
          c.id === params.targetParentId ||
          toUuid(c.id) === toUuid(params.targetParentId!)
      );
      if (!parent) {
        throw new Error("Target parent category was not found.");
      }
      if (parent.parentId) {
        throw new Error(
          "Sub-categories can only be nested 2 levels deep under a top-level category."
        );
      }
      if (parent.type !== cat.type) {
        throw new Error(
          "Sub-category must belong to a parent category of the same type."
        );
      }
    }

    if (await isDbReady()) {
      const dbUserId = toUuid(userId);
      const dbCatId = toUuid(cat.id);
      await db.transaction(async (trx) => {
        if (params.targetParentId !== undefined) {
          await trx
            .update(categories)
            .set({
              parentId: params.targetParentId ? toUuid(params.targetParentId) : null,
              updatedAt: new Date(),
            })
            .where(and(eq(categories.id, dbCatId), eq(categories.userId, dbUserId)));
        }

        for (let idx = 0; idx < params.orderedIds.length; idx++) {
          await trx
            .update(categories)
            .set({ sortOrder: idx * 10, updatedAt: new Date() })
            .where(
              and(
                eq(categories.id, toUuid(params.orderedIds[idx])),
                eq(categories.userId, dbUserId)
              )
            );
        }
      });
      return;
    }

    if (params.targetParentId !== undefined) {
      const targetObj = inMemoryCategories.find(
        (c) => c.userId === userId && c.id === cat.id
      );
      if (targetObj) {
        const resolvedParent = params.targetParentId
          ? userCats.find(
              (c) =>
                c.id === params.targetParentId ||
                toUuid(c.id) === toUuid(params.targetParentId!)
            )
          : null;
        targetObj.parentId = resolvedParent ? resolvedParent.id : null;
      }
    }

    const orderMap = new Map(params.orderedIds.map((catId, idx) => [catId, idx * 10]));
    for (const c of inMemoryCategories) {
      if (c.userId === userId && orderMap.has(c.id)) {
        c.sortOrder = orderMap.get(c.id)!;
      }
    }
  },

  addAccount: async (
    input: {
      name: string;
      institution: string;
      accountType: string;
      accountNumberLast4?: string;
      currency: string;
      currentBalance: number;
      isOffsetAccount?: boolean;
      interestRatePct?: number;
    },
    explicitUserId?: string
  ): Promise<AccountRecord> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const newAcc: AccountRecord = {
      id: crypto.randomUUID(),
      userId,
      name: input.name.trim(),
      institution: input.institution.trim(),
      accountType: input.accountType,
      accountNumberLast4: (input.accountNumberLast4 || "").trim().slice(0, 4),
      currency: (input.currency || "AUD").toUpperCase(),
      currentBalance: (Math.round(input.currentBalance * 100) / 100).toFixed(2),
      isOffsetAccount: Boolean(input.isOffsetAccount || input.accountType === "offset"),
      interestRatePct: (Math.round((input.interestRatePct ?? 0) * 100) / 100).toFixed(2),
      isActive: true,
    };

    if (await isDbReady()) {
      await db.insert(accounts).values({
        id: newAcc.id,
        userId: toUuid(userId),
        name: newAcc.name,
        institution: newAcc.institution,
        accountType: newAcc.accountType,
        accountNumberLast4: newAcc.accountNumberLast4 || null,
        currency: newAcc.currency,
        currentBalance: newAcc.currentBalance,
        isOffsetAccount: newAcc.isOffsetAccount,
        interestRatePct: newAcc.interestRatePct,
        isActive: true,
      });
    } else {
      inMemoryAccounts.push(newAcc);
    }

    return newAcc;
  },

  updateAccount: async (
    id: string,
    input: {
      name: string;
      institution: string;
      accountType: string;
      accountNumberLast4?: string;
      currency: string;
      currentBalance: number;
      isOffsetAccount?: boolean;
      interestRatePct?: number;
    },
    explicitUserId?: string
  ): Promise<AccountRecord | null> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const trimmedName = input.name.trim();
    const trimmedInst = input.institution.trim();
    const last4 = (input.accountNumberLast4 || "").trim().slice(0, 4);
    const currency = (input.currency || "AUD").toUpperCase();
    const balanceStr = (Math.round(input.currentBalance * 100) / 100).toFixed(2);
    const isOffset = Boolean(input.isOffsetAccount || input.accountType === "offset");
    const rateStr = (Math.round((input.interestRatePct ?? 0) * 100) / 100).toFixed(2);

    if (await isDbReady()) {
      const [updated] = await db
        .update(accounts)
        .set({
          name: trimmedName,
          institution: trimmedInst,
          accountType: input.accountType,
          accountNumberLast4: last4 || null,
          currency,
          currentBalance: balanceStr,
          isOffsetAccount: isOffset,
          interestRatePct: rateStr,
          updatedAt: new Date(),
        })
        .where(and(eq(accounts.id, toUuid(id)), eq(accounts.userId, toUuid(userId))))
        .returning();

      if (!updated) return null;
      return {
        id: updated.id,
        userId: updated.userId,
        name: updated.name,
        institution: updated.institution,
        accountType: updated.accountType,
        accountNumberLast4: updated.accountNumberLast4 || "",
        currency: updated.currency,
        currentBalance: updated.currentBalance,
        isOffsetAccount: updated.isOffsetAccount,
        interestRatePct: updated.interestRatePct || "0.00",
        isActive: updated.isActive,
      };
    }

    const acc = inMemoryAccounts.find((a) => a.id === id && a.userId === userId);
    if (!acc) return null;

    acc.name = trimmedName;
    acc.institution = trimmedInst;
    acc.accountType = input.accountType;
    acc.accountNumberLast4 = last4;
    acc.currency = currency;
    acc.currentBalance = balanceStr;
    acc.isOffsetAccount = isOffset;
    acc.interestRatePct = rateStr;

    for (const tx of inMemoryTransactions) {
      if (tx.userId === userId && tx.accountId === id) {
        tx.accountName = trimmedName;
      }
    }

    return { ...acc };
  },

  toggleAccountActive: async (
    id: string,
    isActive: boolean,
    explicitUserId?: string
  ): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return;

    if (await isDbReady()) {
      await db
        .update(accounts)
        .set({ isActive, updatedAt: new Date() })
        .where(and(eq(accounts.id, toUuid(id)), eq(accounts.userId, toUuid(userId))));
      return;
    }

    const acc = inMemoryAccounts.find((a) => a.id === id && a.userId === userId);
    if (acc) {
      acc.isActive = isActive;
    }
  },

  getAccountTransactionCounts: async (
    explicitUserId?: string
  ): Promise<Record<string, number>> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return {};

    const counts: Record<string, number> = {};
    if (await isDbReady()) {
      const rows = await db
        .select({
          accountId: transactions.accountId,
          count: sql<number>`count(*)::int`,
        })
        .from(transactions)
        .where(eq(transactions.userId, toUuid(userId)))
        .groupBy(transactions.accountId);
      for (const r of rows) {
        counts[r.accountId] = r.count;
      }
      return counts;
    }

    for (const tx of inMemoryTransactions) {
      if (tx.userId === userId) {
        counts[tx.accountId] = (counts[tx.accountId] || 0) + 1;
      }
    }
    return counts;
  },

  deleteAccount: async (id: string, explicitUserId?: string): Promise<void> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }

    const counts = await store.getAccountTransactionCounts(userId);
    if ((counts[id] || counts[toUuid(id)] || 0) > 0) {
      throw new Error(
        "Cannot delete an account with ledger transactions. Archive the account instead to preserve ledger integrity."
      );
    }

    if (await isDbReady()) {
      await db
        .delete(accounts)
        .where(and(eq(accounts.id, toUuid(id)), eq(accounts.userId, toUuid(userId))));
      return;
    }

    const idx = inMemoryAccounts.findIndex((a) => a.id === id && a.userId === userId);
    if (idx !== -1) {
      inMemoryAccounts.splice(idx, 1);
    }
  },
};
