"use client";

import { useState, useTransition } from "react";
import {
  PieChart as PieIcon,
  AlertTriangle,
  Plus,
  Search,
  Filter,
  ArrowUpDown,
  CheckCircle2,
  DollarSign,
  Layers,
  Sparkles,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatCurrency, formatDate } from "@/lib/utils";
import { BudgetItem, createBudgetAction } from "@/actions/budgets";

interface BudgetsViewProps {
  initialBudgets: BudgetItem[];
  anomalies: Array<{
    id: string;
    date: string;
    merchant: string;
    categoryName: string;
    amount: number;
    anomalyType: string;
    severity: "high" | "medium" | "low";
  }>;
  categories: Array<{ id: string; name: string; color: string }>;
}

export function BudgetsView({ initialBudgets, anomalies, categories }: BudgetsViewProps) {
  const [budgets, setBudgets] = useState(initialBudgets);
  const [activeTab, setActiveTab] = useState("budgets");
  const [isPending, startTransition] = useTransition();

  // Investigation filter states
  const [anomalySearch, setAnomalySearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // New Budget Modal
  const [isNewBudgetOpen, setIsNewBudgetOpen] = useState(false);
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [allocatedAmount, setAllocatedAmount] = useState("");
  const [period, setPeriod] = useState<"monthly" | "weekly" | "yearly">("monthly");

  const totalCap = budgets.reduce((sum, b) => sum + b.allocatedAmount, 0);
  const totalSpent = budgets.reduce((sum, b) => sum + b.spentAmount, 0);
  const overallPct = totalCap > 0 ? Math.round((totalSpent / totalCap) * 100) : 0;

  const filteredAnomalies = anomalies
    .filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (anomalySearch.trim()) {
        const q = anomalySearch.toLowerCase();
        return (
          a.merchant.toLowerCase().includes(q) ||
          a.categoryName.toLowerCase().includes(q) ||
          a.anomalyType.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) =>
      sortOrder === "desc"
        ? Math.abs(b.amount) - Math.abs(a.amount)
        : Math.abs(a.amount) - Math.abs(b.amount)
    );

  const handleCreateBudget = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(allocatedAmount);
    if (!categoryId || isNaN(amountNum) || amountNum <= 0) return;

    const cat = categories.find((c) => c.id === categoryId);

    startTransition(async () => {
      const res = await createBudgetAction({
        categoryId,
        categoryName: cat?.name || "Category",
        allocatedAmount: amountNum,
        period,
      });

      if (res.success && res.budget) {
        setBudgets([...budgets, res.budget]);
        setIsNewBudgetOpen(false);
        setAllocatedAmount("");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Budgets & Anomaly Investigation
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Category spending thresholds • Outlier detection • Financial investigation table
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setIsNewBudgetOpen(true)} className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" />
            Set Budget Cap
          </Button>
        </div>
      </div>

      {/* Tabs: Budgets vs Investigation View */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/60 p-1">
          <TabsTrigger value="budgets" className="text-xs gap-1.5">
            <PieIcon className="h-3.5 w-3.5" />
            Active Category Caps ({budgets.length})
          </TabsTrigger>
          <TabsTrigger value="investigation" className="text-xs gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            Investigation & Anomalies ({anomalies.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: BUDGET CAPS */}
        <TabsContent value="budgets" className="space-y-6">
          {/* High-level budget burn gauge */}
          <Card className="border-border/60 bg-gradient-to-br from-card to-card/50">
            <CardContent className="p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs text-muted-foreground">Overall Monthly Allocation</span>
                  <div className="text-2xl font-bold font-mono">
                    {formatCurrency(totalSpent)} / {formatCurrency(totalCap)}
                  </div>
                </div>
                <div className="text-right">
                  <Badge
                    variant={overallPct > 90 ? "destructive" : "info"}
                    className="text-xs font-mono px-2 py-0.5"
                  >
                    {overallPct}% Consumed
                  </Badge>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Remaining Buffer: {formatCurrency(Math.max(0, totalCap - totalSpent))}
                  </p>
                </div>
              </div>

              <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    overallPct > 100
                      ? "bg-rose-500"
                      : overallPct > 80
                      ? "bg-amber-500"
                      : "bg-sky-500"
                  }`}
                  style={{ width: `${Math.min(100, overallPct)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Category Budget Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {budgets.map((b) => (
              <Card key={b.id} className="border-border/60">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full inline-block"
                        style={{ backgroundColor: b.categoryColor }}
                      />
                      {b.categoryName}
                    </span>
                    <Badge
                      variant={
                        b.status === "overrun"
                          ? "destructive"
                          : b.status === "warning"
                          ? "warning"
                          : "outline"
                      }
                      className="text-[9px] uppercase font-mono py-0"
                    >
                      {b.status}
                    </Badge>
                  </div>
                  <CardTitle className="text-lg font-bold font-mono mt-1">
                    {formatCurrency(b.spentAmount)}{" "}
                    <span className="text-xs font-normal text-muted-foreground font-sans">
                      of {formatCurrency(b.allocatedAmount)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1 space-y-2">
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
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                    <span>{b.percentageSpent.toFixed(0)}% Used</span>
                    <span>
                      {b.remainingAmount >= 0
                        ? `${formatCurrency(b.remainingAmount)} left`
                        : `Over by ${formatCurrency(Math.abs(b.remainingAmount))}`}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* TAB 2: INVESTIGATION VIEW (ANOMALY DRILL-DOWN) */}
        <TabsContent value="investigation" className="space-y-4">
          <Card className="border-border/60">
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Search anomaly, merchant..."
                    value={anomalySearch}
                    onChange={(e) => setAnomalySearch(e.target.value)}
                    className="pl-9 h-9 text-xs"
                  />
                </div>

                <div>
                  <select
                    aria-label="Filter anomalies by severity"
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                    className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs"
                  >
                    <option value="all">All Severities</option>
                    <option value="high">High Severity (Overrun)</option>
                    <option value="medium">Medium Severity (Near Cap)</option>
                    <option value="low">Low Severity (Unclassified)</option>
                  </select>
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                    className="text-xs h-9 gap-1.5 w-full sm:w-auto"
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    Sort by Amount ({sortOrder.toUpperCase()})
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Investigation Table */}
          <Card className="border-border/60 overflow-hidden">
            <CardHeader className="p-4 pb-2 border-b bg-muted/20">
              <CardTitle className="text-sm font-semibold">
                Anomalous Spending Records
              </CardTitle>
              <CardDescription className="text-xs">
                Surfaced transactions with unusual variance, budget overshoot, or unclassified tagging
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Execution Date</TableHead>
                    <TableHead>Merchant / Point of Sale</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Anomaly Flag</TableHead>
                    <TableHead className="text-right">Transaction Amount</TableHead>
                    <TableHead className="text-center">Severity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAnomalies.map((anom) => (
                    <TableRow key={anom.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {formatDate(anom.date)}
                      </TableCell>
                      <TableCell className="font-semibold text-xs sm:text-sm">
                        {anom.merchant}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {anom.categoryName}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-foreground">
                        {anom.anomalyType}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-xs sm:text-sm text-rose-600 dark:text-rose-400">
                        {formatCurrency(anom.amount)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={
                            anom.severity === "high"
                              ? "destructive"
                              : anom.severity === "medium"
                              ? "warning"
                              : "outline"
                          }
                          className="text-[9px] uppercase font-mono py-0"
                        >
                          {anom.severity}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Set Budget Cap Modal */}
      {isNewBudgetOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold">Set Category Budget Cap</h3>
                <p className="text-xs text-muted-foreground">
                  Define spending ceiling and overrun threshold
                </p>
              </div>
              <button
                onClick={() => setIsNewBudgetOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateBudget} className="space-y-4">
              <div className="space-y-1">
                <Label>Category</Label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Budget Limit ($ AUD)</Label>
                  <Input
                    type="number"
                    step="10"
                    placeholder="500.00"
                    value={allocatedAmount}
                    onChange={(e) => setAllocatedAmount(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label>Budget Period</Label>
                  <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as any)}
                    className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsNewBudgetOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Setting..." : "Save Budget Cap"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
