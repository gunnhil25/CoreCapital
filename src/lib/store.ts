import crypto from "crypto";
import path from "path";
import { desc, eq, asc, and, sql } from "drizzle-orm";
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
  type: string;
  color: string;
  icon: string;
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
  period: "monthly" | "weekly" | "yearly";
  allocatedAmount: number;
  spentAmount: number;
  remainingAmount: number;
  percentageSpent: number;
  status: "normal" | "warning" | "overrun";
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

// In-memory state used as fallback when PostgreSQL is unavailable or in test mode
const inMemoryUsers: UserRecord[] = [];
const inMemoryAccounts: AccountRecord[] = [];
const inMemoryCategories: CategoryRecord[] = [];
const inMemoryRules: RuleRecord[] = [];
const inMemoryTransactions: TransactionWithLedger[] = [];
const inMemoryBatches: ImportBatchItem[] = [];
const inMemoryAuditLogs: AuditLogItem[] = [];
const inMemoryBudgetConfigs: Array<{
  id: string;
  userId: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  categoryColor: string;
  period: "monthly" | "weekly" | "yearly";
  allocatedAmount: number;
  startDate: string;
}> = [];
const inMemorySubscriptions: SubscriptionItem[] = [];
const inMemoryGoalConfigs = new Map<string, PropertyGoalConfig>();
const inMemoryFhssContributions: FhssContributionRecord[] = [];

