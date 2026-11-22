import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  calculateFhssRelease,
  calculateDhoasEntitlement,
  calculateNewSouthWalesStampDuty,
  calculateQueenslandStampDuty,
  calculateSouthAustraliaStampDuty,
  calculateVictoriaStampDuty,
  calculateWesternAustraliaStampDuty,
  calculateTasmaniaStampDuty,
  calculateActStampDuty,
  calculateNorthernTerritoryStampDuty,
  calculateStampDuty,
  getLocationDisplayLabel,
  calculateAnnualizedSubscriptionCost,
  getAustralianFinancialYear,
} from "@/lib/australian-finance";
import {
  getPropertyGoalModelAction,
  savePropertyGoalAction,
  deletePropertyGoalAction,
  addFhssContributionAction,
  deleteFhssContributionAction,
} from "@/actions/property-goals";
import {
  getCashFlowProjectionAction,
  getCashFlowPageDataAction,
  createCashFlowItemAction,
  toggleCashFlowItemAction,
  deleteCashFlowItemAction,
} from "@/actions/cash-flow";
import {
  normalizeDate,
  cleanMerchantName,
  computeDeduplicationHash,
  parseCsvTextToRows,
  parseBankStatementCsv,
} from "@/lib/csv-engine";
import {
  evaluateRuleMatch,
  findMatchingRule,
  ClassificationRuleItem,
} from "@/lib/rule-engine";
import {
  createTransactionAction,
  editTransactionAction,
  reverseTransactionAction,
  getAccountsAction,
  getCategoriesAction,
  getTransactionsAction,
  getTransactionsPageDataAction,
} from "@/actions/transactions";
import {
  createBudgetAction,
  deleteBudgetAction,
  getBudgetsAction,
  getSpendingAnomaliesAction,
  updateBudgetAction,
} from "@/actions/budgets";
import { getSubscriptionsAction } from "@/actions/subscriptions";
import {
  createClassificationRuleAction,
  deleteClassificationRuleAction,
  getClassificationRulesAction,
  runClassificationRulesAction,
  toggleClassificationRuleAction,
  updateClassificationRuleAction,
} from "@/actions/rules";
import {
  getManageDataAction,
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
  mergeCategoryAction,
  moveCategoryOrderAction,
  reorderCategoriesAction,
  createAccountAction,
  updateAccountAction,
  toggleAccountActiveAction,
  deleteAccountAction,
} from "@/actions/manage";
import {
  buildCategorySpendingHierarchy,
  computeCategoryDragResult,
  sortAndFlattenCategories,
  summarizeBudgetsHierarchy,
} from "@/lib/category-utils";
import {
  getAuthStatusAction,
  setupInitialAdminAction,
  loginAction,
  logoutAction,
  updateMyProfileAction,
  changeMyPasswordAction,
  resetMyWorkspaceAction,
  listUsersAdminAction,
  createUserAdminAction,
  updateUserAdminAction,
  resetUserPasswordAdminAction,
  resetUserWorkspaceAdminAction,
  deleteUserAdminAction,
} from "@/actions/auth";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  setTestSession,
} from "@/lib/auth";
import { store } from "@/lib/store";
import {
  DEFAULT_THEME,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  getNextTheme,
  resolveTheme,
} from "@/lib/theme";
import { POST as openBankingWebhookPost } from "@/app/api/webhooks/open-banking/route";
import { GET as healthGet } from "@/app/api/health/route";

describe("Australian Finance Calculation Engine", () => {
  it("derives Australian financial year boundaries accurately", () => {
    expect(getAustralianFinancialYear(new Date("2026-07-01T12:00:00Z"))).toBe("2026-27");
    expect(getAustralianFinancialYear(new Date("2026-06-30T00:00:00Z"))).toBe("2025-26");
  });

  it("enforces $15,000/FY annual cap and $50,000 lifetime cap in FHSS calculations", () => {
    // Exceeding $15,000 in a single FY should cap eligible contributions at $15,000
    const singleFyOver = calculateFhssRelease(
      [
        {
          amount: 22000,
          contributionType: "concessional",
          date: "2026-03-10",
          financialYear: "2025-26",
        },
      ],
      0.325,
      "2026-27"
    );
    expect(singleFyOver.concessionalTotal).toBe(15000);
    expect(singleFyOver.totalContributed).toBe(15000);
    expect(singleFyOver.eligibleConcessionalAmount).toBe(12750);
    expect(singleFyOver.estimatedTaxSaved).toBeCloseTo(2625, 2);

    // Exceeding $50,000 across 4 FYs should cap lifetime total at $50,000
    const multiFyOver = calculateFhssRelease(
      [
        { amount: 15000, contributionType: "concessional", date: "2023-09-01", financialYear: "2023-24" },
        { amount: 15000, contributionType: "concessional", date: "2024-09-01", financialYear: "2024-25" },
        { amount: 15000, contributionType: "concessional", date: "2025-09-01", financialYear: "2025-26" },
        { amount: 15000, contributionType: "concessional", date: "2026-09-01", financialYear: "2026-27" },
      ],
      0.325,
      "2026-27"
    );
    expect(multiFyOver.totalContributed).toBe(50000);
    expect(multiFyOver.remainingLifetimeCap).toBe(0);
    expect(multiFyOver.remainingAnnualCap).toBe(0);
  });

  it("calculates DHOAS entitlement tiers for 2029 horizon", () => {
    const tier2 = calculateDhoasEntitlement("2021-03-01", "permanent");
    expect(tier2.projected2029Tier.tier).toBe(2);
    expect(tier2.projected2029Tier.subsidisedLoanCap).toBe(579000);
    expect(tier2.annualSubsidyValue2029).toBe(592 * 12);

    const tier3 = calculateDhoasEntitlement("2015-01-01", "permanent");
    expect(tier3.projected2029Tier.tier).toBe(3);
    expect(tier3.projected2029Tier.subsidisedLoanCap).toBe(772000);
  });

  it("calculates SA and VIC stamp duty with FHB exemptions and concessions", () => {
    expect(calculateSouthAustraliaStampDuty(0)).toBe(0);
    expect(calculateSouthAustraliaStampDuty(850000, true)).toBe(40580);

    expect(calculateVictoriaStampDuty(580000, true)).toBe(0);
    expect(calculateVictoriaStampDuty(675000, true)).toBeGreaterThan(0);
    expect(calculateVictoriaStampDuty(675000, true)).toBeLessThan(
      calculateVictoriaStampDuty(675000, false)
    );
    expect(calculateVictoriaStampDuty(950000, true)).toBe(48670);
  });

  it("calculates stamp duty across all 8 Australian states/territories and custom locations", () => {
    expect(calculateNewSouthWalesStampDuty(750000, true)).toBe(0);
    expect(calculateNewSouthWalesStampDuty(900000, true)).toBeGreaterThan(0);
    expect(calculateNewSouthWalesStampDuty(900000, true)).toBeLessThan(
      calculateNewSouthWalesStampDuty(900000, false)
    );

    expect(calculateQueenslandStampDuty(650000, true)).toBe(0);
    expect(calculateQueenslandStampDuty(750000, true)).toBeGreaterThan(0);
    expect(calculateQueenslandStampDuty(750000, false)).toBeGreaterThan(
      calculateQueenslandStampDuty(750000, true)
    );

    expect(calculateWesternAustraliaStampDuty(420000, true)).toBe(0);
    expect(calculateWesternAustraliaStampDuty(520000, true)).toBeGreaterThan(0);
    expect(calculateWesternAustraliaStampDuty(520000, true)).toBeLessThan(
      calculateWesternAustraliaStampDuty(520000, false)
    );

    expect(calculateTasmaniaStampDuty(700000, true)).toBe(0);
    expect(calculateTasmaniaStampDuty(800000, true)).toBeGreaterThan(0);

    expect(calculateActStampDuty(900000, true)).toBe(0);
    expect(calculateActStampDuty(1100000, true)).toBeGreaterThan(0);

    expect(calculateNorthernTerritoryStampDuty(500000, true)).toBeGreaterThan(0);
    expect(calculateNorthernTerritoryStampDuty(700000, true)).toBe(Math.round(700000 * 0.0495));

    expect(calculateStampDuty("NSW", 750000, true)).toBe(0);
    expect(calculateStampDuty("QLD", 900000, false)).toBe(calculateQueenslandStampDuty(900000, false));
    expect(calculateStampDuty("CUSTOM", 800000, false)).toBe(0);
    expect(calculateStampDuty("CUSTOM", 800000, false, 24500)).toBe(24500);
    expect(calculateStampDuty("SA", 850000, true, 12000)).toBe(12000);

    expect(getLocationDisplayLabel("WA", "Fremantle")).toBe("Fremantle, WA");
    expect(getLocationDisplayLabel("CUSTOM", "London, UK")).toBe("London, UK");
  });

  it("supports configurable DHOAS target dates, fixed tiers, custom amounts, and lump sums", () => {
    const fixedTier3 = calculateDhoasEntitlement("2021-03-01", "permanent", "2033-05-01", {
      mode: "tier3",
    });
    expect(fixedTier3.targetYear).toBe(2033);
    expect(fixedTier3.projectedTier.tier).toBe(3);
    expect(fixedTier3.effectiveLoanCap).toBe(772000);

    const customDhoas = calculateDhoasEntitlement("2021-03-01", "reserve", "2030-01-15", {
      mode: "custom",
      customMonthlySubsidy: 650,
      customLoanCap: 620000,
      lumpSumAmount: 18500,
    });
    expect(customDhoas.targetYear).toBe(2030);
    expect(customDhoas.serviceType).toBe("reserve");
    expect(customDhoas.effectiveMonthlySubsidy).toBe(650);
    expect(customDhoas.effectiveLoanCap).toBe(620000);
    expect(customDhoas.annualSubsidyValue).toBe(650 * 12);
    expect(customDhoas.lumpSumAmount).toBe(18500);
  });

  it("annualizes subscription costs accurately across billing cycles", () => {
    expect(calculateAnnualizedSubscriptionCost(19.95, "weekly")).toBe(1037.4);
    expect(calculateAnnualizedSubscriptionCost(50, "fortnightly")).toBe(1300);
    expect(calculateAnnualizedSubscriptionCost(22.99, "monthly")).toBe(275.88);
    expect(calculateAnnualizedSubscriptionCost(100, "quarterly")).toBe(400);
    expect(calculateAnnualizedSubscriptionCost(135, "annually")).toBe(135);
  });
});

