"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CornerDownRight,
  FolderTree,
  GitMerge,
  GripVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  WalletCards,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/utils";
import {
  CategoryDropPosition,
  computeCategoryDragResult,
  sortAndFlattenCategories,
} from "@/lib/category-utils";
import { AccountRecord, CategoryRecord } from "@/lib/store";
import {
  createAccountAction,
  createCategoryAction,
  deleteAccountAction,
  deleteCategoryAction,
  ManageDataResponse,
  mergeCategoryAction,
  moveCategoryOrderAction,
  reorderCategoriesAction,
  toggleAccountActiveAction,
  updateAccountAction,
  updateCategoryAction,
} from "@/actions/manage";

interface ManageViewProps {
  initialData: ManageDataResponse;
  initialTab?: "categories" | "accounts";
}

const COLOR_SWATCHES = [
  "#6d5dfc",
  "#27c6a5",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef5b72",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#64748b",
];

const CATEGORY_TYPES = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "investment", label: "Investment" },
  { value: "transfer", label: "Transfer" },
] as const;

const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking / Everyday" },
  { value: "savings", label: "Savings" },
  { value: "offset", label: "Mortgage Offset" },
  { value: "credit_card", label: "Credit Card" },
  { value: "loan", label: "Loan / Mortgage" },
  { value: "superannuation", label: "Superannuation" },
  { value: "investment", label: "Investment / Brokerage" },
] as const;

const SELECT_CLS =
  "w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

function getAccountTypeLabel(type: string): string {
  return ACCOUNT_TYPES.find((t) => t.value === type)?.label || type;
}

