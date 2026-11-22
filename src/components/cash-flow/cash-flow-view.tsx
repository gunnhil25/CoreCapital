"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Clock,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  CashFlowDataPoint,
  CashFlowFrequency,
  CashFlowPageData,
  createCashFlowItemAction,
  deleteCashFlowItemAction,
  toggleCashFlowItemAction,
} from "@/actions/cash-flow";

interface CashFlowViewProps {
  initialData: CashFlowPageData;
}

const FREQUENCY_LABELS: Record<CashFlowFrequency, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
  one_off: "One-off",
};

const SELECT_CLS =
  "w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function getTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function CashFlowView({ initialData }: CashFlowViewProps) {
  const [data, setData] = useState<CashFlowPageData>(initialData);
  const [horizon, setHorizon] = useState<30 | 90>(30);
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Add Scheduled Item Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemType, setItemType] = useState<"income" | "expense">("income");
  const [itemAmount, setItemAmount] = useState("");
  const [itemFrequency, setItemFrequency] = useState<CashFlowFrequency>("fortnightly");
  const [itemAccountId, setItemAccountId] = useState(initialData.accounts[0]?.id || "");
  const [itemNextDate, setItemNextDate] = useState(getTodayIso);
  const [itemEndDate, setItemEndDate] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  const currency = data.baseCurrency || "AUD";
  const fmt = (val: number) => formatCurrency(val, currency);

  const activeData = horizon === 30 ? data.projection30 : data.projection90;
  const majorEvents = activeData.points.filter((p) => p.eventDescription);
  const hasAnyActivity = activeData.startingBalance !== 0 || majorEvents.length > 0;

  const openModal = (presetType?: "income" | "expense") => {
    setFormError(null);
    if (presetType) setItemType(presetType);
    if (!itemAccountId && data.accounts[0]?.id) {
      setItemAccountId(data.accounts[0].id);
    }
    setIsAddModalOpen(true);
  };

  const handleCreateItem = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const amt = parseFloat(itemAmount);
    if (!itemName.trim()) {
      setFormError("Please enter a name for the scheduled item.");
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      setFormError("Amount must be greater than zero.");
      return;
    }

    startTransition(async () => {
      const res = await createCashFlowItemAction({
        accountId: itemAccountId || undefined,
        name: itemName,
        type: itemType,
        amount: amt,
        frequency: itemFrequency,
        nextOccurrenceDate: itemNextDate,
        endDate: itemEndDate.trim() || null,
      });

      if (!res.success || !res.data) {
        setFormError(res.error || "Failed to add scheduled cash flow item.");
        return;
      }

      setData(res.data);
      setIsAddModalOpen(false);
      setItemName("");
      setItemAmount("");
      setItemEndDate("");
    });
  };

  const handleToggleItem = (id: string, nextActive: boolean) => {
    startTransition(async () => {
      const res = await toggleCashFlowItemAction(id, nextActive);
      if (res.success && res.data) {
        setData(res.data);
      }
    });
  };

  const handleDeleteItem = (id: string) => {
    startTransition(async () => {
      const res = await deleteCashFlowItemAction(id);
      if (res.success && res.data) {
        setData(res.data);
      }
    });
  };

  const netChangePositive = activeData.netChange > 0;
  const netChangeNegative = activeData.netChange < 0;

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Cash Flow Forecasting
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Forward-looking liquidity curve from your configured scheduled income, expenses, and active subscriptions
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg border">
            <Button
              type="button"
              variant={horizon === 30 ? "default" : "ghost"}
              size="sm"
              onClick={() => setHorizon(30)}
              className="text-xs h-8 px-3"
            >
              30-Day Outlook
            </Button>
            <Button
              type="button"
              variant={horizon === 90 ? "default" : "ghost"}
              size="sm"
              onClick={() => setHorizon(90)}
              className="text-xs h-8 px-3"
            >
              90-Day Outlook
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => openModal()}
            className="h-9 text-xs gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Scheduled Item
          </Button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">Current Liquid Capital</CardDescription>
            <CardTitle className="text-xl sm:text-2xl font-bold font-mono">
              {fmt(activeData.startingBalance)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <span className="text-[11px] text-muted-foreground">
              Active Checking, Savings & Offset
            </span>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">
              Projected End Balance ({horizon}d)
            </CardDescription>
            <CardTitle
              className={`text-xl sm:text-2xl font-bold font-mono ${
                netChangePositive
                  ? "text-emerald-600 dark:text-emerald-400"
                  : netChangeNegative
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-foreground"
              }`}
            >
              {fmt(activeData.endingBalance)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div
              className={`flex items-center text-[11px] font-medium ${
                netChangePositive
                  ? "text-emerald-600 dark:text-emerald-400"
                  : netChangeNegative
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-muted-foreground"
              }`}
            >
              {netChangePositive ? (
                <>
                  <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" />
                  <span>+{fmt(activeData.netChange)} net growth</span>
                </>
              ) : netChangeNegative ? (
                <>
                  <ArrowDownRight className="h-3.5 w-3.5 mr-0.5" />
                  <span>{fmt(activeData.netChange)} net outflow</span>
                </>
              ) : (
                <span>{fmt(0)} net change</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">Lowest Projected Point</CardDescription>
            <CardTitle
              className={`text-xl sm:text-2xl font-bold font-mono ${
                activeData.lowestBalance < 0 ? "text-rose-500" : "text-sky-500"
              }`}
            >
              {fmt(activeData.lowestBalance)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {activeData.lowestBalance < 0 ? (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 mt-0.5">
                Overdraft Risk
              </Badge>
            ) : !hasAnyActivity ? (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 mt-0.5">
                No Activity
              </Badge>
            ) : (
              <Badge variant="success" className="text-[10px] px-1.5 py-0 mt-0.5">
                Liquidity Safe
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">
              Scheduled Income ({horizon}d)
            </CardDescription>
            <CardTitle className="text-xl sm:text-2xl font-bold font-mono">
              {activeData.scheduledIncomeCount}{" "}
              {activeData.scheduledIncomeCount === 1 ? "Event" : "Events"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <span className="text-[11px] text-muted-foreground font-mono">
              {fmt(activeData.scheduledIncomeTotal)} projected inflow
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Interactive Projection Chart */}
      <Card className="border-border/60 overflow-hidden">
        <CardHeader className="p-5 pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">
                Projected Bank Balance Trajectory
              </CardTitle>
              <CardDescription className="text-xs">
                Projected liquidity over the next {horizon} calendar days based on your active accounts and scheduled items
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs font-mono">
              {horizon} Days Horizon
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-3">
          {!hasAnyActivity ? (
            <div className="h-72 w-full rounded-xl border border-dashed flex flex-col items-center justify-center gap-3 text-center px-6">
              <p className="text-sm font-semibold text-foreground">
                No cash flow balances or scheduled items configured yet
              </p>
              <p className="text-xs text-muted-foreground max-w-md">
                Add recurring income or expenses below, record{" "}
                <Link href="/subscriptions" className="text-sky-500 hover:underline">
                  subscriptions
                </Link>
                , or log transactions in the{" "}
                <Link href="/transactions" className="text-sky-500 hover:underline">
                  ledger
                </Link>{" "}
                to build your forecast.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openModal("income")}
                className="gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Add First Scheduled Item
              </Button>
            </div>
          ) : mounted ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={activeData.points}
                  margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                  <XAxis
                    dataKey="formattedDate"
                    stroke="#888888"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    interval={horizon === 30 ? 4 : 12}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) =>
                      Math.abs(val) >= 1000
                        ? `$${(val / 1000).toFixed(1)}k`
                        : `$${Math.round(val)}`
                    }
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const pt = payload[0].payload as CashFlowDataPoint;
                        return (
                          <div className="rounded-lg border bg-background/95 backdrop-blur-md p-3 shadow-xl text-xs space-y-1">
                            <p className="font-semibold">{pt.formattedDate}</p>
                            <p className="font-mono text-sky-500 font-bold text-sm">
                              Balance: {fmt(pt.projectedBalance)}
                            </p>
                            {pt.eventDescription && (
                              <p className="text-[11px] text-emerald-500 pt-1 border-t">
                                ★ {pt.eventDescription}
                              </p>
                            )}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="projectedBalance"
                    stroke="#0ea5e9"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#balanceGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-72 w-full rounded-xl bg-muted/20 animate-pulse" />
          )}
        </CardContent>
      </Card>

      {/* Configured Scheduled Cash Flow Rules + Projected Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configured Scheduled Items */}
        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2 border-b bg-muted/20 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-sky-500" />
                Configured Scheduled Items ({data.scheduledItems.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Recurring paychecks, rent, bills, and planned one-off transfers
              </CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => openModal()}
              className="h-7 text-xs gap-1"
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {data.scheduledItems.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground space-y-2">
                <p>No scheduled income or expense items added yet.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => openModal("income")}
                  className="text-xs gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Schedule Income or Expense
                </Button>
              </div>
            ) : (
              <div className="divide-y text-xs">
                {data.scheduledItems.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3.5 flex items-center justify-between gap-3 ${
                      !item.isActive ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                          item.type === "income"
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-rose-500/10 text-rose-500"
                        }`}
                      >
                        {item.type === "income" ? (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-foreground truncate">
                            {item.name}
                          </span>
                          <Badge variant="outline" className="text-[9px] py-0">
                            {FREQUENCY_LABELS[item.frequency]}
                          </Badge>
                          {!item.isActive && (
                            <Badge variant="secondary" className="text-[9px] py-0">
                              Paused
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Next: {formatDate(item.nextOccurrenceDate)}
                          {item.accountName ? ` • ${item.accountName}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`font-mono font-bold mr-1 ${
                          item.type === "income"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-foreground"
                        }`}
                      >
                        {item.type === "income" ? "+" : "-"}
                        {fmt(item.amount)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title={item.isActive ? "Pause item" : "Resume item"}
                        aria-label={item.isActive ? "Pause scheduled item" : "Resume scheduled item"}
                        disabled={isPending}
                        onClick={() => handleToggleItem(item.id, !item.isActive)}
                      >
                        {item.isActive ? (
                          <Pause className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Delete scheduled item"
                        aria-label="Delete scheduled item"
                        disabled={isPending}
                        onClick={() => handleDeleteItem(item.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Major Scheduled Inflows and Outflows */}
        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2 border-b bg-muted/20">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-sky-500" />
              Scheduled Cash Flow Events ({horizon}d)
            </CardTitle>
            <CardDescription className="text-xs">
              Upcoming projected inflows and outflows over the next {horizon} days
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {majorEvents.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No scheduled cash flow events in the next {horizon} days.
              </div>
            ) : (
              <div className="divide-y text-xs">
                {majorEvents.map((evt, idx) => (
                  <div
                    key={`${evt.date}-${idx}`}
                    className="p-3.5 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                          evt.inflow >= evt.outflow
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-rose-500/10 text-rose-500"
                        }`}
                      >
                        {evt.inflow >= evt.outflow ? (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground break-words">
                          {evt.eventDescription}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {evt.formattedDate}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {evt.inflow > 0 && (
                        <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          +{fmt(evt.inflow)}
                        </p>
                      )}
                      {evt.outflow > 0 && (
                        <p className="font-mono font-bold text-foreground">
                          -{fmt(evt.outflow)}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground font-mono">
                        Projected: {fmt(evt.projectedBalance)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Scheduled Item Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cc-animate-overlay">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 cc-animate-modal">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold">Add Scheduled Cash Flow Item</h3>
                <p className="text-xs text-muted-foreground">
                  Schedule recurring pay, rent, bills, or one-off future cash movements
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateItem} className="space-y-4">
              {formError && (
                <div className="p-2.5 rounded-lg border bg-destructive/10 border-destructive/30 text-destructive text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="cf-name">Item Name</Label>
                <Input
                  id="cf-name"
                  placeholder="e.g., Salary, Rent, Electricity Bill"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="cf-type">Type</Label>
                  <select
                    id="cf-type"
                    value={itemType}
                    onChange={(e) =>
                      setItemType(e.target.value === "expense" ? "expense" : "income")
                    }
                    className={SELECT_CLS}
                  >
                    <option value="income">Income (+)</option>
                    <option value="expense">Expense (-)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="cf-amount">Amount ({currency})</Label>
                  <Input
                    id="cf-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="2500.00"
                    value={itemAmount}
                    onChange={(e) => setItemAmount(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="cf-frequency">Frequency</Label>
                  <select
                    id="cf-frequency"
                    value={itemFrequency}
                    onChange={(e) =>
                      setItemFrequency(e.target.value as CashFlowFrequency)
                    }
                    className={SELECT_CLS}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annually">Annually</option>
                    <option value="one_off">One-off</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="cf-account">Account</Label>
                  <select
                    id="cf-account"
                    value={itemAccountId}
                    onChange={(e) => setItemAccountId(e.target.value)}
                    className={SELECT_CLS}
                  >
                    {data.accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="cf-next-date">Next Occurrence Date</Label>
                  <Input
                    id="cf-next-date"
                    type="date"
                    value={itemNextDate}
                    onChange={(e) => setItemNextDate(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="cf-end-date">End Date (optional)</Label>
                  <Input
                    id="cf-end-date"
                    type="date"
                    value={itemEndDate}
                    onChange={(e) => setItemEndDate(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Scheduled Item"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
