"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Building,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Layers,
  MapPin,
  Plus,
  RotateCcw,
  Settings2,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import {
  addFhssContributionAction,
  deleteFhssContributionAction,
  deletePropertyGoalAction,
  PropertyGoalData,
  PropertyGoalModelResponse,
  savePropertyGoalAction,
} from "@/actions/property-goals";
import {
  AUSTRALIAN_STATES,
  calculateDhoasEntitlement,
  calculateStampDuty,
  DHOAS_TIERS,
  DhoasConfigMode,
  getAustralianFinancialYear,
  getAustralianStateInfo,
  getLocationDisplayLabel,
  isAustralianStateCode,
  PropertyLocationCode,
} from "@/lib/australian-finance";

interface PropertyGoalsViewProps {
  initialData: PropertyGoalModelResponse;
}

interface GoalFormState {
  goalName: string;
  targetDate: string;
  locationCode: PropertyLocationCode;
  targetCity: string;
  isFirstHomeBuyer: boolean;
  targetPrice: string;
  depositPct: string;
  depositAmountInput: string;
  customStampDuty: string;
  conveyancingFees: string;
  estimatedLmi: string;
  useLiveLiquidSavings: boolean;
  currentSavingsAllocated: string;
  monthlySavingsPace: string;
  useFhss: boolean;
  fhssMarginalTaxRatePct: string;
  useDhoas: boolean;
  dhoasMode: DhoasConfigMode;
  dhoasEnlistmentDate: string;
  dhoasServiceType: "permanent" | "reserve";
  dhoasMonthlySubsidy: string;
  dhoasLoanCap: string;
  dhoasLumpSumAmount: string;
}

function getDefaultTargetDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 3);
  return d.toISOString().split("T")[0];
}

function buildFormStateFromGoal(goal: PropertyGoalData | null): GoalFormState {
  if (!goal) {
    const defaultPrice = 850000;
    const defaultPct = 20;
    return {
      goalName: "Mortgage Deposit Goal",
      targetDate: getDefaultTargetDate(),
      locationCode: "SA",
      targetCity: "Adelaide",
      isFirstHomeBuyer: true,
      targetPrice: String(defaultPrice),
      depositPct: String(defaultPct),
      depositAmountInput: String((defaultPrice * defaultPct) / 100),
      customStampDuty: "",
      conveyancingFees: "3850",
      estimatedLmi: "0",
      useLiveLiquidSavings: true,
      currentSavingsAllocated: "0",
      monthlySavingsPace: "0",
      useFhss: false,
      fhssMarginalTaxRatePct: "32.5",
      useDhoas: false,
      dhoasMode: "auto",
      dhoasEnlistmentDate: "2021-03-01",
      dhoasServiceType: "permanent",
      dhoasMonthlySubsidy: "",
      dhoasLoanCap: "",
      dhoasLumpSumAmount: "0",
    };
  }

  return {
    goalName: goal.goalName,
    targetDate: goal.targetDate,
    locationCode: goal.locationCode,
    targetCity:
      goal.locationCode === "CUSTOM"
        ? goal.customLocationName || goal.targetCity
        : goal.targetCity,
    isFirstHomeBuyer: goal.isFirstHomeBuyer,
    targetPrice: String(goal.targetPrice),
    depositPct: String(goal.depositPct),
    depositAmountInput: String(Math.round(goal.targetDepositAmount * 100) / 100),
    customStampDuty: goal.customStampDuty !== null ? String(goal.customStampDuty) : "",
    conveyancingFees: String(goal.conveyancingFees),
    estimatedLmi: String(goal.estimatedLmi),
    useLiveLiquidSavings: goal.useLiveLiquidSavings,
    currentSavingsAllocated: String(goal.currentSavingsAllocated),
    monthlySavingsPace: String(goal.monthlySavingsPace),
    useFhss: goal.useFhss,
    fhssMarginalTaxRatePct: String(goal.fhssMarginalTaxRatePct),
    useDhoas: goal.useDhoas,
    dhoasMode: goal.dhoasMode,
    dhoasEnlistmentDate: goal.dhoasEnlistmentDate || "2021-03-01",
    dhoasServiceType: goal.dhoasServiceType,
    dhoasMonthlySubsidy:
      goal.dhoasMonthlySubsidy !== null ? String(goal.dhoasMonthlySubsidy) : "",
    dhoasLoanCap: goal.dhoasLoanCap !== null ? String(goal.dhoasLoanCap) : "",
    dhoasLumpSumAmount: String(goal.dhoasLumpSumAmount),
  };
}

function buildFinancialYearOptions(targetYear?: number): string[] {
  const currentYear = new Date().getFullYear();
  const minStart = currentYear - 2;
  const maxStart = Math.max(currentYear + 4, (targetYear ?? currentYear + 3) + 1);
  const years: string[] = [];
  for (let y = minStart; y <= maxStart; y++) {
    years.push(`${y}-${String(y + 1).slice(-2)}`);
  }
  return years;
}

function formatTargetMonthYear(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric" }).format(d);
}

