import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  calculateFhssRelease,
  calculateDhoasEntitlement,
  calculateSouthAustraliaStampDuty,
  calculateVictoriaStampDuty,
  calculateAnnualizedSubscriptionCost,
  getAustralianFinancialYear,
} from "@/lib/australian-finance";
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
