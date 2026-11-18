export interface ClassificationRuleItem {
  id: string;
  name: string;
  priority: number;
  field: string; // 'description' | 'merchant' | 'amount'
  matchType: string; // 'contains' | 'exact' | 'ilike' | 'starts_with' | 'regex'
  matchValue: string;
  targetCategoryId: string;
  autoApply: boolean;
  isActive: boolean;
}

const UNSAFE_NESTED_QUANTIFIER_RE =
  /(\+|\*|\{[0-9,]+\})\s*\??\s*\)\s*(\+|\*|\{[0-9,]+\})/;

/**
 * Matches a transaction field against a rule criterion
 */
export function evaluateRuleMatch(
  rule: ClassificationRuleItem,
  transaction: {
    merchant?: string | null;
    rawDescription?: string | null;
    cleanDescription?: string | null;
    amount?: number | string | null;
  }
): boolean {
  if (!rule.isActive) return false;

  let candidateText = "";
  if (rule.field === "merchant") {
    candidateText = transaction.merchant || "";
  } else if (rule.field === "amount") {
    candidateText = String(transaction.amount ?? "");
  } else {
    candidateText = `${transaction.cleanDescription || ""} ${transaction.rawDescription || ""}`.trim();
  }

  const value = rule.matchValue.trim();
  if (!value) return false;

  const lowerCandidate = candidateText.toLowerCase();
  const lowerValue = value.toLowerCase().replace(/^%+|%+$/g, ""); // strip SQL LIKE % for convenience

  switch (rule.matchType) {
    case "exact":
      return lowerCandidate === lowerValue;
    case "starts_with":
      return lowerCandidate.startsWith(lowerValue);
    case "contains":
    case "ilike":
      return lowerCandidate.includes(lowerValue);
    case "regex":
      if (value.length > 120 || UNSAFE_NESTED_QUANTIFIER_RE.test(value)) {
        return false;
      }
      try {
        const regex = new RegExp(value, "i");
        return regex.test(candidateText);
      } catch {
        return false;
      }
    default:
      return lowerCandidate.includes(lowerValue);
  }
}

/**
 * Finds the highest-priority classification rule that matches the given transaction
 */
export function findMatchingRule(
  transaction: {
    merchant?: string | null;
    rawDescription?: string | null;
    cleanDescription?: string | null;
    amount?: number | string | null;
  },
  rules: ClassificationRuleItem[]
): ClassificationRuleItem | null {
  // Sort by priority ascending (lower number = higher priority)
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (evaluateRuleMatch(rule, transaction)) {
      return rule;
    }
  }

  return null;
}

/**
 * Finds the target category ID of the highest-priority matching rule
 */
export function findMatchingCategory(
  transaction: {
    merchant?: string | null;
    rawDescription?: string | null;
    cleanDescription?: string | null;
    amount?: number | string | null;
  },
  rules: ClassificationRuleItem[]
): string | null {
  return findMatchingRule(transaction, rules)?.targetCategoryId ?? null;
}
