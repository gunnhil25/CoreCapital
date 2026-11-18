import Link from "next/link";
import {
  TrendingUp,
  Receipt,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Home,
  Shield,
  Layers,
  Upload,
  ChevronRight,
  CheckCircle2,
  RotateCcw,
  PieChart as PieIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  DashboardCharts,
  CategoryDistributionPoint,
  MonthlyCashFlowChartPoint,
} from "@/components/analytics/dashboard-charts";
import { getPropertyGoalModelAction } from "@/actions/property-goals";
import { getBudgetsAction } from "@/actions/budgets";
import { getTransactionsAction } from "@/actions/transactions";

export const dynamic = "force-dynamic";

const HISTORICAL_BASELINE_MONTHS: MonthlyCashFlowChartPoint[] = [
  { month: "May 26", income: 7700, expenses: 3420 },
  { month: "Jun 26", income: 7700, expenses: 3890 },
  { month: "Jul 26", income: 9250, expenses: 4120 },
  { month: "Aug 26", income: 7700, expenses: 3510 },
  { month: "Sep 26", income: 7700, expenses: 3680 },
];

export default async function DashboardPage() {
  const [{ goal, dhoas, fhss }, budgets, transactions] = await Promise.all([
    getPropertyGoalModelAction(),
    getBudgetsAction(),
    getTransactionsAction(),
  ]);

  const totalBudgetLimit = budgets.reduce((sum, b) => sum + b.allocatedAmount, 0);
  const totalBudgetSpent = budgets.reduce((sum, b) => sum + b.spentAmount, 0);
  const budgetUtilizationPct =
    totalBudgetLimit > 0 ? Math.round((totalBudgetSpent / totalBudgetLimit) * 100) : 0;

  // Live inflow, outflow, and savings rate from posted non-reversal ledger records
  const activeTransactions = transactions.filter(
    (t) => t.status === "posted" && !t.isReversal
  );
  const totalInflow = activeTransactions
    .filter((t) => parseFloat(t.amount) > 0)
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);
  const totalOutflow = activeTransactions
    .filter((t) => parseFloat(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount)), 0);
  const savingsRatePct =
    totalInflow > 0
      ? Math.max(0, Math.round(((totalInflow - totalOutflow) / totalInflow) * 1000) / 10)
      : 0;

  // Build monthly bar chart points dynamically from active ledger transactions
  const monthBuckets = new Map<string, { label: string; income: number; expenses: number }>();
  for (const tx of activeTransactions) {
    const ym = tx.date.slice(0, 7); // YYYY-MM
    const d = new Date(`${tx.date}T00:00:00`);
    const label = isNaN(d.getTime())
      ? ym
      : new Intl.DateTimeFormat("en-AU", { month: "short", year: "2-digit" }).format(d);
    const bucket = monthBuckets.get(ym) || { label, income: 0, expenses: 0 };
    const amt = parseFloat(tx.amount) || 0;
    if (amt > 0) {
      bucket.income += amt;
    } else {
      bucket.expenses += Math.abs(amt);
    }
    monthBuckets.set(ym, bucket);
  }

  const liveMonthlyPoints: MonthlyCashFlowChartPoint[] = Array.from(monthBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({
      month: v.label,
      income: Math.round(v.income * 100) / 100,
      expenses: Math.round(v.expenses * 100) / 100,
    }));

  const liveMonthLabels = new Set(liveMonthlyPoints.map((m) => m.month));
  const monthlyData: MonthlyCashFlowChartPoint[] =
    liveMonthlyPoints.length === 0
      ? []
      : [
          ...HISTORICAL_BASELINE_MONTHS.filter((m) => !liveMonthLabels.has(m.month)),
          ...liveMonthlyPoints,
        ].slice(-6);

  // Build spending distribution donut chart from budgets and non-budgeted ledger debits
  const categoryTotals = new Map<string, CategoryDistributionPoint>();
  const budgetedCategoryIds = new Set(budgets.map((b) => b.categoryId));

  for (const b of budgets) {
    if (b.spentAmount > 0) {
      categoryTotals.set(b.categoryId, {
        name: b.categoryName,
        value: b.spentAmount,
        color: b.categoryColor,
      });
    }
  }

  for (const tx of activeTransactions) {
    for (const le of tx.ledgerEntries) {
      if (le.entryType !== "debit") continue;
      const catKey = le.categoryId || "uncategorized";
      if (budgetedCategoryIds.has(catKey)) continue;
      const prev = categoryTotals.get(catKey) || {
        name: le.categoryName || "Uncategorized",
        value: 0,
        color: le.categoryColor || "#64748b",
      };
      prev.value = Math.round((prev.value + (parseFloat(le.amount) || 0)) * 100) / 100;
      categoryTotals.set(catKey, prev);
    }
  }

  const categoryData = Array.from(categoryTotals.values()).sort((a, b) => b.value - a.value);
  const recentTransactions = transactions.slice(0, 5);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* Page Title & Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Financial Cockpit
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Immutable Double-Entry Ledger • Proxmox LXC Host
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/ingest">
              <Upload className="h-4 w-4 mr-1.5" />
              Upload CSV
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/transactions?action=new">
              <Receipt className="h-4 w-4 mr-1.5" />
              Log Transaction
            </Link>
          </Button>
        </div>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-border/60 bg-gradient-to-br from-card to-card/50">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Liquid Assets</span>
              <Wallet className="h-4 w-4 text-sky-500" />
            </CardDescription>
            <CardTitle className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground">
              {formatCurrency(goal.currentCashSavings)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1">
              <ArrowUpRight className="h-3.5 w-3.5 mr-0.5 shrink-0" />
              <span>Active Checking & Savings</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-gradient-to-br from-card to-card/50">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Ledger Inflow</span>
              <ArrowUpRight className="h-4 w-4 text-emerald-500" />
            </CardDescription>
            <CardTitle className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground">
              {formatCurrency(totalInflow)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-muted-foreground mt-1">
              Posted Credits ({activeTransactions.filter((t) => parseFloat(t.amount) > 0).length} entries)
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-gradient-to-br from-card to-card/50">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Ledger Outflow</span>
              <ArrowDownRight className="h-4 w-4 text-rose-500" />
            </CardDescription>
            <CardTitle className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground">
              {formatCurrency(totalOutflow)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-muted-foreground mt-1">
              Budget Cap: {formatCurrency(totalBudgetLimit)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-gradient-to-br from-card to-card/50">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Savings Rate</span>
              <TrendingUp className="h-4 w-4 text-indigo-500" />
            </CardDescription>
            <CardTitle className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground">
              {savingsRatePct.toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <Badge
              variant={savingsRatePct >= 20 ? "success" : "warning"}
              className="text-[10px] px-1.5 py-0 mt-1"
            >
              Runway: {savingsRatePct >= 20 ? "Optimal" : "Watch"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Interactive Recharts Analytics Visuals */}
      <DashboardCharts monthlyData={monthlyData} categoryData={categoryData} />

      {/* 2-Column Section: Australian Property Deposit & Budget Tracking */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Australian Schemes & 2029 Goal Card */}
        <Card className="lg:col-span-2 border-border/60 overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-sky-500/10 via-indigo-500/10 to-transparent pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-sky-500/20 text-sky-500 flex items-center justify-center">
                  <Home className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base sm:text-lg">
                    2029 Property Deposit Target ({goal.targetCity})
                  </CardTitle>
                  <CardDescription>
                    Algorithmic FHSS super scheme + DHOAS Defence subsidy tier projection
                  </CardDescription>
                </div>
              </div>
              <Badge variant="info" className="font-mono">
                2029 Horizon
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-muted-foreground">Deposit & Purchase Cash Ready</span>
                <span className="font-mono">
                  {formatCurrency(goal.currentCashSavings + fhss.estimatedTotalReleaseAmount)} /{" "}
                  {formatCurrency(goal.totalRequiredCash)} (
                  {Math.round(
                    ((goal.currentCashSavings + fhss.estimatedTotalReleaseAmount) /
                      goal.totalRequiredCash) *
                      100
                  )}
                  %)
                </span>
              </div>
              <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-indigo-600 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        ((goal.currentCashSavings + fhss.estimatedTotalReleaseAmount) /
                          goal.totalRequiredCash) *
                          100
                      )
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* Scheme Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-sky-500" />
                    FHSS Super Withdrawable
                  </span>
                  <span className="font-mono text-xs font-bold text-sky-500">
                    {formatCurrency(fhss.estimatedTotalReleaseAmount)}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Saved {formatCurrency(fhss.estimatedTaxSaved)} tax • Deemed SIC ~7.15%
                </p>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-indigo-500" />
                    DHOAS Defence Subsidy
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 font-mono">
                    {dhoas.projected2029Tier.name.split(" ")[0]}{" "}
                    {dhoas.projected2029Tier.name.split(" ")[1]} (2029)
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Subsidized loan cap ${dhoas.projected2029Tier.subsidisedLoanCap.toLocaleString()} • ~$
                  {dhoas.projected2029Tier.estimatedMonthlySubsidy}/mo relief
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button variant="ghost" size="sm" asChild className="text-xs gap-1">
                <Link href="/property-goals">
                  Detailed Scheme Calculator & Scenarios
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Budget Caps Summary Gauge */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Budget Caps</span>
              <span className="text-xs text-muted-foreground font-normal">
                {budgetUtilizationPct}% Used
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-3.5">
            {budgets.slice(0, 4).map((b) => (
              <div key={b.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate max-w-[140px]">{b.categoryName}</span>
                  <span className="font-mono text-muted-foreground">
                    {formatCurrency(b.spentAmount)} / {formatCurrency(b.allocatedAmount)}
                  </span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      b.status === "overrun"
                        ? "bg-rose-500"
                        : b.status === "warning"
                        ? "bg-amber-500"
                        : "bg-sky-500"
                    }`}
                    style={{ width: `${Math.min(100, b.percentageSpent)}%` }}
                  />
                </div>
              </div>
            ))}

            <Button variant="outline" size="sm" className="w-full text-xs mt-2" asChild>
              <Link href="/budgets">
                <PieIcon className="h-3.5 w-3.5 mr-1.5" />
                Manage Budgets & Investigation
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Immutable Ledger Recent Activity */}
      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base sm:text-lg">Recent Ledger Records</CardTitle>
            <CardDescription>
              Double-entry audit entries with reversal verification
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild className="text-xs gap-1">
            <Link href="/transactions">
              All Transactions
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y text-xs sm:text-sm">
            {recentTransactions.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No ledger transactions yet. Click <strong>Log Transaction</strong> or{" "}
                <strong>Upload CSV</strong> to add your first entry.
              </div>
            ) : (
              recentTransactions.map((tx) => {
              const amountNum = parseFloat(tx.amount) || 0;
              const isCredit = amountNum > 0;
              const categoryLabel = tx.isSplit
                ? `Split (${tx.ledgerEntries.length} items)`
                : tx.ledgerEntries[0]?.categoryName || "Uncategorized";

              return (
                <div
                  key={tx.id}
                  className={`p-4 flex items-center justify-between hover:bg-muted/30 transition-colors ${
                    tx.status === "reversed" ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                        tx.isReversal
                          ? "bg-sky-500/10 text-sky-500"
                          : isCredit
                          ? "bg-emerald-500/10 text-emerald-500"
                          : "bg-rose-500/10 text-rose-500"
                      }`}
                    >
                      {tx.isReversal ? (
                        <RotateCcw className="h-4 w-4" />
                      ) : isCredit ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold truncate">{tx.cleanDescription}</p>
                        {tx.isSplit && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0">
                            Split ({tx.ledgerEntries.length})
                          </Badge>
                        )}
                        {tx.isReversal && (
                          <Badge variant="info" className="text-[9px] px-1 py-0">
                            Reversal
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDate(tx.date)} • {categoryLabel} • {tx.accountName || "Account"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`font-mono font-bold ${
                        tx.isReversal
                          ? "text-sky-500"
                          : isCredit
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {isCredit ? `+${formatCurrency(amountNum)}` : formatCurrency(amountNum)}
                    </p>
                    <span className="text-[10px] text-muted-foreground font-mono uppercase">
                      {tx.status}
                    </span>
                  </div>
                </div>
              );
            })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