function createDemoWorkspacePayload(userId: string, preserveLegacyTestIds: boolean) {
  const catMap = new Map<string, { id: string; name: string; slug: string; color: string }>();

  const seededCategories: CategoryRecord[] = defaultCategories.map((c) => {
    const id = preserveLegacyTestIds ? c.id : crypto.randomUUID();
    catMap.set(c.id, { id, name: c.name, slug: c.slug, color: c.color });
    return {
      id,
      userId,
      name: c.name,
      slug: c.slug,
      type: c.type,
      color: c.color,
      icon: c.icon,
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

  return {
    seededCategories,
    seededAccounts,
    seededRules,
    seededTransactions,
    seededBatches,
    seededBudgets,
    seededSubscriptions,
    seededGoal,
    seededFhss,
  };
}

function createCleanWorkspacePayload(userId: string) {
  const catMap = new Map<string, string>();
  const seededCategories: CategoryRecord[] = defaultCategories.map((c) => {
    const id = crypto.randomUUID();
    catMap.set(c.id, id);
    return {
      id,
      userId,
      name: c.name,
      slug: c.slug,
      type: c.type,
      color: c.color,
      icon: c.icon,
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
if (process.env.NODE_ENV === "test") {
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
          type: c.type,
          color: c.color,
          icon: c.icon,
          isSystem: true,
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
        type: c.type,
        color: c.color,
        icon: c.icon,
        isSystem: true,
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
  await db.delete(propertyGoals).where(eq(propertyGoals.userId, dbUserId));
  await db.delete(fhssContributions).where(eq(fhssContributions.userId, dbUserId));
  await db.delete(classificationRules).where(eq(classificationRules.userId, dbUserId));
  await db.delete(accounts).where(eq(accounts.userId, dbUserId));
  await db.delete(categories).where(eq(categories.userId, dbUserId));
  await db.delete(auditLogs).where(eq(auditLogs.userId, dbUserId));
}

function buildBudgetItem(
  cfg: {
    id: string;
    categoryId: string;
    categoryName: string;
    categorySlug: string;
    categoryColor: string;
    period: "monthly" | "weekly" | "yearly";
    allocatedAmount: number;
    startDate: string;
  },
  allTransactions: TransactionWithLedger[]
): BudgetItem {
  const baseline =
    cfg.startDate === "2026-10-01"
      ? DEMO_BUDGET_BASELINES_BY_SLUG[cfg.categorySlug] ?? 0
      : 0;

  let ledgerNet = 0;
  for (const tx of allTransactions) {
    for (const entry of tx.ledgerEntries) {
      const entryCatMatch =
        entry.categoryId && toUuid(entry.categoryId) === toUuid(cfg.categoryId);
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
  } else if (percentageSpent >= 80) {
    status = "warning";
  }

  return {
    id: cfg.id,
    categoryId: cfg.categoryId,
    categoryName: cfg.categoryName,
    categoryColor: cfg.categoryColor,
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

  return list.sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? 1
        : -1
      : a.createdAt < b.createdAt
      ? 1
      : -1
  );
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

  getCategories: async (explicitUserId?: string) => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) return [];
    if (await isDbReady()) {
      const rows = await db
        .select()
        .from(categories)
        .where(eq(categories.userId, toUuid(userId)))
        .orderBy(asc(categories.name));
      return rows.map((c) => ({
        id: c.id,
        userId: c.userId || userId,
        name: c.name,
        slug: c.slug,
        type: c.type,
        color: c.color,
        icon: c.icon,
      }));
    }
    return inMemoryCategories
      .filter((c) => c.userId === userId)
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
        const list = entryMap.get(le.transactionId) || [];
        list.push({
          id: le.id,
          transactionId: le.transactionId,
          accountId: le.accountId,
          categoryId: le.categoryId,
          categoryName: cat?.name || "Uncategorized",
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

    const userTx = inMemoryTransactions.filter((t) => t.userId === userId);
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
      const dbTxId = toUuid(tx.id);
      const dbUserId = toUuid(tx.userId);
      const dbAccountId = toUuid(tx.accountId);

      await db.transaction(async (trx) => {
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

    const account = inMemoryAccounts.find(
      (a) => a.id === tx.accountId && a.userId === tx.userId
    );
    if (account) {
      const nextBalance = (parseFloat(account.currentBalance) || 0) + (parseFloat(tx.amount) || 0);
      account.currentBalance = nextBalance.toFixed(2);
    }

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

      return budgetRows.map((b) => {
        const cat = catMap.get(b.categoryId);
        return buildBudgetItem(
          {
            id: b.id,
            categoryId: b.categoryId,
            categoryName: cat?.name || "Category",
            categorySlug: cat?.slug || "",
            categoryColor: cat?.color || "#0ea5e9",
            period: (b.period as "monthly" | "weekly" | "yearly") || "monthly",
            allocatedAmount: parseFloat(b.amount),
            startDate: b.startDate,
          },
          allTransactions
        );
      });
    }

    return inMemoryBudgetConfigs
      .filter((cfg) => cfg.userId === userId)
      .map((cfg) => buildBudgetItem(cfg, allTransactions));
  },

  addBudget: async (
    input: {
      categoryId: string;
      categoryName: string;
      categoryColor?: string;
      allocatedAmount: number;
      period: "monthly" | "weekly" | "yearly";
    },
    explicitUserId?: string
  ): Promise<BudgetItem> => {
    const userId = await store.resolveActiveUserId(explicitUserId);
    if (!userId) {
      throw new Error("Authentication required.");
    }
    const id = crypto.randomUUID();
    const cat = (await store.getCategories(userId)).find((c) => c.id === input.categoryId);
    const startDate = new Date().toISOString().split("T")[0];
    const cfg = {
      id,
      userId,
      categoryId: input.categoryId,
      categoryName: cat?.name || input.categoryName,
      categorySlug: cat?.slug || "",
      categoryColor: cat?.color || input.categoryColor || "#0ea5e9",
      period: input.period,
      allocatedAmount: input.allocatedAmount,
      startDate,
    };

    if (await isDbReady()) {
      await db.insert(budgets).values({
        id,
        userId: toUuid(userId),
        categoryId: toUuid(input.categoryId),
        period: input.period,
        amount: input.allocatedAmount.toFixed(2),
        startDate,
      });
    } else {
      inMemoryBudgetConfigs.push(cfg);
    }

    const allTransactions = await store.getTransactions(undefined, userId);
    return buildBudgetItem(cfg, allTransactions);
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
};
