"use client";

import { useState, useTransition } from "react";
import {
  Home,
  Shield,
  Layers,
  Sparkles,
  TrendingUp,
  Plus,
  Building,
  CheckCircle2,
  Calendar,
  AlertCircle,
  HelpCircle,
  Clock,
  MapPin,
  Percent,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  PropertyGoalData,
  updatePropertyGoalAction,
  addFhssContributionAction,
} from "@/actions/property-goals";
import {
  calculateFhssRelease,
  calculateDhoasEntitlement,
  calculateSouthAustraliaStampDuty,
  calculateVictoriaStampDuty,
} from "@/lib/australian-finance";

interface PropertyGoalsViewProps {
  initialData: {
    goal: PropertyGoalData;
    fhss: ReturnType<typeof calculateFhssRelease>;
    dhoas: ReturnType<typeof calculateDhoasEntitlement>;
    contributions: Array<{
      id: string;
      amount: number;
      contributionType: "concessional" | "non_concessional";
      date: string;
      financialYear: string;
      fundName: string;
      bpayRef?: string;
    }>;
  };
}

export function PropertyGoalsView({ initialData }: PropertyGoalsViewProps) {
  const [data, setData] = useState(initialData);
  const [isPending, startTransition] = useTransition();

  // Model parameters
  const [city, setCity] = useState<"Adelaide" | "Melbourne">(data.goal.targetCity);
  const [targetPrice, setTargetPrice] = useState(data.goal.targetPrice.toString());
  const [depositPct, setDepositPct] = useState(data.goal.depositPct.toString());

  // FHSS Entry Modal
  const [isFhssModalOpen, setIsFhssModalOpen] = useState(false);
  const [fhssAmount, setFhssAmount] = useState("15000");
  const [fhssFy, setFhssFy] = useState("2026-27");
  const [fhssFund, setFhssFund] = useState("ADF Super");

  const { goal, fhss, dhoas, contributions } = data;

  const handleUpdateModel = (newCity?: "Adelaide" | "Melbourne", overridePrice?: number) => {
    const selectedCity = newCity || city;
    const priceNum = overridePrice ?? (parseFloat(targetPrice) || 850000);
    const depNum = parseFloat(depositPct) || 20;

    startTransition(async () => {
      const res = await updatePropertyGoalAction({
        targetCity: selectedCity,
        targetPrice: priceNum,
        depositPct: depNum,
      });

      if (res.success && res.data) {
        setData(res.data);
        return;
      }

      // Recalculate local state fallback
      const targetDepositAmount = (priceNum * depNum) / 100;
      const stampDuty =
        selectedCity === "Adelaide"
          ? calculateSouthAustraliaStampDuty(priceNum, true)
          : calculateVictoriaStampDuty(priceNum, true);
      const totalRequiredCash = targetDepositAmount + stampDuty + 3850;
      const totalFunds = goal.currentCashSavings + fhss.estimatedTotalReleaseAmount;
      const netGap = Math.max(0, totalRequiredCash - totalFunds);

      setData((prev) => ({
        ...prev,
        goal: {
          ...prev.goal,
          targetCity: selectedCity,
          targetPrice: priceNum,
          depositPct: depNum,
          targetDepositAmount,
          stampDuty,
          totalRequiredCash,
          netGap: Math.round(netGap),
          requiredMonthlySavingsRate: Math.round(netGap / prev.goal.monthsUntil2029),
        },
      }));
    });
  };

  const handleAddFhss = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(fhssAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    startTransition(async () => {
      const res = await addFhssContributionAction({
        amount: amountNum,
        financialYear: fhssFy,
        contributionType: "concessional",
        fundName: fhssFund,
      });

      if (res.success && res.contribution) {
        const nextContribs = [...contributions, res.contribution];
        const nextFhss = calculateFhssRelease(nextContribs, 0.325);

        const totalFunds = goal.currentCashSavings + nextFhss.estimatedTotalReleaseAmount;
        const netGap = Math.max(0, goal.totalRequiredCash - totalFunds);

        setData((prev) => ({
          ...prev,
          contributions: nextContribs,
          fhss: nextFhss,
          goal: {
            ...prev.goal,
            fhssReleaseEstimate: Math.round(nextFhss.estimatedTotalReleaseAmount),
            netGap: Math.round(netGap),
            requiredMonthlySavingsRate: Math.round(netGap / prev.goal.monthsUntil2029),
          },
        }));

        setIsFhssModalOpen(false);
      }
    });
  };

  const totalCapitalReady = goal.currentCashSavings + fhss.estimatedTotalReleaseAmount;
  const progressPercent = Math.min(
    100,
    Math.round((totalCapitalReady / goal.totalRequiredCash) * 100)
  );

  return (
    <div className="space-y-6">
      {/* Title & Target Year Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            2029 Australian Property Deposit Engine
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Adelaide & Melbourne Modeling • First Home Super Saver (FHSS) • DHOAS Subsidy Tier Accrual
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info" className="text-xs font-mono px-2.5 py-1">
            🎯 Target Date: July 2029 ({goal.monthsUntil2029} Months)
          </Badge>
        </div>
      </div>

      {/* Target City & Property Configuration Card */}
      <Card className="border-border/60 bg-gradient-to-br from-card to-card/50">
        <CardHeader className="p-5 pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Building className="h-4 w-4 text-sky-500" />
              Property Purchase Parameters
            </span>
            <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg border text-xs">
              <button
                type="button"
                onClick={() => {
                  setCity("Adelaide");
                  setTargetPrice("850000");
                  handleUpdateModel("Adelaide", 850000);
                }}
                className={`px-3 py-1 rounded font-medium transition-colors ${
                  city === "Adelaide"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Adelaide (SA)
              </button>
              <button
                type="button"
                onClick={() => {
                  setCity("Melbourne");
                  setTargetPrice("950000");
                  handleUpdateModel("Melbourne", 950000);
                }}
                className={`px-3 py-1 rounded font-medium transition-colors ${
                  city === "Melbourne"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Melbourne (VIC)
              </button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Target Property Price</Label>
              <Input
                type="number"
                step="10000"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                onBlur={() => handleUpdateModel()}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label>Target Deposit Percentage</Label>
              <Input
                type="number"
                step="1"
                value={depositPct}
                onChange={(e) => setDepositPct(e.target.value)}
                onBlur={() => handleUpdateModel()}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label>Estimated State Stamp Duty</Label>
              <div className="h-9 rounded-lg border bg-muted/40 px-3 flex items-center text-xs font-mono">
                {formatCurrency(goal.stampDuty)} ({city === "Adelaide" ? "SA Scale" : "VIC Scale"})
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Progress & Capital Breakdown Bar */}
      <Card className="border-border/60">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Total Cash Ready (Liquid + FHSS Release)</p>
              <p className="text-2xl font-bold font-mono text-sky-500">
                {formatCurrency(totalCapitalReady)}{" "}
                <span className="text-sm font-normal text-muted-foreground font-sans">
                  of {formatCurrency(goal.totalRequiredCash)} required
                </span>
              </p>
            </div>
            <div className="text-right">
              <Badge
                variant={progressPercent >= 50 ? "success" : "warning"}
                className="text-xs font-mono px-2 py-0.5"
              >
                {progressPercent}% Funded
              </Badge>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Remaining Gap: {formatCurrency(goal.netGap)}
              </p>
            </div>
          </div>

          <div className="h-3 w-full bg-muted rounded-full overflow-hidden flex">
            {/* Liquid Savings Portion */}
            <div
              className="h-full bg-sky-500 transition-all duration-500"
              style={{
                width: `${(goal.currentCashSavings / goal.totalRequiredCash) * 100}%`,
              }}
              title={`Liquid Savings: ${formatCurrency(goal.currentCashSavings)}`}
            />
            {/* FHSS Super Released Portion */}
            <div
              className="h-full bg-indigo-500 transition-all duration-500"
              style={{
                width: `${(fhss.estimatedTotalReleaseAmount / goal.totalRequiredCash) * 100}%`,
              }}
              title={`FHSS Release: ${formatCurrency(fhss.estimatedTotalReleaseAmount)}`}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              <span>Liquid Cash: {formatCurrency(goal.currentCashSavings)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
              <span>FHSS Voluntary Super: {formatCurrency(fhss.estimatedTotalReleaseAmount)}</span>
            </div>
            <div className="font-mono text-foreground font-semibold">
              Monthly Pace Required: {formatCurrency(goal.requiredMonthlySavingsRate)}/mo
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Two-Column Module: FHSS Tracker & DHOAS Defence Subsidy Tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. FHSS SCHEME TRACKER */}
        <Card className="border-border/60">
          <CardHeader className="bg-gradient-to-r from-sky-500/10 to-transparent p-5 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-sky-500/20 text-sky-500 flex items-center justify-center">
                  <Shield className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base">First Home Super Saver (FHSS)</CardTitle>
                  <CardDescription>
                    Voluntary BPAY super contributions & ATO SIC deemed earnings
                  </CardDescription>
                </div>
              </div>
              <Button size="sm" onClick={() => setIsFhssModalOpen(true)} className="h-7 text-xs gap-1">
                <Plus className="h-3 w-3" />
                Log Contribution
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
                <span className="text-muted-foreground">Total Contributed</span>
                <p className="font-mono text-base font-bold text-foreground">
                  {formatCurrency(fhss.totalContributed)} / $50,000
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatCurrency(fhss.remainingLifetimeCap)} lifetime cap space remaining
                </p>
              </div>

              <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
                <span className="text-muted-foreground">Max Withdrawable Release</span>
                <p className="font-mono text-base font-bold text-sky-500">
                  {formatCurrency(fhss.estimatedTotalReleaseAmount)}
                </p>
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  Includes ~{formatCurrency(fhss.estimatedDeemedEarnings)} deemed SIC earnings
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg border bg-muted/20 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">Tax Arbitrage Benefit</span>
                <Badge variant="success" className="font-mono text-[10px] px-1.5 py-0">
                  +{formatCurrency(fhss.estimatedTaxSaved)} Tax Saved
                </Badge>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                By contributing pre-tax/BPAY and claiming a personal tax deduction, contributions are taxed at only <strong>15% in super</strong> instead of your <strong>32.5% marginal tax rate</strong>, locking in an immediate 17.5% net advantage.
              </p>
            </div>

            {/* Contributions History */}
            <div className="space-y-1.5 pt-1">
              <p className="text-xs font-semibold">Logged Contributions ({contributions.length})</p>
              <div className="divide-y rounded-lg border bg-card text-xs">
                {contributions.map((c) => (
                  <div key={c.id} className="p-2.5 flex items-center justify-between">
                    <div>
                      <div className="font-medium flex items-center gap-1.5">
                        <span>{c.fundName}</span>
                        <Badge variant="outline" className="text-[9px] py-0 font-mono">
                          {c.financialYear}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono">{c.bpayRef}</p>
                    </div>
                    <span className="font-mono font-bold text-sky-500">
                      {formatCurrency(c.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. DHOAS SUBSIDY TIER TRACKER */}
        <Card className="border-border/60">
          <CardHeader className="bg-gradient-to-r from-indigo-500/10 to-transparent p-5 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-500/20 text-indigo-500 flex items-center justify-center">
                  <Layers className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base">DHOAS Defence Home Subsidy</CardTitle>
                  <CardDescription>
                    Accrued service years & monthly interest subsidy progression
                  </CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                Permanent ADF
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
                <span className="text-muted-foreground">Current Accrued Service</span>
                <p className="font-mono text-base font-bold text-foreground">
                  {dhoas.currentServiceYears} Years
                </p>
                <Badge variant="info" className="text-[9px] py-0 font-mono">
                  {dhoas.currentTier.name.split(" ")[0]} {dhoas.currentTier.name.split(" ")[1]}
                </Badge>
              </div>

              <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
                <span className="text-muted-foreground">Projected Tier at 2029 Purchase</span>
                <p className="font-mono text-base font-bold text-indigo-500">
                  {dhoas.projected2029Years} Years
                </p>
                <Badge variant="success" className="text-[9px] py-0 font-mono">
                  {dhoas.projected2029Tier.name.split(" ")[0]} {dhoas.projected2029Tier.name.split(" ")[1]} (Unlocked!)
                </Badge>
              </div>
            </div>

            <div className="p-3.5 rounded-lg border bg-muted/20 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">2029 Subsidized Loan Cap</span>
                <span className="font-mono font-bold text-indigo-500 text-sm">
                  ${dhoas.projected2029Tier.subsidisedLoanCap.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Estimated Monthly Subsidy Benefit:</span>
                <span className="font-mono font-semibold text-foreground">
                  ~{formatCurrency(dhoas.projected2029Tier.estimatedMonthlySubsidy)} / month
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground pt-1 border-t">
                <span>Cumulative Annual Cash Flow Relief:</span>
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  +{formatCurrency(dhoas.annualSubsidyValue2029)} / year
                </span>
              </div>
            </div>

            {/* Tier Progression Roadmap */}
            <div className="space-y-2 pt-1 text-xs">
              <span className="font-semibold">DHOAS Tier Progression Ladder</span>
              <div className="space-y-1.5 font-mono text-[11px]">
                <div className="p-2 rounded border bg-muted/20 flex items-center justify-between">
                  <span>Tier 1 (4-7 Yrs Service)</span>
                  <span>Cap: $386,000 • ~$395/mo</span>
                </div>
                <div className="p-2 rounded border bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 font-bold flex items-center justify-between">
                  <span>★ Tier 2 (8-11 Yrs - Unlocks in 2029!)</span>
                  <span>Cap: $579,000 • ~$592/mo</span>
                </div>
                <div className="p-2 rounded border bg-muted/20 flex items-center justify-between opacity-60">
                  <span>Tier 3 (12+ Yrs Service)</span>
                  <span>Cap: $772,000 • ~$790/mo</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Log FHSS Contribution Modal */}
      {isFhssModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold">Log FHSS Super Contribution</h3>
                <p className="text-xs text-muted-foreground">
                  Record voluntary BPAY contribution toward $50k FHSS cap
                </p>
              </div>
              <button
                onClick={() => setIsFhssModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddFhss} className="space-y-4">
              <div className="space-y-1">
                <Label>Contribution Amount ($ AUD)</Label>
                <Input
                  type="number"
                  step="100"
                  placeholder="15000"
                  value={fhssAmount}
                  onChange={(e) => setFhssAmount(e.target.value)}
                  className="h-9 text-xs font-mono"
                  required
                />
                <p className="text-[10px] text-muted-foreground">
                  ATO limit: $15,000 per financial year
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Financial Year</Label>
                  <select
                    value={fhssFy}
                    onChange={(e) => setFhssFy(e.target.value)}
                    className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs"
                  >
                    <option value="2024-25">2024-25</option>
                    <option value="2025-26">2025-26</option>
                    <option value="2026-27">2026-27</option>
                    <option value="2027-28">2027-28</option>
                    <option value="2028-29">2028-29</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>Super Fund Name</Label>
                  <Input
                    value={fhssFund}
                    onChange={(e) => setFhssFund(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsFhssModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Logging..." : "Log Contribution"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
