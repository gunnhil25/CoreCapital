import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================================
// 1. USERS & PROFILES
// ============================================================================
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  passwordHash: text("password_hash").default("").notNull(),
  role: varchar("role", { length: 20 }).default("user").notNull(), // 'admin' | 'user'
  isActive: boolean("is_active").default(true).notNull(),
  sessionVersion: integer("session_version").default(1).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  avatarUrl: text("avatar_url"),
  baseCurrency: varchar("base_currency", { length: 3 }).default("AUD").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// 2. FINANCIAL ACCOUNTS
// ============================================================================
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 100 }).notNull(), // e.g. "Everyday Checking", "Mortgage Offset"
    institution: varchar("institution", { length: 100 }).notNull(), // e.g. "CommBank", "Macquarie", "ANZ"
    accountType: varchar("account_type", { length: 30 }).notNull(), // 'checking' | 'savings' | 'offset' | 'credit_card' | 'loan' | 'superannuation' | 'investment'
    accountNumberLast4: varchar("account_number_last_4", { length: 4 }),
    currency: varchar("currency", { length: 3 }).default("AUD").notNull(),
    currentBalance: numeric("current_balance", { precision: 12, scale: 2 }).default("0.00").notNull(),
    isOffsetAccount: boolean("is_offset_account").default(false).notNull(),
    interestRatePct: numeric("interest_rate_pct", { precision: 5, scale: 2 }), // e.g. 5.94% for mortgage/offset
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("accounts_user_idx").on(table.userId),
    index("accounts_type_idx").on(table.accountType),
  ]
);

// ============================================================================
// 3. CATEGORIES & TAXONOMY (Hierarchical)
// ============================================================================
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }), // null if system-level default
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    parentId: uuid("parent_id"), // Self-referencing foreign key for subcategories
    type: varchar("type", { length: 20 }).default("expense").notNull(), // 'income' | 'expense' | 'transfer' | 'investment'
    color: varchar("color", { length: 30 }).default("#0ea5e9").notNull(),
    icon: varchar("icon", { length: 50 }).default("Tag").notNull(),
    isSystem: boolean("is_system").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("categories_user_idx").on(table.userId),
    index("categories_parent_idx").on(table.parentId),
    index("categories_slug_idx").on(table.slug),
  ]
);

// ============================================================================
// 4. CLASSIFICATION & AUTO-CATEGORIZATION RULES
// ============================================================================
export const classificationRules = pgTable(
  "classification_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    priority: integer("priority").default(100).notNull(), // Lower number = higher priority
    field: varchar("field", { length: 50 }).default("description").notNull(), // 'description' | 'merchant' | 'amount'
    matchType: varchar("match_type", { length: 30 }).default("ilike").notNull(), // 'contains' | 'exact' | 'ilike' | 'starts_with' | 'regex'
    matchValue: varchar("match_value", { length: 255 }).notNull(), // e.g. "%woolworths%", "%mcdonalds%", "BPAY%DEFENCE"
    targetCategoryId: uuid("target_category_id")
      .references(() => categories.id, { onDelete: "cascade" })
      .notNull(),
    autoApply: boolean("auto_apply").default(true).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    matchCount: integer("match_count").default(0).notNull(),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("rules_user_idx").on(table.userId),
    index("rules_priority_idx").on(table.priority),
    index("rules_active_idx").on(table.isActive),
  ]
);

// ============================================================================
// 5. IMPORT BATCHES (CSV Statements & Automated Bank Ingestion)
// ============================================================================
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id")
      .references(() => accounts.id, { onDelete: "cascade" })
      .notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileHash: varchar("file_hash", { length: 64 }).notNull(), // SHA-256 preventing accidental re-upload of identical file
    bankFormat: varchar("bank_format", { length: 50 }).default("standard_csv").notNull(), // 'commbank' | 'macquarie' | 'anz' | 'nab' | 'generic_csv'
    totalRows: integer("total_rows").default(0).notNull(),
    importedRows: integer("imported_rows").default(0).notNull(),
    duplicateRows: integer("duplicate_rows").default(0).notNull(),
    status: varchar("status", { length: 30 }).default("completed").notNull(), // 'pending' | 'processing' | 'completed' | 'failed'
    errorMessage: text("error_message"),
    importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("import_batches_user_idx").on(table.userId),
    index("import_batches_account_idx").on(table.accountId),
    index("import_batches_hash_idx").on(table.fileHash),
  ]
);

