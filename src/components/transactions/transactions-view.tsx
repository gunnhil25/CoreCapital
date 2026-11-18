"use client";

import { useState, useTransition, useEffect } from "react";
import {
  Receipt,
  Plus,
  RotateCcw,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Scissors,
  Split,
  ChevronDown,
  Layers,
  ShieldAlert,
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
  createTransactionAction,
  reverseTransactionAction,
} from "@/actions/transactions";
import { TransactionWithLedger } from "@/lib/store";

interface TransactionsViewProps {
  initialTransactions: TransactionWithLedger[];
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; color: string; type: string }[];
  initialOpenNewModal?: boolean;
}

export function TransactionsView({
  initialTransactions,
  accounts,
  categories,
  initialOpenNewModal = false,
}: TransactionsViewProps) {
  const [transactionsList, setTransactionsList] = useState(initialTransactions);
  const [search, setSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  // Modal states
  const [isNewTxOpen, setIsNewTxOpen] = useState(Boolean(initialOpenNewModal));

  useEffect(() => {
    if (initialOpenNewModal) {
      setIsNewTxOpen(true);
    }
  }, [initialOpenNewModal]);
  const [isReversalOpen, setIsReversalOpen] = useState(false);
  const [targetTxForReversal, setTargetTxForReversal] = useState<TransactionWithLedger | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  // Form states for New Transaction
  const [isPending, startTransition] = useTransition();
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [cleanDescription, setCleanDescription] = useState("");
  const [categoryId, setCategoryId] = useState(categories[1]?.id || "");

  // Split transaction states
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splits, setSplits] = useState<Array<{ categoryId: string; amount: string; description: string }>>([
    { categoryId: categories[1]?.id || "", amount: "", description: "" },
    { categoryId: categories[8]?.id || categories[2]?.id || "", amount: "", description: "" },
  ]);

  // Handle Search & Filter logic
  const filteredTransactions = transactionsList.filter((tx) => {
    if (selectedAccount !== "all" && tx.accountId !== selectedAccount) return false;
    if (selectedStatus !== "all" && tx.status !== selectedStatus) return false;
    if (
      selectedCategory !== "all" &&
      !tx.ledgerEntries.some((le) => le.categoryId === selectedCategory)
    ) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchesDesc = tx.cleanDescription.toLowerCase().includes(q);
      const matchesRaw = tx.rawDescription.toLowerCase().includes(q);
      const matchesMerchant = tx.merchant?.toLowerCase().includes(q);
      if (!matchesDesc && !matchesRaw && !matchesMerchant) return false;
    }
    return true;
  });

  const totalSplitSum = splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  const parsedTotalAmount = parseFloat(amount) || 0;
  const isSplitBalanced = Math.abs(totalSplitSum - parsedTotalAmount) < 0.01;

  const handleAddSplitRow = () => {
    setSplits([...splits, { categoryId: categories[0]?.id || "", amount: "", description: "" }]);
  };

  const handleRemoveSplitRow = (index: number) => {
    if (splits.length > 2) {
      setSplits(splits.filter((_, i) => i !== index));
    }
  };

  const handleCreateTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    setActionMessage(null);

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setActionMessage({ type: "error", text: "Please specify a valid positive amount." });
      return;
    }

    const effectiveAmount = type === "expense" ? -Math.abs(numAmount) : Math.abs(numAmount);

    if (isSplitMode && !isSplitBalanced) {
      setActionMessage({
        type: "error",
        text: `Split rows total ($${totalSplitSum.toFixed(2)}) must exactly equal transaction amount ($${parsedTotalAmount.toFixed(2)}).`,
      });
      return;
    }

    startTransition(async () => {
      const res = await createTransactionAction({
        accountId,
        date,
        amount: effectiveAmount,
        cleanDescription,
        categoryId: isSplitMode ? undefined : categoryId,
        isSplit: isSplitMode,
        splits: isSplitMode
          ? splits.map((s) => ({
              categoryId: s.categoryId,
              amount: parseFloat(s.amount) || 0,
              description: s.description || cleanDescription,
            }))
          : undefined,
      });

      if (res.success && res.transaction) {
        setTransactionsList([res.transaction, ...transactionsList]);
        setIsNewTxOpen(false);
        setAmount("");
        setCleanDescription("");
        setIsSplitMode(false);
        setActionMessage({ type: "success", text: "Transaction successfully logged to ledger!" });
      } else {
        setActionMessage({ type: "error", text: res.error || "Failed to create transaction." });
      }
    });
  };

  const handleExecuteReversal = () => {
    if (!targetTxForReversal) return;

    startTransition(async () => {
      const res = await reverseTransactionAction(targetTxForReversal.id, reversalReason);
      if (res.success && res.reversalTransaction) {
        // Update local list
        setTransactionsList((prev) =>
          prev.map((t) => (t.id === targetTxForReversal.id ? { ...t, status: "reversed" } : t))
        );
        setTransactionsList((prev) => [res.reversalTransaction!, ...prev]);
        setIsReversalOpen(false);
        setTargetTxForReversal(null);
        setReversalReason("");
        setActionMessage({
          type: "success",
          text: `Transaction reversed. Offsetting entry ${res.reversalTransaction.id} logged to audit ledger.`,
        });
      } else {
        setActionMessage({ type: "error", text: res.error || "Failed to reverse transaction." });
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Transactions & Ledger
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Immutable Double-Entry Ledger • Offsetting Reversals Only
          </p>
        </div>
        <Button onClick={() => setIsNewTxOpen(true)} className="gap-1.5 shadow-sm">
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
            onClick={() => setActionMessage(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search merchant, notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>

            {/* Account Filter */}
            <div>
              <select
                aria-label="Filter transactions by account"
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Accounts</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <select
                aria-label="Filter transactions by category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <select
                aria-label="Filter transactions by status"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Statuses</option>
                <option value="posted">Posted</option>
                <option value="reversed">Reversed</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ledger Table */}
      <Card className="border-border/60 overflow-hidden">
        <CardHeader className="p-4 pb-2 border-b bg-muted/20 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Ledger Records</CardTitle>
            <CardDescription className="text-xs">
              Showing {filteredTransactions.length} entries
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono">
            Audited Entries
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description / Merchant</TableHead>
                <TableHead className="hidden md:table-cell">Account</TableHead>
                <TableHead>Category / Splits</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground text-xs">
                    No ledger transactions matching the selected filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredTransactions.map((tx) => {
                  const isNegative = parseFloat(tx.amount) < 0;
                  return (
                    <TableRow
                      key={tx.id}
                      className={tx.status === "reversed" ? "opacity-60 bg-muted/10 line-through-text" : ""}
                    >
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {formatDate(tx.date)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-xs sm:text-sm">
                          {tx.cleanDescription}
                        </div>
                        {tx.isReversal && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 font-mono mt-0.5">
                            Offsets: {tx.reversesTransactionId} ({tx.reversalReason})
                          </div>
                        )}
                        {tx.merchant && !tx.isReversal && (
                          <div className="text-[11px] text-muted-foreground">
                            {tx.merchant}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {tx.accountName || "Account"}
                      </TableCell>
                      <TableCell>
                        {tx.isSplit ? (
                          <div className="space-y-1">
                            <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 border-sky-500/40 text-sky-500">
                              <Split className="h-3 w-3" />
                              Split ({tx.ledgerEntries.length})
                            </Badge>
                            <div className="text-[11px] text-muted-foreground space-y-0.5">
                              {tx.ledgerEntries.map((le) => (
                                <div key={le.id} className="flex items-center gap-1">
                                  <span
                                    className="h-1.5 w-1.5 rounded-full inline-block"
                                    style={{ backgroundColor: le.categoryColor || "#64748b" }}
                                  />
                                  <span>{le.categoryName}:</span>
                                  <span className="font-mono">{formatCurrency(parseFloat(le.amount))}</span>
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
                            tx.isReversal
                              ? "text-sky-500"
                              : isNegative
                              ? "text-foreground"
                              : "text-emerald-600 dark:text-emerald-400"
                          }
                        >
                          {formatCurrency(parseFloat(tx.amount))}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {tx.status === "reversed" ? (
                          <Badge variant="destructive" className="text-[9px] px-1 py-0 font-mono">
                            REVERSED
                          </Badge>
                        ) : tx.isReversal ? (
                          <Badge variant="info" className="text-[9px] px-1 py-0 font-mono">
                            REVERSAL ENTRY
                          </Badge>
                        ) : (
                          <Badge variant="success" className="text-[9px] px-1 py-0 font-mono">
                            POSTED
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {tx.status === "posted" && !tx.isReversal && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setTargetTxForReversal(tx);
                              setIsReversalOpen(true);
                            }}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Reverse
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Manual Entry & Split Transaction Dialog */}
      {isNewTxOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold">Log Transaction</h3>
                <p className="text-xs text-muted-foreground">
                  Direct ledger insertion with split transaction support
                </p>
              </div>
              <button
                onClick={() => setIsNewTxOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTransaction} className="space-y-4">
              {/* Type Switcher */}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={type === "expense" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setType("expense")}
                  className="flex-1 text-xs"
                >
                  Expense / Debit
                </Button>
                <Button
                  type="button"
                  variant={type === "income" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setType("income")}
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
                    className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs"
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
                    className="h-9 text-xs"
                    required
                  />
                </div>
              </div>

              {/* Amount and Description */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Total Amount ($ AUD)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="150.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Description / Merchant</Label>
                  <Input
                    placeholder="e.g. Woolworths Adelaide"
                    value={cleanDescription}
                    onChange={(e) => setCleanDescription(e.target.value)}
                    className="h-9 text-xs"
                    required
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

              {/* Single Category Selector */}
              {!isSplitMode ? (
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
              ) : (
                /* Split Items Editor */
                <div className="space-y-3 bg-muted/30 p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Split Breakdown</span>
                    <span
                      className={`text-xs font-mono ${
                        isSplitBalanced ? "text-emerald-500" : "text-destructive font-bold"
                      }`}
                    >
                      Allocated: ${totalSplitSum.toFixed(2)} / ${parsedTotalAmount.toFixed(2)}
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
                        className="flex-1 h-8 rounded border border-input bg-transparent px-2 text-xs"
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

              {/* Form Action Buttons */}
              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsNewTxOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending || (isSplitMode && !isSplitBalanced)}
                >
                  {isPending ? "Committing..." : "Commit to Ledger"}
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
              In accordance with <strong>Immutable Ledger principles</strong>, this entry will not be deleted. An offsetting reversing transaction will be logged with opposite sign, and an audit trail record will be preserved.
            </p>

            <div className="p-3 rounded-lg bg-muted/40 border text-xs space-y-1 font-mono">
              <div>Transaction ID: {targetTxForReversal.id}</div>
              <div>Merchant: {targetTxForReversal.cleanDescription}</div>
              <div>Amount: {formatCurrency(parseFloat(targetTxForReversal.amount))}</div>
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
