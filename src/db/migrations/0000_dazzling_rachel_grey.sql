CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"institution" varchar(100) NOT NULL,
	"account_type" varchar(30) NOT NULL,
	"account_number_last_4" varchar(4),
	"currency" varchar(3) DEFAULT 'AUD' NOT NULL,
	"current_balance" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"is_offset_account" boolean DEFAULT false NOT NULL,
	"interest_rate_pct" numeric(5, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(40) NOT NULL,
	"previous_state" jsonb,
	"new_state" jsonb,
	"client_ip" varchar(45),
	"user_agent" text,
	"reason" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"period" varchar(20) DEFAULT 'monthly' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"alert_threshold_pct" integer DEFAULT 80 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_flow_scheduled_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"type" varchar(20) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"frequency" varchar(30) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"next_occurrence_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"parent_id" uuid,
	"type" varchar(20) DEFAULT 'expense' NOT NULL,
	"color" varchar(30) DEFAULT '#0ea5e9' NOT NULL,
	"icon" varchar(50) DEFAULT 'Tag' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"field" varchar(50) DEFAULT 'description' NOT NULL,
	"match_type" varchar(30) DEFAULT 'ilike' NOT NULL,
	"match_value" varchar(255) NOT NULL,
	"target_category_id" uuid NOT NULL,
	"auto_apply" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"match_count" integer DEFAULT 0 NOT NULL,
	"last_matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dhoas_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enlistment_date" date NOT NULL,
	"service_type" varchar(30) DEFAULT 'permanent' NOT NULL,
	"current_service_months" integer DEFAULT 0 NOT NULL,
	"qualifying_service_years" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"current_tier" integer DEFAULT 0 NOT NULL,
	"projected_2029_tier" integer DEFAULT 2 NOT NULL,
	"subsidised_loan_cap" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"estimated_monthly_subsidy" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"partner_defence_eligible" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fhss_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"financial_year" varchar(10) NOT NULL,
	"contribution_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"contribution_type" varchar(30) DEFAULT 'concessional' NOT NULL,
	"super_fund_name" varchar(150) NOT NULL,
	"bpay_reference" varchar(50),
	"marginal_tax_rate_pct" numeric(5, 2) DEFAULT '32.50' NOT NULL,
	"tax_saved_estimated" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"deemed_earnings_rate_pct" numeric(5, 2) DEFAULT '7.15' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"bank_format" varchar(50) DEFAULT 'standard_csv' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"status" varchar(30) DEFAULT 'completed' NOT NULL,
	"error_message" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"entry_type" varchar(20) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"reversed_entry_id" uuid,
	"sequence_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_banking_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"institution_id" varchar(100) NOT NULL,
	"connection_status" varchar(30) DEFAULT 'active' NOT NULL,
	"consent_expiry_date" timestamp with time zone,
	"external_connection_id" varchar(255),
	"last_synced_at" timestamp with time zone,
	"last_sync_status" varchar(50),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_year" integer DEFAULT 2029 NOT NULL,
	"target_city" varchar(100) DEFAULT 'Adelaide' NOT NULL,
	"target_property_price" numeric(12, 2) NOT NULL,
	"target_deposit_pct" numeric(5, 2) DEFAULT '20.00' NOT NULL,
	"target_deposit_amount" numeric(12, 2) NOT NULL,
	"estimated_stamp_duty" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"estimated_lmi" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"estimated_conveyancing_fees" numeric(12, 2) DEFAULT '4000.00' NOT NULL,
	"current_savings_allocated" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"monthly_savings_contribution" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"ocr_raw_text" text,
	"extracted_merchant" varchar(255),
	"extracted_date" date,
	"extracted_total" numeric(12, 2),
	"extracted_gst" numeric(12, 2),
	"confidence_score" numeric(5, 2),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"matched_transaction_id" uuid,
	"parsed_line_items" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"name" varchar(150) NOT NULL,
	"merchant" varchar(150),
	"amount" numeric(12, 2) NOT NULL,
	"billing_cycle" varchar(30) NOT NULL,
	"annualized_amount" numeric(12, 2) NOT NULL,
	"start_date" date NOT NULL,
	"next_billing_date" date NOT NULL,
	"end_date" date,
	"auto_detected" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"cancellation_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"import_batch_id" uuid,
	"date" date NOT NULL,
	"posted_date" date,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'AUD' NOT NULL,
	"merchant" varchar(255),
	"clean_description" text NOT NULL,
	"raw_description" text NOT NULL,
	"status" varchar(30) DEFAULT 'posted' NOT NULL,
	"is_split" boolean DEFAULT false NOT NULL,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"reverses_transaction_id" uuid,
	"reversal_reason" text,
	"deduplication_hash" varchar(128),
	"notes" text,
	"tags" text[],
	"receipt_scan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"password_hash" text DEFAULT '' NOT NULL,
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"last_login_at" timestamp with time zone,
	"avatar_url" text,
	"base_currency" varchar(3) DEFAULT 'AUD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_scheduled_items" ADD CONSTRAINT "cash_flow_scheduled_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_scheduled_items" ADD CONSTRAINT "cash_flow_scheduled_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_target_category_id_categories_id_fk" FOREIGN KEY ("target_category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dhoas_profiles" ADD CONSTRAINT "dhoas_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fhss_contributions" ADD CONSTRAINT "fhss_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_banking_connections" ADD CONSTRAINT "open_banking_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_goals" ADD CONSTRAINT "property_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "accounts_type_idx" ON "accounts" USING btree ("account_type");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_timestamp_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "budgets_user_idx" ON "budgets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "budgets_category_idx" ON "budgets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "cash_flow_user_idx" ON "cash_flow_scheduled_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cash_flow_account_idx" ON "cash_flow_scheduled_items" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "cash_flow_next_occ_idx" ON "cash_flow_scheduled_items" USING btree ("next_occurrence_date");--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "rules_user_idx" ON "classification_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rules_priority_idx" ON "classification_rules" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "rules_active_idx" ON "classification_rules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "dhoas_user_idx" ON "dhoas_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fhss_user_idx" ON "fhss_contributions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fhss_fy_idx" ON "fhss_contributions" USING btree ("financial_year");--> statement-breakpoint
CREATE INDEX "fhss_date_idx" ON "fhss_contributions" USING btree ("contribution_date");--> statement-breakpoint
CREATE INDEX "import_batches_user_idx" ON "import_batches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "import_batches_account_idx" ON "import_batches" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "import_batches_hash_idx" ON "import_batches" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "ledger_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_category_idx" ON "ledger_entries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "ledger_reversed_entry_idx" ON "ledger_entries" USING btree ("reversed_entry_id");--> statement-breakpoint
CREATE INDEX "open_banking_user_idx" ON "open_banking_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "open_banking_provider_idx" ON "open_banking_connections" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "property_goals_user_idx" ON "property_goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "receipts_user_idx" ON "receipt_scans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "receipts_status_idx" ON "receipt_scans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_active_idx" ON "subscriptions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "subscriptions_next_bill_idx" ON "subscriptions" USING btree ("next_billing_date");--> statement-breakpoint
CREATE INDEX "transactions_user_idx" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_account_idx" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transactions_date_idx" ON "transactions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "transactions_dedup_idx" ON "transactions" USING btree ("deduplication_hash");--> statement-breakpoint
CREATE INDEX "transactions_reverses_idx" ON "transactions" USING btree ("reverses_transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");