// ============================================================================
// 6. TRANSACTIONS (External Financial Events - Immutable Ledger Backbone)
// ============================================================================
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id")
      .references(() => accounts.id, { onDelete: "cascade" })
      .notNull(),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
    date: date("date", { mode: "string" }).notNull(), // Transaction execution date (YYYY-MM-DD)
    postedDate: date("posted_date", { mode: "string" }), // Settlement date if distinct
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(), // Positive = Credit / Inflow; Negative = Debit / Outflow
    currency: varchar("currency", { length: 3 }).default("AUD").notNull(),
    merchant: varchar("merchant", { length: 255 }),
    cleanDescription: text("clean_description").notNull(),
    rawDescription: text("raw_description").notNull(),
    status: varchar("status", { length: 30 }).default("posted").notNull(), // 'pending' | 'posted' | 'reversed'
    isSplit: boolean("is_split").default(false).notNull(),
    
    // Immutable Reversal Architecture
    isReversal: boolean("is_reversal").default(false).notNull(),
    reversesTransactionId: uuid("reverses_transaction_id"), // Self-referencing link to the original transaction
    reversalReason: text("reversal_reason"),
    
    // Deduplication and External Integrity
    deduplicationHash: varchar("deduplication_hash", { length: 128 }), // SHA-256 (accountId + date + amount + rawDescription)
    notes: text("notes"),
    tags: text("tags").array(), // PostgreSQL text array
    receiptScanId: uuid("receipt_scan_id"), // Optional receipt scan linkage
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("transactions_user_idx").on(table.userId),
    index("transactions_account_idx").on(table.accountId),
    index("transactions_date_idx").on(table.date),
    index("transactions_dedup_idx").on(table.deduplicationHash),
    index("transactions_reverses_idx").on(table.reversesTransactionId),
    index("transactions_status_idx").on(table.status),
  ]
);

// ============================================================================
// 7. LEDGER ENTRIES (Double-Entry / Split Breakdown / Reversals)
// ============================================================================
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id")
      .references(() => transactions.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id")
      .references(() => accounts.id, { onDelete: "cascade" })
      .notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }), // null if unclassified/transfer
    entryType: varchar("entry_type", { length: 20 }).notNull(), // 'debit' | 'credit'
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(), // Always positive precision numeric
    description: text("description"), // Sub-item note (e.g. "$100 Groceries" vs "$50 Household goods")
    isReversal: boolean("is_reversal").default(false).notNull(),
    reversedEntryId: uuid("reversed_entry_id"), // Points to the original ledger entry being reversed
    sequenceIndex: integer("sequence_index").default(0).notNull(), // Ordering within a split transaction
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ledger_transaction_idx").on(table.transactionId),
    index("ledger_account_idx").on(table.accountId),
    index("ledger_category_idx").on(table.categoryId),
    index("ledger_reversed_entry_idx").on(table.reversedEntryId),
  ]
);

// ============================================================================
// 8. AUDIT LOGS (Immutable Compliance & System Action Trail)
// ============================================================================
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    entityType: varchar("entity_type", { length: 50 }).notNull(), // 'transaction' | 'ledger_entry' | 'account' | 'rule'
    entityId: uuid("entity_id").notNull(),
    action: varchar("action", { length: 40 }).notNull(), // 'INSERT' | 'REVERSAL' | 'CLASSIFY' | 'SPLIT' | 'IMPORT' | 'UPDATE_METADATA'
    previousState: jsonb("previous_state"),
    newState: jsonb("new_state"),
    clientIp: varchar("client_ip", { length: 45 }),
    userAgent: text("user_agent"),
    reason: text("reason"),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_user_idx").on(table.userId),
    index("audit_entity_idx").on(table.entityType, table.entityId),
    index("audit_action_idx").on(table.action),
    index("audit_timestamp_idx").on(table.timestamp),
  ]
);

// ============================================================================
// 9. SUBSCRIPTIONS & RECURRING EXPENSES
// ============================================================================
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: varchar("name", { length: 150 }).notNull(), // e.g. "Netflix Standard", "Anytime Fitness", "AWS Hosting"
    merchant: varchar("merchant", { length: 150 }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    billingCycle: varchar("billing_cycle", { length: 30 }).notNull(), // 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
    annualizedAmount: numeric("annualized_amount", { precision: 12, scale: 2 }).notNull(), // Calculated true annual cost
    startDate: date("start_date", { mode: "string" }).notNull(),
    nextBillingDate: date("next_billing_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    autoDetected: boolean("auto_detected").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    cancellationUrl: text("cancellation_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("subscriptions_user_idx").on(table.userId),
    index("subscriptions_active_idx").on(table.isActive),
    index("subscriptions_next_bill_idx").on(table.nextBillingDate),
  ]
);

