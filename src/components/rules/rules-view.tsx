"use client";

import { useState, useTransition } from "react";
import {
  SlidersHorizontal,
  Plus,
  Play,
  CheckCircle2,
  Sparkles,
  Search,
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
import {
  createClassificationRuleAction,
  runClassificationRulesOnUnclassifiedAction,
} from "@/actions/rules";
import { sortAndFlattenCategories } from "@/lib/category-utils";

interface RulesViewProps {
  initialRules: Array<{
    id: string;
    name: string;
    priority: number;
    field: string;
    matchType: string;
    matchValue: string;
    targetCategoryId: string;
    isActive: boolean;
    matchCount?: number;
  }>;
  categories: Array<{
    id: string;
    name: string;
    color: string;
    parentId?: string | null;
    sortOrder?: number;
  }>;
}

export function RulesView({ initialRules, categories }: RulesViewProps) {
  const orderedCategories = sortAndFlattenCategories(categories);
  const [rules, setRules] = useState(initialRules);
  const [isPending, startTransition] = useTransition();
  const [isNewRuleOpen, setIsNewRuleOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("50");
  const [field, setField] = useState<"description" | "merchant" | "amount">("description");
  const [matchType, setMatchType] = useState<"contains" | "exact" | "ilike" | "starts_with" | "regex">("contains");
  const [matchValue, setMatchValue] = useState("");
  const [targetCategoryId, setTargetCategoryId] = useState(categories[0]?.id || "");

  const handleRunRules = () => {
    startTransition(async () => {
      const res = await runClassificationRulesOnUnclassifiedAction();
      if (res.success) {
        setFeedback(`Rule engine evaluated: successfully classified ${res.matchedCount} transactions!`);
      }
    });
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !matchValue || !targetCategoryId) return;

    startTransition(async () => {
      const res = await createClassificationRuleAction({
        name,
        priority: parseInt(priority, 10) || 50,
        field,
        matchType,
        matchValue,
        targetCategoryId,
      });

      if (res.success && res.rule) {
        setRules([...rules, res.rule]);
        setIsNewRuleOpen(false);
        setName("");
        setMatchValue("");
        setFeedback(`Rule "${name}" created and active!`);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Classification Rules Engine
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Priority-ordered automatic transaction tagger • Regex & ILIKE pattern matching
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunRules}
            disabled={isPending}
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5 text-emerald-500 fill-emerald-500" />
            {isPending ? "Evaluating..." : "Run Engine on Unclassified"}
          </Button>
          <Button size="sm" onClick={() => setIsNewRuleOpen(true)} className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" />
            Add Rule
          </Button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div className="p-3.5 rounded-lg border bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{feedback}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-xs opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* Rules Table Card */}
      <Card className="border-border/60 overflow-hidden">
        <CardHeader className="p-4 pb-2 border-b bg-muted/20 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-sky-500" />
              Active Classification Rules
            </CardTitle>
            <CardDescription className="text-xs">
              Evaluated in ascending priority order (lowest number executes first)
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono">
            {rules.length} Rules Active
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Priority</TableHead>
                <TableHead>Rule Name</TableHead>
                <TableHead>Target Field</TableHead>
                <TableHead>Match Pattern</TableHead>
                <TableHead>Assigned Category</TableHead>
                <TableHead className="text-center">Matches</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules
                .sort((a, b) => a.priority - b.priority)
                .map((rule) => {
                  const targetCat = orderedCategories.find((c) => c.id === rule.targetCategoryId);
                  return (
                    <TableRow key={rule.id}>
                      <TableCell className="font-mono text-xs font-bold text-sky-500">
                        #{rule.priority}
                      </TableCell>
                      <TableCell className="font-semibold text-xs sm:text-sm">
                        {rule.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground uppercase">
                        {rule.field}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <Badge variant="outline" className="text-[10px] py-0">
                            {rule.matchType}
                          </Badge>
                          <code className="text-sky-600 dark:text-sky-400 bg-muted/60 px-1.5 py-0.5 rounded">
                            "{rule.matchValue}"
                          </code>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span
                            className="h-2 w-2 rounded-full inline-block"
                            style={{ backgroundColor: targetCat?.color || "#64748b" }}
                          />
                          <span>{targetCat?.displayLabel || targetCat?.name || "Category"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        {rule.matchCount || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="success" className="text-[9px] px-1.5 py-0 font-mono">
                          ACTIVE
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* New Rule Modal */}
      {isNewRuleOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold">Create Classification Rule</h3>
                <p className="text-xs text-muted-foreground">
                  Automatically classify incoming transactions
                </p>
              </div>
              <button
                onClick={() => setIsNewRuleOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRule} className="space-y-4">
              <div className="space-y-1">
                <Label>Rule Name</Label>
                <Input
                  placeholder="e.g. McDonald's Fast Food Tag"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Evaluation Priority</Label>
                  <Input
                    type="number"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground">Lower = higher priority</p>
                </div>

                <div className="space-y-1">
                  <Label>Match Field</Label>
                  <select
                    value={field}
                    onChange={(e) => setField(e.target.value as any)}
                    className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs"
                  >
                    <option value="description">Description</option>
                    <option value="merchant">Merchant</option>
                    <option value="amount">Amount</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Match Type</Label>
                  <select
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value as any)}
                    className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-xs"
                  >
                    <option value="contains">Contains (Case Insensitive)</option>
                    <option value="ilike">ILIKE SQL Pattern</option>
                    <option value="exact">Exact Match</option>
                    <option value="starts_with">Starts With</option>
                    <option value="regex">Regular Expression</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>Pattern Value</Label>
                  <Input
                    placeholder="e.g. mcdonalds or woolworths"
                    value={matchValue}
                    onChange={(e) => setMatchValue(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Assign Category</Label>
                <select
                  value={targetCategoryId}
                  onChange={(e) => setTargetCategoryId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs"
                >
                  {orderedCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.depth === 1 ? `↳ ${c.displayLabel}` : c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsNewRuleOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Rule"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