describe("CSV Parsing & Deduplication Engine", () => {
  it("normalizes Australian and ISO dates", () => {
    expect(normalizeDate("10/10/2026")).toBe("2026-10-10");
    expect(normalizeDate("2026-10-08")).toBe("2026-10-08");
    expect(normalizeDate("05-11-26")).toBe("2026-11-05");
  });

  it("cleans merchant names and strips POS prefixes/suffixes", () => {
    const cleaned = cleanMerchantName("VISA PURCHASE WOOLWORTHS UNLEY SA AUS");
    expect(cleaned.clean).toBe("WOOLWORTHS UNLEY");
    expect(cleaned.merchant).toBe("WOOLWORTHS UNLEY");
  });

  it("computes deterministic SHA-256 deduplication hashes", () => {
    const h1 = computeDeduplicationHash("acc-1", "2026-10-10", -42.5, "  COLES ADELAIDE ");
    const h2 = computeDeduplicationHash("acc-1", "2026-10-10", -42.5, "coles adelaide");
    const h3 = computeDeduplicationHash("acc-2", "2026-10-10", -42.5, "coles adelaide");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toHaveLength(64);
  });

  it("parses quoted CSV fields containing commas", () => {
    const rows = parseCsvTextToRows('10/10/2026,-50.00,"WOOLWORTHS, UNLEY SA",1000.00');
    expect(rows[0]).toEqual(["10/10/2026", "-50.00", "WOOLWORTHS, UNLEY SA", "1000.00"]);
  });

  it("parses CommBank, Macquarie, ANZ, and Generic CSV statements", () => {
    const cbaCsv = [
      "Date,Amount,Description,Balance",
      "10/10/2026,3850.00,DIRECT CREDIT DEFENCE PAYROLL,12450.00",
      "09/10/2026,-154.30,VISA PURCHASE WOOLWORTHS UNLEY SA AUS,8600.00",
    ].join("\n");
    const cbaRows = parseBankStatementCsv(cbaCsv, "acc-1", "commbank");
    expect(cbaRows).toHaveLength(2);
    expect(cbaRows[0].amount).toBe(3850);
    expect(cbaRows[1].amount).toBe(-154.3);

    const macquarieCsv = [
      "Date,Description,Debit,Credit,Balance,Category",
      "09/10/2026,COLES SUPERMARKET,82.50,,49000.00,Groceries",
      "10/10/2026,INTEREST CREDIT,,195.25,49195.25,Income",
    ].join("\n");
    const macRows = parseBankStatementCsv(macquarieCsv, "acc-2", "auto");
    expect(macRows).toHaveLength(2);
    expect(macRows[0].amount).toBe(-82.5);
    expect(macRows[1].amount).toBe(195.25);

    const anzCsv = "08/10/2026,-18.50,EFTPOS MCDONALDS ADELAIDE";
    const anzRows = parseBankStatementCsv(anzCsv, "acc-1", "anz");
    expect(anzRows).toHaveLength(1);
    expect(anzRows[0].date).toBe("2026-10-08");
    expect(anzRows[0].amount).toBe(-18.5);

    const genericCsv = "Date,Description,Amount\n2026-10-12,Coffee Shop,-5.50";
    const genericRows = parseBankStatementCsv(genericCsv, "acc-1", "generic_csv");
    expect(genericRows).toHaveLength(1);
    expect(genericRows[0].amount).toBe(-5.5);
  });
});

describe("Classification Rule Engine & ReDoS Guard", () => {
  const sampleRules: ClassificationRuleItem[] = [
    {
      id: "r-woolworths",
      name: "Woolworths",
      priority: 10,
      field: "description",
      matchType: "contains",
      matchValue: "woolworths",
      targetCategoryId: "cat-2",
      autoApply: true,
      isActive: true,
    },
    {
      id: "r-coles",
      name: "Coles",
      priority: 20,
      field: "description",
      matchType: "contains",
      matchValue: "coles",
      targetCategoryId: "cat-2",
      autoApply: true,
      isActive: true,
    },
    {
      id: "r-priority",
      name: "Priority Override",
      priority: 5,
      field: "description",
      matchType: "regex",
      matchValue: "^COLES\\s+EXPRESS",
      targetCategoryId: "cat-7",
      autoApply: true,
      isActive: true,
    },
  ];

  it("matches exact rule object by priority instead of first category match", () => {
    const colesMatch = findMatchingRule(
      { cleanDescription: "Coles Unley SA", rawDescription: "COLES UNLEY" },
      sampleRules
    );
    expect(colesMatch?.id).toBe("r-coles");

    const priorityMatch = findMatchingRule(
      { cleanDescription: "Coles Express Fuel", rawDescription: "COLES EXPRESS" },
      sampleRules
    );
    expect(priorityMatch?.id).toBe("r-priority");
    expect(priorityMatch?.targetCategoryId).toBe("cat-7");
  });

  it("blocks nested quantifier ReDoS patterns and oversized regexes", () => {
    const evilRule: ClassificationRuleItem = {
      id: "r-evil",
      name: "ReDoS",
      priority: 1,
      field: "description",
      matchType: "regex",
      matchValue: "(a+)+b",
      targetCategoryId: "cat-2",
      autoApply: true,
      isActive: true,
    };
    expect(
      evaluateRuleMatch(evilRule, {
        cleanDescription: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaac",
      })
    ).toBe(false);

    const longRule: ClassificationRuleItem = {
      ...evilRule,
      matchValue: "a".repeat(125),
    };
    expect(evaluateRuleMatch(longRule, { cleanDescription: "a".repeat(130) })).toBe(false);
  });
});

