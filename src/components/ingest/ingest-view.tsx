"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertTriangle,
  History,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Wand2,
  Plus,
  X,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { importBankStatementCsvAction, ImportCsvResult } from "@/actions/csv-parser";
import {
  acceptBulkRuleSuggestionsAction,
  acceptRuleSuggestionAction,
  type RuleSuggestion,
} from "@/actions/rules";
import { sortAndFlattenCategories } from "@/lib/category-utils";
import { formatDate } from "@/lib/utils";

interface IngestViewProps {
  accounts: { id: string; name: string }[];
  batches: Array<{
    id: string;
    fileName: string;
    fileHash: string;
    bankFormat: string;
    totalRows: number;
    importedRows: number;
    duplicateRows: number;
    status: string;
    importedAt: string;
  }>;
  categories?: Array<{
    id: string;
    name: string;
    type?: string;
    color: string;
    parentId?: string | null;
    sortOrder?: number;
  }>;
  initialSuggestions?: RuleSuggestion[];
}

export function IngestView({
  accounts,
  batches: initialBatches,
  categories = [],
  initialSuggestions = [],
}: IngestViewProps) {
  const router = useRouter();
  const orderedCategories = useMemo(
    () => sortAndFlattenCategories(categories),
    [categories]
  );
  const [batches, setBatches] = useState(initialBatches);
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || "");
  const [bankFormat, setBankFormat] = useState("auto");
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();
  const [importResult, setImportResult] = useState<ImportCsvResult | null>(null);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>(initialSuggestions);
  const [selectedCats, setSelectedCats] = useState<Record<string, string>>({});
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [ruleFeedback, setRuleFeedback] = useState<string | null>(null);

  const sampleCsvData = `Date,Amount,Description,Balance
10/10/2026,3850.00,DIRECT CREDIT DEFENCE PAYROLL,12450.00
09/10/2026,-154.30,VISA PURCHASE WOOLWORTHS UNLEY SA AUS,8600.00
08/10/2026,-18.50,EFTPOS MCDONALDS ADELAIDE,8445.70
07/10/2026,-22.99,DIRECT DEBIT NETFLIX AUSTRALIA,8427.20
06/10/2026,-95.40,BP CONNECT ADELAIDE FUEL,8331.80
05/10/2026,-1250.00,BPAY TO ADF SUPER FHSS VOLUNTARY CONTRIB,7081.80
04/10/2026,-30.00,DIRECT DEBIT AMAYSIM MOBILE PTY LTD,7051.80
02/10/2026,-13.99,VISA PURCHASE SPOTIFY AUSTRALIA,7037.81
04/11/2026,-30.00,DIRECT DEBIT AMAYSIM MOBILE PTY LTD,7007.81
02/11/2026,-13.99,VISA PURCHASE SPOTIFY AUSTRALIA,6993.82`;

  const handleLoadSampleStatement = () => {
    const blob = new Blob([sampleCsvData], { type: "text/csv" });
    const sampleFile = new File([blob], "CommBank_Adelaide_Sample.csv", { type: "text/csv" });
    setFile(sampleFile);
    setBankFormat("commbank");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !selectedAccountId) return;

    setImportResult(null);
    setRuleFeedback(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", selectedAccountId);
    formData.append("bankFormat", bankFormat);

    startTransition(async () => {
      const res = await importBankStatementCsvAction(formData);
      setImportResult(res);
      if (res.success) {
        setBatches((prev) => [
          {
            id: res.batchId || `batch-${Date.now()}`,
            fileName: res.fileName || file.name,
            fileHash: "sha256-verified",
            bankFormat,
            totalRows: res.totalRows || 0,
            importedRows: res.importedCount || 0,
            duplicateRows: res.duplicateCount || 0,
            status: "completed",
            importedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        if (res.suggestions && res.suggestions.length > 0) {
          setSuggestions(res.suggestions);
          setDismissedIds([]);
        }
        setFile(null);
        router.refresh();
      }
    });
  };

  const visibleSuggestions = suggestions.filter(
    (s) => !dismissedIds.includes(s.id)
  );
  const getSelectedCatId = (s: RuleSuggestion) =>
    selectedCats[s.id] !== undefined
      ? selectedCats[s.id]
      : s.suggestedCategoryId || "";
  const readySuggestions = visibleSuggestions.filter((s) =>
    Boolean(getSelectedCatId(s))
  );

  const handleApproveSuggestion = (s: RuleSuggestion) => {
    const catId = getSelectedCatId(s);
    if (!catId) return;
    setRuleFeedback(null);

    startTransition(async () => {
      const res = await acceptRuleSuggestionAction({
        name: s.suggestedRuleName,
        matchValue: s.matchValue,
        targetCategoryId: catId,
        field: s.field,
        priority: s.suggestedPriority,
        applyToExisting: true,
      });
      if (res.success) {
        if (res.suggestions) {
          setSuggestions(res.suggestions);
        } else {
          setDismissedIds((prev) => [...prev, s.id]);
        }
        setRuleFeedback(
          `Created rule "${s.suggestedRuleName}" and auto-tagged ${res.matchedCount ?? 0} matching transactions.`
        );
        router.refresh();
      }
    });
  };

  const handleApproveAllReady = () => {
    if (readySuggestions.length === 0) return;
    setRuleFeedback(null);

    startTransition(async () => {
      const res = await acceptBulkRuleSuggestionsAction(
        readySuggestions.map((s) => ({
          name: s.suggestedRuleName,
          matchValue: s.matchValue,
          targetCategoryId: getSelectedCatId(s),
          field: s.field,
          priority: s.suggestedPriority,
        }))
      );
      if (res.success) {
        if (res.suggestions) {
          setSuggestions(res.suggestions);
        }
        setRuleFeedback(
          `Approved ${res.createdCount ?? 0} rules and tagged ${res.matchedCount ?? 0} transactions automatically!`
        );
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Statement Ingestion & Parsing Engine
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Australian Bank CSV Parser • SHA-256 Deduplication Hashing • Rule-Based Classification
        </p>
      </div>

      {/* Upload & Configuration Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-border/60">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UploadCloud className="h-5 w-5 text-sky-500" />
              Upload Bank Export Statement
            </CardTitle>
            <CardDescription>
              Accepts CSV files from Commonwealth Bank, Macquarie, ANZ, NAB, and standard exports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Destination Account</Label>
                  <select
                    aria-label="Destination Account"
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Bank CSV Format</Label>
                  <select
                    aria-label="Bank CSV Format"
                    value={bankFormat}
                    onChange={(e) => setBankFormat(e.target.value)}
                    className="w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs"
                  >
                    <option value="auto">Auto-Detect Headers</option>
                    <option value="commbank">Commonwealth Bank (CBA)</option>
                    <option value="macquarie">Macquarie Bank</option>
                    <option value="anz">ANZ Bank</option>
                    <option value="nab">NAB Bank</option>
                    <option value="generic_csv">Generic CSV</option>
                  </select>
                </div>
              </div>

              {/* Drag & Drop File Zone */}
              <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:bg-muted/20 transition-colors">
                <input
                  type="file"
                  id="csv-file-input"
                  accept=".csv,text/csv"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <label
                  htmlFor="csv-file-input"
                  className="cursor-pointer flex flex-col items-center justify-center space-y-2"
                >
                  <div className="h-12 w-12 rounded-full bg-sky-500/10 text-sky-500 flex items-center justify-center">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-primary underline underline-offset-4">
                      Click to browse
                    </span>{" "}
                    <span className="text-sm text-muted-foreground">or drag CSV statement here</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    CSV files up to 10MB supported
                  </p>
                </label>

                {file && (
                  <div className="mt-4 p-2.5 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between text-xs max-w-sm mx-auto">
                    <span className="font-mono truncate">{file.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {(file.size / 1024).toFixed(1)} KB
                    </Badge>
                  </div>
                )}
              </div>

              {/* Quick Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleLoadSampleStatement}
                  className="w-full sm:w-auto text-xs gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  Load Sample CommBank Statement
                </Button>

                <Button
                  type="submit"
                  size="sm"
                  disabled={!file || isPending}
                  className="w-full sm:w-auto gap-2"
                >
                  {isPending ? "Ingesting & Deduplicating..." : "Execute Bulk Ingestion"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Ingestion Engine Features Info */}
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Ingestion Guardrails
            </CardTitle>
            <CardDescription>
              Built-in deduplication & rule evaluation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs text-muted-foreground">
            <div className="space-y-1">
              <p className="font-semibold text-foreground">SHA-256 Deduplication</p>
              <p>
                Every imported row generates a unique hash based on account, execution date, numeric amount, and raw description. Duplicate imports are skipped.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Automatic Categorization</p>
              <p>
                Transactions are immediately matched against active <code className="text-foreground">classification_rules</code> (regex, ilike, contains) to tag categories without manual effort.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Immutable Ledger</p>
              <p>
                Imported entries are recorded as immutable financial events. Any mistaken import can be neutralized with atomic reversals.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Result Notification Banner */}
      {importResult && (
        <Card
          className={`border ${
            importResult.success
              ? "bg-emerald-500/10 border-emerald-500/30"
              : "bg-destructive/10 border-destructive/30"
          }`}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {importResult.success ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              )}
              <div className="text-xs sm:text-sm">
                {importResult.success ? (
                  <div>
                    <span className="font-semibold text-foreground">
                      Statement Ingestion Complete!
                    </span>{" "}
                    Successfully imported <strong>{importResult.importedCount}</strong> rows.{" "}
                    {importResult.duplicateCount && importResult.duplicateCount > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        Skipped {importResult.duplicateCount} duplicate records.
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-destructive font-medium">
                    {importResult.error || "Failed to parse bank statement."}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rule Creation Feedback Banner */}
      {ruleFeedback && (
        <div className="p-3.5 rounded-lg border bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{ruleFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setRuleFeedback(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Smart Rule Suggestions Panel */}
      {visibleSuggestions.length > 0 && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
          <CardHeader className="p-4 pb-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" />
                Suggested Rules from Ingested Transactions ({visibleSuggestions.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Automatically detected repeated or recognized merchants without active rules — approve to automate future imports
              </CardDescription>
            </div>
            {readySuggestions.length > 0 && (
              <Button
                type="button"
                size="sm"
                disabled={isPending}
                onClick={handleApproveAllReady}
                className="gap-1.5 shrink-0"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Approve All Ready ({readySuggestions.length})
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0 divide-y">
            {visibleSuggestions.map((s) => {
              const selectedCatId = getSelectedCatId(s);
              return (
                <div
                  key={s.id}
                  className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{s.merchantDisplay}</span>
                      <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded text-primary">
                        contains &ldquo;{s.matchValue}&rdquo;
                      </code>
                      <Badge variant="outline" className="text-[10px] font-mono py-0">
                        {s.occurrenceCount} {s.occurrenceCount === 1 ? "tx" : "txs"}
                      </Badge>
                      {s.isRecurring && (
                        <Badge variant="info" className="text-[9px] font-mono py-0">
                          Recurring
                        </Badge>
                      )}
                      <Badge
                        variant={
                          s.confidence === "high"
                            ? "success"
                            : s.confidence === "medium"
                            ? "secondary"
                            : "warning"
                        }
                        className="text-[9px] font-mono py-0"
                      >
                        {s.confidence === "high"
                          ? "High Confidence"
                          : s.confidence === "medium"
                          ? "Suggested"
                          : "Choose Category"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.reason}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      aria-label={`Category for ${s.merchantDisplay}`}
                      value={selectedCatId}
                      onChange={(e) =>
                        setSelectedCats((prev) => ({
                          ...prev,
                          [s.id]: e.target.value,
                        }))
                      }
                      className="h-8 min-w-[190px] rounded-lg border border-input bg-background text-foreground px-2.5 text-xs"
                    >
                      <option value="">Select category...</option>
                      {orderedCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.depth === 1 ? `↳ ${c.displayLabel}` : c.name}
                        </option>
                      ))}
                    </select>

                    <Button
                      type="button"
                      size="sm"
                      disabled={isPending || !selectedCatId}
                      onClick={() => handleApproveSuggestion(s)}
                      className="h-8 text-xs gap-1"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add &amp; Tag
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      aria-label={`Dismiss ${s.merchantDisplay}`}
                      onClick={() => setDismissedIds((prev) => [...prev, s.id])}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Import Batches History Table */}
      <Card className="border-border/60">
        <CardHeader className="p-4 pb-2 border-b bg-muted/20">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-sky-500" />
            Statement Ingestion History
          </CardTitle>
          <CardDescription className="text-xs">
            Previous bank statements parsed and committed to ledger
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Import Date</TableHead>
                <TableHead>File Name</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-center">Total Rows</TableHead>
                <TableHead className="text-center">Imported</TableHead>
                <TableHead className="text-center">Duplicates</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {formatDate(batch.importedAt)}
                  </TableCell>
                  <TableCell className="font-medium text-xs">
                    {batch.fileName}
                  </TableCell>
                  <TableCell className="uppercase text-[11px] font-mono text-muted-foreground">
                    {batch.bankFormat}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs">
                    {batch.totalRows}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                    {batch.importedRows}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs text-amber-600 dark:text-amber-400">
                    {batch.duplicateRows}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="success" className="text-[9px] px-1.5 py-0 font-mono">
                      {batch.status.toUpperCase()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
