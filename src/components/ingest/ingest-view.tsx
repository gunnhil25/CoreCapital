"use client";

import { useState, useTransition } from "react";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertTriangle,
  History,
  Sparkles,
  ArrowRight,
  ShieldCheck,
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
import { importBankStatementCsvAction } from "@/actions/csv-parser";
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
}

export function IngestView({ accounts, batches: initialBatches }: IngestViewProps) {
  const [batches, setBatches] = useState(initialBatches);
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || "");
  const [bankFormat, setBankFormat] = useState("auto");
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();
  const [importResult, setImportResult] = useState<any>(null);

  const sampleCsvData = `Date,Amount,Description,Balance
10/10/2026,3850.00,DIRECT CREDIT DEFENCE PAYROLL,12450.00
09/10/2026,-154.30,VISA PURCHASE WOOLWORTHS UNLEY SA AUS,8600.00
08/10/2026,-18.50,EFTPOS MCDONALDS ADELAIDE,8445.70
07/10/2026,-22.99,DIRECT DEBIT NETFLIX AUSTRALIA,8427.20
06/10/2026,-95.40,BP CONNECT ADELAIDE FUEL,8331.80
05/10/2026,-1250.00,BPAY TO ADF SUPER FHSS VOLUNTARY CONTRIB,7081.80`;

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
        setFile(null);
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
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs"
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
                    value={bankFormat}
                    onChange={(e) => setBankFormat(e.target.value)}
                    className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs"
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
                    {importResult.duplicateCount > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">
                        Skipped {importResult.duplicateCount} duplicate records.
                      </span>
                    )}
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
