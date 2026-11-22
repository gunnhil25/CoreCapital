"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCircle2,
  Copy,
  Hash,
  History,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Scissors,
  Search,
  ShieldAlert,
  Split,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  createTransactionAction,
  editTransactionAction,
  getTransactionsPageDataAction,
  reverseTransactionAction,
} from "@/actions/transactions";
import { AuditLogItem, TransactionWithLedger } from "@/lib/store";

type SortKey =
  | "date_desc"
  | "date_asc"
  | "amount_desc"
  | "amount_asc"
  | "description_asc"
  | "description_desc"
  | "account_asc"
  | "category_asc";

type SortColumn = "date" | "description" | "account" | "category" | "amount";

interface TransactionsViewProps {
  initialTransactions: TransactionWithLedger[];
  initialAuditLogs: AuditLogItem[];
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; color: string; type: string }[];
  baseCurrency?: string;
  initialOpenNewModal?: boolean;
  initialTab?: "transactions" | "ledger";
}

interface SplitFormRow {
  categoryId: string;
  amount: string;
  description: string;
}

const SELECT_CLS =
  "w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

function getTodayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

function getPrimaryCategoryName(tx: TransactionWithLedger): string {
  if (tx.isSplit) return `Split (${tx.ledgerEntries.length})`;
  return tx.ledgerEntries[0]?.categoryName || "Uncategorized";
}

function SortIcon({
  column,
  sortBy,
}: {
  column: SortColumn;
  sortBy: SortKey;
}) {
  if (column === "date") {
    if (sortBy === "date_desc") return <ArrowDown className="h-3 w-3 inline ml-1" />;
    if (sortBy === "date_asc") return <ArrowUp className="h-3 w-3 inline ml-1" />;
  } else if (column === "description") {
    if (sortBy === "description_desc") return <ArrowDown className="h-3 w-3 inline ml-1" />;
    if (sortBy === "description_asc") return <ArrowUp className="h-3 w-3 inline ml-1" />;
  } else if (column === "amount") {
    if (sortBy === "amount_desc") return <ArrowDown className="h-3 w-3 inline ml-1" />;
    if (sortBy === "amount_asc") return <ArrowUp className="h-3 w-3 inline ml-1" />;
  } else if (column === "account" && sortBy === "account_asc") {
    return <ArrowUp className="h-3 w-3 inline ml-1" />;
  } else if (column === "category" && sortBy === "category_asc") {
    return <ArrowUp className="h-3 w-3 inline ml-1" />;
  }
  return <ArrowUpDown className="h-3 w-3 inline ml-1 opacity-40" />;
}

