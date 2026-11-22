import { CategoryLike, formatCategoryDisplayLabel } from "./category-utils";

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

export interface MerchantSignature {
  key: string;
  label: string;
  matchValue: string;
  patterns: string[];
  categoryHints: string[];
}

export interface NormalizedMerchant {
  key: string;
  displayName: string;
  matchValue: string;
  signature: MerchantSignature | null;
}

export interface RuleSuggestion {
  id: string;
  merchantDisplay: string;
  suggestedRuleName: string;
  field: "description" | "merchant";
  matchType: "contains";
  matchValue: string;
  suggestedCategoryId: string | null;
  suggestedCategoryLabel: string | null;
  suggestedCategoryColor: string | null;
  suggestedPriority: number;
  confidence: "high" | "medium" | "low";
  source: "user_history" | "merchant_directory" | "repeated_pattern";
  reason: string;
  occurrenceCount: number;
  unclassifiedCount: number;
  isRecurring: boolean;
  averageAmount: number;
  sampleDescriptions: string[];
}

export interface LearnOnEditSuggestion {
  merchantDisplay: string;
  suggestedRuleName: string;
  matchValue: string;
  targetCategoryId: string;
  targetCategoryLabel: string;
  suggestedPriority: number;
  alsoMatchesCount: number;
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

/**
 * Ordered Australian & digital merchant signatures (more specific compound names precede generic prefixes).
 */
export const AUSTRALIAN_MERCHANT_SIGNATURES: MerchantSignature[] = [
  // Streaming, Music & Cloud Subscriptions
  { key: "spotify", label: "Spotify", matchValue: "spotify", patterns: ["spotify"], categoryHints: ["subscriptions", "streaming", "saas", "software", "media"] },
  { key: "netflix", label: "Netflix", matchValue: "netflix", patterns: ["netflix"], categoryHints: ["subscriptions", "streaming", "saas", "media"] },
  { key: "disney-plus", label: "Disney+", matchValue: "disney", patterns: ["disney+", "disney plus"], categoryHints: ["subscriptions", "streaming", "saas"] },
  { key: "stan", label: "Stan", matchValue: "stan", patterns: ["stan.com", "stan entertainment", "stan"], categoryHints: ["subscriptions", "streaming", "saas"] },
  { key: "binge", label: "Binge", matchValue: "binge", patterns: ["binge"], categoryHints: ["subscriptions", "streaming", "saas"] },
  { key: "kayo", label: "Kayo Sports", matchValue: "kayo", patterns: ["kayo sports", "kayo"], categoryHints: ["subscriptions", "streaming", "saas"] },
  { key: "amazon-prime", label: "Amazon Prime", matchValue: "amazon prime", patterns: ["amazon prime", "prime video"], categoryHints: ["subscriptions", "streaming", "saas"] },
  { key: "apple-bill", label: "Apple Services", matchValue: "apple.com", patterns: ["apple.com/bill", "apple music", "icloud"], categoryHints: ["subscriptions", "saas", "software"] },
  { key: "youtube", label: "YouTube / Google", matchValue: "youtube", patterns: ["youtube", "google one", "google storage"], categoryHints: ["subscriptions", "streaming", "saas"] },
  { key: "openai", label: "OpenAI / ChatGPT", matchValue: "openai", patterns: ["openai", "chatgpt"], categoryHints: ["subscriptions", "saas", "software"] },
  { key: "anthropic", label: "Anthropic / Claude", matchValue: "anthropic", patterns: ["anthropic", "claude.ai"], categoryHints: ["subscriptions", "saas", "software"] },
  { key: "adobe", label: "Adobe Creative Cloud", matchValue: "adobe", patterns: ["adobe"], categoryHints: ["subscriptions", "saas", "software"] },
  { key: "microsoft-365", label: "Microsoft 365", matchValue: "microsoft", patterns: ["microsoft 365", "microsoft"], categoryHints: ["subscriptions", "saas", "software"] },
  { key: "github", label: "GitHub", matchValue: "github", patterns: ["github"], categoryHints: ["subscriptions", "saas", "software"] },
  { key: "dropbox", label: "Dropbox", matchValue: "dropbox", patterns: ["dropbox"], categoryHints: ["subscriptions", "saas", "software"] },
  { key: "audible", label: "Audible", matchValue: "audible", patterns: ["audible"], categoryHints: ["subscriptions", "saas", "media"] },

  // Mobile & Telco (ordered before grocery/retail where brands overlap e.g. aldimobile vs aldi)
  { key: "aldimobile", label: "ALDImobile", matchValue: "aldimobile", patterns: ["aldimobile", "aldi mobile"], categoryHints: ["mobile", "phone", "telco", "utilities"] },
  { key: "amaysim", label: "Amaysim", matchValue: "amaysim", patterns: ["amaysim"], categoryHints: ["mobile", "phone", "telco", "utilities"] },
  { key: "belong", label: "Belong", matchValue: "belong", patterns: ["belong"], categoryHints: ["mobile", "internet", "telco", "utilities"] },
  { key: "boost-mobile", label: "Boost Mobile", matchValue: "boost mobile", patterns: ["boost mobile"], categoryHints: ["mobile", "phone", "telco", "utilities"] },
  { key: "felix-mobile", label: "Felix Mobile", matchValue: "felix mobile", patterns: ["felix mobile"], categoryHints: ["mobile", "phone", "telco", "utilities"] },
  { key: "circles-life", label: "Circles.Life", matchValue: "circles.life", patterns: ["circles.life", "circles life"], categoryHints: ["mobile", "phone", "telco", "utilities"] },
  { key: "kogan-mobile", label: "Kogan Mobile", matchValue: "kogan mobile", patterns: ["kogan mobile"], categoryHints: ["mobile", "phone", "telco", "utilities"] },
  { key: "lebara", label: "Lebara", matchValue: "lebara", patterns: ["lebara"], categoryHints: ["mobile", "phone", "telco", "utilities"] },
  { key: "telstra", label: "Telstra", matchValue: "telstra", patterns: ["telstra"], categoryHints: ["mobile", "internet", "telco", "utilities"] },
  { key: "optus", label: "Optus", matchValue: "optus", patterns: ["optus"], categoryHints: ["mobile", "internet", "telco", "utilities"] },
  { key: "vodafone", label: "Vodafone", matchValue: "vodafone", patterns: ["vodafone"], categoryHints: ["mobile", "phone", "telco", "utilities"] },

  // Internet / NBN
  { key: "aussie-broadband", label: "Aussie Broadband", matchValue: "aussie broadband", patterns: ["aussie broadband"], categoryHints: ["internet", "nbn", "broadband", "telco", "utilities"] },
  { key: "superloop", label: "Superloop", matchValue: "superloop", patterns: ["superloop"], categoryHints: ["internet", "nbn", "broadband", "telco", "utilities"] },
  { key: "tpg", label: "TPG", matchValue: "tpg", patterns: ["tpg internet", "tpg"], categoryHints: ["internet", "nbn", "broadband", "telco", "utilities"] },
  { key: "iinet", label: "iiNet", matchValue: "iinet", patterns: ["iinet"], categoryHints: ["internet", "nbn", "broadband", "telco", "utilities"] },
  { key: "launtel", label: "Launtel", matchValue: "launtel", patterns: ["launtel"], categoryHints: ["internet", "nbn", "broadband", "telco", "utilities"] },
  { key: "exetel", label: "Exetel", matchValue: "exetel", patterns: ["exetel"], categoryHints: ["internet", "nbn", "broadband", "telco", "utilities"] },
  { key: "starlink", label: "Starlink", matchValue: "starlink", patterns: ["starlink"], categoryHints: ["internet", "broadband", "telco", "utilities"] },
  { key: "dodo", label: "Dodo", matchValue: "dodo", patterns: ["dodo services", "dodo"], categoryHints: ["internet", "nbn", "telco", "utilities"] },

  // Energy & Water
  { key: "agl", label: "AGL Energy", matchValue: "agl", patterns: ["agl energy", "agl sales", "agl"], categoryHints: ["electricity", "energy", "gas", "utilities"] },
  { key: "origin-energy", label: "Origin Energy", matchValue: "origin", patterns: ["origin energy"], categoryHints: ["electricity", "energy", "gas", "utilities"] },
  { key: "energyaustralia", label: "EnergyAustralia", matchValue: "energyaustralia", patterns: ["energyaustralia", "energy australia"], categoryHints: ["electricity", "energy", "gas", "utilities"] },
  { key: "red-energy", label: "Red Energy", matchValue: "red energy", patterns: ["red energy"], categoryHints: ["electricity", "energy", "gas", "utilities"] },
  { key: "alinta", label: "Alinta Energy", matchValue: "alinta", patterns: ["alinta energy", "alinta"], categoryHints: ["electricity", "energy", "gas", "utilities"] },
  { key: "sa-water", label: "SA Water", matchValue: "sa water", patterns: ["sa water"], categoryHints: ["water", "utilities"] },
  { key: "sa-power", label: "SA Power Networks", matchValue: "sa power", patterns: ["sa power"], categoryHints: ["electricity", "energy", "utilities"] },
  { key: "sydney-water", label: "Sydney Water", matchValue: "sydney water", patterns: ["sydney water"], categoryHints: ["water", "utilities"] },
  { key: "amber-electric", label: "Amber Electric", matchValue: "amber electric", patterns: ["amber electric"], categoryHints: ["electricity", "energy", "utilities"] },
  { key: "ovo-energy", label: "OVO Energy", matchValue: "ovo energy", patterns: ["ovo energy"], categoryHints: ["electricity", "energy", "utilities"] },

  // Delivery & Fast Food (ordered BEFORE generic uber rideshare)
  { key: "uber-eats", label: "Uber Eats", matchValue: "uber eats", patterns: ["uber eats", "ubereats", "uber *eats"], categoryHints: ["takeaway", "fast food", "delivery", "dining"] },
  { key: "doordash", label: "DoorDash", matchValue: "doordash", patterns: ["doordash"], categoryHints: ["takeaway", "fast food", "delivery", "dining"] },
  { key: "menulog", label: "Menulog", matchValue: "menulog", patterns: ["menulog"], categoryHints: ["takeaway", "fast food", "delivery", "dining"] },
  { key: "mcdonalds", label: "McDonald's", matchValue: "mcdonalds", patterns: ["mcdonalds", "mcdonald's"], categoryHints: ["takeaway", "fast food", "dining"] },
  { key: "kfc", label: "KFC", matchValue: "kfc", patterns: ["kfc"], categoryHints: ["takeaway", "fast food", "dining"] },
  { key: "hungry-jacks", label: "Hungry Jack's", matchValue: "hungry jacks", patterns: ["hungry jacks", "hungry jack's"], categoryHints: ["takeaway", "fast food", "dining"] },
  { key: "gyg", label: "Guzman y Gomez", matchValue: "guzman y gomez", patterns: ["guzman y gomez", "gyg"], categoryHints: ["takeaway", "fast food", "dining"] },
  { key: "grilld", label: "Grill'd", matchValue: "grill", patterns: ["grill'd", "grilld"], categoryHints: ["takeaway", "fast food", "dining"] },
  { key: "nandos", label: "Nando's", matchValue: "nando", patterns: ["nando's", "nandos"], categoryHints: ["takeaway", "fast food", "dining"] },
  { key: "dominos", label: "Domino's", matchValue: "domino", patterns: ["domino's", "dominos"], categoryHints: ["takeaway", "fast food", "dining"] },
  { key: "subway", label: "Subway", matchValue: "subway", patterns: ["subway"], categoryHints: ["takeaway", "fast food", "dining"] },
  { key: "zambrero", label: "Zambrero", matchValue: "zambrero", patterns: ["zambrero"], categoryHints: ["takeaway", "fast food", "dining"] },
  { key: "oporto", label: "Oporto", matchValue: "oporto", patterns: ["oporto"], categoryHints: ["takeaway", "fast food", "dining"] },

  // Groceries & Meal Kits
  { key: "woolworths", label: "Woolworths", matchValue: "woolworths", patterns: ["woolworths"], categoryHints: ["groceries", "supermarket", "food"] },
  { key: "coles", label: "Coles", matchValue: "coles", patterns: ["coles"], categoryHints: ["groceries", "supermarket", "food"] },
  { key: "aldi", label: "ALDI", matchValue: "aldi", patterns: ["aldi stores", "aldi"], categoryHints: ["groceries", "supermarket", "food"] },
  { key: "iga", label: "IGA", matchValue: "iga", patterns: ["iga supermarket", "iga"], categoryHints: ["groceries", "supermarket", "food"] },
  { key: "foodland", label: "Foodland", matchValue: "foodland", patterns: ["foodland"], categoryHints: ["groceries", "supermarket", "food"] },
  { key: "drakes", label: "Drakes Supermarkets", matchValue: "drakes", patterns: ["drakes"], categoryHints: ["groceries", "supermarket", "food"] },
  { key: "harris-farm", label: "Harris Farm", matchValue: "harris farm", patterns: ["harris farm"], categoryHints: ["groceries", "supermarket", "food"] },
  { key: "costco", label: "Costco", matchValue: "costco", patterns: ["costco"], categoryHints: ["groceries", "supermarket", "household"] },
  { key: "hellofresh", label: "HelloFresh", matchValue: "hellofresh", patterns: ["hellofresh"], categoryHints: ["groceries", "food"] },
  { key: "marley-spoon", label: "Marley Spoon", matchValue: "marley spoon", patterns: ["marley spoon"], categoryHints: ["groceries", "food"] },

  // Coffee & Cafes
  { key: "campos", label: "Campos Coffee", matchValue: "campos", patterns: ["campos"], categoryHints: ["coffee", "cafe", "dining"] },
  { key: "starbucks", label: "Starbucks", matchValue: "starbucks", patterns: ["starbucks"], categoryHints: ["coffee", "cafe", "dining"] },
  { key: "gloria-jeans", label: "Gloria Jean's", matchValue: "gloria jean", patterns: ["gloria jeans", "gloria jean's"], categoryHints: ["coffee", "cafe", "dining"] },
  { key: "zarraffa", label: "Zarraffa's Coffee", matchValue: "zarraffa", patterns: ["zarraffa"], categoryHints: ["coffee", "cafe", "dining"] },
  { key: "muffin-break", label: "Muffin Break", matchValue: "muffin break", patterns: ["muffin break"], categoryHints: ["coffee", "cafe", "dining"] },
  { key: "coffee-club", label: "The Coffee Club", matchValue: "coffee club", patterns: ["coffee club"], categoryHints: ["coffee", "cafe", "dining"] },

  // Fuel
  { key: "bp", label: "BP Fuel", matchValue: "bp", patterns: ["bp connect", "bp express", "bp"], categoryHints: ["fuel", "petrol", "transport"] },
  { key: "ampol", label: "Ampol", matchValue: "ampol", patterns: ["ampol"], categoryHints: ["fuel", "petrol", "transport"] },
  { key: "caltex", label: "Caltex", matchValue: "caltex", patterns: ["caltex"], categoryHints: ["fuel", "petrol", "transport"] },
  { key: "shell", label: "Shell", matchValue: "shell", patterns: ["shell coles express", "shell"], categoryHints: ["fuel", "petrol", "transport"] },
  { key: "seven-eleven", label: "7-Eleven", matchValue: "7-eleven", patterns: ["7-eleven", "7 eleven"], categoryHints: ["fuel", "petrol", "transport"] },
  { key: "otr", label: "OTR", matchValue: "otr", patterns: ["otr"], categoryHints: ["fuel", "petrol", "transport"] },
  { key: "united-petroleum", label: "United Petroleum", matchValue: "united petroleum", patterns: ["united petroleum"], categoryHints: ["fuel", "petrol", "transport"] },
  { key: "liberty-oil", label: "Liberty Oil", matchValue: "liberty oil", patterns: ["liberty oil"], categoryHints: ["fuel", "petrol", "transport"] },
  { key: "metro-petroleum", label: "Metro Petroleum", matchValue: "metro petroleum", patterns: ["metro petroleum"], categoryHints: ["fuel", "petrol", "transport"] },

  // Rideshare, Public Transit & Tolls
  { key: "uber", label: "Uber", matchValue: "uber", patterns: ["uber *trip", "uber trip", "uber"], categoryHints: ["rideshare", "transit", "transport"] },
  { key: "didi", label: "DiDi", matchValue: "didi", patterns: ["didi mobility", "didi"], categoryHints: ["rideshare", "transit", "transport"] },
  { key: "linkt", label: "Linkt Tolls", matchValue: "linkt", patterns: ["linkt"], categoryHints: ["tolls", "transport"] },
  { key: "transurban", label: "Transurban", matchValue: "transurban", patterns: ["transurban"], categoryHints: ["tolls", "transport"] },
  { key: "opal", label: "Opal Card", matchValue: "opal", patterns: ["transport for nsw", "opal top up", "opal"], categoryHints: ["transit", "transport"] },
  { key: "myki", label: "myki", matchValue: "myki", patterns: ["myki", "ptv"], categoryHints: ["transit", "transport"] },
  { key: "adelaide-metro", label: "Adelaide Metro", matchValue: "adelaide metro", patterns: ["adelaide metro"], categoryHints: ["transit", "transport"] },
  { key: "translink", label: "Translink", matchValue: "translink", patterns: ["translink"], categoryHints: ["transit", "transport"] },
  { key: "wilson-parking", label: "Wilson Parking", matchValue: "wilson parking", patterns: ["wilson parking"], categoryHints: ["parking", "transport"] },
  { key: "secure-parking", label: "Secure Parking", matchValue: "secure parking", patterns: ["secure parking"], categoryHints: ["parking", "transport"] },

  // Health & Fitness
  { key: "anytime-fitness", label: "Anytime Fitness", matchValue: "anytime fitness", patterns: ["anytime fitness"], categoryHints: ["gym", "fitness", "health"] },
  { key: "fitness-first", label: "Fitness First", matchValue: "fitness first", patterns: ["fitness first"], categoryHints: ["gym", "fitness", "health"] },
  { key: "goodlife", label: "Goodlife Health Clubs", matchValue: "goodlife", patterns: ["goodlife"], categoryHints: ["gym", "fitness", "health"] },
  { key: "jetts", label: "Jetts Fitness", matchValue: "jetts", patterns: ["jetts"], categoryHints: ["gym", "fitness", "health"] },
  { key: "f45", label: "F45 Training", matchValue: "f45", patterns: ["f45"], categoryHints: ["gym", "fitness", "health"] },
  { key: "plus-fitness", label: "Plus Fitness", matchValue: "plus fitness", patterns: ["plus fitness"], categoryHints: ["gym", "fitness", "health"] },
  { key: "chemist-warehouse", label: "Chemist Warehouse", matchValue: "chemist warehouse", patterns: ["chemist warehouse"], categoryHints: ["pharmacy", "health"] },
  { key: "priceline", label: "Priceline Pharmacy", matchValue: "priceline", patterns: ["priceline"], categoryHints: ["pharmacy", "health"] },
  { key: "terrywhite", label: "TerryWhite Chemmart", matchValue: "terrywhite", patterns: ["terrywhite", "terry white"], categoryHints: ["pharmacy", "health"] },
  { key: "bupa", label: "Bupa", matchValue: "bupa", patterns: ["bupa"], categoryHints: ["health"] },
  { key: "medibank", label: "Medibank", matchValue: "medibank", patterns: ["medibank"], categoryHints: ["health"] },
  { key: "hcf", label: "HCF Health", matchValue: "hcf", patterns: ["hcf"], categoryHints: ["health"] },
  { key: "nib", label: "nib Health", matchValue: "nib", patterns: ["nib health"], categoryHints: ["health"] },
  { key: "ahm", label: "ahm Health", matchValue: "ahm", patterns: ["ahm health"], categoryHints: ["health"] },

  // Household & General Retail
  { key: "bunnings", label: "Bunnings Warehouse", matchValue: "bunnings", patterns: ["bunnings"], categoryHints: ["household", "hardware", "supplies"] },
  { key: "kmart", label: "Kmart", matchValue: "kmart", patterns: ["kmart"], categoryHints: ["household", "supplies", "shopping"] },
  { key: "target", label: "Target", matchValue: "target", patterns: ["target australia", "target"], categoryHints: ["household", "supplies", "shopping"] },
  { key: "big-w", label: "Big W", matchValue: "big w", patterns: ["big w"], categoryHints: ["household", "supplies", "shopping"] },
  { key: "ikea", label: "IKEA", matchValue: "ikea", patterns: ["ikea"], categoryHints: ["household", "supplies"] },
  { key: "officeworks", label: "Officeworks", matchValue: "officeworks", patterns: ["officeworks"], categoryHints: ["household", "supplies"] },
  { key: "jb-hifi", label: "JB Hi-Fi", matchValue: "jb hi", patterns: ["jb hi-fi", "jb hifi"], categoryHints: ["household", "shopping", "supplies"] },
  { key: "harvey-norman", label: "Harvey Norman", matchValue: "harvey norman", patterns: ["harvey norman"], categoryHints: ["household", "shopping", "supplies"] },
  { key: "amazon", label: "Amazon", matchValue: "amazon", patterns: ["amazon mktplc", "amazon.com", "amazon"], categoryHints: ["household", "shopping", "supplies"] },
  { key: "ebay", label: "eBay", matchValue: "ebay", patterns: ["ebay"], categoryHints: ["household", "shopping", "supplies"] },

  // Superannuation & Investments
  { key: "fhss-super", label: "Super / FHSS", matchValue: "fhss", patterns: ["fhss", "adf super", "australiansuper", "hostplus"], categoryHints: ["fhss", "super", "investment"] },
  { key: "investments", label: "Brokerage / ETFs", matchValue: "vanguard", patterns: ["vanguard", "betashares", "commsec", "pearler"], categoryHints: ["investment", "super"] },

  // Salary / Payroll Income
  { key: "payroll", label: "Salary / Payroll", matchValue: "payroll", patterns: ["payroll", "salary", "wages"], categoryHints: ["salary", "pay", "income"] },
];

const GENERIC_FILLER_WORDS = new Set([
  "payment",
  "payments",
  "pty",
  "ltd",
  "limited",
  "aus",
  "australia",
  "au",
  "inc",
  "llc",
  "co",
]);

function escapeRegexLiteral(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesSignaturePattern(text: string, pattern: string): boolean {
  const trimmed = pattern.trim().toLowerCase();
  if (!trimmed) return false;
  if (/^[a-z0-9\s]+$/.test(trimmed)) {
    return new RegExp(
      `(?:^|[^a-z0-9])${escapeRegexLiteral(trimmed)}(?:$|[^a-z0-9])`,
      "i"
    ).test(text);
  }
  return text.toLowerCase().includes(trimmed);
}

function toTitleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w.length <= 3 && w === w.toUpperCase()
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(" ");
}

/**
 * Normalizes a transaction merchant/description into a canonical matching key and concise "contains" rule pattern.
 */
export function normalizeMerchantPattern(input: {
  merchant?: string | null;
  cleanDescription?: string | null;
  rawDescription?: string | null;
}): NormalizedMerchant | null {
  const combined = [input.merchant, input.cleanDescription, input.rawDescription]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!combined) return null;

