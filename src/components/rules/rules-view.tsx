"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  SlidersHorizontal,
  Plus,
  Play,
  Pause,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertCircle,
  CornerDownRight,
  GitBranch,
  Sparkles,
  RefreshCw,
  Wand2,
  X,
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
  acceptBulkRuleSuggestionsAction,
  acceptRuleSuggestionAction,
  createClassificationRuleAction,
  deleteClassificationRuleAction,
  getRuleSuggestionsAction,
  runClassificationRulesAction,
  toggleClassificationRuleAction,
  updateClassificationRuleAction,
  type RuleSuggestion,
} from "@/actions/rules";
import { evaluateRuleMatch } from "@/lib/rule-engine";
import { sortAndFlattenCategories } from "@/lib/category-utils";

export interface RulePreviewTransaction {
  id: string;
  date: string;
  merchant: string | null;
  cleanDescription: string;
  rawDescription: string;
  amount: string;
  categoryId: string | null;
  categoryName: string;
}

interface RuleItem {
  id: string;
  name: string;
  priority: number;
  field: string;
  matchType: string;
  matchValue: string;
  targetCategoryId: string;
  isActive: boolean;
  matchCount?: number;
}

interface RulesViewProps {
  initialRules: RuleItem[];
  categories: Array<{
    id: string;
    name: string;
    color: string;
    parentId?: string | null;
    sortOrder?: number;
  }>;
  recentTransactions?: RulePreviewTransaction[];
  initialSuggestions?: RuleSuggestion[];
}

const SELECT_CLS =
  "w-full h-9 rounded-lg border border-input bg-background text-foreground px-3 text-xs";