describe("Immutable Ledger Transactions & Budget/Balance Sync", () => {
  it("rejects unbalanced split transactions", async () => {
    const accounts = await getAccountsAction();
    const res = await createTransactionAction({
      accountId: accounts[0].id,
      date: "2026-11-18",
      amount: -100,
      cleanDescription: "Unbalanced Split",
      isSplit: true,
      splits: [
        { categoryId: "cat-2", amount: 60 },
        { categoryId: "cat-9", amount: 30 },
      ],
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("Split sum");
  });

  it("creates a transaction, updates account balance and budget spend, and reverses atomically", async () => {
    const accountsBefore = await getAccountsAction();
    const checkingBefore = accountsBefore.find((a) => a.accountType === "checking")!;
    const initialBal = parseFloat(checkingBefore.currentBalance);

    const budgetsBefore = await getBudgetsAction();
    const groceriesBefore = budgetsBefore.find((b) => b.categoryId === "cat-2")!;

    const createRes = await createTransactionAction({
      accountId: checkingBefore.id,
      date: "2026-11-18",
      amount: -75.5,
      cleanDescription: "Woolworths Test Shop",
      categoryId: "cat-2",
    });
    expect(createRes.success).toBe(true);
    expect(createRes.transaction).toBeDefined();

    const accountsMid = await getAccountsAction();
    const checkingMid = accountsMid.find((a) => a.id === checkingBefore.id)!;
    expect(parseFloat(checkingMid.currentBalance)).toBeCloseTo(initialBal - 75.5, 2);

    const budgetsMid = await getBudgetsAction();
    const groceriesMid = budgetsMid.find((b) => b.categoryId === "cat-2")!;
    expect(groceriesMid.spentAmount).toBeCloseTo(groceriesBefore.spentAmount + 75.5, 2);

    // Execute reversal
    const txId = createRes.transaction!.id;
    const revRes = await reverseTransactionAction(txId, "Duplicate test entry");
    expect(revRes.success).toBe(true);
    expect(revRes.reversalTransaction?.amount).toBe("75.50");
    expect(revRes.reversalTransaction?.isReversal).toBe(true);

    // Balance and budget spend return to initial values
    const accountsAfter = await getAccountsAction();
    const checkingAfter = accountsAfter.find((a) => a.id === checkingBefore.id)!;
    expect(parseFloat(checkingAfter.currentBalance)).toBeCloseTo(initialBal, 2);

    const budgetsAfter = await getBudgetsAction();
    const groceriesAfter = budgetsAfter.find((b) => b.categoryId === "cat-2")!;
    expect(groceriesAfter.spentAmount).toBeCloseTo(groceriesBefore.spentAmount, 2);

    // Original marked reversed and cannot be reversed twice
    const allTxs = await getTransactionsAction();
    const orig = allTxs.find((t) => t.id === txId);
    expect(orig?.status).toBe("reversed");

    const doubleRev = await reverseTransactionAction(txId, "Second try");
    expect(doubleRev.success).toBe(false);
    expect(doubleRev.error).toContain("already been reversed");

    // Reversal entry itself cannot be reversed
    const revOfRev = await reverseTransactionAction(revRes.reversalTransaction!.id, "Try rev");
    expect(revOfRev.success).toBe(false);
    expect(revOfRev.error).toContain("Cannot reverse a reversal entry");
  });
});

describe("Open Banking Webhook HMAC Verification & Ingestion", () => {
  it("returns 401 on missing or invalid HMAC signature", async () => {
    const body = JSON.stringify({ type: "transaction.created", data: {} });

    const missingReq = new NextRequest("http://localhost:3000/api/webhooks/open-banking", {
      method: "POST",
      body,
    });
    const missingRes = await openBankingWebhookPost(missingReq);
    expect(missingRes.status).toBe(401);

    const invalidReq = new NextRequest("http://localhost:3000/api/webhooks/open-banking", {
      method: "POST",
      body,
      headers: { "x-basiq-signature": "deadbeef" },
    });
    const invalidRes = await openBankingWebhookPost(invalidReq);
    expect(invalidRes.status).toBe(401);
  });

  it("ingests and deduplicates transactions when signed with valid HMAC", async () => {
    const secret = process.env.OPEN_BANKING_WEBHOOK_SECRET || "stub_secret_corecapital";
    const accounts = await getAccountsAction();
    const payload = JSON.stringify({
      type: "transaction.created",
      data: {
        transactions: [
          {
            accountId: accounts[0].id,
            date: "2026-11-18",
            amount: -24.99,
            description: "DIRECT DEBIT NETFLIX STREAMING",
          },
        ],
      },
    });
    const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    const req1 = new NextRequest("http://localhost:3000/api/webhooks/open-banking", {
      method: "POST",
      body: payload,
      headers: { "x-cdr-signature": sig },
    });
    const res1 = await openBankingWebhookPost(req1);
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.importedCount).toBe(1);
    expect(json1.duplicateCount).toBe(0);

    // Replay same webhook payload -> deduplicated
    const req2 = new NextRequest("http://localhost:3000/api/webhooks/open-banking", {
      method: "POST",
      body: payload,
      headers: { "x-cdr-signature": sig },
    });
    const res2 = await openBankingWebhookPost(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.importedCount).toBe(0);
    expect(json2.duplicateCount).toBe(1);
  });
});

describe("Container Healthcheck Endpoint", () => {
  it("returns 200 OK with CoreCapital readiness payload", async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.app).toBe("corecapital");
    expect(["connected", "in_memory_fallback"]).toContain(json.database);
  });

  it("returns 503 degraded when database is unavailable in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const readySpy = vi.spyOn(store, "isDbReady").mockResolvedValueOnce(false);
    try {
      const res = await healthGet();
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.status).toBe("degraded");
      expect(json.app).toBe("corecapital");
      expect(json.database).toBe("disconnected");
    } finally {
      readySpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe("Password Crypto & Signed Session Tokens", () => {
  it("hashes and verifies passwords with scrypt and random salt", () => {
    const h1 = hashPassword("StrongPass123!");
    const h2 = hashPassword("StrongPass123!");
    expect(h1).toMatch(/^scrypt\$/);
    expect(h1).not.toBe(h2);
    expect(verifyPassword("StrongPass123!", h1)).toBe(true);
    expect(verifyPassword("WrongPass!", h1)).toBe(false);
    expect(verifyPassword("StrongPass123!", "invalid-hash")).toBe(false);
  });

  it("signs, verifies, and rejects tampered or expired session tokens", () => {
    const token = createSessionToken({
      userId: "u-1",
      email: "admin@corecapital.local",
      name: "Admin",
      role: "admin",
      sessionVersion: 1,
    });
    const decoded = verifySessionToken(token);
    expect(decoded?.userId).toBe("u-1");
    expect(decoded?.role).toBe("admin");

    const [body, sig] = token.split(".");
    const tampered = `${body}.${sig.slice(0, -2)}xx`;
    expect(verifySessionToken(tampered)).toBeNull();

    const expired = createSessionToken(
      {
        userId: "u-1",
        email: "admin@corecapital.local",
        name: "Admin",
        role: "admin",
        sessionVersion: 1,
      },
      -1000
    );
    expect(verifySessionToken(expired)).toBeNull();
  });
});

describe("First-Run Setup, Auth, Workspace Reset & Admin User Management", () => {
  it("supports initial admin setup, lock, login, password bump, workspace reset, and admin CRUD", async () => {
    await store.clearAllUsersForTest();
    setTestSession(null);

    const beforeSetup = await getAuthStatusAction();
    expect(beforeSetup.initialized).toBe(false);
    expect(beforeSetup.user).toBeNull();

    // Reject weak password during setup
    const weakSetup = await setupInitialAdminAction({
      name: "Admin Owner",
      email: "owner@corecapital.local",
      password: "short",
      seedMode: "clean",
    });
    expect(weakSetup.success).toBe(false);

    // Valid first-run admin creation with Clean Slate workspace
    const setupRes = await setupInitialAdminAction({
      name: "Admin Owner",
      email: "owner@corecapital.local",
      password: "AdminPassword123!",
      baseCurrency: "AUD",
      seedMode: "clean",
    });
    expect(setupRes.success).toBe(true);
    expect(setupRes.user?.role).toBe("admin");
    const adminId = setupRes.user!.id;

    // Setup endpoint must now be permanently locked
    const secondSetup = await setupInitialAdminAction({
      name: "Hijacker",
      email: "attacker@corecapital.local",
      password: "AttackerPassword123!",
      seedMode: "clean",
    });
    expect(secondSetup.success).toBe(false);
    expect(secondSetup.error).toContain("already initialized");

    // Clean workspace has 1 $0.00 checking account and 0 transactions/budgets
    expect(await getTransactionsAction()).toHaveLength(0);
    expect(await getBudgetsAction()).toHaveLength(0);
    const cleanAccounts = await getAccountsAction();
    expect(cleanAccounts).toHaveLength(1);
    expect(cleanAccounts[0].currentBalance).toBe("0.00");

    // Profile update
    const profRes = await updateMyProfileAction({
      name: "Primary Admin",
      email: "owner@corecapital.local",
      baseCurrency: "AUD",
    });
    expect(profRes.success).toBe(true);
    expect(profRes.user?.name).toBe("Primary Admin");

    // Password change bumps sessionVersion and invalidates old session tokens
    const badPwd = await changeMyPasswordAction({
      currentPassword: "WrongCurrentPassword",
      newPassword: "NewAdminPassword123!",
    });
    expect(badPwd.success).toBe(false);

    const goodPwd = await changeMyPasswordAction({
      currentPassword: "AdminPassword123!",
      newPassword: "NewAdminPassword123!",
    });
    expect(goodPwd.success).toBe(true);

    // Simulate stale session with old sessionVersion (1) -> rejected
    setTestSession({
      userId: adminId,
      email: "owner@corecapital.local",
      name: "Primary Admin",
      role: "admin",
      sessionVersion: 1,
      exp: Date.now() + 60_000,
    });
    expect((await getAuthStatusAction()).user).toBeNull();

    // Logout & Login with new password
    await logoutAction();
    const badLogin = await loginAction({
      email: "owner@corecapital.local",
      password: "AdminPassword123!",
    });
    expect(badLogin.success).toBe(false);

    const goodLogin = await loginAction({
      email: "owner@corecapital.local",
      password: "NewAdminPassword123!",
    });
    expect(goodLogin.success).toBe(true);
    expect(goodLogin.user?.sessionVersion).toBe(2);

    // Self workspace reset: clean -> demo -> clean
    await resetMyWorkspaceAction("demo");
    expect((await getAccountsAction()).length).toBe(3);
    expect((await getTransactionsAction()).length).toBe(3);
    expect((await getBudgetsAction()).length).toBe(5);
    expect((await getSubscriptionsAction()).length).toBe(5);

    await resetMyWorkspaceAction("clean");
    expect((await getAccountsAction()).length).toBe(1);
    expect((await getTransactionsAction()).length).toBe(0);

    // Admin creates a second standard user with demo data
    const createUserRes = await createUserAdminAction({
      name: "Partner User",
      email: "partner@corecapital.local",
      password: "PartnerPass123!",
      role: "user",
      seedMode: "demo",
    });
    expect(createUserRes.success).toBe(true);
    const partnerId = createUserRes.user!.id;

    // Cannot demote or deactivate the last active admin
    const demoteLastAdmin = await updateUserAdminAction({
      targetUserId: adminId,
      name: "Primary Admin",
      email: "owner@corecapital.local",
      role: "user",
      isActive: true,
    });
    expect(demoteLastAdmin.success).toBe(false);
    expect(demoteLastAdmin.error).toContain("last active administrator");

    // Cannot self-delete
    const selfDelete = await deleteUserAdminAction(adminId);
    expect(selfDelete.success).toBe(false);

    // Log in as partner -> sees partner's isolated demo ledger and is blocked from admin actions
    await loginAction({
      email: "partner@corecapital.local",
      password: "PartnerPass123!",
    });
    expect((await getTransactionsAction()).length).toBe(3);
    const nonAdminList = await listUsersAdminAction();
    expect(nonAdminList.success).toBe(false);

    // Log back in as Admin -> still sees Admin's clean ledger (0 transactions)
    await loginAction({
      email: "owner@corecapital.local",
      password: "NewAdminPassword123!",
    });
    expect((await getTransactionsAction()).length).toBe(0);

    // Admin updates partner details, resets password, resets workspace, and deletes partner
    const updatePartner = await updateUserAdminAction({
      targetUserId: partnerId,
      name: "Updated Partner",
      email: "partner@corecapital.local",
      role: "user",
      isActive: true,
    });
    expect(updatePartner.success).toBe(true);
    expect(updatePartner.user?.name).toBe("Updated Partner");

    const resetPartnerPwd = await resetUserPasswordAdminAction({
      targetUserId: partnerId,
      newPassword: "ResetPartnerPass123!",
    });
    expect(resetPartnerPwd.success).toBe(true);

    const resetPartnerWs = await resetUserWorkspaceAdminAction({
      targetUserId: partnerId,
      seedMode: "clean",
    });
    expect(resetPartnerWs.success).toBe(true);

    const deletePartner = await deleteUserAdminAction(partnerId);
    expect(deletePartner.success).toBe(true);

    const finalList = await listUsersAdminAction();
    expect(finalList.users).toHaveLength(1);
    expect(finalList.users[0].id).toBe(adminId);

    setTestSession(undefined);
  });
});

describe("Theme Mode Helpers", () => {
  it("defaults to dark theme when stored value is missing or invalid", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(resolveTheme(null)).toBe("dark");
    expect(resolveTheme(undefined)).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");
  });

  it("resolves explicit light and dark values and toggles cleanly", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(getNextTheme("dark")).toBe("light");
    expect(getNextTheme("light")).toBe("dark");
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
  });
});