// ============================================================================
// 10. CASH FLOW SCHEDULED ITEMS (30-day & 90-day Projections)
// ============================================================================
export const cashFlowScheduledItems = pgTable(
  "cash_flow_scheduled_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id")
      .references(() => accounts.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 150 }).notNull(), // e.g. "Fortnightly Pay", "Rent", "Council Rates"
    type: varchar("type", { length: 20 }).notNull(), // 'income' | 'expense'
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    frequency: varchar("frequency", { length: 30 }).notNull(), // 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually' | 'one_off'
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    nextOccurrenceDate: date("next_occurrence_date", { mode: "string" }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("cash_flow_user_idx").on(table.userId),
    index("cash_flow_account_idx").on(table.accountId),
    index("cash_flow_next_occ_idx").on(table.nextOccurrenceDate),
  ]
);

// ============================================================================
// 11. PROPERTY GOAL & DEPOSIT MODELING (Configurable Target, Location & Schemes)
// ============================================================================
export const propertyGoals = pgTable(
  "property_goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    goalName: varchar("goal_name", { length: 150 }).default("Mortgage Deposit Goal").notNull(),
    targetDate: date("target_date", { mode: "string" }).default("2029-07-01").notNull(),
    targetYear: integer("target_year").default(2029).notNull(),
    locationCode: varchar("location_code", { length: 20 }).default("SA").notNull(), // 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT' | 'CUSTOM'
    targetCity: varchar("target_city", { length: 100 }).default("Adelaide").notNull(),
    customLocationName: varchar("custom_location_name", { length: 150 }),
    isFirstHomeBuyer: boolean("is_first_home_buyer").default(true).notNull(),
    targetPropertyPrice: numeric("target_property_price", { precision: 12, scale: 2 }).notNull(),
    targetDepositPct: numeric("target_deposit_pct", { precision: 5, scale: 2 }).default("20.00").notNull(),
    targetDepositAmount: numeric("target_deposit_amount", { precision: 12, scale: 2 }).notNull(),
    estimatedStampDuty: numeric("estimated_stamp_duty", { precision: 12, scale: 2 }).default("0.00").notNull(),
    customStampDuty: numeric("custom_stamp_duty", { precision: 12, scale: 2 }),
    estimatedLmi: numeric("estimated_lmi", { precision: 12, scale: 2 }).default("0.00").notNull(), // Lenders Mortgage Insurance
    estimatedConveyancingAndFees: numeric("estimated_conveyancing_fees", { precision: 12, scale: 2 }).default("4000.00").notNull(),
    useLiveLiquidSavings: boolean("use_live_liquid_savings").default(true).notNull(),
    currentSavingsAllocated: numeric("current_savings_allocated", { precision: 12, scale: 2 }).default("0.00").notNull(),
    monthlySavingsContribution: numeric("monthly_savings_contribution", { precision: 12, scale: 2 }).default("0.00").notNull(),
    useFhss: boolean("use_fhss").default(false).notNull(),
    fhssMarginalTaxRatePct: numeric("fhss_marginal_tax_rate_pct", { precision: 5, scale: 2 }).default("32.50").notNull(),
    useDhoas: boolean("use_dhoas").default(false).notNull(),
    dhoasMode: varchar("dhoas_mode", { length: 20 }).default("auto").notNull(), // 'auto' | 'tier1' | 'tier2' | 'tier3' | 'custom'
    dhoasEnlistmentDate: date("dhoas_enlistment_date", { mode: "string" }),
    dhoasServiceType: varchar("dhoas_service_type", { length: 20 }).default("permanent").notNull(),
    dhoasMonthlySubsidy: numeric("dhoas_monthly_subsidy", { precision: 12, scale: 2 }),
    dhoasLoanCap: numeric("dhoas_loan_cap", { precision: 12, scale: 2 }),
    dhoasLumpSumAmount: numeric("dhoas_lump_sum_amount", { precision: 12, scale: 2 }).default("0.00").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("property_goals_user_idx").on(table.userId)]
);