export function RulesView({
  initialRules,
  categories,
  recentTransactions = [],
  initialSuggestions = [],
}: RulesViewProps) {
  const router = useRouter();
  const orderedCategories = useMemo(
    () => sortAndFlattenCategories(categories),
    [categories]
  );
  const [rules, setRules] = useState<RuleItem[]>(initialRules);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>(initialSuggestions);
  const [selectedSuggestionCats, setSelectedSuggestionCats] = useState<Record<string, string>>({});
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [ruleModalMode, setRuleModalMode] = useState<"create" | "edit" | null>(null);
  const [editingRule, setEditingRule] = useState<RuleItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RuleItem | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("50");
  const [field, setField] = useState<"description" | "merchant" | "amount">("description");
  const [matchType, setMatchType] = useState<
    "contains" | "exact" | "ilike" | "starts_with" | "regex"
  >("contains");
  const [matchValue, setMatchValue] = useState("");
  const [targetCategoryId, setTargetCategoryId] = useState(
    orderedCategories[0]?.id || categories[0]?.id || ""
  );
  const [customTestText, setCustomTestText] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => a.priority - b.priority),
    [rules]
  );

  const selectedTargetNode = orderedCategories.find(
    (c) => c.id === targetCategoryId
  );

  const previewMatches = useMemo(() => {
    if (!matchValue.trim()) return [];
    const candidateRule = {
      id: "preview",
      name: name || "Preview Rule",
      priority: parseInt(priority, 10) || 50,
      field,
      matchType,
      matchValue,
      targetCategoryId,
      autoApply: true,
      isActive: true,
    };
    return recentTransactions.filter((tx) =>
      evaluateRuleMatch(candidateRule, {
        merchant: tx.merchant,
        cleanDescription: tx.cleanDescription,
        rawDescription: tx.rawDescription,
        amount: tx.amount,
      })
    );
  }, [name, priority, field, matchType, matchValue, targetCategoryId, recentTransactions]);

  const customSampleMatched = useMemo(() => {
    if (!matchValue.trim() || !customTestText.trim()) return null;
    return evaluateRuleMatch(
      {
        id: "preview-custom",
        name: "Preview",
        priority: 1,
        field,
        matchType,
        matchValue,
        targetCategoryId,
        autoApply: true,
        isActive: true,
      },
      {
        merchant: customTestText,
        cleanDescription: customTestText,
        rawDescription: customTestText,
        amount: customTestText,
      }
    );
  }, [field, matchType, matchValue, targetCategoryId, customTestText]);

  const openCreateRuleModal = () => {
    setModalError(null);
    setEditingRule(null);
    const defaultCatId = orderedCategories[0]?.id || categories[0]?.id || "";
    const defaultNode = orderedCategories.find((c) => c.id === defaultCatId);
    setName("");
    setPriority(defaultNode?.depth === 1 ? "25" : "50");
    setField("description");
    setMatchType("contains");
    setMatchValue("");
    setTargetCategoryId(defaultCatId);
    setCustomTestText("");
    setRuleModalMode("create");
  };

  const openEditRuleModal = (rule: RuleItem) => {
    setModalError(null);
    setEditingRule(rule);
    setName(rule.name);
    setPriority(String(rule.priority));
    setField((rule.field as any) || "description");
    setMatchType((rule.matchType as any) || "contains");
    setMatchValue(rule.matchValue);
    setTargetCategoryId(rule.targetCategoryId);
    setCustomTestText("");
    setRuleModalMode("edit");
  };

  const handleTargetCategoryChange = (nextCatId: string) => {
    setTargetCategoryId(nextCatId);
    if (ruleModalMode === "create") {
      const node = orderedCategories.find((c) => c.id === nextCatId);
      if (node?.depth === 1 && priority === "50") {
        setPriority("25");
      } else if (node?.depth === 0 && priority === "25") {
        setPriority("50");
      }
    }
  };

  const handleRunRules = (mode: "unclassified" | "refine_parents") => {
    setFeedback(null);
    startTransition(async () => {
      const res = await runClassificationRulesAction(mode);
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Failed to evaluate classification rules.",
        });
        return;
      }
      if (res.rules) {
        setRules(res.rules);
      }
      setFeedback({
        type: "success",
        text:
          mode === "refine_parents"
            ? `Sub-category refinement complete: moved ${res.matchedCount} entries into specific sub-categories.`
            : `Rule engine evaluated: classified ${res.matchedCount} unclassified ledger entries.`,
      });
      router.refresh();
    });
  };

  const handleToggleRule = (rule: RuleItem) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await toggleClassificationRuleAction(rule.id, !rule.isActive);
      if (res.success && res.rules) {
        setRules(res.rules);
        setFeedback({
          type: "success",
          text: rule.isActive
            ? `Paused rule "${rule.name}".`
            : `Resumed rule "${rule.name}".`,
        });
      } else {
        setFeedback({
          type: "error",
          text: res.error || "Failed to toggle rule status.",
        });
      }
    });
  };

  const handleSubmitRule = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setFeedback(null);

    if (!name.trim() || !matchValue.trim() || !targetCategoryId) {
      setModalError("Rule name, match pattern, and target category are required.");
      return;
    }

    startTransition(async () => {
      if (ruleModalMode === "edit" && editingRule) {
        const res = await updateClassificationRuleAction({
          id: editingRule.id,
          name: name.trim(),
          priority: parseInt(priority, 10) || 50,
          field,
          matchType,
          matchValue: matchValue.trim(),
          targetCategoryId,
          isActive: editingRule.isActive,
        });

        if (!res.success || !res.rule) {
          setModalError(res.error || "Failed to update classification rule.");
          return;
        }
        setRules((prev) =>
          prev.map((r) => (r.id === res.rule!.id ? res.rule! : r))
        );
        setRuleModalMode(null);
        setEditingRule(null);
        setFeedback({
          type: "success",
          text: `Updated rule "${res.rule.name}".`,
        });
        router.refresh();
      } else {
        const res = await createClassificationRuleAction({
          name: name.trim(),
          priority: parseInt(priority, 10) || 50,
          field,
          matchType,
          matchValue: matchValue.trim(),
          targetCategoryId,
        });

        if (!res.success || !res.rule) {
          setModalError(res.error || "Failed to create classification rule.");
          return;
        }
        setRules((prev) => [...prev, res.rule!]);
        setRuleModalMode(null);
        setName("");
        setMatchValue("");
        setFeedback({
          type: "success",
          text: `Rule "${res.rule.name}" created and active!`,
        });
        const refreshedSuggestions = await getRuleSuggestionsAction();
        setSuggestions(refreshedSuggestions);
        router.refresh();
      }
    });
  };

  const visibleSuggestions = suggestions.filter(
    (s) => !dismissedSuggestionIds.includes(s.id)
  );
  const getSuggestionCategoryId = (s: RuleSuggestion) =>
    selectedSuggestionCats[s.id] !== undefined
      ? selectedSuggestionCats[s.id]
      : s.suggestedCategoryId || "";
  const readySuggestions = visibleSuggestions.filter((s) =>
    Boolean(getSuggestionCategoryId(s))
  );

  const handleScanSuggestions = () => {
    setFeedback(null);
    startTransition(async () => {
      const next = await getRuleSuggestionsAction();
      setSuggestions(next);
      setDismissedSuggestionIds([]);
      setFeedback({
        type: "success",
        text:
          next.length > 0
            ? `Scanned ledger: found ${next.length} automated rule ${
                next.length === 1 ? "suggestion" : "suggestions"
              }.`
            : "Scanned ledger: all recurring & recognized merchants already have active rules!",
      });
    });
  };

  const handleAcceptSuggestion = (s: RuleSuggestion) => {
    const catId = getSuggestionCategoryId(s);
    if (!catId) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await acceptRuleSuggestionAction({
        name: s.suggestedRuleName,
        matchValue: s.matchValue,
        targetCategoryId: catId,
        field: s.field,
        priority: s.suggestedPriority,
        applyToExisting: true,
      });
      if (res.success && res.rules) {
        setRules(res.rules);
        if (res.suggestions) {
          setSuggestions(res.suggestions);
        } else {
          setDismissedSuggestionIds((prev) => [...prev, s.id]);
        }
        setFeedback({
          type: "success",
          text: `Added rule "${s.suggestedRuleName}" and auto-tagged ${
            res.matchedCount ?? 0
          } matching entries.`,
        });
        router.refresh();
      } else {
        setFeedback({
          type: "error",
          text: res.error || "Failed to add suggested rule.",
        });
      }
    });
  };

  const handleAcceptAllSuggestions = () => {
    if (readySuggestions.length === 0) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await acceptBulkRuleSuggestionsAction(
        readySuggestions.map((s) => ({
          name: s.suggestedRuleName,
          matchValue: s.matchValue,
          targetCategoryId: getSuggestionCategoryId(s),
          field: s.field,
          priority: s.suggestedPriority,
        }))
      );
      if (res.success && res.rules) {
        setRules(res.rules);
        if (res.suggestions) {
          setSuggestions(res.suggestions);
        }
        setFeedback({
          type: "success",
          text: `Approved ${res.createdCount ?? 0} suggested rules and auto-tagged ${
            res.matchedCount ?? 0
          } transactions!`,
        });
        router.refresh();
      } else {
        setFeedback({
          type: "error",
          text: res.error || "Failed to approve suggestions.",
        });
      }
    });
  };

  const handleConfirmDeleteRule = () => {
    if (!deleteTarget) return;
    setFeedback(null);
    startTransition(async () => {
      const removedName = deleteTarget.name;
      const res = await deleteClassificationRuleAction(deleteTarget.id);
      setDeleteTarget(null);
      if (res.success && res.rules) {
        setRules(res.rules);
        setFeedback({
          type: "success",
          text: `Deleted rule "${removedName}".`,
        });
        const refreshedSuggestions = await getRuleSuggestionsAction();
        setSuggestions(refreshedSuggestions);
        router.refresh();
      } else {
        setFeedback({
          type: "error",
          text: res.error || "Failed to delete rule.",
        });
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
            Priority-ordered automatic transaction tagger • Sub-category refinement • Regex &amp; ILIKE matching
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleScanSuggestions}
            disabled={isPending}
            className="gap-1.5"
            title="Scan transaction history for repeated or recognized merchants without rules"
          >
            <RefreshCw className="h-3.5 w-3.5 text-primary" />
            Scan Suggestions
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRunRules("unclassified")}
            disabled={isPending}
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5 text-emerald-500 fill-emerald-500" />
            {isPending ? "Evaluating..." : "Run on Unclassified"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRunRules("refine_parents")}
            disabled={isPending}
            className="gap-1.5"
            title="Move entries tagged with a broad parent category into matching sub-categories"
          >
            <GitBranch className="h-3.5 w-3.5 text-primary" />
            Refine into Sub-Categories
          </Button>
          <Button size="sm" onClick={openCreateRuleModal} className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" />
            Add Rule
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

      {/* Smart Rule Suggestions Panel */}
      {visibleSuggestions.length > 0 && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card overflow-hidden">
          <CardHeader className="p-4 pb-3 border-b bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" />
                Smart Rule Suggestions ({visibleSuggestions.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Repeated &amp; recognized merchants detected from your transactions without an active rule yet
              </CardDescription>
            </div>
            {readySuggestions.length > 0 && (
              <Button
                type="button"
                size="sm"
                disabled={isPending}
                onClick={handleAcceptAllSuggestions}
                className="gap-1.5 shrink-0"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Approve All Ready ({readySuggestions.length})
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0 divide-y">
            {visibleSuggestions.map((s) => {
              const selectedCatId = getSuggestionCategoryId(s);
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
                      aria-label={`Suggested category for ${s.merchantDisplay}`}
                      value={selectedCatId}
                      onChange={(e) =>
                        setSelectedSuggestionCats((prev) => ({
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
                      onClick={() => handleAcceptSuggestion(s)}
                      className="h-8 text-xs gap-1"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Rule &amp; Apply
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      aria-label={`Dismiss suggestion ${s.merchantDisplay}`}
                      onClick={() =>
                        setDismissedSuggestionIds((prev) => [...prev, s.id])
                      }
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

      {/* Rules Table Card */}
      <Card className="border-border/60 overflow-hidden">
        <CardHeader className="p-4 pb-2 border-b bg-muted/20 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-sky-500" />
              Active Classification Rules
            </CardTitle>
            <CardDescription className="text-xs">
              Evaluated in ascending priority order — give specific sub-category rules lower priority numbers than broad parent rules
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono">
            {rules.filter((r) => r.isActive).length} / {rules.length} Active
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
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRules.map((rule) => {
                const targetCat = orderedCategories.find(
                  (c) => c.id === rule.targetCategoryId
                );
                return (
                  <TableRow
                    key={rule.id}
                    className={!rule.isActive ? "opacity-60" : undefined}
                  >
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
                          &ldquo;{rule.matchValue}&rdquo;
                        </code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        {targetCat?.depth === 1 && (
                          <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        <span
                          className="h-2 w-2 rounded-full inline-block shrink-0"
                          style={{ backgroundColor: targetCat?.color || "#64748b" }}
                        />
                        <span>
                          {targetCat?.displayLabel || targetCat?.name || "Category"}
                        </span>
                        {targetCat?.depth === 1 && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 font-mono">
                            Sub
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {rule.matchCount || 0}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={rule.isActive ? "success" : "secondary"}
                        className="text-[9px] px-1.5 py-0 font-mono"
                      >
                        {rule.isActive ? "ACTIVE" : "PAUSED"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          title={rule.isActive ? "Pause rule" : "Resume rule"}
                          aria-label={`${rule.isActive ? "Pause" : "Resume"} ${rule.name}`}
                          disabled={isPending}
                          onClick={() => handleToggleRule(rule)}
                        >
                          {rule.isActive ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          title="Edit rule"
                          aria-label={`Edit ${rule.name}`}
                          onClick={() => openEditRuleModal(rule)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Delete rule"
                          aria-label={`Delete ${rule.name}`}
                          onClick={() => setDeleteTarget(rule)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create / Edit Rule Modal */}
      {ruleModalMode && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cc-animate-overlay">
          <div className="bg-card border rounded-xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto cc-animate-modal">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold">
                  {ruleModalMode === "edit"
                    ? "Edit Classification Rule"
                    : "Create Classification Rule"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Automatically classify incoming or parent-tagged transactions into categories or sub-categories
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRuleModalMode(null)}
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

            <form onSubmit={handleSubmitRule} className="space-y-4">
              <div className="space-y-1">
                <Label>Rule Name</Label>
                <Input
                  placeholder="e.g. Specialty Coffee Roasters"
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
                  <p className="text-[10px] text-muted-foreground">
                    Lower = higher precedence (e.g. 25 before 50)
                  </p>
                </div>

                <div className="space-y-1">
                  <Label>Match Field</Label>
                  <select
                    value={field}
                    onChange={(e) => setField(e.target.value as any)}
                    className={SELECT_CLS}
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
                    className={SELECT_CLS}
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
                    placeholder="e.g. campos or mcdonalds"
                    value={matchValue}
                    onChange={(e) => setMatchValue(e.target.value)}
                    className="h-9 text-xs font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Assign Category / Sub-Category</Label>
                <select
                  value={targetCategoryId}
                  onChange={(e) => handleTargetCategoryChange(e.target.value)}
                  className={SELECT_CLS}
                >
                  {orderedCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.depth === 1 ? `↳ ${c.displayLabel}` : c.name}
                    </option>
                  ))}
                </select>
                {selectedTargetNode?.depth === 1 && (
                  <p className="text-[10px] text-primary flex items-center gap-1 pt-0.5">
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span>
                      Targets sub-category <strong>{selectedTargetNode.displayLabel}</strong> — specific sub-category rules run cleanly ahead of parent fallbacks when assigned lower priority numbers.
                    </span>
                  </p>
                )}
              </div>

              {/* Live Pattern Match Preview */}
              <div className="rounded-lg border bg-muted/25 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold">Live Pattern Preview</span>
                  <span className="font-mono text-muted-foreground">
                    {matchValue.trim()
                      ? `Matches ${previewMatches.length} of ${recentTransactions.length} recent txs`
                      : "Enter pattern above"}
                  </span>
                </div>

                <Input
                  placeholder="Optional: type sample description or merchant to test..."
                  value={customTestText}
                  onChange={(e) => setCustomTestText(e.target.value)}
                  className="h-8 text-xs bg-background"
                />

                {customSampleMatched !== null && (
                  <p
                    className={`text-[11px] font-medium ${
                      customSampleMatched
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    Sample check: {customSampleMatched ? "Matched pattern!" : "Did not match."}
                  </p>
                )}

                {previewMatches.length > 0 && (
                  <div className="space-y-1 pt-1 border-t">
                    {previewMatches.slice(0, 3).map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between text-[11px] gap-2"
                      >
                        <span className="truncate font-medium">
                          {m.cleanDescription}
                        </span>
                        <Badge variant="outline" className="text-[9px] py-0 shrink-0">
                          {m.categoryName}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRuleModalMode(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending
                    ? "Saving..."
                    : ruleModalMode === "edit"
                    ? "Save Changes"
                    : "Save Rule"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Rule Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cc-animate-overlay">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 cc-animate-modal">
            <h3 className="text-base font-bold">
              Delete Rule &ldquo;{deleteTarget.name}&rdquo;?
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Historical transactions already tagged by this rule remain untouched, and future imports will skip it.
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
                onClick={handleConfirmDeleteRule}
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