describe("Configurable Property Goal Actions & Schemes", () => {
  it("supports custom goal creation without hardcoded 2029 defaults, FHSS/DHOAS toggles, and custom DHOAS amounts", async () => {
    await store.clearAllUsersForTest();
    setTestSession(null);
    const setupRes = await setupInitialAdminAction({
      name: "Goal Tester",
      email: "goals@corecapital.local",
      password: "GoalPassword123!",
      baseCurrency: "AUD",
      seedMode: "clean",
    });
    expect(setupRes.success).toBe(true);

    const initial = await getPropertyGoalModelAction();
    expect(initial.hasGoal).toBe(false);
    expect(initial.goal).toBeNull();

    // Log an FHSS contribution first while FHSS is turned OFF on the goal
    const contribRes = await addFhssContributionAction({
      amount: 15000,
      financialYear: "2026-27",
      contributionType: "concessional",
      fundName: "AustralianSuper",
    });
    expect(contribRes.success).toBe(true);

    // Save non-Australian custom goal with FHSS & DHOAS both OFF
    const customSave = await savePropertyGoalAction({
      goalName: "London Flat Deposit",
      targetDate: "2031-03-15",
      locationCode: "CUSTOM",
      targetCity: "London, UK",
      customLocationName: "London, UK",
      isFirstHomeBuyer: false,
      targetPrice: 650000,
      depositPct: 15,
      customStampDuty: 20000,
      conveyancingFees: 2500,
      estimatedLmi: 0,
      useLiveLiquidSavings: false,
      currentSavingsAllocated: 50000,
      monthlySavingsPace: 2500,
      useFhss: false,
      fhssMarginalTaxRatePct: 37,
      useDhoas: false,
      dhoasMode: "auto",
      dhoasEnlistmentDate: "2021-03-01",
      dhoasServiceType: "permanent",
      dhoasMonthlySubsidy: null,
      dhoasLoanCap: null,
      dhoasLumpSumAmount: 0,
    });
    expect(customSave.success).toBe(true);
    expect(customSave.data?.hasGoal).toBe(true);
    expect(customSave.data?.goal?.locationLabel).toBe("London, UK");
    expect(customSave.data?.goal?.targetYear).toBe(2031);
    expect(customSave.data?.goal?.targetDepositAmount).toBe(97500);
    expect(customSave.data?.goal?.stampDuty).toBe(20000);
    expect(customSave.data?.goal?.totalRequiredCash).toBe(120000);
    // FHSS is OFF so totalCapitalReady reflects only allocated $50k
    expect(customSave.data?.goal?.fhssReleaseEstimate).toBe(0);
    expect(customSave.data?.goal?.totalCapitalReady).toBe(50000);
    expect(customSave.data?.dhoas).toBeNull();

    // Enable FHSS and verify totalCapitalReady includes FHSS release
    const withFhss = await savePropertyGoalAction({
      goalName: "Brisbane Deposit",
      targetDate: "2031-03-15",
      locationCode: "QLD",
      targetCity: "Brisbane",
      isFirstHomeBuyer: true,
      targetPrice: 800000,
      depositPct: 20,
      customStampDuty: null,
      conveyancingFees: 3850,
      estimatedLmi: 0,
      useLiveLiquidSavings: false,
      currentSavingsAllocated: 50000,
      monthlySavingsPace: 2500,
      useFhss: true,
      fhssMarginalTaxRatePct: 37,
      useDhoas: false,
      dhoasMode: "auto",
      dhoasEnlistmentDate: "2021-03-01",
      dhoasServiceType: "permanent",
      dhoasMonthlySubsidy: null,
      dhoasLoanCap: null,
      dhoasLumpSumAmount: 0,
    });
    expect(withFhss.success).toBe(true);
    expect(withFhss.data?.goal?.locationLabel).toBe("Brisbane, QLD");
    expect(withFhss.data?.goal?.fhssReleaseEstimate).toBeGreaterThan(0);
    expect(withFhss.data?.goal?.totalCapitalReady).toBeGreaterThan(50000);
    expect(withFhss.data?.dhoas).toBeNull();

    // Enable DHOAS with custom subsidy, loan cap, and lump sum
    const withDhoas = await savePropertyGoalAction({
      goalName: "Brisbane Deposit",
      targetDate: "2031-03-15",
      locationCode: "QLD",
      targetCity: "Brisbane",
      isFirstHomeBuyer: true,
      targetPrice: 800000,
      depositPct: 20,
      customStampDuty: null,
      conveyancingFees: 3850,
      estimatedLmi: 0,
      useLiveLiquidSavings: false,
      currentSavingsAllocated: 50000,
      monthlySavingsPace: 2500,
      useFhss: true,
      fhssMarginalTaxRatePct: 37,
      useDhoas: true,
      dhoasMode: "custom",
      dhoasEnlistmentDate: "2021-03-01",
      dhoasServiceType: "permanent",
      dhoasMonthlySubsidy: 650,
      dhoasLoanCap: 620000,
      dhoasLumpSumAmount: 15000,
    });
    expect(withDhoas.success).toBe(true);
    expect(withDhoas.data?.dhoas?.effectiveMonthlySubsidy).toBe(650);
    expect(withDhoas.data?.dhoas?.effectiveLoanCap).toBe(620000);
    expect(withDhoas.data?.dhoas?.lumpSumAmount).toBe(15000);
    expect(withDhoas.data?.dhoas?.targetYear).toBe(2031);
    expect(withDhoas.data?.goal?.totalCapitalReady).toBeCloseTo(
      withFhss.data!.goal!.totalCapitalReady + 15000,
      2
    );

    // Delete FHSS contribution and delete goal
    const contribId = withDhoas.data!.contributions[0].id;
    const afterDelContrib = await deleteFhssContributionAction(contribId);
    expect(afterDelContrib.success).toBe(true);
    expect(afterDelContrib.data?.contributions).toHaveLength(0);

    const afterDelGoal = await deletePropertyGoalAction();
    expect(afterDelGoal.success).toBe(true);
    expect(afterDelGoal.data?.hasGoal).toBe(false);
    expect(afterDelGoal.data?.goal).toBeNull();
    setTestSession(undefined);
  });
});

