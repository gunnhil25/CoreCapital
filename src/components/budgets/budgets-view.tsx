"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PieChart as PieIcon,
  AlertTriangle,
  Plus,
  Search,
  ArrowUpDown,
  CornerDownRight,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertCircle,
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
import {
  formatCategoryDisplayLabel,
  sortAndFlattenCategories,
  summarizeBudgetsHierarchy,
} from "@/lib/category-utils";
import {
  BudgetItem,
  createBudgetAction,
  deleteBudgetAction,
  updateBudgetAction,
} from "@/actions/budgets";

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
  categories: Array<{
    id: string;
    name: string;
    color: string;
    parentId?: string | null;
    sortOrder?: number;
  }>;
}

export function BudgetsView({ initialBudgets, anomalies, categories }: BudgetsViewProps) {
  const router = useRouter();
  const orderedCategories = useMemo(
    () => sortAndFlattenCategories(categories),
    [categories]
  );
  const childCategoriesByParent = useMemo(() => {
    const map = new Map<string, typeof orderedCategories>();
    for (const c of orderedCategories) {
      if (c.parentId) {
        const list = map.get(c.parentId) || [];
        list.push(c);
        map.set(c.parentId, list);
      }
    }
    return map;
  }, [orderedCategories]);

  const [budgets, setBudgets] = useState(initialBudgets);
  const [activeTab, setActiveTab] = useState("budgets");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Investigation filter states
  const [anomalySearch, setAnomalySearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Create / Edit Budget Cap Modal
  const [budgetModalMode, setBudgetModalMode] = useState<"create" | "edit" | null>(null);
  const [editingBudget, setEditingBudget] = useState<BudgetItem | null>(null);
  const [subCapParentId, setSubCapParentId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [allocatedAmount, setAllocatedAmount] = useState("");
  const [alertThresholdPct, setAlertThresholdPct] = useState("80");
  const [period, setPeriod] = useState<"monthly" | "weekly" | "yearly">("monthly");
  const [modalError, setModalError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BudgetItem | null>(null);

  const budgetSummary = useMemo(
    () => summarizeBudgetsHierarchy(budgets),
    [budgets]
  );
  const { groups: budgetGroups, totalCap, totalSpent, overallPct } = budgetSummary;

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

  const openCreateBudgetModal = (parentCatId?: string) => {
    setModalError(null);
    setEditingBudget(null);
    if (parentCatId) {
      const childOpts = childCategoriesByParent.get(parentCatId) || [];
      setSubCapParentId(parentCatId);
      setCategoryId(childOpts[0]?.id || parentCatId);
    } else {
      setSubCapParentId(null);
      setCategoryId(orderedCategories[0]?.id || categories[0]?.id || "");
    }
    setAllocatedAmount("");
    setAlertThresholdPct("80");
    setPeriod("monthly");
    setBudgetModalMode("create");
  };

  const openEditBudgetModal = (budget: BudgetItem) => {
    setModalError(null);
    setEditingBudget(budget);
    setSubCapParentId(budget.parentCategoryId || null);
    setCategoryId(budget.categoryId);
    setAllocatedAmount(budget.allocatedAmount.toString());
    setAlertThresholdPct(String(budget.alertThresholdPct ?? 80));
    setPeriod(budget.period);
    setBudgetModalMode("edit");
  };

  const selectedModalCategory = orderedCategories.find((c) => c.id === categoryId);
  const activeParentIdForModal =
    subCapParentId || selectedModalCategory?.parentId || null;
  const activeParentBudget = activeParentIdForModal
    ? budgets.find((b) => b.categoryId === activeParentIdForModal)
    : undefined;
  const activeParentCategory = activeParentIdForModal
    ? categories.find((c) => c.id === activeParentIdForModal)
    : undefined;

  const modalCategoryOptions = useMemo(() => {
    if (budgetModalMode === "edit" && editingBudget) {
      return orderedCategories.filter((c) => c.id === editingBudget.categoryId);
    }
    if (subCapParentId) {
      return childCategoriesByParent.get(subCapParentId) || [];
    }
    return orderedCategories;
  }, [
    budgetModalMode,
    editingBudget,
    subCapParentId,
    childCategoriesByParent,
    orderedCategories,
  ]);

  const parsedModalAmount = parseFloat(allocatedAmount) || 0;
  const otherSiblingSubCapsTotal = useMemo(() => {
    if (!activeParentIdForModal || !selectedModalCategory?.parentId) return 0;
    return budgets
      .filter(
        (b) =>
          b.parentCategoryId === activeParentIdForModal &&
          b.categoryId !== categoryId
      )
      .reduce((sum, b) => sum + b.allocatedAmount, 0);
  }, [activeParentIdForModal, selectedModalCategory, budgets, categoryId]);

  const projectedSubCapsTotal =
    Math.round((otherSiblingSubCapsTotal + parsedModalAmount) * 100) / 100;
  const exceedsParentWarning = Boolean(
    activeParentBudget &&
      selectedModalCategory?.parentId &&
      parsedModalAmount > 0 &&
      projectedSubCapsTotal > activeParentBudget.allocatedAmount + 0.005
  );

  const handleSubmitBudget = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setFeedback(null);
    const amountNum = parseFloat(allocatedAmount);
    const thresholdNum = parseInt(alertThresholdPct, 10) || 80;

    if (!categoryId || isNaN(amountNum) || amountNum <= 0) {
      setModalError("Please enter a valid positive budget limit.");
      return;
    }

    const cat = categories.find((c) => c.id === categoryId);

    startTransition(async () => {
      if (budgetModalMode === "edit" && editingBudget) {
        const res = await updateBudgetAction({
          id: editingBudget.id,
          allocatedAmount: amountNum,
          period,
          alertThresholdPct: thresholdNum,
        });
        if (!res.success || !res.budgets) {
          setModalError(res.error || "Failed to update budget cap.");
          return;
        }
        setBudgets(res.budgets);
        setBudgetModalMode(null);
        setEditingBudget(null);
        setFeedback({
          type: "success",
          text: `Updated budget cap for "${cat?.name || editingBudget.categoryName}".`,
        });
        router.refresh();
      } else {
        const res = await createBudgetAction({
          categoryId,
          categoryName: cat?.name || "Category",
          allocatedAmount: amountNum,
          period,
          alertThresholdPct: thresholdNum,
        });
        if (!res.success || !res.budgets) {
          setModalError(res.error || "Failed to save budget cap.");
          return;
        }
        setBudgets(res.budgets);
        setBudgetModalMode(null);
        setAllocatedAmount("");
        setFeedback({
          type: "success",
          text: `Saved budget cap for "${formatCategoryDisplayLabel(categoryId, categories)}".`,
        });
        router.refresh();
      }
    });
  };

  const handleConfirmDeleteBudget = () => {
    if (!deleteTarget) return;
    setFeedback(null);
    startTransition(async () => {
      const targetName = formatCategoryDisplayLabel(
        deleteTarget.categoryId,
        categories
      );
      const res = await deleteBudgetAction(deleteTarget.id);
      setDeleteTarget(null);
      if (res.success && res.budgets) {
        setBudgets(res.budgets);
        setFeedback({
          type: "success",
          text: `Removed budget cap for "${targetName}".`,
        });
        router.refresh();
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
          <Button onClick={() => openCreateBudgetModal()} className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" />
            Set Budget Cap
          </Button>
        </div>
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

      {/* Tabs: Budgets vs Investigation View */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/60 p-1">
          <TabsTrigger value="budgets" className="text-xs gap-1.5">
            <PieIcon className="h-3.5 w-3.5" />
            Active Category Caps ({budgetGroups.length})
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

          {/* Category Budget Cards Grid (with Nested Sub-Caps) */}
          {budgetGroups.length === 0 ? (
            <Card className="border-border/60">
              <CardContent className="p-8 text-center text-xs text-muted-foreground space-y-2">
                <p>No category budget caps configured yet.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openCreateBudgetModal()}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Set First Budget Cap
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
              {budgetGroups.map(
                ({
                  budget: b,
                  subCaps,
                  subCapsAllocatedTotal,
                  subCapsSpentTotal,
                  exceedsParentCap,
                  hasSubCapAlert,
                  isStandaloneSubCategory,
                }) => {
                  const availableChildren =
                    childCategoriesByParent.get(b.categoryId) || [];
                  const unallocatedSubSpend = Math.max(
                    0,
                    Math.round((b.spentAmount - subCapsSpentTotal) * 100) / 100
                  );

                  return (
                    <Card key={b.id} className="border-border/60">
                      <CardHeader className="p-4 pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className="h-2.5 w-2.5 rounded-full inline-block shrink-0"
                                style={{ backgroundColor: b.categoryColor }}
                              />
                              <span className="text-xs font-semibold truncate">
                                {isStandaloneSubCategory
                                  ? formatCategoryDisplayLabel(b.categoryId, categories)
                                  : b.categoryName}
                              </span>
                              {isStandaloneSubCategory && (
                                <Badge variant="secondary" className="text-[9px] py-0 font-mono">
                                  Sub-Category
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className="text-[10px] font-mono uppercase text-muted-foreground">
                                {b.period} • Alert ≥{b.alertThresholdPct}%
                              </span>
                              {hasSubCapAlert && (
                                <Badge variant="warning" className="text-[9px] py-0 font-mono">
                                  Sub-Cap Alert
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
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
                        </div>
                        <CardTitle className="text-lg font-bold font-mono mt-1.5 flex items-baseline justify-between gap-2">
                          <span>
                            {formatCurrency(b.spentAmount)}{" "}
                            <span className="text-xs font-normal text-muted-foreground font-sans">
                              of {formatCurrency(b.allocatedAmount)}
                            </span>
                          </span>
                          <div className="flex items-center gap-0.5">
                            {!isStandaloneSubCategory && availableChildren.length > 0 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 text-[10px] font-sans text-muted-foreground hover:text-primary"
                                onClick={() => openCreateBudgetModal(b.categoryId)}
                                title="Add soft sub-cap under this parent category"
                              >
                                <Plus className="h-3 w-3 mr-0.5" />
                                Sub-Cap
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              aria-label={`Edit ${b.categoryName} budget`}
                              onClick={() => openEditBudgetModal(b)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              aria-label={`Delete ${b.categoryName} budget`}
                              onClick={() => setDeleteTarget(b)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardTitle>
                      </CardHeader>

                      <CardContent className="p-4 pt-1 space-y-2.5">
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

                        {/* Nested Soft Sub-Caps */}
                        {subCaps.length > 0 && (
                          <div className="mt-3 pt-3 border-t space-y-2.5">
                            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              <span>Nested Sub-Caps ({subCaps.length})</span>
                              <span className="font-mono">
                                {formatCurrency(subCapsAllocatedTotal)} /{" "}
                                {formatCurrency(b.allocatedAmount)}
                              </span>
                            </div>

                            {exceedsParentCap && (
                              <div className="px-2.5 py-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">
                                Sub-caps ({formatCurrency(subCapsAllocatedTotal)}) exceed parent cap (
                                {formatCurrency(b.allocatedAmount)}).
                              </div>
                            )}

                            <div className="space-y-2">
                              {subCaps.map((sc) => (
                                <div
                                  key={sc.id}
                                  className="rounded-lg border bg-muted/25 p-2.5 space-y-1.5"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                      <span
                                        className="h-2 w-2 rounded-full shrink-0"
                                        style={{ backgroundColor: sc.categoryColor }}
                                      />
                                      <span className="text-xs font-medium truncate">
                                        {sc.categoryName}
                                      </span>
                                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                        ≥{sc.alertThresholdPct}%
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Badge
                                        variant={
                                          sc.status === "overrun"
                                            ? "destructive"
                                            : sc.status === "warning"
                                            ? "warning"
                                            : "outline"
                                        }
                                        className="text-[9px] uppercase font-mono py-0"
                                      >
                                        {sc.status}
                                      </Badge>
                                      <button
                                        type="button"
                                        onClick={() => openEditBudgetModal(sc)}
                                        aria-label={`Edit ${sc.categoryName} sub-cap`}
                                        className="p-0.5 text-muted-foreground hover:text-foreground"
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeleteTarget(sc)}
                                        aria-label={`Delete ${sc.categoryName} sub-cap`}
                                        className="p-0.5 text-muted-foreground hover:text-destructive"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        sc.status === "overrun"
                                          ? "bg-rose-500"
                                          : sc.status === "warning"
                                          ? "bg-amber-500"
                                          : "bg-emerald-500"
                                      }`}
                                      style={{
                                        width: `${Math.min(100, sc.percentageSpent)}%`,
                                      }}
                                    />
                                  </div>

                                  <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                                    <span>
                                      {formatCurrency(sc.spentAmount)} /{" "}
                                      {formatCurrency(sc.allocatedAmount)}
                                    </span>
                                    <span>{sc.percentageSpent.toFixed(0)}%</span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {unallocatedSubSpend > 0.01 && (
                              <p className="text-[10px] text-muted-foreground font-mono">
                                Other / un-capped sub-spend: {formatCurrency(unallocatedSubSpend)}
                              </p>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                }
              )}
            </div>
          )}
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
                    className="w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs"
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

      {/* Set / Edit Budget Cap Modal */}
      {budgetModalMode && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cc-animate-overlay">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 cc-animate-modal">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold">
                  {budgetModalMode === "edit"
                    ? "Edit Category Budget Cap"
                    : subCapParentId
                    ? `Add Sub-Cap under ${activeParentCategory?.name || "Parent"}`
                    : "Set Category Budget Cap"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Define spending ceiling and custom alert threshold
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBudgetModalMode(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="p-3 rounded-lg border bg-destructive/10 border-destructive/30 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {activeParentBudget && selectedModalCategory?.parentId && (
              <div className="p-3 rounded-lg border bg-muted/30 text-xs space-y-1">
                <p className="font-semibold">
                  Parent Cap ({activeParentBudget.categoryName}):{" "}
                  <span className="font-mono">
                    {formatCurrency(activeParentBudget.allocatedAmount)}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Other sibling sub-caps: {formatCurrency(otherSiblingSubCapsTotal)} • Remaining room:{" "}
                  {formatCurrency(
                    Math.max(0, activeParentBudget.allocatedAmount - otherSiblingSubCapsTotal)
                  )}
                </p>
              </div>
            )}

            <form onSubmit={handleSubmitBudget} className="space-y-4">
              <div className="space-y-1">
                <Label>Category</Label>
                <select
                  value={categoryId}
                  disabled={budgetModalMode === "edit"}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs disabled:opacity-70"
                >
                  {modalCategoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.depth === 1 ? `↳ ${c.displayLabel}` : c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Limit ($ AUD)</Label>
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
                  <Label>Alert At (%)</Label>
                  <Input
                    type="number"
                    min="10"
                    max="100"
                    step="5"
                    value={alertThresholdPct}
                    onChange={(e) => setAlertThresholdPct(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label>Period</Label>
                  <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as any)}
                    className="w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>

              {exceedsParentWarning && activeParentBudget && (
                <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300">
                  Total sub-caps ({formatCurrency(projectedSubCapsTotal)}) will exceed the{" "}
                  <strong>{activeParentBudget.categoryName}</strong> parent cap (
                  {formatCurrency(activeParentBudget.allocatedAmount)}). You can still save this soft sub-cap.
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBudgetModalMode(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending
                    ? "Saving..."
                    : budgetModalMode === "edit"
                    ? "Save Changes"
                    : "Save Budget Cap"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Budget Cap Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cc-animate-overlay">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 cc-animate-modal">
            <h3 className="text-base font-bold">
              Delete Budget Cap &ldquo;
              {formatCategoryDisplayLabel(deleteTarget.categoryId, categories)}
              &rdquo;?
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This removes the spending ceiling for this category without modifying any ledger transactions.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={handleConfirmDeleteBudget}
              >
                {isPending ? "Deleting..." : "Confirm Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