  for (const sig of AUSTRALIAN_MERCHANT_SIGNATURES) {
    if (sig.patterns.some((pat) => matchesSignaturePattern(combined, pat))) {
      return {
        key: sig.key,
        displayName: sig.label,
        matchValue: sig.matchValue,
        signature: sig,
      };
    }
  }

  let candidate = (
    input.merchant ||
    input.cleanDescription ||
    input.rawDescription ||
    ""
  ).trim();

  candidate = candidate
    .replace(
      /^(VISA PURCHASE|VISA DEBIT|EFTPOS|DIRECT DEBIT|DIRECT CREDIT|PAYMENT TO|PAYMENT BY|TRANSFER TO|DEBIT CARD PURCHASE|CARD PURCHASE|BPAY TO|BPAY|OSKO|PAYID|PENDING\s*-|SQ\s*\*|SP\s+|PP\*|PAYPAL\s*\*)\s*/i,
      ""
    )
    .replace(/\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)(\s+(AUS|AUSTRALIA))?.*$/i, "")
    .replace(/\s+(PTY\s+LTD|LIMITED|LTD|AUSTRALIA)\b.*$/i, "")
    .replace(/\s+CARD\s+\d{4}.*$/i, "")
    .replace(/\s+VALUE\s+DATE:.*$/i, "")
    .replace(/\b[A-Z]?\d{4,}\b/g, " ")
    .replace(/#[a-z0-9_-]+/gi, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ")
    .replace(/[^a-z0-9\s'&+-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = candidate
    .split(" ")
    .filter((w) => w.length > 0 && !GENERIC_FILLER_WORDS.has(w.toLowerCase()))
    .slice(0, 3);

  const joined = words.join(" ").trim();
  const normalizedValue = joined.toLowerCase();

  if (normalizedValue.length < 3 || /^\d+$/.test(normalizedValue)) {
    return null;
  }

  return {
    key: normalizedValue,
    displayName: toTitleCase(joined),
    matchValue: normalizedValue,
    signature: null,
  };
}

/**
 * Resolves the best category match for hint keywords, preferring nested sub-categories over broad parents.
 */
export function resolveCategoryByHints<T extends CategoryLike>(
  hints: string[],
  categories: T[],
  isCredit: boolean
): T | null {
  if (categories.length === 0 || hints.length === 0) return null;

  const compatible = categories.filter((c) =>
    isCredit ? c.type === "income" : c.type === "expense" || c.type === "investment"
  );
  const pool = compatible.length > 0 ? compatible : categories;

  for (const rawHint of hints) {
    const hint = rawHint.toLowerCase();
    const subMatch = pool.find(
      (c) =>
        Boolean(c.parentId) &&
        (c.name.toLowerCase().includes(hint) ||
          (c.slug || "").toLowerCase().includes(hint))
    );
    if (subMatch) return subMatch;

    const parentMatch = pool.find(
      (c) =>
        !c.parentId &&
        (c.name.toLowerCase().includes(hint) ||
          (c.slug || "").toLowerCase().includes(hint))
    );
    if (parentMatch) return parentMatch;
  }

  return null;
}

function detectRecurringCadence(dates: string[], amounts: number[]): boolean {
  if (dates.length < 2) return false;

  const absAmounts = amounts.map((a) => Math.abs(a)).filter((a) => a > 0);
  if (absAmounts.length >= 2) {
    const avg = absAmounts.reduce((s, a) => s + a, 0) / absAmounts.length;
    if (avg > 0 && absAmounts.every((a) => Math.abs(a - avg) / avg <= 0.15)) {
      return true;
    }
  }

  const timestamps = dates
    .map((d) => new Date(`${d}T00:00:00Z`).getTime())
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b);

  if (timestamps.length < 2) return false;

  const diffs: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    diffs.push(Math.round((timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60 * 24)));
  }
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  return (
    (median >= 6 && median <= 8) ||
    (median >= 13 && median <= 15) ||
    (median >= 27 && median <= 33)
  );
}

