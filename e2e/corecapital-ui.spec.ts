import fs from "node:fs";
import path from "node:path";
import { expect, Locator, Page, test, BrowserContext } from "@playwright/test";

const CAPTURE_DIR = process.env.E2E_CAPTURE_DIR || "";

async function maybeCapture(page: Page, filename: string) {
  if (!CAPTURE_DIR) return;
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(CAPTURE_DIR, filename), fullPage: true });
}

async function selectOptionContaining(select: Locator, substring: string) {
  const options = await select.locator("option").evaluateAll((els) =>
    els.map((el) => ({
      value: (el as HTMLOptionElement).value,
      text: (el.textContent || "").trim(),
    }))
  );
  const needle = substring.toLowerCase();
  const exact = options.find((o) => o.text.toLowerCase() === needle);
  const partial = options.find((o) => o.text.toLowerCase().includes(needle));
  const match = exact || partial;
  if (!match) {
    throw new Error(
      `Option matching "${substring}" not found. Available: ${options.map((o) => o.text).join(", ")}`
    );
  }
  await select.selectOption(match.value);
}

async function assertNoHorizontalOverflow(page: Page, routeLabel: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    overflow.scrollWidth,
    `Horizontal overflow detected on ${routeLabel}: scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.innerWidth}`
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

test.describe.serial("CoreCapital End-to-End UI Flows", () => {
  let context: BrowserContext;
  let page: Page;
  let pageErrors: string[] = [];
  let consoleErrors: string[] = [];
  let failedResponses: string[] = [];

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();

    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("response", (res) => {
      if (res.status() >= 400 && !res.url().includes("favicon")) {
        failedResponses.push(`${res.status()} ${res.url()}`);
      }
    });
  });

  test.beforeEach(() => {
    pageErrors = [];
    consoleErrors = [];
    failedResponses = [];
  });

  test.afterEach(async () => {
    expect(pageErrors, `Uncaught page errors: ${pageErrors.join("; ")}`).toEqual([]);
    expect(consoleErrors, `Console errors: ${consoleErrors.join("; ")}`).toEqual([]);
    expect(failedResponses, `Failed HTTP responses: ${failedResponses.join("; ")}`).toEqual([]);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("1. Completes first-run setup, verifies live clock header & theme toggle persistence", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByText("CoreCapital Setup")).toBeVisible();

    await page.locator("#setup-name").fill("Alex Mercer");
    await page.locator("#setup-email").fill("alex@corecapital.local");
    await page.locator("#setup-password").fill("TestPass123!");
    await page.locator("#setup-confirm").fill("TestPass123!");
    await page.getByRole("button", { name: /Load Demo Data/i }).click();
    await page.getByRole("button", { name: /Complete Setup & Enter Cockpit/i }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Financial Cockpit" })).toBeVisible();
    await assertNoHorizontalOverflow(page, "/ (dark)");

    // Header live local date + time check
    const header = page.locator("header");
    await expect(header).toContainText(/\d{1,2}:\d{2}:\d{2}/);
    await maybeCapture(page, "01-dashboard-dark.png");

    // Sidebar Light / Dark toggle persistence check
    const isDarkInitially = await page.evaluate(() =>
      document.documentElement.classList.contains("dark")
    );
    expect(isDarkInitially).toBe(true);

    const themeGroup = page.getByRole("group", { name: "Theme mode" });
    await themeGroup.getByRole("button", { name: "Light" }).click();
    await expect(
      page.evaluate(() => document.documentElement.classList.contains("dark"))
    ).resolves.toBe(false);
    await maybeCapture(page, "02-dashboard-light.png");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Financial Cockpit" })).toBeVisible();
    await expect(
      page.evaluate(() => document.documentElement.classList.contains("dark"))
    ).resolves.toBe(false);

    // Switch back to Dark mode for consistent dark/light mix across subsequent tests
    await page
      .getByRole("group", { name: "Theme mode" })
      .getByRole("button", { name: "Dark" })
      .click();
    await expect(
      page.evaluate(() => document.documentElement.classList.contains("dark"))
    ).resolves.toBe(true);
  });

  test("2. Manages categories, sub-categories, ordering, drag-and-drop & merge on /accounts", async () => {
    await page.goto("/accounts");
    await expect(
      page.getByRole("heading", { name: "Accounts & Categories" })
    ).toBeVisible();

    // Create top-level Expense category "Lifestyle E2E"
    await page.getByRole("button", { name: /Add Category/i }).click();
    await page.locator("#cat-name").fill("Lifestyle E2E");
    await page.locator("#cat-type").selectOption("expense");
    await page.getByRole("button", { name: /Create Category/i }).click();
    await expect(page.getByText(`Created category "Lifestyle E2E"`)).toBeVisible();

    // Create sub-categories "Specialty Coffee" and "Quick Takeaway" under "Lifestyle E2E"
    const lifestyleRow = page
      .locator("div.px-4.py-3", { hasText: "Lifestyle E2E" })
      .first();
    await lifestyleRow.getByRole("button", { name: "Sub", exact: true }).click();
    await page.locator("#cat-name").fill("Specialty Coffee");
    await page.getByRole("button", { name: /Create Category/i }).click();
    await expect(page.getByText(`Created category "Specialty Coffee"`)).toBeVisible();

    await lifestyleRow.getByRole("button", { name: "Sub", exact: true }).click();
    await page.locator("#cat-name").fill("Quick Takeaway");
    await page.getByRole("button", { name: /Create Category/i }).click();
    await expect(page.getByText(`Created category "Quick Takeaway"`)).toBeVisible();
    await expect(lifestyleRow).toContainText("2 sub-categories");

    // Arrow reordering: move "Quick Takeaway" up ahead of "Specialty Coffee"
    await page.getByRole("button", { name: "Move Quick Takeaway up" }).click();
    await page.waitForTimeout(300);

    const checkOrder = async () =>
      page.locator("div.px-4.py-3 span.font-semibold").evaluateAll((els) =>
        els.map((e) => (e.textContent || "").trim())
      );
    const namesAfterArrow = await checkOrder();
    expect(namesAfterArrow.indexOf("Quick Takeaway")).toBeLessThan(
      namesAfterArrow.indexOf("Specialty Coffee")
    );

    // Drag-and-drop test: drag "Specialty Coffee" row above "Quick Takeaway"
    const coffeeRow = page
      .locator("div.px-4.py-3", { hasText: "Specialty Coffee" })
      .first();
    const takeawayRow = page
      .locator("div.px-4.py-3", { hasText: "Quick Takeaway" })
      .first();
    await coffeeRow.dragTo(takeawayRow, { targetPosition: { x: 40, y: 6 } });
    await page.waitForTimeout(400);

    // Create "Temp Cafe" and merge it into "Specialty Coffee"
    await lifestyleRow.getByRole("button", { name: "Sub", exact: true }).click();
    await page.locator("#cat-name").fill("Temp Cafe");
    await page.getByRole("button", { name: /Create Category/i }).click();
    await expect(page.getByText(`Created category "Temp Cafe"`)).toBeVisible();

    await page.getByRole("button", { name: "Merge Temp Cafe" }).click();
    const replacementSelect = page.getByLabel("Replacement category", { exact: true });
    await selectOptionContaining(replacementSelect, "Specialty Coffee");
    await page.getByRole("button", { name: "Confirm Merge" }).click();

    await expect(page.getByText(/Merged "Temp Cafe" into "Specialty Coffee"/)).toBeVisible();
    await expect(
      page.locator("div.px-4.py-3 span.font-semibold", { hasText: "Temp Cafe" })
    ).toHaveCount(0);
    await maybeCapture(page, "03-accounts-categories.png");
    await assertNoHorizontalOverflow(page, "/accounts (categories)");

    // Check Accounts tab
    await page.getByRole("tab", { name: /Accounts/i }).click();
    await expect(page.getByText("Active Liquid Assets")).toBeVisible();
    await assertNoHorizontalOverflow(page, "/accounts (accounts)");
  });

  test("3. Logs sub-category transactions, verifies Immutable Ledger, edits immutably, and tests dashboard drilldown", async () => {
    await page.goto("/transactions");
    await expect(page.getByText("Transactions & Immutable Ledger")).toBeVisible();

    const logTx = async (desc: string, amount: string, categorySubstring: string) => {
      await page.getByRole("button", { name: "Log Transaction" }).click();
      const modal = page.locator("div.cc-animate-modal");
      await modal.locator('input[type="number"]').fill(amount);
      await modal.locator('input[placeholder*="Woolworths Adelaide"]').fill(desc);
      const categorySelect = modal.locator("select").nth(1);
      await selectOptionContaining(categorySelect, categorySubstring);
      await modal.getByRole("button", { name: "Commit to Ledger" }).click();
      await expect(modal).toBeHidden();
    };

    await logTx("Campos Morning Brew", "45", "Lifestyle E2E › Specialty Coffee");
    await logTx("Thai Dinner Delivery", "210", "Lifestyle E2E › Quick Takeaway");
    await logTx("General Weekend Fun", "50", "Lifestyle E2E");

    const txTable = page.locator("table");
    await expect(txTable.getByText("Campos Morning Brew").first()).toBeVisible();
    await expect(txTable.getByText("Lifestyle E2E › Specialty Coffee")).toBeVisible();
    await maybeCapture(page, "04-transactions.png");

    // Edit "General Weekend Fun" immutably -> "Weekend Cinema & Fun"
    const weekendRow = txTable.locator("tr", { hasText: "General Weekend Fun" });
    await weekendRow.getByRole("button", { name: "Edit" }).click();
    const editModal = page.locator("div.cc-animate-modal");
    await editModal
      .locator('input[placeholder*="Woolworths Adelaide"]')
      .fill("Weekend Cinema & Fun");
    await editModal.getByRole("button", { name: "Save Changes to Ledger" }).click();
    await expect(editModal).toBeHidden();
    await expect(txTable.getByText("Weekend Cinema & Fun").first()).toBeVisible();

    // Immutable Ledger tab check
    await page.getByRole("tab", { name: /Immutable Ledger/i }).click();
    await expect(page.getByText("Total Ledger Records")).toBeVisible();
    await expect(page.getByText("Immutable Double-Entry Timeline")).toBeVisible();
    await expect(page.getByText("REVERSAL ENTRY").first()).toBeVisible();
    await assertNoHorizontalOverflow(page, "/transactions");

    // Return to Dashboard and test Spending Distribution drilldown
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Financial Cockpit" })).toBeVisible();

    const drilldownBtn = page.getByRole("button", {
      name: /Lifestyle E2E/i,
    });
    await expect(drilldownBtn).toBeVisible();
    await drilldownBtn.click();

    await expect(page.getByText(/Sub-category breakdown \(3 segments\)/)).toBeVisible();
    await expect(page.getByText("Quick Takeaway", { exact: true })).toBeVisible();
    await expect(page.getByText("General Lifestyle E2E", { exact: true })).toBeVisible();
    await expect(page.getByText("Specialty Coffee", { exact: true })).toBeVisible();
    await maybeCapture(page, "05-dashboard-drilldown.png");

    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByText("Spending Distribution")).toBeVisible();
    await assertNoHorizontalOverflow(page, "/ (after drilldown)");
  });

  test("4. Configures nested budget sub-caps (no double-counting) and sub-category rules preview/refinement", async () => {
    await page.goto("/budgets");
    await expect(
      page.getByRole("heading", { name: /Budgets & Anomaly Investigation/i })
    ).toBeVisible();

    const parseAllocationTotal = async () => {
      const text = await page
        .locator("div.text-2xl.font-bold.font-mono")
        .first()
        .innerText();
      // Format: "$1,911.38 / $1,930.00" -> capture total cap after "/"
      const parts = text.split("/");
      return parseFloat(parts[1].replace(/[^0-9.-]/g, ""));
    };

    const initialTotalCap = await parseAllocationTotal();

    // Set $500 Monthly cap on parent "Lifestyle E2E"
    await page.getByRole("button", { name: /Set Budget Cap/i }).click();
    const modal = page.locator("div.cc-animate-modal");
    await selectOptionContaining(modal.locator("select").first(), "Lifestyle E2E");
    await modal.locator('input[placeholder="500.00"]').fill("500");
    await modal.getByRole("button", { name: "Save Budget Cap" }).click();
    await expect(modal).toBeHidden();

    const capAfterParent = await parseAllocationTotal();
    expect(capAfterParent).toBeCloseTo(initialTotalCap + 500, 2);

    // Click "+ Sub-Cap" on Lifestyle E2E card to add $120 sub-cap on Quick Takeaway (75% alert)
    const lifestyleCard = page
      .locator("div.rounded-xl.border", { hasText: "Lifestyle E2E" })
      .filter({ has: page.getByRole("button", { name: "Sub-Cap" }) })
      .first();
    await lifestyleCard.getByRole("button", { name: "Sub-Cap" }).click();

    const subModal = page.locator("div.cc-animate-modal");
    await selectOptionContaining(subModal.locator("select").first(), "Quick Takeaway");
    await subModal.locator('input[placeholder="500.00"]').fill("120");
    await subModal.locator('input[type="number"]').nth(1).fill("75");
    await subModal.getByRole("button", { name: "Save Budget Cap" }).click();
    await expect(subModal).toBeHidden();

    await expect(lifestyleCard).toContainText("Nested Sub-Caps (1)");
    await expect(lifestyleCard).toContainText("Sub-Cap Alert");
    await maybeCapture(page, "06-budgets-subcaps.png");

    // Overall cap must stay identical (zero double-counting!)
    const capAfterSub = await parseAllocationTotal();
    expect(capAfterSub).toBeCloseTo(capAfterParent, 2);

    // Investigation & Anomalies tab check
    await page.getByRole("tab", { name: /Investigation & Anomalies/i }).click();
    await expect(page.locator("table").getByText("Lifestyle E2E › Quick Takeaway")).toBeVisible();
    await assertNoHorizontalOverflow(page, "/budgets");

    // Rules Engine: Add sub-category rule, check priority suggestion (25) & Live Pattern Preview
    await page.goto("/rules");
    await expect(
      page.getByRole("heading", { name: "Classification Rules Engine" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Add Rule" }).click();
    const ruleModal = page.locator("div.cc-animate-modal");
    await selectOptionContaining(
      ruleModal.locator("select").nth(2),
      "Lifestyle E2E › Specialty Coffee"
    );
    await expect(ruleModal.locator('input[type="number"]')).toHaveValue("25");
    await ruleModal
      .locator('input[placeholder*="Specialty Coffee Roasters"]')
      .fill("Campos Coffee Rule");
    await ruleModal
      .locator('input[placeholder*="campos"]')
      .fill("campos");

    await expect(ruleModal).toContainText("Campos Morning Brew");
    await ruleModal.getByRole("button", { name: "Save Rule" }).click();
    await expect(ruleModal).toBeHidden();
    await maybeCapture(page, "07-rules.png");

    // Pause/Resume and Refine into Sub-Categories
    await page.getByRole("button", { name: "Pause Campos Coffee Rule" }).click();
    await expect(page.getByText(`Paused rule "Campos Coffee Rule".`)).toBeVisible();
    await page.getByRole("button", { name: "Resume Campos Coffee Rule" }).click();
    await expect(page.getByText(`Resumed rule "Campos Coffee Rule".`)).toBeVisible();

    await page.getByRole("button", { name: /Refine into Sub-Categories/i }).click();
    await expect(page.getByText(/Sub-category refinement complete/)).toBeVisible();
    await assertNoHorizontalOverflow(page, "/rules");
  });

  test("5. Smoke-checks /cash-flow, /property-goals, /subscriptions, and /settings cleanly", async () => {
    const routes: Array<{ path: string; heading: RegExp; shot?: string }> = [
      { path: "/cash-flow", heading: /Cash Flow Forecasting/i },
      { path: "/property-goals", heading: /Deposit Goal/i },
      { path: "/subscriptions", heading: /Subscription Creep Monitor/i },
      { path: "/settings", heading: /Settings & User Management/i, shot: "08-settings.png" },
    ];

    for (const r of routes) {
      await page.goto(r.path);
      await expect(page.getByRole("heading", { name: r.heading })).toBeVisible();
      await assertNoHorizontalOverflow(page, r.path);
      if (r.shot) {
        await maybeCapture(page, r.shot);
      }
    }
  });

  test("6. Automated rule suggestions after CSV ingestion and learn-on-edit shortcut", async () => {
    await page.goto("/ingest");
    await expect(
      page.getByRole("heading", { name: /Statement Ingestion & Parsing Engine/i })
    ).toBeVisible();

    // Load repeated sample CommBank statement containing Spotify & Amaysim
    await page.getByRole("button", { name: /Load Sample CommBank Statement/i }).click();
    await page.getByRole("button", { name: /Execute Bulk Ingestion/i }).click();

    await expect(page.getByText(/Statement Ingestion Complete!/i)).toBeVisible();
    await expect(
      page.getByText(/Suggested Rules from Ingested Transactions \(/i)
    ).toBeVisible();
    await expect(page.getByText("Spotify", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Amaysim", { exact: true }).first()).toBeVisible();

    // Bulk approve all high/medium ready suggestions
    await page.getByRole("button", { name: /Approve All Ready \(/i }).click();
    await expect(
      page.getByText(/Approved \d+ rules? and tagged \d+ transactions? automatically!/i)
    ).toBeVisible();
    await assertNoHorizontalOverflow(page, "/ingest (suggestions)");

    // Verify new rules are persisted in /rules
    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: /Classification Rules Engine/i })).toBeVisible();
    await expect(page.locator("table").getByText(/Spotify Auto-Tag/i)).toBeVisible();
    await expect(page.locator("table").getByText(/Amaysim Auto-Tag/i)).toBeVisible();
    await assertNoHorizontalOverflow(page, "/rules (after bulk approve)");

    // Trigger Learn-on-Edit banner on /transactions when logging an unruled merchant
    await page.goto("/transactions");
    await page.getByRole("button", { name: /Log Transaction/i }).click();
    const modal = page.locator("div.cc-animate-modal");
    await expect(modal).toBeVisible();

    await modal.locator('input[type="number"]').fill("85");
    await modal.locator('input[placeholder*="Woolworths Adelaide"]').fill("Bunnings Mile End");
    await selectOptionContaining(modal.locator("select").nth(1), "Household & Supplies");
    await modal.getByRole("button", { name: /Commit to Ledger/i }).click();
    await expect(modal).toBeHidden();

    // Learn-on-Edit prompt should appear with one-click Create Rule & Apply
    await expect(page.getByText(/Automate future entries:/i)).toBeVisible();
    await expect(page.getByText(/Bunnings Warehouse/i).first()).toBeVisible();
    await page.getByRole("button", { name: /Create Rule & Apply/i }).click();
    await expect(page.getByText(/Automated rule "Bunnings Warehouse Auto-Tag" saved/i)).toBeVisible();
    await assertNoHorizontalOverflow(page, "/transactions (learn-on-edit)");

    // Confirm Bunnings rule appears on /rules
    await page.goto("/rules");
    await expect(page.locator("table").getByText(/Bunnings Warehouse Auto-Tag/i)).toBeVisible();
  });
});