const SELECT_CLS =
  "w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function PropertyGoalsView({ initialData }: PropertyGoalsViewProps) {
  const [data, setData] = useState<PropertyGoalModelResponse>(initialData);
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(!initialData.hasGoal);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  const [form, setForm] = useState<GoalFormState>(() =>
    buildFormStateFromGoal(initialData.goal)
  );

  // FHSS Log Contribution Modal
  const [isFhssModalOpen, setIsFhssModalOpen] = useState(false);
  const [fhssAmount, setFhssAmount] = useState("15000");
  const [fhssFy, setFhssFy] = useState(() => getAustralianFinancialYear());
  const [fhssContribType, setFhssContribType] = useState<"concessional" | "non_concessional">(
    "concessional"
  );
  const [fhssFund, setFhssFund] = useState("ADF Super");

  const currency = data.baseCurrency || "AUD";
  const fmt = (val: number) => formatCurrency(val, currency);

  const { goal, fhss, dhoas, contributions, liveLiquidAccountSavings } = data;
  const fyOptions = useMemo(
    () => buildFinancialYearOptions(goal?.targetYear),
    [goal?.targetYear]
  );

  // Live preview calculations inside the configuration form
  const formPreview = useMemo(() => {
    const price = Math.max(0, parseFloat(form.targetPrice) || 0);
    const pct = Math.max(0, Math.min(100, parseFloat(form.depositPct) || 0));
    const depositAmount = Math.round(((price * pct) / 100) * 100) / 100;
    const customDuty =
      form.customStampDuty.trim() !== "" ? parseFloat(form.customStampDuty) : null;
    const autoDuty = calculateStampDuty(form.locationCode, price, form.isFirstHomeBuyer, null);
    const effectiveDuty = calculateStampDuty(
      form.locationCode,
      price,
      form.isFirstHomeBuyer,
      customDuty !== null && Number.isFinite(customDuty) ? customDuty : null
    );
    const fees = Math.max(0, parseFloat(form.conveyancingFees) || 0);
    const lmi = Math.max(0, parseFloat(form.estimatedLmi) || 0);
    const totalRequired = Math.round((depositAmount + effectiveDuty + fees + lmi) * 100) / 100;

    const liquidOrAllocated = form.useLiveLiquidSavings
      ? liveLiquidAccountSavings
      : Math.max(0, parseFloat(form.currentSavingsAllocated) || 0);
    const fhssCredit = form.useFhss ? fhss.estimatedTotalReleaseAmount : 0;
    const dhoasLump = form.useDhoas
      ? Math.max(0, parseFloat(form.dhoasLumpSumAmount) || 0)
      : 0;
    const capitalReady = liquidOrAllocated + fhssCredit + dhoasLump;
    const gap = Math.max(0, totalRequired - capitalReady);

    const targetMs = new Date(`${form.targetDate}T00:00:00`).getTime();
    const rawMonths = isNaN(targetMs)
      ? 1
      : Math.round((targetMs - Date.now()) / (1000 * 60 * 60 * 24 * 30.4375));
    const months = Math.max(1, rawMonths);
    const monthlyNeeded = Math.round(gap / months);

    const dhoasPreview = form.useDhoas
      ? calculateDhoasEntitlement(
          form.dhoasEnlistmentDate || "2021-03-01",
          form.dhoasServiceType,
          form.targetDate,
          {
            mode: form.dhoasMode,
            customMonthlySubsidy:
              form.dhoasMonthlySubsidy.trim() !== ""
                ? parseFloat(form.dhoasMonthlySubsidy)
                : null,
            customLoanCap:
              form.dhoasLoanCap.trim() !== "" ? parseFloat(form.dhoasLoanCap) : null,
            lumpSumAmount: dhoasLump,
          }
        )
      : null;

    return {
      price,
      pct,
      depositAmount,
      autoDuty,
      effectiveDuty,
      fees,
      lmi,
      totalRequired,
      gap,
      months,
      monthlyNeeded,
      dhoasPreview,
    };
  }, [form, liveLiquidAccountSavings, fhss.estimatedTotalReleaseAmount]);

  const handlePriceChange = (raw: string) => {
    const num = parseFloat(raw);
    const pct = parseFloat(form.depositPct);
    const nextAmount =
      !isNaN(num) && num >= 0 && !isNaN(pct)
        ? String(Math.round(((num * pct) / 100) * 100) / 100)
        : form.depositAmountInput;
    setForm((prev) => ({ ...prev, targetPrice: raw, depositAmountInput: nextAmount }));
  };

  const handleDepositPctChange = (raw: string) => {
    const pct = parseFloat(raw);
    const price = parseFloat(form.targetPrice);
    const nextAmount =
      !isNaN(pct) && !isNaN(price) && price >= 0
        ? String(Math.round(((price * pct) / 100) * 100) / 100)
        : form.depositAmountInput;
    setForm((prev) => ({ ...prev, depositPct: raw, depositAmountInput: nextAmount }));
  };

  const handleDepositAmountChange = (raw: string) => {
    const amt = parseFloat(raw);
    const price = parseFloat(form.targetPrice);
    const nextPct =
      !isNaN(amt) && !isNaN(price) && price > 0
        ? String(Math.round((amt / price) * 10000) / 100)
        : form.depositPct;
    setForm((prev) => ({ ...prev, depositAmountInput: raw, depositPct: nextPct }));
  };

  const handleLocationChange = (nextLoc: PropertyLocationCode) => {
    setForm((prev) => {
      const prevDefaultCity =
        prev.locationCode !== "CUSTOM"
          ? getAustralianStateInfo(prev.locationCode).defaultCity
          : "";
      const isDefaultOrEmpty =
        !prev.targetCity.trim() || prev.targetCity.trim() === prevDefaultCity;

      let nextCity = prev.targetCity;
      if (nextLoc === "CUSTOM") {
        if (isDefaultOrEmpty) nextCity = "";
      } else {
        const stateInfo = getAustralianStateInfo(nextLoc);
        if (isDefaultOrEmpty) nextCity = stateInfo.defaultCity;
      }

      const nextFees =
        nextLoc === "CUSTOM" && prev.conveyancingFees === "3850"
          ? "0"
          : nextLoc !== "CUSTOM" && prev.locationCode === "CUSTOM" && prev.conveyancingFees === "0"
          ? "3850"
          : prev.conveyancingFees;

      return {
        ...prev,
        locationCode: nextLoc,
        targetCity: nextCity,
        conveyancingFees: nextFees,
        isFirstHomeBuyer: nextLoc === "CUSTOM" ? false : prev.isFirstHomeBuyer,
      };
    });
  };

  const handleSaveGoal = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const price = parseFloat(form.targetPrice);
    const pct = parseFloat(form.depositPct);
    const fees = parseFloat(form.conveyancingFees) || 0;
    const lmi = parseFloat(form.estimatedLmi) || 0;
    const allocated = parseFloat(form.currentSavingsAllocated) || 0;
    const monthlyPace = parseFloat(form.monthlySavingsPace) || 0;
    const marginalRate = parseFloat(form.fhssMarginalTaxRatePct);
    const customDuty =
      form.customStampDuty.trim() !== "" ? parseFloat(form.customStampDuty) : null;
    const dhoasMonthly =
      form.dhoasMonthlySubsidy.trim() !== "" ? parseFloat(form.dhoasMonthlySubsidy) : null;
    const dhoasCap = form.dhoasLoanCap.trim() !== "" ? parseFloat(form.dhoasLoanCap) : null;
    const dhoasLump = parseFloat(form.dhoasLumpSumAmount) || 0;

    if (!Number.isFinite(price) || price <= 0) {
      setFeedback({ type: "error", text: "Please enter a valid target property price (> 0)." });
      return;
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setFeedback({ type: "error", text: "Deposit percentage must be between 0% and 100%." });
      return;
    }

    startTransition(async () => {
      const res = await savePropertyGoalAction({
        goalName: form.goalName,
        targetDate: form.targetDate,
        locationCode: form.locationCode,
        targetCity: form.targetCity,
        customLocationName: form.locationCode === "CUSTOM" ? form.targetCity : null,
        isFirstHomeBuyer: form.isFirstHomeBuyer,
        targetPrice: price,
        depositPct: pct,
        customStampDuty:
          customDuty !== null && Number.isFinite(customDuty) ? customDuty : null,
        conveyancingFees: fees,
        estimatedLmi: lmi,
        useLiveLiquidSavings: form.useLiveLiquidSavings,
        currentSavingsAllocated: allocated,
        monthlySavingsPace: monthlyPace,
        useFhss: form.useFhss,
        fhssMarginalTaxRatePct: Number.isFinite(marginalRate) ? marginalRate : 32.5,
        useDhoas: form.useDhoas,
        dhoasMode: form.dhoasMode,
        dhoasEnlistmentDate: form.dhoasEnlistmentDate,
        dhoasServiceType: form.dhoasServiceType,
        dhoasMonthlySubsidy:
          dhoasMonthly !== null && Number.isFinite(dhoasMonthly) ? dhoasMonthly : null,
        dhoasLoanCap: dhoasCap !== null && Number.isFinite(dhoasCap) ? dhoasCap : null,
        dhoasLumpSumAmount: dhoasLump,
      });

      if (!res.success || !res.data) {
        setFeedback({ type: "error", text: res.error || "Failed to save property goal." });
        return;
      }

      setData(res.data);
      setForm(buildFormStateFromGoal(res.data.goal));
      setIsEditing(false);
      setFeedback({ type: "success", text: "Mortgage deposit goal saved." });
    });
  };

  const handleConfirmResetGoal = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await deletePropertyGoalAction();
      setConfirmResetOpen(false);
      if (!res.success || !res.data) {
        setFeedback({ type: "error", text: res.error || "Failed to reset property goal." });
        return;
      }
      setData(res.data);
      setForm(buildFormStateFromGoal(null));
      setIsEditing(true);
      setFeedback({ type: "success", text: "Property goal cleared. Configure a new target below." });
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
        contributionType: fhssContribType,
        fundName: fhssFund,
      });

      if (res.success && res.data) {
        setData(res.data);
        setIsFhssModalOpen(false);
      }
    });
  };

  const handleDeleteFhss = (id: string) => {
    startTransition(async () => {
      const res = await deleteFhssContributionAction(id);
      if (res.success && res.data) {
        setData(res.data);
      }
    });
  };

  const activeStateInfo =
    form.locationCode !== "CUSTOM" && isAustralianStateCode(form.locationCode)
      ? getAustralianStateInfo(form.locationCode)
      : null;

  const progressPercent =
    goal && goal.totalRequiredCash > 0
      ? Math.min(100, Math.round((goal.totalCapitalReady / goal.totalRequiredCash) * 100))
      : 0;

  const cashPctBar =
    goal && goal.totalRequiredCash > 0
      ? Math.min(100, (goal.currentCashSavings / goal.totalRequiredCash) * 100)
      : 0;
  const fhssPctBar =
    goal && goal.totalRequiredCash > 0 && goal.useFhss
      ? Math.min(
          Math.max(0, 100 - cashPctBar),
          (goal.fhssReleaseEstimate / goal.totalRequiredCash) * 100
        )
      : 0;
  const dhoasPctBar =
    goal && goal.totalRequiredCash > 0 && goal.useDhoas && goal.dhoasLumpSumAmount > 0
      ? Math.min(
          Math.max(0, 100 - cashPctBar - fhssPctBar),
          (goal.dhoasLumpSumAmount / goal.totalRequiredCash) * 100
        )
      : 0;

  const showBothSchemes = Boolean(goal?.useFhss && goal?.useDhoas && dhoas);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {goal ? goal.goalName : "Mortgage Deposit Goal Planner"}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5">
            {goal ? (
              <>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-sky-500" />
                  {goal.locationLabel}
                </span>
                <span>•</span>
                <span>{goal.depositPct}% Deposit Target</span>
                {goal.useFhss && (
                  <>
                    <span>•</span>
                    <span>FHSS Active</span>
                  </>
                )}
                {goal.useDhoas && (
                  <>
                    <span>•</span>
                    <span>DHOAS Active</span>
                  </>
                )}
              </>
            ) : (
              "Configure your target property price, deposit percentage, target date, location, and optional housing schemes."
            )}
          </p>
        </div>

        {goal && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={goal.isTargetDatePast ? "warning" : "info"}
              className="text-xs font-mono px-2.5 py-1 gap-1"
            >
              <Calendar className="h-3.5 w-3.5" />
              {goal.isTargetDatePast
                ? `Target Reached (${formatTargetMonthYear(goal.targetDate)})`
                : `Target: ${formatTargetMonthYear(goal.targetDate)} (${goal.monthsUntilTarget} mo)`}
            </Badge>
            <Button
              type="button"
              variant={isEditing ? "secondary" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                if (!isEditing) {
                  setForm(buildFormStateFromGoal(goal));
                }
                setIsEditing((prev) => !prev);
              }}
            >
              <Settings2 className="h-3.5 w-3.5" />
              {isEditing ? "Close Editor" : "Configure Goal"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1"
              onClick={() => setConfirmResetOpen(true)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        )}
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-xs sm:text-sm flex items-center justify-between ${
            feedback.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Reset Goal Confirmation Bar */}
      {confirmResetOpen && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs">
              <p className="font-semibold text-foreground">Clear your configured mortgage deposit goal?</p>
              <p className="text-muted-foreground">
                Your accounts and any logged FHSS contributions will stay intact.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmResetOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={handleConfirmResetGoal}
              >
                {isPending ? "Clearing..." : "Confirm Clear Goal"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Goal Configuration Form (shown when !goal or when editing) */}
      {(isEditing || !goal) && (
        <Card className="border-border/60 bg-gradient-to-br from-card to-card/50 shadow-sm">
          <CardHeader className="p-5 pb-3 border-b bg-muted/20">
            <CardTitle className="text-base flex items-center gap-2">
              <Building className="h-4 w-4 text-sky-500" />
              {goal ? "Configure Mortgage Deposit Goal" : "Create Your Mortgage Deposit Goal"}
            </CardTitle>
            <CardDescription className="text-xs">
              Set your target location (any Australian state/territory or international/custom), purchase date, deposit amount, and optional FHSS or DHOAS schemes.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            <form onSubmit={handleSaveGoal} className="space-y-6">
              {/* Row 1: Goal Identity & Location */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="goal-name">Goal Name</Label>
                  <Input
                    id="goal-name"
                    value={form.goalName}
                    onChange={(e) => setForm((p) => ({ ...p, goalName: e.target.value }))}
                    placeholder="First Home Deposit"
                    className="h-9 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="goal-target-date">Target Purchase Date</Label>
                  <Input
                    id="goal-target-date"
                    type="date"
                    value={form.targetDate}
                    onChange={(e) => setForm((p) => ({ ...p, targetDate: e.target.value }))}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="goal-location">Location / Region</Label>
                  <select
                    id="goal-location"
                    value={form.locationCode}
                    onChange={(e) =>
                      handleLocationChange(e.target.value as PropertyLocationCode)
                    }
                    className={SELECT_CLS}
                  >
                    <optgroup label="Australia (States & Territories)">
                      {AUSTRALIAN_STATES.map((st) => (
                        <option key={st.code} value={st.code}>
                          {st.code} — {st.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="International / Other">
                      <option value="CUSTOM">Outside Australia / Custom Location</option>
                    </optgroup>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="goal-city">
                    {form.locationCode === "CUSTOM"
                      ? "City / Country / Location"
                      : "City / Suburb"}
                  </Label>
                  <Input
                    id="goal-city"
                    value={form.targetCity}
                    onChange={(e) => setForm((p) => ({ ...p, targetCity: e.target.value }))}
                    placeholder={
                      form.locationCode === "CUSTOM"
                        ? "e.g., London, UK or Auckland, NZ"
                        : activeStateInfo?.defaultCity || "Adelaide"
                    }
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              {/* First Home Buyer toggle (AU only) */}
              {activeStateInfo && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border bg-muted/20 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={form.isFirstHomeBuyer}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, isFirstHomeBuyer: e.target.checked }))
                      }
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span>First Home Buyer ({activeStateInfo.code} concession/exemption scale)</span>
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    {activeStateInfo.fhbNote}
                  </span>
                </div>
              )}

              {/* Row 2: Price, Deposit & Transaction Costs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="goal-price">Target Property Price ({currency})</Label>
                  <Input
                    id="goal-price"
                    type="number"
                    min="1"
                    step="5000"
                    value={form.targetPrice}
                    onChange={(e) => handlePriceChange(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="goal-deposit-pct">Target Deposit (%)</Label>
                  <Input
                    id="goal-deposit-pct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={form.depositPct}
                    onChange={(e) => handleDepositPctChange(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="goal-deposit-amount">Target Deposit Amount ({currency})</Label>
                  <Input
                    id="goal-deposit-amount"
                    type="number"
                    min="0"
                    step="1000"
                    value={form.depositAmountInput}
                    onChange={(e) => handleDepositAmountChange(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="goal-custom-duty">
                    {form.locationCode === "CUSTOM"
                      ? `Transfer Tax / Stamp Duty (${currency})`
                      : `Override Stamp Duty (${currency}, optional)`}
                  </Label>
                  <Input
                    id="goal-custom-duty"
                    type="number"
                    min="0"
                    step="100"
                    value={form.customStampDuty}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, customStampDuty: e.target.value }))
                    }
                    placeholder={
                      form.locationCode === "CUSTOM"
                        ? "0"
                        : `Auto: ${fmt(formPreview.autoDuty)}`
                    }
                    className="h-9 text-xs font-mono"
                  />
                  {form.locationCode !== "CUSTOM" && (
                    <p className="text-[10px] text-muted-foreground">
                      Leave blank to use {form.locationCode} scale ({fmt(formPreview.autoDuty)}).
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="goal-fees">Conveyancing & Closing Fees ({currency})</Label>
                  <Input
                    id="goal-fees"
                    type="number"
                    min="0"
                    step="100"
                    value={form.conveyancingFees}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, conveyancingFees: e.target.value }))
                    }
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="goal-lmi">Estimated LMI / Mortgage Insurance ({currency})</Label>
                  <Input
                    id="goal-lmi"
                    type="number"
                    min="0"
                    step="100"
                    value={form.estimatedLmi}
                    onChange={(e) => setForm((p) => ({ ...p, estimatedLmi: e.target.value }))}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Row 3: Deposit Savings Source & Monthly Pace */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-lg border bg-muted/20 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-semibold">Deposit Savings Source</Label>
                    <div className="inline-flex rounded-md border bg-background p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() =>
                          setForm((p) => ({ ...p, useLiveLiquidSavings: true }))
                        }
                        className={`px-2.5 py-1 rounded transition-colors ${
                          form.useLiveLiquidSavings
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Live Accounts
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((p) => ({ ...p, useLiveLiquidSavings: false }))
                        }
                        className={`px-2.5 py-1 rounded transition-colors ${
                          !form.useLiveLiquidSavings
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Custom Amount
                      </button>
                    </div>
                  </div>
                  {form.useLiveLiquidSavings ? (
                    <p className="text-xs text-muted-foreground">
                      Automatically tracking active Checking, Savings & Offset accounts:{" "}
                      <span className="font-mono font-semibold text-foreground">
                        {fmt(liveLiquidAccountSavings)}
                      </span>
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <Input
                        type="number"
                        min="0"
                        step="500"
                        value={form.currentSavingsAllocated}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, currentSavingsAllocated: e.target.value }))
                        }
                        className="h-8 text-xs font-mono"
                        placeholder="0"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Custom cash savings allocated specifically to this deposit.
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-3.5 rounded-lg border bg-muted/20 space-y-2">
                  <Label htmlFor="goal-monthly-pace" className="text-xs font-semibold">
                    Planned Monthly Savings Contribution ({currency}/mo)
                  </Label>
                  <Input
                    id="goal-monthly-pace"
                    type="number"
                    min="0"
                    step="50"
                    value={form.monthlySavingsPace}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, monthlySavingsPace: e.target.value }))
                    }
                    className="h-8 text-xs font-mono"
                    placeholder="0"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Optional: compare your planned savings pace against the required monthly rate.
                  </p>
                </div>
              </div>

              {/* Row 4: Optional Schemes (FHSS & DHOAS On/Off + Config) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* FHSS Toggle Card */}
                <div className="p-4 rounded-xl border bg-muted/15 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-sky-500" />
                      <div>
                        <p className="text-xs font-bold">
                          First Home Super Saver (FHSS)
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Include voluntary super contributions in deposit capital
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={form.useFhss ? "default" : "outline"}
                      className="h-7 text-xs px-3"
                      onClick={() => setForm((p) => ({ ...p, useFhss: !p.useFhss }))}
                    >
                      {form.useFhss ? "Enabled" : "Off"}
                    </Button>
                  </div>

                  {form.useFhss && (
                    <div className="pt-2 border-t space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="fhss-tax-rate" className="text-xs">
                          Marginal Tax Rate (%)
                        </Label>
                        <div className="flex items-center gap-1">
                          {["30", "32.5", "37", "45"].map((rate) => (
                            <button
                              key={rate}
                              type="button"
                              onClick={() =>
                                setForm((p) => ({ ...p, fhssMarginalTaxRatePct: rate }))
                              }
                              className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                                form.fhssMarginalTaxRatePct === rate
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-background text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {rate}%
                            </button>
                          ))}
                        </div>
                      </div>
                      <Input
                        id="fhss-tax-rate"
                        type="number"
                        min="0"
                        max="60"
                        step="0.5"
                        value={form.fhssMarginalTaxRatePct}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            fhssMarginalTaxRatePct: e.target.value,
                          }))
                        }
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  )}
                </div>

                {/* DHOAS Toggle Card */}
                <div className="p-4 rounded-xl border bg-muted/15 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-indigo-500" />
                      <div>
                        <p className="text-xs font-bold">
                          DHOAS Defence Subsidy
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Toggle DHOAS on/off and configure tier or exact subsidy amount
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={form.useDhoas ? "default" : "outline"}
                      className="h-7 text-xs px-3"
                      onClick={() => setForm((p) => ({ ...p, useDhoas: !p.useDhoas }))}
                    >
                      {form.useDhoas ? "Enabled" : "Off"}
                    </Button>
                  </div>

                  {form.useDhoas && (
                    <div className="pt-2 border-t space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="space-y-1">
                          <Label htmlFor="dhoas-mode" className="text-[11px]">
                            DHOAS Calculation Mode
                          </Label>
                          <select
                            id="dhoas-mode"
                            value={form.dhoasMode}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                dhoasMode: e.target.value as DhoasConfigMode,
                              }))
                            }
                            className={SELECT_CLS}
                          >
                            <option value="auto">Auto (From Service Years)</option>
                            <option value="tier1">Tier 1 ($386k cap • $395/mo)</option>
                            <option value="tier2">Tier 2 ($579k cap • $592/mo)</option>
                            <option value="tier3">Tier 3 ($772k cap • $790/mo)</option>
                            <option value="custom">Custom DHOAS Amount</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="dhoas-lump-sum" className="text-[11px]">
                            DHOAS Lump Sum Toward Deposit ({currency})
                          </Label>
                          <Input
                            id="dhoas-lump-sum"
                            type="number"
                            min="0"
                            step="500"
                            value={form.dhoasLumpSumAmount}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                dhoasLumpSumAmount: e.target.value,
                              }))
                            }
                            className="h-9 text-xs font-mono"
                            placeholder="0"
                          />
                        </div>
                      </div>

                      {form.dhoasMode === "auto" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div className="space-y-1">
                            <Label htmlFor="dhoas-enlistment" className="text-[11px]">
                              Service Enlistment Date
                            </Label>
                            <Input
                              id="dhoas-enlistment"
                              type="date"
                              value={form.dhoasEnlistmentDate}
                              onChange={(e) =>
                                setForm((p) => ({
                                  ...p,
                                  dhoasEnlistmentDate: e.target.value,
                                }))
                              }
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="dhoas-service-type" className="text-[11px]">
                              Service Type
                            </Label>
                            <select
                              id="dhoas-service-type"
                              value={form.dhoasServiceType}
                              onChange={(e) =>
                                setForm((p) => ({
                                  ...p,
                                  dhoasServiceType:
                                    e.target.value === "reserve" ? "reserve" : "permanent",
                                }))
                              }
                              className={SELECT_CLS}
                            >
                              <option value="permanent">Permanent ADF</option>
                              <option value="reserve">Reserve ADF</option>
                            </select>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="space-y-1">
                          <Label htmlFor="dhoas-monthly-subsidy" className="text-[11px]">
                            Monthly Subsidy Override ({currency}/mo)
                          </Label>
                          <Input
                            id="dhoas-monthly-subsidy"
                            type="number"
                            min="0"
                            step="10"
                            value={form.dhoasMonthlySubsidy}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                dhoasMonthlySubsidy: e.target.value,
                              }))
                            }
                            placeholder={
                              formPreview.dhoasPreview
                                ? `Default: $${formPreview.dhoasPreview.projectedTier.estimatedMonthlySubsidy}`
                                : "e.g., 592"
                            }
                            className="h-8 text-xs font-mono"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="dhoas-loan-cap" className="text-[11px]">
                            Subsidised Loan Cap Override ({currency})
                          </Label>
                          <Input
                            id="dhoas-loan-cap"
                            type="number"
                            min="0"
                            step="10000"
                            value={form.dhoasLoanCap}
                            onChange={(e) =>
                              setForm((p) => ({ ...p, dhoasLoanCap: e.target.value }))
                            }
                            placeholder={
                              formPreview.dhoasPreview
                                ? `Default: $${formPreview.dhoasPreview.projectedTier.subsidisedLoanCap.toLocaleString()}`
                                : "e.g., 579000"
                            }
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Live Summary Preview & Submit */}
              <div className="p-4 rounded-xl border bg-muted/30 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs flex-1">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Target Deposit</span>
                    <span className="font-mono font-bold text-foreground">
                      {fmt(formPreview.depositAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">
                      Stamp Duty / Tax
                    </span>
                    <span className="font-mono font-bold text-foreground">
                      {fmt(formPreview.effectiveDuty)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">
                      Total Cash Required
                    </span>
                    <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                      {fmt(formPreview.totalRequired)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">
                      Est. Pace ({formPreview.months} mo)
                    </span>
                    <span className="font-mono font-bold text-foreground">
                      {fmt(formPreview.monthlyNeeded)}/mo
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 shrink-0">
                  {goal && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setForm(buildFormStateFromGoal(goal));
                        setIsEditing(false);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    {isPending ? "Saving..." : goal ? "Save Changes" : "Save Deposit Goal"}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Active Goal Overview & Progress */}
      {goal && (
        <>
          <Card className="border-border/60">
            <CardContent className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Total Capital Ready toward {fmt(goal.targetPrice)} in {goal.locationLabel}
                  </p>
                  <p className="text-2xl font-bold font-mono text-sky-500">
                    {fmt(goal.totalCapitalReady)}{" "}
                    <span className="text-sm font-normal text-muted-foreground font-sans">
                      of {fmt(goal.totalRequiredCash)} required
                    </span>
                  </p>
                </div>
                <div className="sm:text-right">
                  <Badge
                    variant={progressPercent >= 50 ? "success" : "warning"}
                    className="text-xs font-mono px-2 py-0.5"
                  >
                    {progressPercent}% Funded
                  </Badge>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Remaining Gap: {fmt(goal.netGap)}
                  </p>
                </div>
              </div>

              {/* Stacked Progress Bar */}
              <div className="h-3 w-full bg-muted rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-sky-500 transition-all duration-500"
                  style={{ width: `${cashPctBar}%` }}
                  title={`Cash Savings: ${fmt(goal.currentCashSavings)}`}
                />
                {goal.useFhss && goal.fhssReleaseEstimate > 0 && (
                  <div
                    className="h-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${fhssPctBar}%` }}
                    title={`FHSS Release: ${fmt(goal.fhssReleaseEstimate)}`}
                  />
                )}
                {goal.useDhoas && goal.dhoasLumpSumAmount > 0 && (
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${dhoasPctBar}%` }}
                    title={`DHOAS Lump Sum: ${fmt(goal.dhoasLumpSumAmount)}`}
                  />
                )}
              </div>

              {/* Cost Breakdown Chips */}
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="px-2.5 py-1 rounded-md bg-muted/40 border font-mono">
                  Deposit ({goal.depositPct}%): <strong>{fmt(goal.targetDepositAmount)}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-muted/40 border font-mono">
                  {goal.locationCode === "CUSTOM"
                    ? "Transfer Tax / Duty"
                    : `${goal.locationCode} Stamp Duty`}
                  : <strong>{fmt(goal.stampDuty)}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-muted/40 border font-mono">
                  Closing Fees: <strong>{fmt(goal.conveyancingFees)}</strong>
                </span>
                {goal.estimatedLmi > 0 && (
                  <span className="px-2.5 py-1 rounded-md bg-muted/40 border font-mono">
                    LMI: <strong>{fmt(goal.estimatedLmi)}</strong>
                  </span>
                )}
              </div>

              {/* Legend & Savings Pace */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground pt-2 border-t">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-sky-500" />
                    <span>
                      {goal.useLiveLiquidSavings ? "Liquid Cash" : "Allocated Cash"}:{" "}
                      {fmt(goal.currentCashSavings)}
                    </span>
                  </div>
                  {goal.useFhss && (
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-indigo-500" />
                      <span>FHSS Super: {fmt(goal.fhssReleaseEstimate)}</span>
                    </div>
                  )}
                  {goal.useDhoas && goal.dhoasLumpSumAmount > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      <span>DHOAS Lump Sum: {fmt(goal.dhoasLumpSumAmount)}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 font-mono text-foreground font-semibold">
                  <span>Monthly Pace Required: {fmt(goal.requiredMonthlySavingsRate)}/mo</span>
                  {goal.monthlySavingsPace > 0 && (
                    <Badge
                      variant={
                        goal.monthlySavingsPace >= goal.requiredMonthlySavingsRate
                          ? "success"
                          : "warning"
                      }
                      className="text-[10px] py-0"
                    >
                      {goal.monthlySavingsPace >= goal.requiredMonthlySavingsRate
                        ? `On Track (${fmt(goal.monthlySavingsPace)}/mo)`
                        : `Gap +${fmt(goal.requiredMonthlySavingsRate - goal.monthlySavingsPace)}/mo`}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Conditional Housing Scheme Modules */}
          {(goal.useFhss || (goal.useDhoas && dhoas)) ? (
            <div
              className={`grid grid-cols-1 ${
                showBothSchemes ? "lg:grid-cols-2" : ""
              } gap-6`}
            >
              {/* FHSS SCHEME TRACKER */}
              {goal.useFhss && (
                <Card className="border-border/60">
                  <CardHeader className="bg-gradient-to-r from-sky-500/10 to-transparent p-5 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-sky-500/20 text-sky-500 flex items-center justify-center">
                          <Shield className="h-4 w-4" />
                        </div>
                        <div>
                          <CardTitle className="text-base">
                            First Home Super Saver (FHSS)
                          </CardTitle>
                          <CardDescription>
                            Voluntary super contributions & ATO SIC deemed earnings
                          </CardDescription>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => setIsFhssModalOpen(true)}
                        className="h-7 text-xs gap-1 shrink-0"
                      >
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
                          {fmt(fhss.totalContributed)} / $50,000
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {fmt(fhss.remainingLifetimeCap)} lifetime cap remaining
                        </p>
                      </div>

                      <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
                        <span className="text-muted-foreground">Max Withdrawable Release</span>
                        <p className="font-mono text-base font-bold text-sky-500">
                          {fmt(fhss.estimatedTotalReleaseAmount)}
                        </p>
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          Includes ~{fmt(fhss.estimatedDeemedEarnings)} deemed SIC earnings
                        </p>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border bg-muted/20 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">Tax Arbitrage Benefit</span>
                        <Badge variant="success" className="font-mono text-[10px] px-1.5 py-0">
                          +{fmt(fhss.estimatedTaxSaved)} Tax Saved
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">
                        Concessional super contributions are taxed at{" "}
                        <strong>15% in super</strong> instead of your configured{" "}
                        <strong>{goal.fhssMarginalTaxRatePct}% marginal tax rate</strong>,
                        capturing a{" "}
                        {Math.max(0, goal.fhssMarginalTaxRatePct - 15).toFixed(1)}% tax
                        advantage.
                      </p>
                    </div>

                    {/* Contributions History */}
                    <div className="space-y-1.5 pt-1">
                      <p className="text-xs font-semibold">
                        Logged Contributions ({contributions.length})
                      </p>
                      {contributions.length === 0 ? (
                        <div className="p-4 rounded-lg border border-dashed text-center text-xs text-muted-foreground">
                          No FHSS contributions logged yet. Click{" "}
                          <strong>Log Contribution</strong> above to track voluntary super deposits.
                        </div>
                      ) : (
                        <div className="divide-y rounded-lg border bg-card text-xs">
                          {contributions.map((c) => (
                            <div
                              key={c.id}
                              className="p-2.5 flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="font-medium flex items-center gap-1.5 flex-wrap">
                                  <span className="truncate">{c.fundName}</span>
                                  <Badge variant="outline" className="text-[9px] py-0 font-mono">
                                    {c.financialYear}
                                  </Badge>
                                  <Badge variant="outline" className="text-[9px] py-0">
                                    {c.contributionType === "concessional"
                                      ? "Concessional"
                                      : "Non-Concessional"}
                                  </Badge>
                                </div>
                                {c.bpayRef && (
                                  <p className="text-[10px] text-muted-foreground font-mono">
                                    {c.bpayRef}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono font-bold text-sky-500">
                                  {fmt(c.amount)}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  title="Delete contribution"
                                  aria-label="Delete FHSS contribution"
                                  disabled={isPending}
                                  onClick={() => handleDeleteFhss(c.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* DHOAS SUBSIDY TRACKER */}
              {goal.useDhoas && dhoas && (
                <Card className="border-border/60">
                  <CardHeader className="bg-gradient-to-r from-indigo-500/10 to-transparent p-5 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-indigo-500/20 text-indigo-500 flex items-center justify-center">
                          <Layers className="h-4 w-4" />
                        </div>
                        <div>
                          <CardTitle className="text-base">DHOAS Defence Home Subsidy</CardTitle>
                          <CardDescription>
                            Configurable tier, monthly subsidy & loan cap for {dhoas.targetYear}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs font-mono">
                        {dhoas.mode === "custom"
                          ? "Custom DHOAS"
                          : dhoas.serviceType === "reserve"
                          ? "Reserve ADF"
                          : "Permanent ADF"}
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
                          {dhoas.currentTier.tier === 0
                            ? "Under 4 Yrs"
                            : `Tier ${dhoas.currentTier.tier}`}
                        </Badge>
                      </div>

                      <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
                        <span className="text-muted-foreground">
                          {dhoas.mode === "auto"
                            ? `Projected at ${dhoas.targetYear} Target`
                            : "Configured DHOAS Level"}
                        </span>
                        <p className="font-mono text-base font-bold text-indigo-500">
                          {dhoas.mode === "auto"
                            ? `${dhoas.projectedYears} Years`
                            : dhoas.mode === "custom"
                            ? "Custom Amount"
                            : `Tier ${dhoas.projectedTier.tier}`}
                        </p>
                        <Badge variant="success" className="text-[9px] py-0 font-mono">
                          {dhoas.projectedTier.name.split(" (")[0]}
                        </Badge>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg border bg-muted/20 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">
                          {dhoas.targetYear} Subsidised Loan Cap
                        </span>
                        <span className="font-mono font-bold text-indigo-500 text-sm">
                          {fmt(dhoas.effectiveLoanCap)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Monthly Subsidy Benefit:</span>
                        <span className="font-mono font-semibold text-foreground">
                          ~{fmt(dhoas.effectiveMonthlySubsidy)} / month
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground pt-1 border-t">
                        <span>Annual Cash Flow Relief:</span>
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          +{fmt(dhoas.annualSubsidyValue)} / year
                        </span>
                      </div>
                      {dhoas.lumpSumAmount > 0 && (
                        <div className="flex items-center justify-between text-muted-foreground pt-1 border-t">
                          <span>Lump Sum Applied to Deposit:</span>
                          <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            {fmt(dhoas.lumpSumAmount)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Tier Progression Ladder */}
                    <div className="space-y-2 pt-1 text-xs">
                      <span className="font-semibold">DHOAS Tier Reference Ladder</span>
                      <div className="space-y-1.5 font-mono text-[11px]">
                        {[1, 2, 3].map((tierNum) => {
                          const t = DHOAS_TIERS[tierNum];
                          const isActive =
                            dhoas.mode !== "custom" && dhoas.projectedTier.tier === tierNum;
                          return (
                            <div
                              key={tierNum}
                              className={`p-2 rounded border flex items-center justify-between ${
                                isActive
                                  ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 font-bold"
                                  : "bg-muted/20 opacity-75"
                              }`}
                            >
                              <span>
                                {isActive ? "★ " : ""}
                                {t.name}
                              </span>
                              <span>
                                Cap: ${t.subsidisedLoanCap.toLocaleString()} • ~$
                                {t.estimatedMonthlySubsidy}/mo
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card className="border-dashed border-border/70 bg-muted/10">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  Optional schemes (FHSS & DHOAS) are currently turned off for this goal. You can enable either scheme anytime in <strong>Configure Goal</strong>.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setForm(buildFormStateFromGoal(goal));
                    setIsEditing(true);
                  }}
                >
                  Configure Schemes
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Log FHSS Contribution Modal */}
      {isFhssModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cc-animate-overlay">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 cc-animate-modal">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold">Log FHSS Super Contribution</h3>
                <p className="text-xs text-muted-foreground">
                  Record voluntary super contribution toward $50k FHSS cap
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsFhssModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddFhss} className="space-y-4">
              <div className="space-y-1">
                <Label>Contribution Amount ({currency})</Label>
                <Input
                  type="number"
                  step="100"
                  min="1"
                  placeholder="15000"
                  value={fhssAmount}
                  onChange={(e) => setFhssAmount(e.target.value)}
                  className="h-9 text-xs font-mono"
                  required
                />
                <p className="text-[10px] text-muted-foreground">
                  ATO limit: $15,000 per financial year ($50,000 lifetime)
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Financial Year</Label>
                  <select
                    value={fhssFy}
                    onChange={(e) => setFhssFy(e.target.value)}
                    className={SELECT_CLS}
                  >
                    {fyOptions.map((fy) => (
                      <option key={fy} value={fy}>
                        {fy}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>Contribution Type</Label>
                  <select
                    value={fhssContribType}
                    onChange={(e) =>
                      setFhssContribType(
                        e.target.value === "non_concessional"
                          ? "non_concessional"
                          : "concessional"
                      )
                    }
                    className={SELECT_CLS}
                  >
                    <option value="concessional">Concessional (Pre-tax)</option>
                    <option value="non_concessional">Non-Concessional (Post-tax)</option>
                  </select>
                </div>
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