function localIsoPlusDays(offsetDays: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

describe("Cash Flow Forecasting & Scheduled Items", () => {
  it("starts completely empty after clean slate reset and projects only user-configured items", async () => {
    await store.clearAllUsersForTest();
    setTestSession(null);
    const setupRes = await setupInitialAdminAction({
      name: "Cash Flow Tester",
      email: "cashflow@corecapital.local",
      password: "CashFlowPassword123!",
      baseCurrency: "AUD",
      seedMode: "clean",
    });
    expect(setupRes.success).toBe(true);

    const clean30 = await getCashFlowProjectionAction(30);
    const clean90 = await getCashFlowProjectionAction(90);
    for (const proj of [clean30, clean90]) {
      expect(proj.startingBalance).toBe(0);
      expect(proj.endingBalance).toBe(0);
      expect(proj.lowestBalance).toBe(0);
      expect(proj.netChange).toBe(0);
      expect(proj.scheduledIncomeCount).toBe(0);
      expect(proj.scheduledIncomeTotal).toBe(0);
      expect(proj.scheduledExpenseCount).toBe(0);
      expect(proj.scheduledExpenseTotal).toBe(0);
      expect(proj.points.every((p) => p.eventDescription === undefined)).toBe(true);
    }

    // Add a fortnightly income starting in 5 days -> occurs on day 5 and day 19 in 30d window (2x $2,000)
    const incRes = await createCashFlowItemAction({
      name: "Paycheck",
      type: "income",
      amount: 2000,
      frequency: "fortnightly",
      nextOccurrenceDate: localIsoPlusDays(5),
    });
    expect(incRes.success).toBe(true);
    expect(incRes.item).toBeDefined();

    // Add a one-off expense in 10 days -> $500
    const expRes = await createCashFlowItemAction({
      name: "Car Service",
      type: "expense",
      amount: 500,
      frequency: "one_off",
      nextOccurrenceDate: localIsoPlusDays(10),
    });
    expect(expRes.success).toBe(true);
    expect(expRes.item).toBeDefined();

    const afterAdd = await getCashFlowProjectionAction(30);
    expect(afterAdd.scheduledIncomeCount).toBe(2);
    expect(afterAdd.scheduledIncomeTotal).toBe(4000);
    expect(afterAdd.scheduledExpenseCount).toBe(1);
    expect(afterAdd.scheduledExpenseTotal).toBe(500);
    expect(afterAdd.netChange).toBe(3500);
    expect(afterAdd.endingBalance).toBe(3500);

    // Pause the income item -> excluded from projection
    await toggleCashFlowItemAction(incRes.item!.id, false);
    const afterPause = await getCashFlowProjectionAction(30);
    expect(afterPause.scheduledIncomeCount).toBe(0);
    expect(afterPause.scheduledIncomeTotal).toBe(0);
    expect(afterPause.scheduledExpenseCount).toBe(1);
    expect(afterPause.netChange).toBe(-500);

    // Delete expense item -> back to zero events
    await deleteCashFlowItemAction(expRes.item!.id);
    const pageAfterDel = await getCashFlowPageDataAction();
    expect(pageAfterDel.scheduledItems).toHaveLength(1);
    expect(pageAfterDel.projection30.netChange).toBe(0);

    // Clean slate reset wipes all scheduled cash flow items
    const resetRes = await resetMyWorkspaceAction("clean");
    expect(resetRes.success).toBe(true);
    const afterReset = await getCashFlowPageDataAction();
    expect(afterReset.scheduledItems).toHaveLength(0);
    expect(afterReset.projection30.scheduledIncomeCount).toBe(0);
    expect(afterReset.projection30.endingBalance).toBe(0);

    setTestSession(undefined);
  });
});

describe("Transactions Separation & Immutable Edit / Ledger Hash Audit", () => {
  it("keeps active transactions separate from reversal history, supports immutable edits across accounts/categories/splits, and assigns SHA-256 hashes", async () => {
    await store.clearAllUsersForTest();
    setTestSession(null);
    const setupRes = await setupInitialAdminAction({
      name: "Ledger Auditor",
      email: "auditor@corecapital.local",
      password: "AuditorPassword123!",
      baseCurrency: "AUD",
      seedMode: "demo",
    });
    expect(setupRes.success).toBe(true);

    const [accountsBefore, categories, budgetsBefore] = await Promise.all([
      getAccountsAction(),
      getCategoriesAction(),
      getBudgetsAction(),
    ]);
    const checking = accountsBefore.find((a) => a.accountType === "checking")!;
    const savings = accountsBefore.find((a) => a.accountType === "savings")!;
    const groceriesCat = categories.find((c) => c.slug === "groceries")!;
    const diningCat = categories.find((c) => c.slug === "dining")!;

    const initialCheckingBal = parseFloat(checking.currentBalance);
    const initialSavingsBal = parseFloat(savings.currentBalance);
    const initialGroceriesSpent = budgetsBefore.find(
      (b) => b.categoryId === groceriesCat.id
    )!.spentAmount;
    const initialDiningSpent = budgetsBefore.find(
      (b) => b.categoryId === diningCat.id
    )!.spentAmount;

    // 1. Create and reverse a transaction -> reversal gets 64-char SHA-256 hash and leaves active list clean
    const txARes = await createTransactionAction({
      accountId: checking.id,
      date: "2026-11-20",
      amount: -100,
      cleanDescription: "Duplicate Groceries Charge",
      categoryId: groceriesCat.id,
    });
    expect(txARes.success).toBe(true);
    const txAId = txARes.transaction!.id;

    const revARes = await reverseTransactionAction(txAId, "Duplicate merchant charge");
    expect(revARes.success).toBe(true);
    expect(revARes.reversalTransaction?.deduplicationHash).toMatch(/^[0-9a-f]{64}$/);

    const afterRevPage = await getTransactionsPageDataAction();
    const activeAfterRev = afterRevPage.transactions.filter(
      (t) => t.status === "posted" && !t.isReversal
    );
    expect(activeAfterRev.some((t) => t.id === txAId)).toBe(false);
    expect(
      activeAfterRev.some((t) => t.id === revARes.reversalTransaction!.id)
    ).toBe(false);
    expect(afterRevPage.transactions.some((t) => t.id === txAId && t.status === "reversed")).toBe(
      true
    );
    expect(
      afterRevPage.transactions.every((t) => /^[0-9a-f]{64}$/.test(t.deduplicationHash || ""))
    ).toBe(true);

    // 2. Create txB on checking + groceries, then immutably edit to savings + dining + new amount
    const txBRes = await createTransactionAction({
      accountId: checking.id,
      date: "2026-11-21",
      amount: -80,
      cleanDescription: "Original Cafe Purchase",
      categoryId: groceriesCat.id,
    });
    expect(txBRes.success).toBe(true);
    const txBId = txBRes.transaction!.id;

    const editRes = await editTransactionAction({
      transactionId: txBId,
      accountId: savings.id,
      date: "2026-11-21",
      amount: -120,
      cleanDescription: "Edited Bistro Dinner",
      merchant: "Bistro Adelaide",
      categoryId: diningCat.id,
      notes: "Paid from savings",
      editReason: "Corrected account, category, and receipt total",
    });
    expect(editRes.success).toBe(true);
    expect(editRes.transaction).toBeDefined();
    expect(editRes.reversalTransaction?.deduplicationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(editRes.transaction?.deduplicationHash).toMatch(/^[0-9a-f]{64}$/);

    const [accountsAfterEdit, budgetsAfterEdit, pageAfterEdit] = await Promise.all([
      getAccountsAction(),
      getBudgetsAction(),
      getTransactionsPageDataAction(),
    ]);
    expect(
      parseFloat(accountsAfterEdit.find((a) => a.id === checking.id)!.currentBalance)
    ).toBeCloseTo(initialCheckingBal, 2);
    expect(
      parseFloat(accountsAfterEdit.find((a) => a.id === savings.id)!.currentBalance)
    ).toBeCloseTo(initialSavingsBal - 120, 2);
    expect(
      budgetsAfterEdit.find((b) => b.categoryId === groceriesCat.id)!.spentAmount
    ).toBeCloseTo(initialGroceriesSpent, 2);
    expect(
      budgetsAfterEdit.find((b) => b.categoryId === diningCat.id)!.spentAmount
    ).toBeCloseTo(initialDiningSpent + 120, 2);

    const activeAfterEdit = pageAfterEdit.transactions.filter(
      (t) => t.status === "posted" && !t.isReversal
    );
    expect(activeAfterEdit.some((t) => t.id === txBId)).toBe(false);
    expect(activeAfterEdit.some((t) => t.id === editRes.reversalTransaction!.id)).toBe(false);
    expect(
      activeAfterEdit.some(
        (t) => t.id === editRes.transaction!.id && t.cleanDescription === "Edited Bistro Dinner"
      )
    ).toBe(true);

    expect(
      pageAfterEdit.auditLogs.some(
        (l) => l.entityId === editRes.reversalTransaction!.id && l.action === "REVERSAL"
      )
    ).toBe(true);
    expect(
      pageAfterEdit.auditLogs.some(
        (l) => l.entityId === editRes.transaction!.id && l.action === "EDIT"
      )
    ).toBe(true);

    // 3. Edit replacement into a balanced split transaction
    const splitEditRes = await editTransactionAction({
      transactionId: editRes.transaction!.id,
      accountId: savings.id,
      date: "2026-11-21",
      amount: -120,
      cleanDescription: "Split Grocery & Bistro",
      isSplit: true,
      splits: [
        { categoryId: groceriesCat.id, amount: 70, description: "Groceries share" },
        { categoryId: diningCat.id, amount: 50, description: "Dining share" },
      ],
      editReason: "Split receipt across groceries and dining",
    });
    expect(splitEditRes.success).toBe(true);
    expect(splitEditRes.transaction?.isSplit).toBe(true);
    expect(splitEditRes.transaction?.ledgerEntries).toHaveLength(2);

    const budgetsAfterSplit = await getBudgetsAction();
    expect(
      budgetsAfterSplit.find((b) => b.categoryId === groceriesCat.id)!.spentAmount
    ).toBeCloseTo(initialGroceriesSpent + 70, 2);
    expect(
      budgetsAfterSplit.find((b) => b.categoryId === diningCat.id)!.spentAmount
    ).toBeCloseTo(initialDiningSpent + 50, 2);

    // 4. Reject unbalanced split, editing reversed tx, and editing reversal entry
    const unbalancedEdit = await editTransactionAction({
      transactionId: splitEditRes.transaction!.id,
      accountId: savings.id,
      date: "2026-11-21",
      amount: -120,
      cleanDescription: "Bad Split",
      isSplit: true,
      splits: [
        { categoryId: groceriesCat.id, amount: 60 },
        { categoryId: diningCat.id, amount: 40 },
      ],
    });
    expect(unbalancedEdit.success).toBe(false);
    expect(unbalancedEdit.error).toContain("Split sum");

    const editReversed = await editTransactionAction({
      transactionId: txBId,
      accountId: checking.id,
      date: "2026-11-21",
      amount: -50,
      cleanDescription: "Should Fail",
      categoryId: groceriesCat.id,
    });
    expect(editReversed.success).toBe(false);
    expect(editReversed.error).toContain("reversed");

    const editReversal = await editTransactionAction({
      transactionId: editRes.reversalTransaction!.id,
      accountId: checking.id,
      date: "2026-11-21",
      amount: 80,
      cleanDescription: "Should Fail",
      categoryId: groceriesCat.id,
    });
    expect(editReversal.success).toBe(false);
    expect(editReversal.error).toContain("reversal");

    setTestSession(undefined);
  });
});

describe("Accounts & Categories Management, Sub-Categories & Ordering", () => {
  it("supports category/sub-category CRUD, ordering, parent budget rollup, and account lifecycle", async () => {
    await store.clearAllUsersForTest();
    setTestSession(null);
    const setupRes = await setupInitialAdminAction({
      name: "Taxonomy Tester",
      email: "manage@corecapital.local",
      password: "ManagePassword123!",
      baseCurrency: "AUD",
      seedMode: "clean",
    });
    expect(setupRes.success).toBe(true);

    // 1. Create parent expense & income categories + sub-category inheriting type
    const parentRes = await createCategoryAction({
      name: "Lifestyle",
      type: "expense",
      color: "#6d5dfc",
    });
    expect(parentRes.success).toBe(true);
    const parentId = parentRes.category!.id;

    const childRes = await createCategoryAction({
      name: "Specialty Coffee",
      type: "income", // Should inherit parent's "expense" type
      color: "#27c6a5",
      parentId,
    });
    expect(childRes.success).toBe(true);
    expect(childRes.category?.type).toBe("expense");
    expect(childRes.category?.parentId).toBe(parentId);

    const incomeRes = await createCategoryAction({
      name: "Consulting Income",
      type: "income",
      color: "#10b981",
    });
    expect(incomeRes.success).toBe(true);

    // Reject 3rd-level nesting
    const thirdLevel = await createCategoryAction({
      name: "Pour Over",
      type: "expense",
      color: "#0ea5e9",
      parentId: childRes.category!.id,
    });
    expect(thirdLevel.success).toBe(false);
    expect(thirdLevel.error).toContain("2 levels");

    // 2. Reorder categories so Consulting Income comes first
    const allCatsBefore = await getCategoriesAction();
    const reorderedIds = [
      incomeRes.category!.id,
      ...allCatsBefore.filter((c) => c.id !== incomeRes.category!.id).map((c) => c.id),
    ];
    const reorderRes = await reorderCategoriesAction(reorderedIds);
    expect(reorderRes.success).toBe(true);
    const allCatsAfter = await getCategoriesAction();
    expect(allCatsAfter[0].id).toBe(incomeRes.category!.id);

    const flattened = sortAndFlattenCategories(allCatsAfter);
    const childNode = flattened.find((n) => n.id === childRes.category!.id)!;
    expect(childNode.depth).toBe(1);
    expect(childNode.displayLabel).toBe("Lifestyle › Specialty Coffee");

    // 3. Parent budget cap rolls up sub-category spending
    const budgetRes = await createBudgetAction({
      categoryId: parentId,
      categoryName: "Lifestyle",
      allocatedAmount: 300,
      period: "monthly",
    });
    expect(budgetRes.success).toBe(true);

    const accounts = await getAccountsAction();
    const txSubRes = await createTransactionAction({
      accountId: accounts[0].id,
      date: "2026-11-22",
      amount: -45,
      cleanDescription: "Morning Espresso",
      categoryId: childRes.category!.id,
    });
    expect(txSubRes.success).toBe(true);

    const budgets = await getBudgetsAction();
    const lifestyleBudget = budgets.find((b) => b.categoryId === parentId)!;
    expect(lifestyleBudget.spentAmount).toBeCloseTo(45, 2);

    // 4. Deleting parent category promotes sub-category to top-level
    const editChildRes = await updateCategoryAction({
      id: childRes.category!.id,
      name: "Coffee & Cafes",
      type: "expense",
      color: "#f59e0b",
      parentId,
    });
    expect(editChildRes.success).toBe(true);

    const delParentRes = await deleteCategoryAction(parentId);
    expect(delParentRes.success).toBe(true);
    const catsAfterDel = await getCategoriesAction();
    const promotedChild = catsAfterDel.find((c) => c.id === childRes.category!.id)!;
    expect(promotedChild.parentId).toBeNull();
    expect(promotedChild.name).toBe("Coffee & Cafes");

    // 5. Account CRUD, archive, and ledger delete protection
    const newAccRes = await createAccountAction({
      name: "Macquarie Offset",
      institution: "Macquarie Bank",
      accountType: "offset",
      accountNumberLast4: "9012",
      currency: "AUD",
      currentBalance: 12000,
      isOffsetAccount: true,
      interestRatePct: 5.95,
    });
    expect(newAccRes.success).toBe(true);
    const offsetId = newAccRes.account!.id;

    const updAccRes = await updateAccountAction({
      id: offsetId,
      name: "Macquarie Main Offset",
      institution: "Macquarie Bank",
      accountType: "offset",
      accountNumberLast4: "9012",
      currency: "AUD",
      currentBalance: 13500,
      isOffsetAccount: true,
      interestRatePct: 5.9,
    });
    expect(updAccRes.success).toBe(true);
    expect(updAccRes.account?.currentBalance).toBe("13500.00");

    // Archive hides from active getAccountsAction, keeps in getManageDataAction
    await toggleAccountActiveAction(offsetId, false);
    expect((await getAccountsAction()).some((a) => a.id === offsetId)).toBe(false);
    expect((await getManageDataAction()).accounts.some((a) => a.id === offsetId)).toBe(true);

    // Unused account deletes cleanly; account with transactions cannot be deleted
    const delUnused = await deleteAccountAction(offsetId);
    expect(delUnused.success).toBe(true);
    expect((await getManageDataAction()).accounts.some((a) => a.id === offsetId)).toBe(false);

    const delUsed = await deleteAccountAction(accounts[0].id);
    expect(delUsed.success).toBe(false);
    expect(delUsed.error).toContain("Archive");

    setTestSession(undefined);
  });
});

describe("Sub-Category Enhancements: Drilldown Charts, Nested Budget Sub-Caps, Rules & Merge, Drag-and-Drop", () => {
  it("builds drilldown spending hierarchy with General parent bucket and zero double-counting", () => {
    const cats = [
      { id: "p-food", name: "Food", type: "expense", parentId: null, color: "#6d5dfc", sortOrder: 0 },
      { id: "c-groc", name: "Groceries", type: "expense", parentId: "p-food", color: "#27c6a5", sortOrder: 10 },
      { id: "c-coffee", name: "Coffee", type: "expense", parentId: "p-food", color: "#f59e0b", sortOrder: 20 },
      { id: "p-trans", name: "Transport", type: "expense", parentId: null, color: "#0ea5e9", sortOrder: 30 },
    ];

    // Budgets exist on BOTH parent Food ($370 spent across parent+sub) and sub-cap Coffee ($45)
    const budgets = [
      { categoryId: "p-food", parentCategoryId: null, spentAmount: 370 },
      { categoryId: "c-coffee", parentCategoryId: "p-food", spentAmount: 45 },
    ];

    const txs = [
      {
        status: "posted",
        isReversal: false,
        ledgerEntries: [
          { categoryId: "c-groc", entryType: "debit", amount: "205.00" },
          { categoryId: "c-coffee", entryType: "debit", amount: "45.00" },
          { categoryId: "p-food", entryType: "debit", amount: "120.00" },
          { categoryId: "p-trans", entryType: "debit", amount: "80.00" },
        ],
      },
      // Reversed / reversal transactions should be excluded
      {
        status: "reversed",
        isReversal: false,
        ledgerEntries: [{ categoryId: "c-coffee", entryType: "debit", amount: "999.00" }],
      },
    ];

    const hierarchy = buildCategorySpendingHierarchy(cats, budgets, txs);
    expect(hierarchy).toHaveLength(2);

    const foodSlice = hierarchy.find((s) => s.id === "p-food")!;
    expect(foodSlice.value).toBeCloseTo(370, 2); // 205 + 45 + 120 (zero double-count)
    expect(foodSlice.children).toHaveLength(3);
    const childSum = foodSlice.children!.reduce((s, c) => s + c.value, 0);
    expect(childSum).toBeCloseTo(foodSlice.value, 2);
    expect(foodSlice.children!.some((c) => c.name === "Groceries" && c.value === 205)).toBe(true);
    expect(foodSlice.children!.some((c) => c.name === "Coffee" && c.value === 45)).toBe(true);
    expect(foodSlice.children!.some((c) => c.name === "General Food" && c.value === 120 && c.isDirectParentSpend)).toBe(true);

    const transSlice = hierarchy.find((s) => s.id === "p-trans")!;
    expect(transSlice.value).toBe(80);
    expect(transSlice.children).toBeUndefined();

    // Historical baseline preservation on top-level budget without duplicating child txs
    const withBaseline = buildCategorySpendingHierarchy(
      cats,
      [{ categoryId: "p-food", parentCategoryId: null, spentAmount: 500 }],
      txs
    );
    const foodWithBase = withBaseline.find((s) => s.id === "p-food")!;
    expect(foodWithBase.value).toBe(500);
    expect(foodWithBase.children!.find((c) => c.isDirectParentSpend)?.value).toBe(250); // 120 direct + 130 baseline
  });

  it("supports nested budget sub-caps without double-counting totals, custom alert thresholds, upsert/edit/delete, and anomaly attribution", async () => {
    await store.clearAllUsersForTest();
    setTestSession(null);
    await setupInitialAdminAction({
      name: "Budget SubCap Tester",
      email: "subcaps@corecapital.local",
      password: "SubCapsPassword123!",
      baseCurrency: "AUD",
      seedMode: "clean",
    });

    const accounts = await getAccountsAction();
    const foodParent = (await createCategoryAction({ name: "Food", type: "expense", color: "#6d5dfc" })).category!;
    const takeawaySub = (await createCategoryAction({ name: "Takeaway", type: "expense", color: "#f59e0b", parentId: foodParent.id })).category!;
    const groceriesSub = (await createCategoryAction({ name: "Groceries", type: "expense", color: "#27c6a5", parentId: foodParent.id })).category!;
    const hobbyParent = (await createCategoryAction({ name: "Hobbies", type: "expense", color: "#0ea5e9" })).category!;
    const photographySub = (await createCategoryAction({ name: "Photography", type: "expense", color: "#8b5cf6", parentId: hobbyParent.id })).category!;

    // Parent Food $800; soft sub-caps Takeaway $200 (alert >=75%) and Groceries $700 ($900 > $800 parent cap)
    await createBudgetAction({
      categoryId: foodParent.id,
      categoryName: foodParent.name,
      allocatedAmount: 800,
      period: "monthly",
      alertThresholdPct: 80,
    });
    const takeawayCapRes = await createBudgetAction({
      categoryId: takeawaySub.id,
      categoryName: takeawaySub.name,
      allocatedAmount: 200,
      period: "monthly",
      alertThresholdPct: 75,
    });
    await createBudgetAction({
      categoryId: groceriesSub.id,
      categoryName: groceriesSub.name,
      allocatedAmount: 700,
      period: "monthly",
    });
    // Standalone sub-category cap on Photography (Hobbies has NO parent cap)
    await createBudgetAction({
      categoryId: photographySub.id,
      categoryName: photographySub.name,
      allocatedAmount: 150,
      period: "monthly",
    });

    // Upsert check: creating again for Takeaway updates instead of duplicating
    const upsertTakeaway = await createBudgetAction({
      categoryId: takeawaySub.id,
      categoryName: takeawaySub.name,
      allocatedAmount: 200,
      period: "monthly",
      alertThresholdPct: 75,
    });
    expect(upsertTakeaway.budgets).toHaveLength(4);
    expect(upsertTakeaway.budget?.id).toBe(takeawayCapRes.budget?.id);

    // Spend $160 on Takeaway (80% of $200 >= 75% threshold -> warning; 20% of Food $800 -> normal)
    await createTransactionAction({
      accountId: accounts[0].id,
      date: "2026-11-22",
      amount: -160,
      cleanDescription: "Thai Takeaway Dinner",
      merchant: "Thai Place",
      categoryId: takeawaySub.id,
    });

    const budgets = await getBudgetsAction();
    const summary = summarizeBudgetsHierarchy(budgets);

    // totalCap = Food ($800) + standalone Photography ($150) = $950 (not $1,850)
    expect(summary.totalCap).toBeCloseTo(950, 2);
    // totalSpent = Food ($160 rolled up) + Photography ($0) = $160 (not $320)
    expect(summary.totalSpent).toBeCloseTo(160, 2);

    const foodGroup = summary.groups.find((g) => g.budget.categoryId === foodParent.id)!;
    expect(foodGroup.subCaps).toHaveLength(2);
    expect(foodGroup.exceedsParentCap).toBe(true); // $200 + $700 = $900 > $800
    expect(foodGroup.hasSubCapAlert).toBe(true);
    expect(foodGroup.budget.status).toBe("normal");
    expect(foodGroup.subCaps.find((s) => s.categoryId === takeawaySub.id)?.status).toBe("warning");

    const photoGroup = summary.groups.find((g) => g.budget.categoryId === photographySub.id)!;
    expect(photoGroup.isStandaloneSubCategory).toBe(true);

    const anomaliesWarning = await getSpendingAnomaliesAction();
    expect(
      anomaliesWarning.some(
        (a) => a.categoryName === "Food › Takeaway" && a.severity === "medium" && a.anomalyType.includes("75%")
      )
    ).toBe(true);

    // Overspend via Groceries sub-category -> parent Food overruns and anomaly surfaces matching sub-category tx
    await createTransactionAction({
      accountId: accounts[0].id,
      date: "2026-11-23",
      amount: -680,
      cleanDescription: "Big Supermarket Run",
      merchant: "Woolworths",
      categoryId: groceriesSub.id,
    });

    const anomaliesOverrun = await getSpendingAnomaliesAction();
    const foodOverrunAnom = anomaliesOverrun.find(
      (a) => a.categoryName === "Food" && a.severity === "high"
    );
    expect(foodOverrunAnom).toBeDefined();
    expect(foodOverrunAnom?.merchant).toBe("Woolworths");

    // Edit & delete budget cap
    const updatedCap = await updateBudgetAction({
      id: takeawayCapRes.budget!.id,
      allocatedAmount: 250,
      period: "monthly",
      alertThresholdPct: 90,
    });
    expect(updatedCap.success).toBe(true);
    expect(updatedCap.budget?.allocatedAmount).toBe(250);
    expect(updatedCap.budget?.status).toBe("normal");

    const delCap = await deleteBudgetAction(photographySub.id ? photoGroup.budget.id : "");
    expect(delCap.success).toBe(true);
    expect((await getBudgetsAction())).toHaveLength(3);

    setTestSession(undefined);
  });

  it("evaluates sub-category rules on unclassified entries and refines parent-tagged entries without touching other trees", async () => {
    await store.clearAllUsersForTest();
    setTestSession(null);
    await setupInitialAdminAction({
      name: "Rules SubCat Tester",
      email: "subrules@corecapital.local",
      password: "SubRulesPassword123!",
      baseCurrency: "AUD",
      seedMode: "clean",
    });

    const accounts = await getAccountsAction();
    const foodParent = (await createCategoryAction({ name: "Food", type: "expense", color: "#6d5dfc" })).category!;
    const coffeeSub = (await createCategoryAction({ name: "Coffee", type: "expense", color: "#f59e0b", parentId: foodParent.id })).category!;
    const transportParent = (await createCategoryAction({ name: "Transport", type: "expense", color: "#0ea5e9" })).category!;

    const parentRuleRes = await createClassificationRuleAction({
      name: "Broad Cafe Fallback",
      priority: 50,
      field: "description",
      matchType: "contains",
      matchValue: "cafe",
      targetCategoryId: foodParent.id,
    });
    const subRuleRes = await createClassificationRuleAction({
      name: "Campos Specialty Coffee",
      priority: 20,
      field: "description",
      matchType: "contains",
      matchValue: "campos",
      targetCategoryId: coffeeSub.id,
    });
    expect(parentRuleRes.success).toBe(true);
    expect(subRuleRes.success).toBe(true);

    // 1. Unclassified "Campos Espresso" -> direct match to Food › Coffee
    const txUnclassified = await createTransactionAction({
      accountId: accounts[0].id,
      date: "2026-11-22",
      amount: -6.5,
      cleanDescription: "Campos Espresso",
    });
    // 2. Broadly parent-tagged "Campos Roasters" under Food -> refined to Food › Coffee
    const txBroadFood = await createTransactionAction({
      accountId: accounts[0].id,
      date: "2026-11-22",
      amount: -22.0,
      cleanDescription: "Campos Roasters Beans",
      categoryId: foodParent.id,
    });
    // 3. Unrelated Transport entry containing "campos" -> must stay Transport
    const txOtherTree = await createTransactionAction({
      accountId: accounts[0].id,
      date: "2026-11-22",
      amount: -18.0,
      cleanDescription: "Campos Station Parking",
      categoryId: transportParent.id,
    });

    const runUnclassified = await runClassificationRulesAction("unclassified");
    expect(runUnclassified.success).toBe(true);
    expect(runUnclassified.matchedCount).toBe(1);

    const runRefine = await runClassificationRulesAction("refine_parents");
    expect(runRefine.success).toBe(true);
    expect(runRefine.matchedCount).toBe(1);

    const txsAfter = await getTransactionsAction();
    expect(
      txsAfter.find((t) => t.id === txUnclassified.transaction!.id)?.ledgerEntries[0].categoryId
    ).toBe(coffeeSub.id);
    expect(
      txsAfter.find((t) => t.id === txBroadFood.transaction!.id)?.ledgerEntries[0].categoryName
    ).toBe("Food › Coffee");
    expect(
      txsAfter.find((t) => t.id === txOtherTree.transaction!.id)?.ledgerEntries[0].categoryId
    ).toBe(transportParent.id);

    // Edit rule & pause rule -> paused rule must not match new transactions
    const updRule = await updateClassificationRuleAction({
      id: subRuleRes.rule!.id,
      name: "Campos & Specialty Beans",
      priority: 15,
      field: "description",
      matchType: "contains",
      matchValue: "campos",
      targetCategoryId: coffeeSub.id,
    });
    expect(updRule.success).toBe(true);
    expect(updRule.rule?.priority).toBe(15);

    await toggleClassificationRuleAction(subRuleRes.rule!.id, false);
    const txWhilePaused = await createTransactionAction({
      accountId: accounts[0].id,
      date: "2026-11-22",
      amount: -5.5,
      cleanDescription: "Campos Oat Flat White",
    });
    await runClassificationRulesAction("unclassified");
    const txsPausedCheck = await getTransactionsAction();
    expect(
      txsPausedCheck.find((t) => t.id === txWhilePaused.transaction!.id)?.ledgerEntries[0].categoryId
    ).toBeNull();

    // Delete rule
    await deleteClassificationRuleAction(parentRuleRes.rule!.id);
    const remainingRules = await getClassificationRulesAction();
    expect(remainingRules.some((r) => r.id === parentRuleRes.rule!.id)).toBe(false);

    setTestSession(undefined);
  });

  it("merges retired categories into replacements cleanly across transactions, rules, budgets, sub-categories, and audit logs", async () => {
    await store.clearAllUsersForTest();
    setTestSession(null);
    await setupInitialAdminAction({
      name: "Merge Tester",
      email: "merge@corecapital.local",
      password: "MergePassword123!",
      baseCurrency: "AUD",
      seedMode: "clean",
    });

    const accounts = await getAccountsAction();
    const cats = await getCategoriesAction();
    const foodParent = (await createCategoryAction({ name: "Food", type: "expense", color: "#6d5dfc" })).category!;
    const oldCoffee = (await createCategoryAction({ name: "Old Coffee", type: "expense", color: "#f59e0b", parentId: foodParent.id })).category!;
    const diningOut = (await createCategoryAction({ name: "Dining Out", type: "expense", color: "#ec4899" })).category!;
    const salaryIncome = cats.find((c) => c.type === "income")!;

    // Reject self-merge and cross-type merge
    const selfMerge = await mergeCategoryAction(oldCoffee.id, oldCoffee.id);
    expect(selfMerge.success).toBe(false);
    const crossTypeMerge = await mergeCategoryAction(oldCoffee.id, salaryIncome.id);
    expect(crossTypeMerge.success).toBe(false);

    // Attach tx, rule, and budget caps to BOTH Old Coffee and Dining Out
    const coffeeTx = await createTransactionAction({
      accountId: accounts[0].id,
      date: "2026-11-22",
      amount: -14.5,
      cleanDescription: "Old Coffee Roastery",
      categoryId: oldCoffee.id,
    });
    const coffeeRule = await createClassificationRuleAction({
      name: "Roastery Rule",
      priority: 10,
      field: "description",
      matchType: "contains",
      matchValue: "roastery",
      targetCategoryId: oldCoffee.id,
    });
    await createBudgetAction({
      categoryId: oldCoffee.id,
      categoryName: oldCoffee.name,
      allocatedAmount: 100,
      period: "monthly",
    });
    await createBudgetAction({
      categoryId: diningOut.id,
      categoryName: diningOut.name,
      allocatedAmount: 400,
      period: "monthly",
    });

    const usageBefore = (await getManageDataAction()).usageByCategory[oldCoffee.id];
    expect(usageBefore.transactions).toBe(1);
    expect(usageBefore.rules).toBe(1);
    expect(usageBefore.budgets).toBe(1);

    // Retire-with-replacement into Dining Out
    const mergeRes = await deleteCategoryAction(oldCoffee.id, diningOut.id);
    expect(mergeRes.success).toBe(true);
    expect(mergeRes.mergedSummary?.reassignedEntries).toBe(1);
    expect(mergeRes.mergedSummary?.reassignedRules).toBe(1);

    const pageAfter = await getTransactionsPageDataAction();
    expect(
      pageAfter.transactions.find((t) => t.id === coffeeTx.transaction!.id)?.ledgerEntries[0].categoryId
    ).toBe(diningOut.id);
    expect(
      pageAfter.auditLogs.some((l) => l.action === "MERGE" && l.entityId === diningOut.id)
    ).toBe(true);

    const rulesAfter = await getClassificationRulesAction();
    expect(rulesAfter.find((r) => r.id === coffeeRule.rule!.id)?.targetCategoryId).toBe(diningOut.id);

    const budgetsAfter = await getBudgetsAction();
    const diningBudgets = budgetsAfter.filter((b) => b.categoryId === diningOut.id);
    expect(diningBudgets).toHaveLength(1);
    expect(diningBudgets[0].allocatedAmount).toBe(400);
    expect(diningBudgets[0].spentAmount).toBeCloseTo(14.5, 2);

    // Merging a parent category into its own child promotes child and keeps siblings 2-level valid
    const siblingSub = (await createCategoryAction({ name: "Bakery", type: "expense", color: "#27c6a5", parentId: foodParent.id })).category!;
    const secondSub = (await createCategoryAction({ name: "Deli", type: "expense", color: "#0ea5e9", parentId: foodParent.id })).category!;
    const parentIntoChild = await mergeCategoryAction(foodParent.id, siblingSub.id);
    expect(parentIntoChild.success).toBe(true);
    const catsAfterParentMerge = await getCategoriesAction();
    const promotedBakery = catsAfterParentMerge.find((c) => c.id === siblingSub.id)!;
    const movedDeli = catsAfterParentMerge.find((c) => c.id === secondSub.id)!;
    expect(promotedBakery.parentId).toBeNull();
    expect(movedDeli.parentId).toBe(promotedBakery.id);

    setTestSession(undefined);
  });

  it("computes and persists drag-and-drop category reordering and same-type reparenting safely", async () => {
    await store.clearAllUsersForTest();
    setTestSession(null);
    await setupInitialAdminAction({
      name: "DragDrop Tester",
      email: "dragdrop@corecapital.local",
      password: "DragDropPassword123!",
      baseCurrency: "AUD",
      seedMode: "clean",
    });

    const food = (await createCategoryAction({ name: "Food", type: "expense", color: "#6d5dfc" })).category!;
    const coffee = (await createCategoryAction({ name: "Coffee", type: "expense", color: "#f59e0b", parentId: food.id })).category!;
    const snacks = (await createCategoryAction({ name: "Snacks", type: "expense", color: "#27c6a5", parentId: food.id })).category!;
    const dining = (await createCategoryAction({ name: "Dining", type: "expense", color: "#ec4899" })).category!;
    const salary = (await createCategoryAction({ name: "Bonus Income", type: "income", color: "#10b981" })).category!;

    const allCats = await getCategoriesAction();

    // 1. Reorder sub-categories within Food: Snacks before Coffee
    const subReorder = computeCategoryDragResult(allCats, snacks.id, coffee.id, "before");
    expect(subReorder.changed).toBe(true);
    expect(subReorder.parentChanged).toBe(false);
    expect(subReorder.orderedIds).toHaveLength(allCats.length);
    expect(subReorder.orderedIds.indexOf(snacks.id)).toBeLessThan(
      subReorder.orderedIds.indexOf(coffee.id)
    );

    // 2. Reject cross-type reparenting (dropping expense child onto income parent)
    const crossTypeDrop = computeCategoryDragResult(allCats, snacks.id, salary.id, "inside");
    expect(crossTypeDrop.changed).toBe(false);

    // 3. Reject nesting a parent that has existing children
    const nestParentWithChildren = computeCategoryDragResult(allCats, food.id, dining.id, "inside");
    expect(nestParentWithChildren.changed).toBe(false);

    // 4. Reparent Coffee inside Dining and persist atomically via moveCategoryOrderAction
    const reparent = computeCategoryDragResult(allCats, coffee.id, dining.id, "inside");
    expect(reparent.changed).toBe(true);
    expect(reparent.parentChanged).toBe(true);
    expect(reparent.nextParentId).toBe(dining.id);

    const moveRes = await moveCategoryOrderAction({
      categoryId: coffee.id,
      targetParentId: reparent.nextParentId,
      orderedIds: reparent.orderedIds,
    });
    expect(moveRes.success).toBe(true);
    const updatedCats = await getCategoriesAction();
    expect(updatedCats.find((c) => c.id === coffee.id)?.parentId).toBe(dining.id);

    // 5. Reject direct server call to nest across types
    const invalidServerMove = await moveCategoryOrderAction({
      categoryId: coffee.id,
      targetParentId: salary.id,
      orderedIds: updatedCats.map((c) => c.id),
    });
    expect(invalidServerMove.success).toBe(false);
    expect(invalidServerMove.error).toContain("same type");

    setTestSession(undefined);
  });
});