// ============================================================================
// 12. FHSS SCHEME CONTRIBUTIONS (First Home Super Saver Tracker)
// ============================================================================
export const fhssContributions = pgTable(
  "fhss_contributions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    financialYear: varchar("financial_year", { length: 10 }).notNull(), // '2023-24' | '2024-25' | '2025-26' | '2026-27'
    contributionDate: date("contribution_date", { mode: "string" }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    contributionType: varchar("contribution_type", { length: 30 }).default("concessional").notNull(), // 'concessional' (pre-tax/BPAY) | 'non_concessional'
    superFundName: varchar("super_fund_name", { length: 150 }).notNull(), // e.g. "ADF Super", "AustralianSuper"
    bpayReference: varchar("bpay_reference", { length: 50 }),
    marginalTaxRatePct: numeric("marginal_tax_rate_pct", { precision: 5, scale: 2 }).default("32.50").notNull(),
    taxSavedEstimated: numeric("tax_saved_estimated", { precision: 12, scale: 2 }).default("0.00").notNull(),
    deemedEarningsRatePct: numeric("deemed_earnings_rate_pct", { precision: 5, scale: 2 }).default("7.15").notNull(), // Shortfall Interest Charge (SIC) deemed rate
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("fhss_user_idx").on(table.userId),
    index("fhss_fy_idx").on(table.financialYear),
    index("fhss_date_idx").on(table.contributionDate),
  ]
);

// ============================================================================
// 13. DHOAS SUBSIDY TIERS & DEFENCE SERVICE ACCRUAL
// ============================================================================
export const dhoasProfiles = pgTable(
  "dhoas_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    enlistmentDate: date("enlistment_date", { mode: "string" }).notNull(),
    serviceType: varchar("service_type", { length: 30 }).default("permanent").notNull(), // 'permanent' | 'reserve'
    currentServiceMonths: integer("current_service_months").default(0).notNull(),
    qualifyingServiceYears: numeric("qualifying_service_years", { precision: 5, scale: 2 }).default("0.00").notNull(),
    currentTier: integer("current_tier").default(0).notNull(), // 0 (<4 yrs), 1 (4-7 yrs), 2 (8-11 yrs), 3 (12+ yrs)
    projected2029Tier: integer("projected_2029_tier").default(2).notNull(),
    subsidisedLoanCap: numeric("subsidised_loan_cap", { precision: 12, scale: 2 }).default("0.00").notNull(), // e.g. Tier 1: $386k, Tier 2: $579k, Tier 3: $772k
    estimatedMonthlySubsidy: numeric("estimated_monthly_subsidy", { precision: 12, scale: 2 }).default("0.00").notNull(),
    partnerDefenceEligible: boolean("partner_defence_eligible").default(false).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("dhoas_user_idx").on(table.userId)]
);

// ============================================================================
// 14. BUDGET CAPS & ANOMALY TRACKING
// ============================================================================
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    categoryId: uuid("category_id")
      .references(() => categories.id, { onDelete: "cascade" })
      .notNull(),
    period: varchar("period", { length: 20 }).default("monthly").notNull(), // 'weekly' | 'monthly' | 'quarterly' | 'yearly'
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    alertThresholdPct: integer("alert_threshold_pct").default(80).notNull(), // Alert triggered at 80% of limit
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("budgets_user_idx").on(table.userId),
    index("budgets_category_idx").on(table.categoryId),
  ]
);

// ============================================================================
// 15. RECEIPT SCANS & OCR INTEGRATION HOOKS
// ============================================================================
export const receiptScans = pgTable(
  "receipt_scans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    imageUrl: text("image_url").notNull(),
    ocrRawText: text("ocr_raw_text"),
    extractedMerchant: varchar("extracted_merchant", { length: 255 }),
    extractedDate: date("extracted_date", { mode: "string" }),
    extractedTotal: numeric("extracted_total", { precision: 12, scale: 2 }),
    extractedGst: numeric("extracted_gst", { precision: 12, scale: 2 }),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }),
    status: varchar("status", { length: 30 }).default("pending").notNull(), // 'pending' | 'parsed' | 'linked' | 'failed'
    matchedTransactionId: uuid("matched_transaction_id"),
    parsedLineItems: jsonb("parsed_line_items"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("receipts_user_idx").on(table.userId),
    index("receipts_status_idx").on(table.status),
  ]
);