export function ManageView({
  initialData,
  initialTab = "categories",
}: ManageViewProps) {
  const router = useRouter();
  const [data, setData] = useState<ManageDataResponse>(initialData);
  const [activeTab, setActiveTab] = useState<"categories" | "accounts">(initialTab);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Categories state
  const [catTypeFilter, setCatTypeFilter] = useState<string>("all");
  const [catModalMode, setCatModalMode] = useState<"create" | "edit" | null>(null);
  const [editingCat, setEditingCat] = useState<CategoryRecord | null>(null);
  const [catName, setCatName] = useState("");
  const [catType, setCatType] = useState("expense");
  const [catParentId, setCatParentId] = useState("");
  const [catColor, setCatColor] = useState("#6d5dfc");
  const [catModalError, setCatModalError] = useState<string | null>(null);
  const [retireCatTarget, setRetireCatTarget] = useState<CategoryRecord | null>(null);
  const [retireMode, setRetireMode] = useState<"merge" | "delete">("delete");
  const [replacementCatId, setReplacementCatId] = useState("");
  const [retireModalError, setRetireModalError] = useState<string | null>(null);
  const [draggedCatId, setDraggedCatId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    targetId: string;
    position: CategoryDropPosition;
  } | null>(null);

  // Accounts state
  const [accModalMode, setAccModalMode] = useState<"create" | "edit" | null>(null);
  const [editingAcc, setEditingAcc] = useState<AccountRecord | null>(null);
  const [accName, setAccName] = useState("");
  const [accInstitution, setAccInstitution] = useState("");
  const [accType, setAccType] = useState("checking");
  const [accLast4, setAccLast4] = useState("");
  const [accCurrency, setAccCurrency] = useState(initialData.baseCurrency || "AUD");
  const [accBalance, setAccBalance] = useState("0.00");
  const [accRate, setAccRate] = useState("0.00");
  const [accIsOffset, setAccIsOffset] = useState(false);
  const [accModalError, setAccModalError] = useState<string | null>(null);
  const [deleteAccTarget, setDeleteAccTarget] = useState<AccountRecord | null>(null);

  const currency = data.baseCurrency || "AUD";
  const fmt = (val: number, cur: string = currency) => formatCurrency(val, cur);

  const flattenedCategories = useMemo(
    () => sortAndFlattenCategories(data.categories),
    [data.categories]
  );

  const topLevelCategories = useMemo(
    () => flattenedCategories.filter((c) => c.depth === 0),
    [flattenedCategories]
  );

  const childCountsByParent = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of data.categories) {
      if (c.parentId) {
        map.set(c.parentId, (map.get(c.parentId) || 0) + 1);
      }
    }
    return map;
  }, [data.categories]);

  const visibleCategories = useMemo(() => {
    if (catTypeFilter === "all") return flattenedCategories;
    return flattenedCategories.filter((c) => c.type === catTypeFilter);
  }, [flattenedCategories, catTypeFilter]);

  const accountSummary = useMemo(() => {
    const liquidTypes = new Set(["checking", "savings", "offset"]);
    const investTypes = new Set(["investment", "superannuation"]);
    const debtTypes = new Set(["credit_card", "loan"]);

    let liquid = 0;
    let investments = 0;
    let liabilities = 0;
    let activeCount = 0;

    for (const acc of data.accounts) {
      if (!acc.isActive) continue;
      activeCount += 1;
      const bal = parseFloat(acc.currentBalance) || 0;
      if (liquidTypes.has(acc.accountType)) liquid += bal;
      else if (investTypes.has(acc.accountType)) investments += bal;
      else if (debtTypes.has(acc.accountType)) liabilities += bal;
    }
    return {
      liquid: Math.round(liquid * 100) / 100,
      investments: Math.round(investments * 100) / 100,
      liabilities: Math.round(liabilities * 100) / 100,
      activeCount,
    };
  }, [data.accounts]);

  // Category Modal Handlers
  const openCreateCategoryModal = (presetParent?: CategoryRecord) => {
    setCatModalError(null);
    setEditingCat(null);
    setCatName("");
    setCatParentId(presetParent ? presetParent.id : "");
    setCatType(
      presetParent ? presetParent.type : catTypeFilter !== "all" ? catTypeFilter : "expense"
    );
    setCatColor(presetParent ? presetParent.color : "#6d5dfc");
    setCatModalMode("create");
  };

  const openEditCategoryModal = (cat: CategoryRecord) => {
    setCatModalError(null);
    setEditingCat(cat);
    setCatName(cat.name);
    setCatParentId(cat.parentId || "");
    setCatType(cat.type);
    setCatColor(cat.color);
    setCatModalMode("edit");
  };

  const handleParentSelectChange = (nextParentId: string) => {
    setCatParentId(nextParentId);
    if (nextParentId) {
      const parent = data.categories.find((c) => c.id === nextParentId);
      if (parent) {
        setCatType(parent.type);
      }
    }
  };

  const handleSubmitCategory = (e: React.FormEvent) => {
    e.preventDefault();
    setCatModalError(null);
    setFeedback(null);

    if (!catName.trim()) {
      setCatModalError("Category name is required.");
      return;
    }

    startTransition(async () => {
      const res =
        catModalMode === "edit" && editingCat
          ? await updateCategoryAction({
              id: editingCat.id,
              name: catName,
              type: catType,
              color: catColor,
              parentId: catParentId || null,
            })
          : await createCategoryAction({
              name: catName,
              type: catType,
              color: catColor,
              parentId: catParentId || null,
            });

      if (!res.success || !res.data) {
        setCatModalError(res.error || "Failed to save category.");
        return;
      }

      setData(res.data);
      setCatModalMode(null);
      setEditingCat(null);
      setFeedback({
        type: "success",
        text:
          catModalMode === "edit"
            ? `Updated category "${catName.trim()}".`
            : `Created category "${catName.trim()}".`,
      });
      router.refresh();
    });
  };

  const handleMoveSibling = (cat: CategoryRecord, direction: "up" | "down") => {
    const visibleSiblings = visibleCategories.filter(
      (c) => (c.parentId || null) === (cat.parentId || null)
    );
    const currentIdx = visibleSiblings.findIndex((c) => c.id === cat.id);
    const swapIdx = direction === "up" ? currentIdx - 1 : currentIdx + 1;
    if (currentIdx === -1 || swapIdx < 0 || swapIdx >= visibleSiblings.length) return;

    const neighbor = visibleSiblings[swapIdx];

    // Swap positions inside the full flattened sibling structure
    const fullIds = flattenedCategories.map((c) => c.id);
    const posA = fullIds.indexOf(cat.id);
    const posB = fullIds.indexOf(neighbor.id);
    if (posA === -1 || posB === -1) return;

    const copy = [...flattenedCategories];
    // Reorder within the parent/child groups cleanly by swapping sortOrder values then flattening
    const orderById = new Map(copy.map((item, idx) => [item.id, idx * 10]));
    const orderA = orderById.get(cat.id)!;
    const orderB = orderById.get(neighbor.id)!;
    orderById.set(cat.id, orderB);
    orderById.set(neighbor.id, orderA);

    const reordered = sortAndFlattenCategories(
      data.categories.map((c) => ({ ...c, sortOrder: orderById.get(c.id) ?? c.sortOrder }))
    ).map((c) => c.id);

    startTransition(async () => {
      const res = await reorderCategoriesAction(reordered);
      if (res.success && res.data) {
        setData(res.data);
        router.refresh();
      }
    });
  };

  const openRetireCategoryModal = (cat: CategoryRecord, initialMode: "merge" | "delete") => {
    setRetireModalError(null);
    const candidates = flattenedCategories.filter(
      (c) => c.id !== cat.id && c.type === cat.type
    );
    const defaultReplacement =
      (cat.parentId && candidates.find((c) => c.id === cat.parentId)?.id) ||
      candidates[0]?.id ||
      "";
    setReplacementCatId(defaultReplacement);
    setRetireMode(initialMode === "merge" && candidates.length > 0 ? "merge" : "delete");
    setRetireCatTarget(cat);
  };

  const handleConfirmRetireCategory = () => {
    if (!retireCatTarget) return;
    setFeedback(null);
    setRetireModalError(null);

    if (retireMode === "merge") {
      if (!replacementCatId) {
        setRetireModalError("Select a same-type replacement category to merge into.");
        return;
      }
      startTransition(async () => {
        const res = await mergeCategoryAction(retireCatTarget.id, replacementCatId);
        if (!res.success || !res.data) {
          setRetireModalError(res.error || "Failed to merge category.");
          return;
        }
        const sourceName = retireCatTarget.name;
        const targetName =
          data.categories.find((c) => c.id === replacementCatId)?.name || "replacement";
        setRetireCatTarget(null);
        setData(res.data);
        setFeedback({
          type: "success",
          text: `Merged "${sourceName}" into "${targetName}" (${res.summary?.reassignedEntries ?? 0} ledger entries & ${res.summary?.reassignedRules ?? 0} rules reassigned).`,
        });
        router.refresh();
      });
      return;
    }

    startTransition(async () => {
      const res = await deleteCategoryAction(retireCatTarget.id);
      const removedName = retireCatTarget.name;
      setRetireCatTarget(null);
      if (!res.success || !res.data) {
        setFeedback({ type: "error", text: res.error || "Failed to delete category." });
        return;
      }
      setData(res.data);
      setFeedback({ type: "success", text: `Removed category "${removedName}".` });
      router.refresh();
    });
  };

  const resolveDropPosition = (
    e: React.DragEvent<HTMLDivElement>,
    targetCat: (typeof flattenedCategories)[number],
    sourceId: string
  ): CategoryDropPosition => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    const draggedCat = data.categories.find((c) => c.id === sourceId);
    const draggedHasChildren = draggedCat
      ? (childCountsByParent.get(draggedCat.id) || 0) > 0
      : false;
    const canDropInside = Boolean(
      draggedCat &&
        targetCat.depth === 0 &&
        !draggedHasChildren &&
        draggedCat.type === targetCat.type &&
        draggedCat.id !== targetCat.id &&
        draggedCat.parentId !== targetCat.id
    );

    if (canDropInside && ratio >= 0.28 && ratio <= 0.72) {
      return "inside";
    }
    return ratio < 0.5 ? "before" : "after";
  };

  const handleDragStartCategory = (
    e: React.DragEvent<HTMLDivElement>,
    catId: string
  ) => {
    if (isPending) {
      e.preventDefault();
      return;
    }
    setDraggedCatId(catId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", catId);
  };

  const handleDragOverCategory = (
    e: React.DragEvent<HTMLDivElement>,
    targetCat: (typeof flattenedCategories)[number]
  ) => {
    const sourceId = draggedCatId;
    if (!sourceId || sourceId === targetCat.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const position = resolveDropPosition(e, targetCat, sourceId);
    setDropIndicator((prev) =>
      prev?.targetId === targetCat.id && prev.position === position
        ? prev
        : { targetId: targetCat.id, position }
    );
  };

  const handleDropCategory = (
    e: React.DragEvent<HTMLDivElement>,
    targetCat: (typeof flattenedCategories)[number]
  ) => {
    e.preventDefault();
    const sourceId = draggedCatId || e.dataTransfer.getData("text/plain");
    const activePosition =
      dropIndicator?.targetId === targetCat.id
        ? dropIndicator.position
        : resolveDropPosition(e, targetCat, sourceId);

    setDraggedCatId(null);
    setDropIndicator(null);

    if (!sourceId || sourceId === targetCat.id) return;

    const result = computeCategoryDragResult(
      data.categories,
      sourceId,
      targetCat.id,
      activePosition
    );
    if (!result.changed) return;

    const snapshot = data;
    const orderById = new Map(result.orderedIds.map((id, idx) => [id, idx * 10]));
    setData((prev) => ({
      ...prev,
      categories: prev.categories.map((c) =>
        c.id === sourceId
          ? {
              ...c,
              parentId: result.parentChanged ? result.nextParentId : c.parentId,
              sortOrder: orderById.get(c.id) ?? c.sortOrder,
            }
          : {
              ...c,
              sortOrder: orderById.get(c.id) ?? c.sortOrder,
            }
      ),
    }));

    startTransition(async () => {
      const res = await moveCategoryOrderAction({
        categoryId: sourceId,
        ...(result.parentChanged ? { targetParentId: result.nextParentId } : {}),
        orderedIds: result.orderedIds,
      });

      if (!res.success || !res.data) {
        setData(snapshot);
        setFeedback({
          type: "error",
          text: res.error || "Failed to update category order.",
        });
        return;
      }

      setData(res.data);
      router.refresh();
    });
  };

  // Account Modal Handlers
  const openCreateAccountModal = () => {
    setAccModalError(null);
    setEditingAcc(null);
    setAccName("");
    setAccInstitution("");
    setAccType("checking");
    setAccLast4("");
    setAccCurrency(currency);
    setAccBalance("0.00");
    setAccRate("0.00");
    setAccIsOffset(false);
    setAccModalMode("create");
  };

  const openEditAccountModal = (acc: AccountRecord) => {
    setAccModalError(null);
    setEditingAcc(acc);
    setAccName(acc.name);
    setAccInstitution(acc.institution);
    setAccType(acc.accountType);
    setAccLast4(acc.accountNumberLast4 || "");
    setAccCurrency(acc.currency || currency);
    setAccBalance(acc.currentBalance);
    setAccRate(acc.interestRatePct || "0.00");
    setAccIsOffset(acc.isOffsetAccount);
    setAccModalMode("edit");
  };

  const handleSubmitAccount = (e: React.FormEvent) => {
    e.preventDefault();
    setAccModalError(null);
    setFeedback(null);

    const balNum = parseFloat(accBalance);
    const rateNum = parseFloat(accRate) || 0;
    if (!accName.trim() || !accInstitution.trim()) {
      setAccModalError("Account name and institution are required.");
      return;
    }
    if (isNaN(balNum)) {
      setAccModalError("Please enter a valid numeric balance.");
      return;
    }

    startTransition(async () => {
      const res =
        accModalMode === "edit" && editingAcc
          ? await updateAccountAction({
              id: editingAcc.id,
              name: accName,
              institution: accInstitution,
              accountType: accType,
              accountNumberLast4: accLast4,
              currency: accCurrency,
              currentBalance: balNum,
              isOffsetAccount: accIsOffset,
              interestRatePct: rateNum,
            })
          : await createAccountAction({
              name: accName,
              institution: accInstitution,
              accountType: accType,
              accountNumberLast4: accLast4,
              currency: accCurrency,
              currentBalance: balNum,
              isOffsetAccount: accIsOffset,
              interestRatePct: rateNum,
            });

      if (!res.success || !res.data) {
        setAccModalError(res.error || "Failed to save account.");
        return;
      }

      setData(res.data);
      setAccModalMode(null);
      setEditingAcc(null);
      setFeedback({
        type: "success",
        text:
          accModalMode === "edit"
            ? `Updated account "${accName.trim()}".`
            : `Added account "${accName.trim()}".`,
      });
      router.refresh();
    });
  };

  const handleToggleAccountActive = (acc: AccountRecord) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await toggleAccountActiveAction(acc.id, !acc.isActive);
      if (res.success && res.data) {
        setData(res.data);
        setFeedback({
          type: "success",
          text: acc.isActive
            ? `Archived account "${acc.name}".`
            : `Reactivated account "${acc.name}".`,
        });
        router.refresh();
      } else {
        setFeedback({
          type: "error",
          text: res.error || "Failed to update account status.",
        });
      }
    });
  };

  const handleConfirmDeleteAccount = () => {
    if (!deleteAccTarget) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await deleteAccountAction(deleteAccTarget.id);
      const removedName = deleteAccTarget.name;
      setDeleteAccTarget(null);
      if (!res.success || !res.data) {
        setFeedback({ type: "error", text: res.error || "Failed to delete account." });
        return;
      }
      setData(res.data);
      setFeedback({ type: "success", text: `Deleted account "${removedName}".` });
      router.refresh();
    });
  };

  const editingCatHasChildren = editingCat
    ? (childCountsByParent.get(editingCat.id) || 0) > 0
    : false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Accounts & Categories
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Configure income & expense categories, nested sub-categories, custom ordering, and financial accounts
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "categories" ? (
            <Button
              type="button"
              size="sm"
              onClick={() => openCreateCategoryModal()}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add Category
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={openCreateAccountModal}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add Account
            </Button>
          )}
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

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(val) =>
          setActiveTab(val === "accounts" ? "accounts" : "categories")
        }
        className="space-y-4"
      >
        <TabsList className="bg-muted/60 p-1">
          <TabsTrigger value="categories" className="text-xs gap-2">
            <FolderTree className="h-3.5 w-3.5" />
            <span>Categories</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
              {data.categories.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="accounts" className="text-xs gap-2">
            <WalletCards className="h-3.5 w-3.5" />
            <span>Accounts</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
              {data.accounts.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* TAB 1: CATEGORIES & SUB-CATEGORIES                               */}
        {/* ================================================================ */}
        <TabsContent value="categories" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {[{ value: "all", label: "All Types" }, ...CATEGORY_TYPES].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCatTypeFilter(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    catTypeFilter === opt.value
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-card text-muted-foreground hover:text-foreground border-border"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Parent budget caps automatically include spending from their sub-categories.
            </p>
          </div>

          <Card className="border-border/60 overflow-hidden">
            <CardHeader className="p-4 pb-2 border-b bg-muted/20 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">
                  Category & Sub-Category Hierarchy
                </CardTitle>
                <CardDescription className="text-xs">
                  Drag rows by the grip handle (or use ↑ / ↓) to sort, or drop a sub-category onto another parent of the same type
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-[10px] font-mono">
                {visibleCategories.length} Shown
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              {visibleCategories.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground space-y-2">
                  <p>No categories match this filter yet.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openCreateCategoryModal()}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Category
                  </Button>
                </div>
              ) : (
                <div className="divide-y">
                  {visibleCategories.map((cat) => {
                    const visibleSiblings = visibleCategories.filter(
                      (s) => (s.parentId || null) === (cat.parentId || null)
                    );
                    const sibIdx = visibleSiblings.findIndex((s) => s.id === cat.id);
                    const canMoveUp = sibIdx > 0;
                    const canMoveDown = sibIdx !== -1 && sibIdx < visibleSiblings.length - 1;
                    const childCount = childCountsByParent.get(cat.id) || 0;
                    const usage = data.usageByCategory?.[cat.id] || {
                      transactions: 0,
                      rules: 0,
                      budgets: 0,
                    };
                    const isDragged = draggedCatId === cat.id;
                    const dropPos =
                      dropIndicator?.targetId === cat.id ? dropIndicator.position : null;
                    const sameTypeReplacementCount = flattenedCategories.filter(
                      (c) => c.id !== cat.id && c.type === cat.type
                    ).length;

                    return (
                      <div
                        key={cat.id}
                        draggable={!isPending}
                        onDragStart={(e) => handleDragStartCategory(e, cat.id)}
                        onDragOver={(e) => handleDragOverCategory(e, cat)}
                        onDragLeave={() => {
                          if (dropIndicator?.targetId === cat.id) {
                            setDropIndicator(null);
                          }
                        }}
                        onDrop={(e) => handleDropCategory(e, cat)}
                        onDragEnd={() => {
                          setDraggedCatId(null);
                          setDropIndicator(null);
                        }}
                        className={`px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/25 transition-all ${
                          cat.depth === 1 ? "pl-10 bg-muted/10" : ""
                        } ${isDragged ? "opacity-45 bg-muted/30" : ""} ${
                          dropPos === "before" ? "border-t-2 border-t-primary" : ""
                        } ${dropPos === "after" ? "border-b-2 border-b-primary" : ""} ${
                          dropPos === "inside"
                            ? "ring-2 ring-inset ring-primary/60 bg-primary/10"
                            : ""
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-foreground shrink-0"
                            title="Drag to reorder or drop onto a parent category"
                          >
                            <GripVertical className="h-4 w-4" />
                          </span>
                          {cat.depth === 1 && (
                            <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span
                            className="h-3 w-3 rounded-full shrink-0 ring-2 ring-background"
                            style={{ backgroundColor: cat.color }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-xs sm:text-sm truncate">
                                {cat.name}
                              </span>
                              <Badge
                                variant={
                                  cat.type === "income"
                                    ? "success"
                                    : cat.type === "investment"
                                    ? "info"
                                    : "outline"
                                }
                                className="text-[9px] py-0 uppercase font-mono"
                              >
                                {cat.type}
                              </Badge>
                              {cat.depth === 0 && childCount > 0 && (
                                <Badge variant="secondary" className="text-[9px] py-0 font-mono">
                                  {childCount} sub-{childCount === 1 ? "category" : "categories"}
                                </Badge>
                              )}
                              {usage.transactions > 0 && (
                                <Badge variant="outline" className="text-[9px] py-0 font-mono text-muted-foreground">
                                  {usage.transactions} {usage.transactions === 1 ? "tx" : "txs"}
                                </Badge>
                              )}
                              {usage.rules > 0 && (
                                <Badge variant="outline" className="text-[9px] py-0 font-mono text-muted-foreground">
                                  {usage.rules} {usage.rules === 1 ? "rule" : "rules"}
                                </Badge>
                              )}
                              {cat.depth === 1 && cat.parentName && (
                                <span className="text-[10px] text-muted-foreground">
                                  under {cat.parentName}
                                </span>
                              )}
                              {dropPos === "inside" && (
                                <Badge variant="info" className="text-[9px] py-0 font-mono">
                                  Move under {cat.name}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            disabled={isPending || !canMoveUp}
                            title="Move up"
                            aria-label={`Move ${cat.name} up`}
                            onClick={() => handleMoveSibling(cat, "up")}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            disabled={isPending || !canMoveDown}
                            title="Move down"
                            aria-label={`Move ${cat.name} down`}
                            onClick={() => handleMoveSibling(cat, "down")}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>

                          {cat.depth === 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                              onClick={() => openCreateCategoryModal(cat)}
                              title="Add sub-category"
                            >
                              <Plus className="h-3 w-3 mr-0.5" />
                              Sub
                            </Button>
                          )}

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Edit category"
                            aria-label={`Edit ${cat.name}`}
                            onClick={() => openEditCategoryModal(cat)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>

                          {sameTypeReplacementCount > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-primary"
                              title="Merge into another category"
                              aria-label={`Merge ${cat.name}`}
                              onClick={() => openRetireCategoryModal(cat, "merge")}
                            >
                              <GitMerge className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Delete or merge category"
                            aria-label={`Delete ${cat.name}`}
                            onClick={() => openRetireCategoryModal(cat, "delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 2: ACCOUNTS                                                  */}
        {/* ================================================================ */}
        <TabsContent value="accounts" className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">
                  Active Liquid Assets
                </span>
                <span className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  {fmt(accountSummary.liquid)}
                </span>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">
                  Investments & Super
                </span>
                <span className="text-lg font-bold font-mono text-primary">
                  {fmt(accountSummary.investments)}
                </span>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">
                  Credit & Loans
                </span>
                <span className="text-lg font-bold font-mono text-foreground">
                  {fmt(accountSummary.liabilities)}
                </span>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">
                  Active Accounts
                </span>
                <span className="text-lg font-bold font-mono">
                  {accountSummary.activeCount} / {data.accounts.length}
                </span>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.accounts.map((acc) => {
              const txCount = data.txCountsByAccount[acc.id] || 0;
              const balNum = parseFloat(acc.currentBalance) || 0;

              return (
                <Card
                  key={acc.id}
                  className={`border-border/60 ${!acc.isActive ? "opacity-65" : ""}`}
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-base truncate">{acc.name}</CardTitle>
                          {!acc.isActive && (
                            <Badge variant="secondary" className="text-[9px] py-0 font-mono">
                              ARCHIVED
                            </Badge>
                          )}
                          {acc.isOffsetAccount && (
                            <Badge variant="info" className="text-[9px] py-0 font-mono">
                              OFFSET
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs mt-0.5">
                          {acc.institution}
                          {acc.accountNumberLast4 ? ` • •••• ${acc.accountNumberLast4}` : ""}
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                        {getAccountTypeLabel(acc.accountType)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-2 space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span
                        className={`text-2xl font-bold font-mono ${
                          balNum >= 0
                            ? "text-foreground"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {fmt(balNum, acc.currency || currency)}
                      </span>
                      <div className="text-[11px] text-muted-foreground font-mono text-right">
                        {parseFloat(acc.interestRatePct || "0") > 0 && (
                          <span>{acc.interestRatePct}% p.a. • </span>
                        )}
                        <span>
                          {txCount} {txCount === 1 ? "tx" : "txs"}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t flex items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => openEditAccountModal(acc)}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        Edit
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        disabled={isPending}
                        onClick={() => handleToggleAccountActive(acc)}
                      >
                        {acc.isActive ? (
                          <>
                            <Archive className="h-3 w-3 mr-1" />
                            Archive
                          </>
                        ) : (
                          <>
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Reactivate
                          </>
                        )}
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs text-muted-foreground hover:text-destructive"
                        disabled={isPending || txCount > 0}
                        title={
                          txCount > 0
                            ? "Accounts with ledger transactions cannot be deleted — archive instead"
                            : "Delete unused account"
                        }
                        onClick={() => setDeleteAccTarget(acc)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Create / Edit Category Modal */}
      {catModalMode && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cc-animate-overlay">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 cc-animate-modal">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold">
                  {catModalMode === "edit" ? "Edit Category" : "Create Category"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Configure expense/income categories or nest under a top-level parent
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCatModalMode(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {catModalError && (
              <div className="p-3 rounded-lg border bg-destructive/10 border-destructive/30 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{catModalError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitCategory} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="cat-name">Category Name</Label>
                <Input
                  id="cat-name"
                  placeholder="e.g. Dining Out, Coffee & Cafes, Side Income"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="cat-parent">Parent Category (Optional)</Label>
                  <select
                    id="cat-parent"
                    value={catParentId}
                    disabled={editingCatHasChildren}
                    onChange={(e) => handleParentSelectChange(e.target.value)}
                    className={SELECT_CLS}
                  >
                    <option value="">None (Top-Level Category)</option>
                    {topLevelCategories
                      .filter((p) => p.id !== editingCat?.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.type})
                        </option>
                      ))}
                  </select>
                  {editingCatHasChildren && (
                    <p className="text-[10px] text-muted-foreground">
                      Has sub-categories; remove or move them first to nest this category.
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="cat-type">Category Type</Label>
                  <select
                    id="cat-type"
                    value={catType}
                    disabled={Boolean(catParentId)}
                    onChange={(e) => setCatType(e.target.value)}
                    className={SELECT_CLS}
                  >
                    {CATEGORY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {catParentId && (
                    <p className="text-[10px] text-muted-foreground">
                      Inherits parent category type.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Badge & Chart Color</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {COLOR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => setCatColor(swatch)}
                      aria-label={`Select color ${swatch}`}
                      className={`h-6 w-6 rounded-full border-2 transition-transform ${
                        catColor.toLowerCase() === swatch.toLowerCase()
                          ? "border-foreground scale-110"
                          : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                  <input
                    type="color"
                    aria-label="Custom category color"
                    value={catColor}
                    onChange={(e) => setCatColor(e.target.value)}
                    className="h-7 w-9 rounded border border-input bg-transparent cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCatModalMode(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending
                    ? "Saving..."
                    : catModalMode === "edit"
                    ? "Save Changes"
                    : "Create Category"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Merge / Retire / Delete Category Confirmation Modal */}
      {retireCatTarget && (() => {
        const usage = data.usageByCategory?.[retireCatTarget.id] || {
          transactions: 0,
          rules: 0,
          budgets: 0,
        };
        const childCount = childCountsByParent.get(retireCatTarget.id) || 0;
        const replacementOptions = flattenedCategories.filter(
          (c) => c.id !== retireCatTarget.id && c.type === retireCatTarget.type
        );

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cc-animate-overlay">
            <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 cc-animate-modal">
              <div className="flex items-start justify-between border-b pb-3 gap-2">
                <div>
                  <h3 className="text-base font-bold">
                    {retireMode === "merge" ? "Merge & Retire" : "Delete Category"}{" "}
                    &ldquo;{retireCatTarget.name}&rdquo;
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Currently used by {usage.transactions}{" "}
                    {usage.transactions === 1 ? "transaction" : "transactions"},{" "}
                    {usage.rules} {usage.rules === 1 ? "rule" : "rules"}, and{" "}
                    {usage.budgets} budget {usage.budgets === 1 ? "cap" : "caps"}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRetireCatTarget(null)}
                  className="text-muted-foreground hover:text-foreground text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              {retireModalError && (
                <div className="p-3 rounded-lg border bg-destructive/10 border-destructive/30 text-destructive text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{retireModalError}</span>
                </div>
              )}

              <div className="space-y-2.5">
                <div
                  onClick={() => {
                    if (replacementOptions.length > 0) setRetireMode("merge");
                  }}
                  className={`p-3 rounded-lg border text-xs transition-colors space-y-2 ${
                    replacementOptions.length === 0
                      ? "opacity-50 cursor-not-allowed"
                      : retireMode === "merge"
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/30 cursor-pointer"
                  }`}
                >
                  <label
                    htmlFor="retire-mode-merge"
                    className={`flex items-start gap-2.5 ${
                      replacementOptions.length === 0 ? "cursor-not-allowed" : "cursor-pointer"
                    }`}
                  >
                    <input
                      id="retire-mode-merge"
                      type="radio"
                      name="retire-mode"
                      checked={retireMode === "merge"}
                      disabled={replacementOptions.length === 0}
                      onChange={() => setRetireMode("merge")}
                      className="mt-0.5 accent-primary"
                    />
                    <div className="flex-1">
                      <span className="font-semibold block">
                        Merge &amp; Reassign into Replacement Category
                      </span>
                      <span className="text-muted-foreground text-[11px] leading-relaxed block">
                        Reassigns all ledger entries, classification rules, and subscriptions to the chosen replacement so historical charts stay consolidated.
                        {childCount > 0
                          ? ` Any sub-categories (${childCount}) stay nested cleanly.`
                          : ""}
                      </span>
                    </div>
                  </label>
                  {retireMode === "merge" && replacementOptions.length > 0 && (
                    <div className="pl-6">
                      <select
                        id="retire-replacement-select"
                        aria-label="Replacement category"
                        value={replacementCatId}
                        onChange={(e) => setReplacementCatId(e.target.value)}
                        className={SELECT_CLS}
                      >
                        {replacementOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.depth === 1 ? `↳ ${c.displayLabel}` : c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <label
                  htmlFor="retire-mode-delete"
                  className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs cursor-pointer transition-colors ${
                    retireMode === "delete"
                      ? "border-destructive/60 bg-destructive/5"
                      : "hover:bg-muted/30"
                  }`}
                >
                  <input
                    id="retire-mode-delete"
                    type="radio"
                    name="retire-mode"
                    checked={retireMode === "delete"}
                    onChange={() => setRetireMode("delete")}
                    className="mt-0.5 accent-destructive"
                  />
                  <div>
                    <span className="font-semibold block">
                      Delete without Replacement
                    </span>
                    <span className="text-muted-foreground text-[11px] leading-relaxed block">
                      Ledger entries remain intact as <strong>Uncategorized</strong>. Associated rules and budget caps are removed
                      {childCount > 0
                        ? `, and ${childCount} sub-${childCount === 1 ? "category" : "categories"} will become top-level.`
                        : "."}
                    </span>
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRetireCatTarget(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant={retireMode === "merge" ? "default" : "destructive"}
                  size="sm"
                  disabled={isPending}
                  onClick={handleConfirmRetireCategory}
                >
                  {isPending
                    ? retireMode === "merge"
                      ? "Merging..."
                      : "Deleting..."
                    : retireMode === "merge"
                    ? "Confirm Merge"
                    : "Confirm Delete"}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Create / Edit Account Modal */}
      {accModalMode && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cc-animate-overlay">
          <div className="bg-card border rounded-xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 cc-animate-modal">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold">
                  {accModalMode === "edit" ? "Edit Financial Account" : "Add Financial Account"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Configure bank accounts, savings, offset accounts, loans, or superannuation
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAccModalMode(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {accModalError && (
              <div className="p-3 rounded-lg border bg-destructive/10 border-destructive/30 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{accModalError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitAccount} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="acc-name">Account Name</Label>
                  <Input
                    id="acc-name"
                    placeholder="e.g. High-Interest Savings"
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="acc-inst">Institution</Label>
                  <Input
                    id="acc-inst"
                    placeholder="e.g. Macquarie Bank"
                    value={accInstitution}
                    onChange={(e) => setAccInstitution(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="acc-type">Account Type</Label>
                  <select
                    id="acc-type"
                    value={accType}
                    onChange={(e) => {
                      setAccType(e.target.value);
                      if (e.target.value === "offset") setAccIsOffset(true);
                    }}
                    className={SELECT_CLS}
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="acc-last4">Last 4 Digits</Label>
                  <Input
                    id="acc-last4"
                    maxLength={4}
                    placeholder="1234"
                    value={accLast4}
                    onChange={(e) => setAccLast4(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="acc-balance">Current Balance</Label>
                  <Input
                    id="acc-balance"
                    type="number"
                    step="0.01"
                    value={accBalance}
                    onChange={(e) => setAccBalance(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="acc-rate">Interest Rate (%)</Label>
                  <Input
                    id="acc-rate"
                    type="number"
                    step="0.01"
                    min="0"
                    value={accRate}
                    onChange={(e) => setAccRate(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="acc-currency">Currency</Label>
                  <select
                    id="acc-currency"
                    value={accCurrency}
                    onChange={(e) => setAccCurrency(e.target.value)}
                    className={SELECT_CLS}
                  >
                    <option value="AUD">AUD</option>
                    <option value="USD">USD</option>
                    <option value="NZD">NZD</option>
                    <option value="GBP">GBP</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={accIsOffset}
                  onChange={(e) => setAccIsOffset(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span>Mortgage Offset Account (included in liquid savings)</span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAccModalMode(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending
                    ? "Saving..."
                    : accModalMode === "edit"
                    ? "Save Changes"
                    : "Add Account"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {deleteAccTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cc-animate-overlay">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 cc-animate-modal">
            <h3 className="text-base font-bold">
              Delete Account &ldquo;{deleteAccTarget.name}&rdquo;?
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This unused account has no ledger transactions and will be permanently removed.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteAccTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={handleConfirmDeleteAccount}
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