/**
 * Analyzes posted non-reversal transactions lacking active classification rules and produces
 * prioritized rule suggestions from user history, built-in AU merchant signatures, and repeated patterns.
 */
export function generateRuleSuggestions<
  C extends CategoryLike,
>(params: {
  transactions: Array<{
    id: string;
    importBatchId?: string | null;
    date: string;
    amount: string | number;
    merchant?: string | null;
    cleanDescription: string;
    rawDescription: string;
    status?: string;
    isReversal?: boolean;
    ledgerEntries: Array<{
      categoryId?: string | null;
      categoryName?: string;
    }>;
  }>;
  rules: ClassificationRuleItem[];
  categories: C[];
  minOccurrences?: number;
  includeSingleKnownMerchants?: boolean;
  onlyBatchId?: string;
}): RuleSuggestion[] {
  const {
    transactions,
    rules,
    categories,
    minOccurrences = 2,
    includeSingleKnownMerchants = true,
    onlyBatchId,
  } = params;

  const activeRules = rules.filter((r) => r.isActive);
  const existingPatternSet = new Set(
    rules
      .map((r) => r.matchValue.trim().toLowerCase().replace(/^%+|%+$/g, ""))
      .filter(Boolean)
  );
  const catById = new Map(categories.map((c) => [c.id, c]));

  type TxGroup = {
    normalized: NormalizedMerchant;
    dates: string[];
    amounts: number[];
    unclassifiedCount: number;
    categoryVotes: Map<string, number>;
    sampleDescriptions: string[];
    hasBatchMatch: boolean;
  };

  const groups = new Map<string, TxGroup>();

  for (const tx of transactions) {
    if (tx.status && tx.status !== "posted") continue;
    if (tx.isReversal) continue;

    if (
      findMatchingRule(
        {
          merchant: tx.merchant,
          rawDescription: tx.rawDescription,
          cleanDescription: tx.cleanDescription,
          amount: tx.amount,
        },
        activeRules
      )
    ) {
      continue;
    }

    const normalized = normalizeMerchantPattern(tx);
    if (!normalized) continue;
    if (existingPatternSet.has(normalized.matchValue)) continue;

    let group = groups.get(normalized.key);
    if (!group) {
      group = {
        normalized,
        dates: [],
        amounts: [],
        unclassifiedCount: 0,
        categoryVotes: new Map<string, number>(),
        sampleDescriptions: [],
        hasBatchMatch: false,
      };
      groups.set(normalized.key, group);
    }

    const numAmt = typeof tx.amount === "number" ? tx.amount : parseFloat(tx.amount) || 0;
    group.dates.push(tx.date);
    group.amounts.push(numAmt);
    if (onlyBatchId && tx.importBatchId === onlyBatchId) {
      group.hasBatchMatch = true;
    }
    if (
      tx.cleanDescription &&
      group.sampleDescriptions.length < 3 &&
      !group.sampleDescriptions.includes(tx.cleanDescription)
    ) {
      group.sampleDescriptions.push(tx.cleanDescription);
    }

    for (const le of tx.ledgerEntries) {
      if (!le.categoryId || le.categoryName === "Uncategorized") {
        group.unclassifiedCount += 1;
      } else if (catById.has(le.categoryId)) {
        group.categoryVotes.set(
          le.categoryId,
          (group.categoryVotes.get(le.categoryId) || 0) + 1
        );
      }
    }
  }

  const confidenceOrder: Record<RuleSuggestion["confidence"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const suggestions: RuleSuggestion[] = [];

  for (const group of groups.values()) {
    if (onlyBatchId && !group.hasBatchMatch) continue;

    const occurrenceCount = group.amounts.length;
    const avgSigned =
      group.amounts.reduce((s, a) => s + a, 0) / Math.max(1, occurrenceCount);
    const isCredit = avgSigned > 0;
    const avgAbs =
      Math.round(
        (group.amounts.reduce((s, a) => s + Math.abs(a), 0) /
          Math.max(1, occurrenceCount)) *
          100
      ) / 100;
    const isRecurring = detectRecurringCadence(group.dates, group.amounts);

    let totalVotes = 0;
    let topCatId: string | null = null;
    let topVotes = 0;
    for (const [cid, v] of group.categoryVotes.entries()) {
      totalVotes += v;
      if (v > topVotes) {
        topVotes = v;
        topCatId = cid;
      }
    }

    let matchedCat: C | null = null;
    let source: RuleSuggestion["source"] = "repeated_pattern";
    let confidence: RuleSuggestion["confidence"] = "low";
    let reason = `Repeated ${occurrenceCount} times without a rule`;

    if (topCatId && totalVotes > 0 && topVotes / totalVotes >= 0.7) {
      matchedCat = catById.get(topCatId) || null;
      if (matchedCat) {
        source = "user_history";
        confidence = "high";
        reason = `Learned from ${topVotes} categorized ${group.normalized.displayName} ${
          topVotes === 1 ? "tx" : "txs"
        }`;
      }
    }

    if (!matchedCat && group.normalized.signature) {
      const dirCat = resolveCategoryByHints(
        group.normalized.signature.categoryHints,
        categories,
        isCredit
      );
      if (dirCat) {
        matchedCat = dirCat;
        source = "merchant_directory";
        confidence = occurrenceCount >= 2 || isRecurring ? "high" : "medium";
        reason =
          occurrenceCount >= 2
            ? `Recognized ${group.normalized.displayName} (${occurrenceCount}× recurring pattern)`
            : `Recognized ${group.normalized.displayName} merchant`;
      }
    }

    const meetsThreshold =
      occurrenceCount >= minOccurrences ||
      (includeSingleKnownMerchants &&
        source === "merchant_directory" &&
        group.unclassifiedCount > 0);

    if (!meetsThreshold) continue;
    if (source === "repeated_pattern" && group.unclassifiedCount === 0) continue;

    suggestions.push({
      id: `sug-${group.normalized.key}`,
      merchantDisplay: group.normalized.displayName,
      suggestedRuleName: `${group.normalized.displayName} Auto-Tag`,
      field: "description",
      matchType: "contains",
      matchValue: group.normalized.matchValue,
      suggestedCategoryId: matchedCat?.id ?? null,
      suggestedCategoryLabel: matchedCat
        ? formatCategoryDisplayLabel(matchedCat.id, categories)
        : null,
      suggestedCategoryColor: matchedCat?.color ?? null,
      suggestedPriority: matchedCat?.parentId ? 25 : 45,
      confidence,
      source,
      reason,
      occurrenceCount,
      unclassifiedCount: group.unclassifiedCount,
      isRecurring,
      averageAmount: avgAbs,
      sampleDescriptions: group.sampleDescriptions,
    });
  }

  suggestions.sort(
    (a, b) =>
      confidenceOrder[a.confidence] - confidenceOrder[b.confidence] ||
      b.unclassifiedCount - a.unclassifiedCount ||
      b.occurrenceCount - a.occurrenceCount ||
      a.merchantDisplay.localeCompare(b.merchantDisplay)
  );

  return suggestions.slice(0, 15);
}

/**
 * Generates an instant one-click rule creation prompt when a user manually categorizes
 * or edits a single-category transaction whose merchant does not yet have an active rule.
 */
export function buildSingleTransactionRuleSuggestion<
  C extends CategoryLike,
>(params: {
  transaction: {
    id: string;
    merchant?: string | null;
    cleanDescription: string;
    rawDescription: string;
    amount: string | number;
  };
  categoryId: string;
  transactions: Array<{
    id: string;
    merchant?: string | null;
    cleanDescription: string;
    rawDescription: string;
    amount: string | number;
    status?: string;
    isReversal?: boolean;
    ledgerEntries: Array<{
      categoryId?: string | null;
      categoryName?: string;
    }>;
  }>;
  rules: ClassificationRuleItem[];
  categories: C[];
}): LearnOnEditSuggestion | null {
  const { transaction, categoryId, transactions, rules, categories } = params;
  if (!categoryId) return null;

  const targetCat = categories.find((c) => c.id === categoryId);
  if (!targetCat) return null;

  const activeRules = rules.filter((r) => r.isActive);
  if (
    findMatchingRule(
      {
        merchant: transaction.merchant,
        rawDescription: transaction.rawDescription,
        cleanDescription: transaction.cleanDescription,
        amount: transaction.amount,
      },
      activeRules
    )
  ) {
    return null;
  }

  const normalized = normalizeMerchantPattern(transaction);
  if (!normalized) return null;

  const existingPatternSet = new Set(
    rules
      .map((r) => r.matchValue.trim().toLowerCase().replace(/^%+|%+$/g, ""))
      .filter(Boolean)
  );
  if (existingPatternSet.has(normalized.matchValue)) return null;

  const syntheticRule: ClassificationRuleItem = {
    id: "preview-learn",
    name: "Preview",
    priority: 1,
    field: "description",
    matchType: "contains",
    matchValue: normalized.matchValue,
    targetCategoryId: targetCat.id,
    autoApply: true,
    isActive: true,
  };

  let alsoMatchesCount = 0;
  for (const other of transactions) {
    if (other.id === transaction.id) continue;
    if (other.status && other.status !== "posted") continue;
    if (other.isReversal) continue;

    const needsTag = other.ledgerEntries.some(
      (le) =>
        !le.categoryId ||
        le.categoryName === "Uncategorized" ||
        (Boolean(targetCat.parentId) && le.categoryId === targetCat.parentId)
    );
    if (!needsTag) continue;

    if (
      evaluateRuleMatch(syntheticRule, {
        merchant: other.merchant,
        rawDescription: other.rawDescription,
        cleanDescription: other.cleanDescription,
        amount: other.amount,
      })
    ) {
      alsoMatchesCount += 1;
    }
  }

  return {
    merchantDisplay: normalized.displayName,
    suggestedRuleName: `${normalized.displayName} Auto-Tag`,
    matchValue: normalized.matchValue,
    targetCategoryId: targetCat.id,
    targetCategoryLabel: formatCategoryDisplayLabel(targetCat.id, categories),
    suggestedPriority: targetCat.parentId ? 25 : 45,
    alsoMatchesCount,
  };
}