// ============================================================================
// 16. OPEN BANKING CONNECTIONS & HOOKS (CDR / Basiq / Frollo)
// ============================================================================
export const openBankingConnections = pgTable(
  "open_banking_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    provider: varchar("provider", { length: 50 }).notNull(), // 'basiq' | 'frollo' | 'australian_cdr'
    institutionId: varchar("institution_id", { length: 100 }).notNull(),
    connectionStatus: varchar("connection_status", { length: 30 }).default("active").notNull(), // 'active' | 'pending_auth' | 'expired' | 'revoked' | 'error'
    consentExpiryDate: timestamp("consent_expiry_date", { withTimezone: true }),
    externalConnectionId: varchar("external_connection_id", { length: 255 }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncStatus: varchar("last_sync_status", { length: 50 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("open_banking_user_idx").on(table.userId),
    index("open_banking_provider_idx").on(table.provider),
  ]
);

// ============================================================================
// RELATIONS DEFINITIONS (Drizzle ORM Query API)
// ============================================================================
export const usersRelations = relations(users, ({ many, one }) => ({
  accounts: many(accounts),
  categories: many(categories),
  classificationRules: many(classificationRules),
  transactions: many(transactions),
  subscriptions: many(subscriptions),
  propertyGoals: many(propertyGoals),
  fhssContributions: many(fhssContributions),
  dhoasProfiles: many(dhoasProfiles),
  budgets: many(budgets),
  receiptScans: many(receiptScans),
  openBankingConnections: many(openBankingConnections),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
  transactions: many(transactions),
  ledgerEntries: many(ledgerEntries),
  subscriptions: many(subscriptions),
  importBatches: many(importBatches),
  cashFlowItems: many(cashFlowScheduledItems),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(users, {
    fields: [categories.userId],
    references: [users.id],
  }),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "subcategories",
  }),
  subcategories: many(categories, {
    relationName: "subcategories",
  }),
  ledgerEntries: many(ledgerEntries),
  budgets: many(budgets),
  classificationRules: many(classificationRules),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  importBatch: one(importBatches, {
    fields: [transactions.importBatchId],
    references: [importBatches.id],
  }),
  ledgerEntries: many(ledgerEntries),
  reversedBy: one(transactions, {
    fields: [transactions.reversesTransactionId],
    references: [transactions.id],
    relationName: "reversalLink",
  }),
  reversalOrigin: many(transactions, {
    relationName: "reversalLink",
  }),
  receiptScan: one(receiptScans, {
    fields: [transactions.receiptScanId],
    references: [receiptScans.id],
  }),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  transaction: one(transactions, {
    fields: [ledgerEntries.transactionId],
    references: [transactions.id],
  }),
  account: one(accounts, {
    fields: [ledgerEntries.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [ledgerEntries.categoryId],
    references: [categories.id],
  }),
  reversedByEntry: one(ledgerEntries, {
    fields: [ledgerEntries.reversedEntryId],
    references: [ledgerEntries.id],
    relationName: "ledgerReversalLink",
  }),
}));

export const classificationRulesRelations = relations(classificationRules, ({ one }) => ({
  user: one(users, {
    fields: [classificationRules.userId],
    references: [users.id],
  }),
  targetCategory: one(categories, {
    fields: [classificationRules.targetCategoryId],
    references: [categories.id],
  }),
}));

export const importBatchesRelations = relations(importBatches, ({ one, many }) => ({
  user: one(users, {
    fields: [importBatches.userId],
    references: [users.id],
  }),
  account: one(accounts, {
    fields: [importBatches.accountId],
    references: [accounts.id],
  }),
  transactions: many(transactions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
  account: one(accounts, {
    fields: [subscriptions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [subscriptions.categoryId],
    references: [categories.id],
  }),
}));

export const budgetsRelations = relations(budgets, ({ one }) => ({
  user: one(users, {
    fields: [budgets.userId],
    references: [users.id],
  }),
  category: one(categories, {
    fields: [budgets.categoryId],
    references: [categories.id],
  }),
}));

export const propertyGoalsRelations = relations(propertyGoals, ({ one }) => ({
  user: one(users, {
    fields: [propertyGoals.userId],
    references: [users.id],
  }),
}));

export const fhssContributionsRelations = relations(fhssContributions, ({ one }) => ({
  user: one(users, {
    fields: [fhssContributions.userId],
    references: [users.id],
  }),
}));

export const dhoasProfilesRelations = relations(dhoasProfiles, ({ one }) => ({
  user: one(users, {
    fields: [dhoasProfiles.userId],
    references: [users.id],
  }),
}));

export const receiptScansRelations = relations(receiptScans, ({ one }) => ({
  user: one(users, {
    fields: [receiptScans.userId],
    references: [users.id],
  }),
  matchedTransaction: one(transactions, {
    fields: [receiptScans.matchedTransactionId],
    references: [transactions.id],
  }),
}));

export const openBankingConnectionsRelations = relations(openBankingConnections, ({ one }) => ({
  user: one(users, {
    fields: [openBankingConnections.userId],
    references: [users.id],
  }),
}));
