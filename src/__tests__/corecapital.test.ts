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
  reverseTransactionAction,
  getAccountsAction,
  getTransactionsAction,
} from "@/actions/transactions";
import { getBudgetsAction } from "@/actions/budgets";
import { getSubscriptionsAction } from "@/actions/subscriptions";
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