export function TransactionsView({
  initialTransactions,
  initialAuditLogs,
  accounts,
  categories,
  baseCurrency = "AUD",
  initialOpenNewModal = false,
  initialTab = "transactions",
}: TransactionsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [transactionsList, setTransactionsList] = useState(initialTransactions);
  const [auditLogs, setAuditLogs] = useState(initialAuditLogs);
  const [activeTab, setActiveTab] = useState<"transactions" | "ledger">(initialTab);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Transactions tab filters & sort
  const [search, setSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedType, setSelectedType] = useState<"all" | "expense" | "income" | "split">(
    "all"
  );
  const [sortBy, setSortBy] = useState<SortKey>("date_desc");

  // Immutable Ledger tab filters & copy state
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerFilter, setLedgerFilter] = useState<"all" | "posted" | "reversals" | "splits">(
    "all"
  );
  const [ledgerAccount, setLedgerAccount] = useState("all");
  const [ledgerOrder, setLedgerOrder] = useState<"newest" | "oldest">("newest");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create / Edit Transaction Modal State
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(
    initialOpenNewModal ? "create" : null
  );
  const [editingTx, setEditingTx] = useState<TransactionWithLedger | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const defaultCat1 = categories[1]?.id || categories[0]?.id || "";
  const defaultCat2 = categories[8]?.id || categories[2]?.id || categories[0]?.id || "";

  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [date, setDate] = useState(getTodayLocalIso);
  const [amount, setAmount] = useState("");
  const [txType, setTxType] = useState<"expense" | "income">("expense");
  const [cleanDescription, setCleanDescription] = useState("");
  const [merchant, setMerchant] = useState("");
  const [notes, setNotes] = useState("");
  const [editReason, setEditReason] = useState("");
  const [categoryId, setCategoryId] = useState(defaultCat1);
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splits, setSplits] = useState<SplitFormRow[]>([
    { categoryId: defaultCat1, amount: "", description: "" },
    { categoryId: defaultCat2, amount: "", description: "" },
  ]);

  // Reversal Modal State
  const [isReversalOpen, setIsReversalOpen] = useState(false);
  const [targetTxForReversal, setTargetTxForReversal] =
    useState<TransactionWithLedger | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  useEffect(() => {
    if (initialOpenNewModal) {
      openCreateModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenNewModal]);

  const fmt = (val: number) => formatCurrency(val, baseCurrency);

  const openCreateModal = () => {
    setModalError(null);
    setEditingTx(null);
    setAccountId(accounts[0]?.id || "");
    setDate(getTodayLocalIso());
    setAmount("");
    setTxType("expense");
    setCleanDescription("");
    setMerchant("");
    setNotes("");
    setEditReason("");
    setCategoryId(defaultCat1);
    setIsSplitMode(false);
    setSplits([
      { categoryId: defaultCat1, amount: "", description: "" },
      { categoryId: defaultCat2, amount: "", description: "" },
    ]);
    setFormMode("create");
  };

  const openEditModal = (tx: TransactionWithLedger) => {
    const amtNum = parseFloat(tx.amount) || 0;
    setModalError(null);
    setEditingTx(tx);
    setAccountId(tx.accountId);
    setDate(tx.date);
    setAmount(Math.abs(amtNum).toFixed(2));
    setTxType(amtNum >= 0 ? "income" : "expense");
    setCleanDescription(tx.cleanDescription);
    setMerchant(tx.merchant || "");
    setNotes(tx.notes || "");
    setEditReason("");

    if (tx.isSplit && tx.ledgerEntries.length >= 2) {
      setIsSplitMode(true);
      setCategoryId(tx.ledgerEntries[0]?.categoryId || defaultCat1);
      setSplits(
        tx.ledgerEntries.map((le) => ({
          categoryId: le.categoryId || defaultCat1,
          amount: parseFloat(le.amount).toFixed(2),
          description: le.description || "",
        }))
      );
    } else {
      setIsSplitMode(false);
      setCategoryId(tx.ledgerEntries[0]?.categoryId || defaultCat1);
      setSplits([
        { categoryId: defaultCat1, amount: "", description: "" },
        { categoryId: defaultCat2, amount: "", description: "" },
      ]);
    }
    setFormMode("edit");
  };

  const refreshPageData = async () => {
    const fresh = await getTransactionsPageDataAction();
    setTransactionsList(fresh.transactions);
    setAuditLogs(fresh.auditLogs);
    router.refresh();
  };

  // Active Transactions (never polluted with reversed originals or reversal entries)
  const activeTransactions = useMemo(
    () => transactionsList.filter((tx) => tx.status === "posted" && !tx.isReversal),
    [transactionsList]
  );

  const filteredActiveTransactions = useMemo(() => {
    const list = activeTransactions.filter((tx) => {
      if (selectedAccount !== "all" && tx.accountId !== selectedAccount) return false;
      if (
        selectedCategory !== "all" &&
        !tx.ledgerEntries.some((le) => le.categoryId === selectedCategory)
      ) {
        return false;
      }

      const amt = parseFloat(tx.amount) || 0;
      if (selectedType === "expense" && amt >= 0) return false;
      if (selectedType === "income" && amt <= 0) return false;
      if (selectedType === "split" && !tx.isSplit) return false;

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesDesc = tx.cleanDescription.toLowerCase().includes(q);
        const matchesRaw = tx.rawDescription.toLowerCase().includes(q);
        const matchesMerchant = tx.merchant?.toLowerCase().includes(q) || false;
        const matchesNotes = tx.notes?.toLowerCase().includes(q) || false;
        const matchesCat = tx.ledgerEntries.some((le) =>
          (le.categoryName || "").toLowerCase().includes(q)
        );
        const matchesAmt = tx.amount.toLowerCase().includes(q);
        if (
          !matchesDesc &&
          !matchesRaw &&
          !matchesMerchant &&
          !matchesNotes &&
          !matchesCat &&
          !matchesAmt
        ) {
          return false;
        }
      }
      return true;
    });

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case "date_asc":
          return a.date !== b.date
            ? a.date.localeCompare(b.date)
            : a.createdAt.localeCompare(b.createdAt);
        case "date_desc":
          return a.date !== b.date
            ? b.date.localeCompare(a.date)
            : b.createdAt.localeCompare(a.createdAt);
        case "amount_desc":
          return (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0);
        case "amount_asc":
          return (parseFloat(a.amount) || 0) - (parseFloat(b.amount) || 0);
        case "description_asc":
          return a.cleanDescription.localeCompare(b.cleanDescription);
        case "description_desc":
          return b.cleanDescription.localeCompare(a.cleanDescription);
        case "account_asc":
          return (a.accountName || "").localeCompare(b.accountName || "");
        case "category_asc":
          return getPrimaryCategoryName(a).localeCompare(getPrimaryCategoryName(b));
        default:
          return 0;
      }
    });
  }, [
    activeTransactions,
    selectedAccount,
    selectedCategory,
    selectedType,
    search,
    sortBy,
  ]);

  const activeTotals = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const tx of filteredActiveTransactions) {
      const amt = parseFloat(tx.amount) || 0;
      if (amt > 0) inflow += amt;
      else outflow += Math.abs(amt);
    }
    return {
      count: filteredActiveTransactions.length,
      inflow: Math.round(inflow * 100) / 100,
      outflow: Math.round(outflow * 100) / 100,
      net: Math.round((inflow - outflow) * 100) / 100,
    };
  }, [filteredActiveTransactions]);

  // Ledger Lookups & Timeline Filter
  const { txById, reversalByOriginalId, editedTxIds, ledgerStats } = useMemo(() => {
    const byId = new Map<string, TransactionWithLedger>();
    const revByOrig = new Map<string, TransactionWithLedger>();
    let postedCount = 0;
    let reversedCount = 0;
    let reversalEntryCount = 0;

    for (const tx of transactionsList) {
      byId.set(tx.id, tx);
      if (tx.isReversal) {
        reversalEntryCount += 1;
        if (tx.reversesTransactionId) {
          revByOrig.set(tx.reversesTransactionId, tx);
        }
      } else if (tx.status === "reversed") {
        reversedCount += 1;
      } else if (tx.status === "posted") {
        postedCount += 1;
      }
    }

    const editedIds = new Set(
      auditLogs.filter((l) => l.action === "EDIT").map((l) => l.entityId.toLowerCase())
    );

    return {
      txById: byId,
      reversalByOriginalId: revByOrig,
      editedTxIds: editedIds,
      ledgerStats: {
        total: transactionsList.length,
        posted: postedCount,
        reversed: reversedCount,
        reversals: reversalEntryCount,
      },
    };
  }, [transactionsList, auditLogs]);

  const filteredLedgerRecords = useMemo(() => {
    const list = transactionsList.filter((tx) => {
      if (ledgerAccount !== "all" && tx.accountId !== ledgerAccount) return false;
      if (ledgerFilter === "posted" && (tx.status !== "posted" || tx.isReversal)) {
        return false;
      }
      if (ledgerFilter === "reversals" && !tx.isReversal && tx.status !== "reversed") {
        return false;
      }
      if (ledgerFilter === "splits" && !tx.isSplit) return false;

      if (ledgerSearch.trim()) {
        const q = ledgerSearch.trim().toLowerCase();
        const linkedRev = reversalByOriginalId.get(tx.id);
        const linkedOrig = tx.reversesTransactionId
          ? txById.get(tx.reversesTransactionId)
          : undefined;
        const fields = [
          tx.id,
          tx.deduplicationHash || "",
          tx.cleanDescription,
          tx.rawDescription,
          tx.merchant || "",
          tx.accountName || "",
          tx.reversalReason || "",
          tx.reversesTransactionId || "",
          linkedRev?.id || "",
          linkedRev?.deduplicationHash || "",
          linkedOrig?.deduplicationHash || "",
        ];
        if (!fields.some((f) => f.toLowerCase().includes(q))) {
          return false;
        }
      }
      return true;
    });

    return [...list].sort((a, b) => {
      const cmp = a.createdAt.localeCompare(b.createdAt);
      return ledgerOrder === "newest" ? -cmp : cmp;
    });
  }, [
    transactionsList,
    ledgerAccount,
    ledgerFilter,
    ledgerSearch,
    ledgerOrder,
    reversalByOriginalId,
    txById,
  ]);

  const handleHeaderSort = (column: SortColumn) => {
    if (column === "date") {
      setSortBy((prev) => (prev === "date_desc" ? "date_asc" : "date_desc"));
    } else if (column === "description") {
      setSortBy((prev) =>
        prev === "description_asc" ? "description_desc" : "description_asc"
      );
    } else if (column === "amount") {
      setSortBy((prev) => (prev === "amount_desc" ? "amount_asc" : "amount_desc"));
    } else if (column === "account") {
      setSortBy("account_asc");
    } else if (column === "category") {
      setSortBy("category_asc");
    }
  };

  const totalSplitSum = splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  const parsedTotalAmount = parseFloat(amount) || 0;
  const isSplitBalanced = Math.abs(totalSplitSum - parsedTotalAmount) < 0.01;

  const handleAddSplitRow = () => {
    setSplits([...splits, { categoryId: defaultCat1, amount: "", description: "" }]);
  };

  const handleRemoveSplitRow = (index: number) => {
    if (splits.length > 2) {
      setSplits(splits.filter((_, i) => i !== index));
    }
  };

  const handleCopyHash = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(key);
      setTimeout(() => {
        setCopiedId((prev) => (prev === key ? null : prev));
      }, 1800);
    } catch {
      // Clipboard may be unavailable in non-HTTPS contexts
    }
  };

  const handleSubmitTransactionForm = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setActionMessage(null);

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setModalError("Please specify a valid positive amount.");
      return;
    }
    if (!cleanDescription.trim()) {
      setModalError("Please enter a description or merchant name.");
      return;
    }

    const effectiveAmount = txType === "expense" ? -Math.abs(numAmount) : Math.abs(numAmount);

    if (isSplitMode) {
      if (splits.length < 2) {
        setModalError("Split transactions require at least 2 split rows.");
        return;
      }
      if (!isSplitBalanced) {
        setModalError(
          `Split rows total (${fmt(totalSplitSum)}) must equal transaction amount (${fmt(
            parsedTotalAmount
          )}).`
        );
        return;
      }
    }

    const splitPayload = isSplitMode
      ? splits.map((s) => ({
          categoryId: s.categoryId,
          amount: parseFloat(s.amount) || 0,
          description: s.description || cleanDescription,
        }))
      : undefined;

    startTransition(async () => {
      if (formMode === "edit" && editingTx) {
        const res = await editTransactionAction({
          transactionId: editingTx.id,
          accountId,
          date,
          amount: effectiveAmount,
          cleanDescription,
          merchant,
          categoryId: isSplitMode ? undefined : categoryId,
          isSplit: isSplitMode,
          splits: splitPayload,
          notes,
          editReason,
        });

        if (res.success) {
          await refreshPageData();
          setFormMode(null);
          setEditingTx(null);
          setActionMessage({
            type: "success",
            text: `Transaction updated. An offsetting reversal and replacement entry were recorded in the Immutable Ledger.`,
          });
        } else {
          setModalError(res.error || "Failed to edit transaction.");
        }
        return;
      }

      const res = await createTransactionAction({
        accountId,
        date,
        amount: effectiveAmount,
        cleanDescription,
        merchant,
        categoryId: isSplitMode ? undefined : categoryId,
        isSplit: isSplitMode,
        splits: splitPayload,
        notes,
      });

      if (res.success && res.transaction) {
        await refreshPageData();
        setFormMode(null);
        setActionMessage({
          type: "success",
          text: "Transaction logged to ledger.",
        });
      } else {
        setModalError(res.error || "Failed to create transaction.");
      }
    });
  };

  const handleExecuteReversal = () => {
    if (!targetTxForReversal) return;
    setActionMessage(null);

    startTransition(async () => {
      const res = await reverseTransactionAction(targetTxForReversal.id, reversalReason);
      if (res.success && res.reversalTransaction) {
        await refreshPageData();
        setIsReversalOpen(false);
        setTargetTxForReversal(null);
        setReversalReason("");
        setActionMessage({
          type: "success",
          text: `Transaction reversed and moved to Immutable Ledger history (Reversal Hash: ${res.reversalTransaction.deduplicationHash?.slice(
            0,
            12
          )}...).`,
        });
      } else {
        setActionMessage({
          type: "error",
          text: res.error || "Failed to reverse transaction.",
        });
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Transactions & Immutable Ledger
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Clean active transactions workspace separated from the tamper-evident double-entry audit timeline
          </p>
        </div>
        <Button onClick={openCreateModal} className="gap-1.5 shadow-sm">
          <Plus className="h-4 w-4" />
          Log Transaction
        </Button>
      </div>

      {/* Action Notification Alert */}
      {actionMessage && (
        <div
          className={`p-3.5 rounded-lg border text-xs sm:text-sm flex items-center justify-between ${
            actionMessage.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Separated Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(val) =>
          setActiveTab(val === "ledger" ? "ledger" : "transactions")
        }
        className="space-y-4"
      >
        <TabsList className="bg-muted/60 p-1">
          <TabsTrigger value="transactions" className="text-xs gap-2">
            <Receipt className="h-3.5 w-3.5" />
            <span>Transactions</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
              {activeTransactions.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="ledger" className="text-xs gap-2">
            <History className="h-3.5 w-3.5" />
            <span>Immutable Ledger</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
              {transactionsList.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* TAB 1: ACTIVE TRANSACTIONS (Search, Filter, Sort, Edit, Reverse) */}
        {/* ================================================================ */}
        <TabsContent value="transactions" className="space-y-4">
          {/* Active Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">
                  Active Transactions
                </span>
                <span className="text-lg font-bold font-mono">{activeTotals.count}</span>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">Total Inflow</span>
                <span className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  +{fmt(activeTotals.inflow)}
                </span>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">Total Outflow</span>
                <span className="text-lg font-bold font-mono text-foreground">
                  -{fmt(activeTotals.outflow)}
                </span>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">Net Cash Flow</span>
                <span
                  className={`text-lg font-bold font-mono ${
                    activeTotals.net >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {activeTotals.net >= 0 ? `+${fmt(activeTotals.net)}` : fmt(activeTotals.net)}
                </span>
              </CardContent>
            </Card>
          </div>

          {/* Search, Filter & Sort Controls */}
          <Card className="border-border/60">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Search description, merchant, notes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-9 text-xs"
                  />
                </div>

                <select
                  aria-label="Filter transactions by account"
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className={SELECT_CLS}
                >
                  <option value="all">All Accounts</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter transactions by category"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className={SELECT_CLS}
                >
                  <option value="all">All Categories</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter transactions by type"
                  value={selectedType}
                  onChange={(e) =>
                    setSelectedType(
                      e.target.value as "all" | "expense" | "income" | "split"
                    )
                  }
                  className={SELECT_CLS}
                >
                  <option value="all">All Types</option>
                  <option value="expense">Expenses Only</option>
                  <option value="income">Income Only</option>
                  <option value="split">Split Only</option>
                </select>

                <select
                  aria-label="Sort transactions"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  className={SELECT_CLS}
                >
                  <option value="date_desc">Sort: Date (Newest)</option>
                  <option value="date_asc">Sort: Date (Oldest)</option>
                  <option value="amount_desc">Sort: Amount (High to Low)</option>
                  <option value="amount_asc">Sort: Amount (Low to High)</option>
                  <option value="description_asc">Sort: Description (A–Z)</option>
                  <option value="description_desc">Sort: Description (Z–A)</option>
                  <option value="account_asc">Sort: Account (A–Z)</option>
                  <option value="category_asc">Sort: Category (A–Z)</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Clean Active Transactions Table */}
          <Card className="border-border/60 overflow-hidden">
            <CardHeader className="p-4 pb-2 border-b bg-muted/20 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Active Transactions</CardTitle>
                <CardDescription className="text-xs">
                  Showing {filteredActiveTransactions.length} active entries (reversals & audit history live on the Immutable Ledger tab)
                </CardDescription>
              </div>
              <Badge variant="success" className="text-[10px] font-mono">
                Posted Only
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => handleHeaderSort("date")}
                        className="inline-flex items-center hover:text-foreground transition-colors"
                      >
                        Date
                        <SortIcon column="date" sortBy={sortBy} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => handleHeaderSort("description")}
                        className="inline-flex items-center hover:text-foreground transition-colors"
                      >
                        Description / Merchant
                        <SortIcon column="description" sortBy={sortBy} />
                      </button>
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      <button
                        type="button"
                        onClick={() => handleHeaderSort("account")}
                        className="inline-flex items-center hover:text-foreground transition-colors"
                      >
                        Account
                        <SortIcon column="account" sortBy={sortBy} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => handleHeaderSort("category")}
                        className="inline-flex items-center hover:text-foreground transition-colors"
                      >
                        Category / Splits
                        <SortIcon column="category" sortBy={sortBy} />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button
                        type="button"
                        onClick={() => handleHeaderSort("amount")}
                        className="inline-flex items-center justify-end hover:text-foreground transition-colors"
                      >
                        Amount
                        <SortIcon column="amount" sortBy={sortBy} />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredActiveTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-32 text-center text-muted-foreground text-xs"
                      >
                        No active transactions match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredActiveTransactions.map((tx) => {
                      const amtNum = parseFloat(tx.amount) || 0;
                      const isNegative = amtNum < 0;
                      const isAmended = editedTxIds.has(tx.id.toLowerCase());
                      return (
                        <TableRow key={tx.id}>
                          <TableCell className="font-mono text-xs whitespace-nowrap">
                            {formatDate(tx.date)}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-xs sm:text-sm flex items-center gap-1.5 flex-wrap">
                              <span>{tx.cleanDescription}</span>
                              {isAmended && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1 py-0 border-indigo-500/40 text-indigo-500"
                                >
                                  Edited
                                </Badge>
                              )}
                            </div>
                            {tx.merchant && (
                              <div className="text-[11px] text-muted-foreground">
                                {tx.merchant}
                              </div>
                            )}
                            {tx.notes && (
                              <div className="text-[10px] text-muted-foreground/80 italic truncate max-w-[260px]">
                                {tx.notes}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {tx.accountName || "Account"}
                          </TableCell>
                          <TableCell>
                            {tx.isSplit ? (
                              <div className="space-y-1">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] gap-1 px-1.5 py-0 border-sky-500/40 text-sky-500"
                                >
                                  <Split className="h-3 w-3" />
                                  Split ({tx.ledgerEntries.length})
                                </Badge>
                                <div className="text-[11px] text-muted-foreground space-y-0.5">
                                  {tx.ledgerEntries.map((le) => (
                                    <div key={le.id} className="flex items-center gap-1">
                                      <span
                                        className="h-1.5 w-1.5 rounded-full inline-block"
                                        style={{
                                          backgroundColor: le.categoryColor || "#64748b",
                                        }}
                                      />
                                      <span>{le.categoryName}:</span>
                                      <span className="font-mono">
                                        {fmt(parseFloat(le.amount))}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="h-2 w-2 rounded-full inline-block"
                                  style={{
                                    backgroundColor:
                                      tx.ledgerEntries[0]?.categoryColor || "#64748b",
                                  }}
                                />
                                <span className="text-xs">
                                  {tx.ledgerEntries[0]?.categoryName || "Uncategorized"}
                                </span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-xs sm:text-sm whitespace-nowrap">
                            <span
                              className={
                                isNegative
                                  ? "text-foreground"
                                  : "text-emerald-600 dark:text-emerald-400"
                              }
                            >
                              {isNegative ? fmt(amtNum) : `+${fmt(amtNum)}`}
                            </span>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                                onClick={() => openEditModal(tx)}
                              >
                                <Pencil className="h-3 w-3 mr-1" />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  setTargetTxForReversal(tx);
                                  setReversalReason("");
                                  setIsReversalOpen(true);
                                }}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                Reverse
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 2: IMMUTABLE LEDGER TIMELINE (All Activities & Hash IDs)      */}
        {/* ================================================================ */}
        <TabsContent value="ledger" className="space-y-4">
          {/* Ledger KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">
                  Total Ledger Records
                </span>
                <span className="text-lg font-bold font-mono">{ledgerStats.total}</span>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">Active Posted</span>
                <span className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  {ledgerStats.posted}
                </span>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">
                  Reversed Originals
                </span>
                <span className="text-lg font-bold font-mono text-rose-500">
                  {ledgerStats.reversed}
                </span>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-3.5">
                <span className="text-[11px] text-muted-foreground block">
                  Reversal Entries
                </span>
                <span className="text-lg font-bold font-mono text-sky-500">
                  {ledgerStats.reversals}
                </span>
              </CardContent>
            </Card>
          </div>

          {/* Ledger Filter Bar */}
          <Card className="border-border/60">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Search SHA-256 hash ID, TX ID, reason..."
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    className="pl-9 h-9 text-xs font-mono"
                  />
                </div>

                <select
                  aria-label="Filter immutable ledger by activity type"
                  value={ledgerFilter}
                  onChange={(e) =>
                    setLedgerFilter(
                      e.target.value as "all" | "posted" | "reversals" | "splits"
                    )
                  }
                  className={SELECT_CLS}
                >
                  <option value="all">All Ledger Activity</option>
                  <option value="posted">Active Posted Only</option>
                  <option value="reversals">Reversed & Reversal Entries</option>
                  <option value="splits">Split Ledger Entries</option>
                </select>

                <select
                  aria-label="Filter immutable ledger by account"
                  value={ledgerAccount}
                  onChange={(e) => setLedgerAccount(e.target.value)}
                  className={SELECT_CLS}
                >
                  <option value="all">All Accounts</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Sort immutable ledger timeline"
                  value={ledgerOrder}
                  onChange={(e) =>
                    setLedgerOrder(e.target.value === "oldest" ? "oldest" : "newest")
                  }
                  className={SELECT_CLS}
                >
                  <option value="newest">Timeline: Newest First</option>
                  <option value="oldest">Timeline: Oldest First</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Chronological Immutable Audit Timeline */}
          <Card className="border-border/60">
            <CardHeader className="p-4 pb-3 border-b bg-muted/20 flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Hash className="h-4 w-4 text-sky-500" />
                  Immutable Double-Entry Timeline
                </CardTitle>
                <CardDescription className="text-xs">
                  Append-only chronological audit trail of all posted entries, edits, reversals, and SHA-256 hash IDs
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                {filteredLedgerRecords.length} Records
              </Badge>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              {filteredLedgerRecords.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                  No immutable ledger records match your search or filter.
                </div>
              ) : (
                <div className="relative pl-6 sm:pl-8 space-y-4 before:content-[''] before:absolute before:left-[9px] sm:before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-border">
                  {filteredLedgerRecords.map((tx) => {
                    const amtNum = parseFloat(tx.amount) || 0;
                    const isAmended = editedTxIds.has(tx.id.toLowerCase());
                    const linkedReversal = reversalByOriginalId.get(tx.id);
                    const linkedOriginal = tx.reversesTransactionId
                      ? txById.get(tx.reversesTransactionId)
                      : undefined;
                    const hashId = tx.deduplicationHash || "";

                    const dotColor = tx.isReversal
                      ? "bg-sky-500 ring-sky-500/20"
                      : tx.status === "reversed"
                      ? "bg-rose-500 ring-rose-500/20"
                      : isAmended
                      ? "bg-indigo-500 ring-indigo-500/20"
                      : "bg-emerald-500 ring-emerald-500/20";

                    return (
                      <div key={tx.id} className="relative">
                        {/* Timeline Node */}
                        <span
                          className={`absolute -left-6 sm:-left-8 top-4 h-4 w-4 sm:h-5 sm:w-5 rounded-full ring-4 border-2 border-background ${dotColor}`}
                        />

                        <div
                          className={`rounded-xl border p-4 space-y-3 transition-colors ${
                            tx.isReversal
                              ? "bg-sky-500/5 border-sky-500/30"
                              : tx.status === "reversed"
                              ? "bg-muted/30 border-rose-500/25 opacity-90"
                              : "bg-card border-border/70"
                          }`}
                        >
                          {/* Top Row: Badges, Timestamps, Amount */}
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {tx.status === "reversed" ? (
                                  <Badge
                                    variant="destructive"
                                    className="text-[10px] py-0 font-mono"
                                  >
                                    REVERSED
                                  </Badge>
                                ) : tx.isReversal ? (
                                  <Badge variant="info" className="text-[10px] py-0 font-mono">
                                    REVERSAL ENTRY
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="success"
                                    className="text-[10px] py-0 font-mono"
                                  >
                                    POSTED
                                  </Badge>
                                )}
                                {isAmended && !tx.isReversal && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] py-0 font-mono border-indigo-500/40 text-indigo-500"
                                  >
                                    AMENDED
                                  </Badge>
                                )}
                                {tx.isSplit && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] py-0 font-mono border-sky-500/40 text-sky-500 gap-1"
                                  >
                                    <Split className="h-2.5 w-2.5" />
                                    SPLIT ({tx.ledgerEntries.length})
                                  </Badge>
                                )}
                                <span className="text-[11px] text-muted-foreground font-mono">
                                  Logged {formatTimestamp(tx.createdAt)} • Effective{" "}
                                  {formatDate(tx.date)}
                                </span>
                              </div>

                              <p className="font-semibold text-sm text-foreground break-words">
                                {tx.cleanDescription}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {tx.accountName || "Account"}
                                {tx.merchant ? ` • ${tx.merchant}` : ""}
                              </p>
                            </div>

                            <div className="sm:text-right shrink-0">
                              <p
                                className={`font-mono font-bold text-base ${
                                  tx.isReversal
                                    ? "text-sky-500"
                                    : amtNum >= 0
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-foreground"
                                }`}
                              >
                                {amtNum >= 0 ? `+${fmt(amtNum)}` : fmt(amtNum)}
                              </p>
                            </div>
                          </div>

                          {/* Reversal Cross-References */}
                          {tx.isReversal && tx.reversesTransactionId && (
                            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px] space-y-1">
                              <div className="font-medium text-amber-700 dark:text-amber-300">
                                Reason: {tx.reversalReason || "Reversal"}
                              </div>
                              <div className="font-mono text-muted-foreground break-all">
                                Offsets Original TX:{" "}
                                <span className="text-foreground">{tx.reversesTransactionId}</span>
                              </div>
                              {linkedOriginal?.deduplicationHash && (
                                <div className="font-mono text-muted-foreground break-all">
                                  Original Hash:{" "}
                                  <span className="text-foreground">
                                    {linkedOriginal.deduplicationHash}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {tx.status === "reversed" && linkedReversal && (
                            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[11px] space-y-1">
                              <div className="font-medium text-rose-700 dark:text-rose-300">
                                Superseded by Reversal ({linkedReversal.reversalReason || "Reversed"})
                              </div>
                              <div className="font-mono text-muted-foreground break-all">
                                Offset by TX:{" "}
                                <span className="text-foreground">{linkedReversal.id}</span>
                              </div>
                              {linkedReversal.deduplicationHash && (
                                <div className="font-mono text-muted-foreground break-all">
                                  Reversal Hash:{" "}
                                  <span className="text-foreground">
                                    {linkedReversal.deduplicationHash}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Double-Entry Ledger Legs */}
                          <div className="rounded-lg border bg-muted/20 p-2.5 space-y-1 text-[11px]">
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                              Double-Entry Ledger Legs ({tx.ledgerEntries.length})
                            </span>
                            <div className="space-y-1">
                              {tx.ledgerEntries.map((le) => (
                                <div
                                  key={le.id}
                                  className="flex items-center justify-between gap-2 font-mono"
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] px-1 py-0 uppercase shrink-0"
                                    >
                                      {le.entryType}
                                    </Badge>
                                    <span
                                      className="h-2 w-2 rounded-full shrink-0"
                                      style={{
                                        backgroundColor: le.categoryColor || "#64748b",
                                      }}
                                    />
                                    <span className="font-sans truncate">
                                      {le.categoryName || "Uncategorized"}
                                    </span>
                                    {le.description && (
                                      <span className="font-sans text-muted-foreground truncate hidden sm:inline">
                                        — {le.description}
                                      </span>
                                    )}
                                  </div>
                                  <span className="font-semibold shrink-0">
                                    {fmt(parseFloat(le.amount))}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Cryptographic Hash ID & Record UUID Footer */}
                          <div className="pt-2 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-mono text-muted-foreground">
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex items-center gap-1.5 break-all">
                                <span className="text-[10px] uppercase font-sans font-semibold text-foreground/70 shrink-0">
                                  Hash ID:
                                </span>
                                <span className="text-foreground/90">{hashId}</span>
                              </div>
                              <div className="flex items-center gap-1.5 break-all">
                                <span className="text-[10px] uppercase font-sans font-semibold text-foreground/70 shrink-0">
                                  Record UUID:
                                </span>
                                <span>{tx.id}</span>
                              </div>
                            </div>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 text-[10px] gap-1 shrink-0 self-start sm:self-center"
                              onClick={() => handleCopyHash(tx.id, hashId)}
                            >
                              {copiedId === tx.id ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-500" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  Copy Hash
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create / Edit Transaction Modal */}
      {formMode && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold">
                  {formMode === "edit" ? "Edit Transaction" : "Log Transaction"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {formMode === "edit"
                    ? "Updates your active transaction while preserving immutable audit history"
                    : "Direct ledger insertion with split transaction support"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFormMode(null);
                  setEditingTx(null);
                }}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {formMode === "edit" && (
              <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/25 text-[11px] text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Immutable Edit Guarantee:</strong>{" "}
                Saving changes automatically posts an offsetting reversal for the previous entry and records your updated entry in the{" "}
                <strong>Immutable Ledger</strong> with a complete audit trail.
              </div>
            )}

            {modalError && (
              <div className="p-3 rounded-lg border bg-destructive/10 border-destructive/30 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitTransactionForm} className="space-y-4">
              {/* Type Switcher */}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={txType === "expense" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTxType("expense")}
                  className="flex-1 text-xs"
                >
                  Expense / Debit
                </Button>
                <Button
                  type="button"
                  variant={txType === "income" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTxType("income")}
                  className="flex-1 text-xs"
                >
                  Income / Credit
                </Button>
              </div>

              {/* Account and Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Target Account</Label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className={SELECT_CLS}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>
              </div>

              {/* Amount and Description */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Total Amount ({baseCurrency})</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="150.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Input
                    placeholder="e.g. Woolworths Adelaide"
                    value={cleanDescription}
                    onChange={(e) => setCleanDescription(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                </div>
              </div>

              {/* Merchant & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Merchant (optional)</Label>
                  <Input
                    placeholder="e.g. Woolworths"
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Notes (optional)</Label>
                  <Input
                    placeholder="Optional memo"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              {/* Split Toggle */}
              <div className="pt-2 border-t flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scissors className="h-4 w-4 text-sky-500" />
                  <span className="text-xs font-semibold">Split Transaction</span>
                </div>
                <Button
                  type="button"
                  variant={isSplitMode ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setIsSplitMode(!isSplitMode)}
                  className="text-xs h-7"
                >
                  {isSplitMode ? "Enabled" : "Disabled"}
                </Button>
              </div>

              {/* Single Category Selector or Split Items */}
              {!isSplitMode ? (
                <div className="space-y-1">
                  <Label>Category</Label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className={SELECT_CLS}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3 bg-muted/30 p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Split Breakdown</span>
                    <span
                      className={`text-xs font-mono ${
                        isSplitBalanced ? "text-emerald-500" : "text-destructive font-bold"
                      }`}
                    >
                      Allocated: {fmt(totalSplitSum)} / {fmt(parsedTotalAmount)}
                    </span>
                  </div>

                  {splits.map((split, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select
                        aria-label={`Category for split item ${idx + 1}`}
                        value={split.categoryId}
                        onChange={(e) => {
                          const next = [...splits];
                          next[idx].categoryId = e.target.value;
                          setSplits(next);
                        }}
                        className="flex-1 h-8 rounded border border-input bg-background text-foreground px-2 text-xs"
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Amount"
                        value={split.amount}
                        onChange={(e) => {
                          const next = [...splits];
                          next[idx].amount = e.target.value;
                          setSplits(next);
                        }}
                        className="w-24 h-8 text-xs font-mono"
                      />
                      <Input
                        placeholder="Note (opt)"
                        value={split.description}
                        onChange={(e) => {
                          const next = [...splits];
                          next[idx].description = e.target.value;
                          setSplits(next);
                        }}
                        className="w-28 h-8 text-xs"
                      />
                      {splits.length > 2 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveSplitRow(idx)}
                          className="text-muted-foreground hover:text-destructive text-xs px-1"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddSplitRow}
                    className="w-full text-xs h-7"
                  >
                    + Add Another Split
                  </Button>
                </div>
              )}

              {formMode === "edit" && (
                <div className="space-y-1">
                  <Label>Audit Note (optional)</Label>
                  <Input
                    placeholder="e.g. Corrected category and receipt amount"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              )}

              {/* Form Action Buttons */}
              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFormMode(null);
                    setEditingTx(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending || (isSplitMode && !isSplitBalanced)}
                >
                  {isPending
                    ? "Committing..."
                    : formMode === "edit"
                    ? "Save Changes to Ledger"
                    : "Commit to Ledger"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Immutable Reversal Modal */}
      {isReversalOpen && targetTxForReversal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-amber-500">
              <ShieldAlert className="h-5 w-5 shrink-0" />
              <h3 className="text-base font-bold text-foreground">
                Confirm Transaction Reversal
              </h3>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              In accordance with <strong>Immutable Ledger principles</strong>, this entry will move out of your active Transactions list while an offsetting reversing entry and audit hash are permanently preserved in the <strong>Immutable Ledger</strong> tab.
            </p>

            <div className="p-3 rounded-lg bg-muted/40 border text-xs space-y-1 font-mono break-all">
              <div>TX UUID: {targetTxForReversal.id}</div>
              {targetTxForReversal.deduplicationHash && (
                <div>Hash ID: {targetTxForReversal.deduplicationHash}</div>
              )}
              <div>Merchant: {targetTxForReversal.cleanDescription}</div>
              <div>Amount: {fmt(parseFloat(targetTxForReversal.amount))}</div>
            </div>

            <div className="space-y-1">
              <Label>Reversal Reason (Mandatory Audit Requirement)</Label>
              <Input
                placeholder="e.g. Duplicate receipt entry / Bank refund"
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                className="h-9 text-xs"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsReversalOpen(false);
                  setTargetTxForReversal(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPending || reversalReason.trim().length < 3}
                onClick={handleExecuteReversal}
              >
                {isPending ? "Executing..." : "Post Reversing Entry"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
