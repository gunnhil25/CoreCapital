"use client";

import { useState, useTransition } from "react";
import {
  Repeat,
  AlertTriangle,
  Plus,
  Flame,
  CheckCircle2,
  Calendar,
  DollarSign,
  TrendingUp,
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
  SubscriptionItem,
  createSubscriptionAction,
  toggleSubscriptionAction,
} from "@/actions/subscriptions";

interface SubscriptionsViewProps {
  initialSubscriptions: SubscriptionItem[];
}

export function SubscriptionsView({ initialSubscriptions }: SubscriptionsViewProps) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [isNewSubOpen, setIsNewSubOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Form states
  const [name, setName] = useState("");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [billingCycle, setBillingCycle] = useState<"weekly" | "fortnightly" | "monthly" | "quarterly" | "annually">("monthly");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [nextBillingDate, setNextBillingDate] = useState(new Date().toISOString().split("T")[0]);

  const activeSubs = subscriptions.filter((s) => s.isActive);
  const totalAnnualCost = activeSubs.reduce((sum, s) => sum + s.annualizedAmount, 0);
  const monthlyEquivalentBurn = totalAnnualCost / 12;

  // Identify subscription creep candidates (e.g. weekly subscriptions > $15/wk or annualized > $500)
  const creepAlerts = activeSubs.filter(
    (s) => s.annualizedAmount > 400 || s.billingCycle === "weekly"
  );

  const handleToggle = (id: string, currentActive: boolean) => {
    startTransition(async () => {
      await toggleSubscriptionAction(id, !currentActive);
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isActive: !currentActive } : s))
      );
    });
  };

  const handleCreateSub = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (!name || isNaN(numAmount) || numAmount <= 0) return;

    startTransition(async () => {
      const res = await createSubscriptionAction({
        name,
        merchant,
        amount: numAmount,
        billingCycle,
        startDate,
        nextBillingDate,
      });

      if (res.success && res.subscription) {
        setSubscriptions([...subscriptions, res.subscription]);
        setIsNewSubOpen(false);
        setName("");
        setMerchant("");
        setAmount("");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Subscription Creep Monitor
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Recurring expense isolation • True annualized cost calculation • Micro-charge creep detection
          </p>
        </div>
        <Button onClick={() => setIsNewSubOpen(true)} className="gap-1.5 shadow-sm">
          <Plus className="h-4 w-4" />
          Add Subscription
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Total Annualized Burn</span>
              <DollarSign className="h-4 w-4 text-rose-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
              {formatCurrency(totalAnnualCost)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-muted-foreground">
              Committed cash flow over 12 months
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Monthly Run Rate</span>
              <Calendar className="h-4 w-4 text-sky-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold font-mono">
              {formatCurrency(monthlyEquivalentBurn)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-muted-foreground">
              Across {activeSubs.length} active recurring services
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Creep Alert Items</span>
              <Flame className="h-4 w-4 text-amber-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-amber-500">
              {creepAlerts.length} Services
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-muted-foreground">
              Annualized impact exceeding $400/yr
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Subscription Creep Warning Banner */}
      {creepAlerts.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-foreground">
                Subscription Creep Detected
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Frequent micro-charges create deceptive friction. For instance,{" "}
                <strong>Anytime Fitness ($19.95/wk)</strong> appears negligible per billing cycle, but accumulates to{" "}
                <strong className="text-foreground font-mono">$1,037.40 every year</strong>. Review whether active usage justifies the annual expense.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscriptions Table */}
      <Card className="border-border/60 overflow-hidden">
        <CardHeader className="p-4 pb-2 border-b bg-muted/20 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Repeat className="h-4 w-4 text-sky-500" />
              Isolated Recurring Expenses
            </CardTitle>
            <CardDescription className="text-xs">
              Normalized to true annualized Australian dollar cost
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono">
            {subscriptions.length} Tracked
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service / Merchant</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Billing Frequency</TableHead>
                <TableHead className="text-right">Billed Amount</TableHead>
                <TableHead className="text-right">True Annualized Cost</TableHead>
                <TableHead>Next Billing Date</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((sub) => {
                const isCreepCandidate = sub.annualizedAmount > 400 || sub.billingCycle === "weekly";
                return (
                  <TableRow
                    key={sub.id}
                    className={!sub.isActive ? "opacity-50 bg-muted/10" : ""}
                  >
                    <TableCell>
                      <div className="font-semibold text-xs sm:text-sm flex items-center gap-1.5">
                        <span>{sub.name}</span>
                        {isCreepCandidate && sub.isActive && (
                          <Badge variant="warning" className="text-[9px] px-1 py-0">
                            Creep Risk
                          </Badge>
                        )}
                      </div>
                      {sub.merchant && (
                        <div className="text-[11px] text-muted-foreground">
                          {sub.merchant}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full inline-block"
                          style={{ backgroundColor: sub.categoryColor || "#ec4899" }}
                        />
                        <span>{sub.categoryName || "Subscription"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] uppercase font-mono">
                        {sub.billingCycle}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs sm:text-sm">
                      {formatCurrency(sub.amount)} / {sub.billingCycle.replace("ly", "")}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs sm:text-sm font-bold text-rose-600 dark:text-rose-400">
                      {formatCurrency(sub.annualizedAmount)}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {formatDate(sub.nextBillingDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant={sub.isActive ? "ghost" : "outline"}
                        size="sm"
                        onClick={() => handleToggle(sub.id, sub.isActive)}
                        className="h-7 text-xs px-2.5"
                      >
                        {sub.isActive ? "Pause" : "Resume"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Subscription Modal */}
      {isNewSubOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold">Add Recurring Subscription</h3>
                <p className="text-xs text-muted-foreground">
                  Track recurring service and annual cost
                </p>
              </div>
              <button
                onClick={() => setIsNewSubOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSub} className="space-y-4">
              <div className="space-y-1">
                <Label>Service Name</Label>
                <Input
                  placeholder="e.g. YouTube Premium"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Billing Amount ($ AUD)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="18.99"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label>Billing Frequency</Label>
                  <select
                    value={billingCycle}
                    onChange={(e) => setBillingCycle(e.target.value as any)}
                    className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annually">Annually</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Next Billing Date</Label>
                <Input
                  type="date"
                  value={nextBillingDate}
                  onChange={(e) => setNextBillingDate(e.target.value)}
                  className="h-9 text-xs font-mono"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsNewSubOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Adding..." : "Add Subscription"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
