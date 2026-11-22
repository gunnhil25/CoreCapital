ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "goal_name" varchar(150) DEFAULT 'Mortgage Deposit Goal' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "target_date" date DEFAULT '2029-07-01' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "location_code" varchar(20) DEFAULT 'SA' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "custom_location_name" varchar(150);--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "is_first_home_buyer" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "custom_stamp_duty" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "use_live_liquid_savings" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "use_fhss" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "fhss_marginal_tax_rate_pct" numeric(5, 2) DEFAULT '32.50' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "use_dhoas" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_mode" varchar(20) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_enlistment_date" date;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_service_type" varchar(20) DEFAULT 'permanent' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_monthly_subsidy" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_loan_cap" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "property_goals" ADD COLUMN IF NOT EXISTS "dhoas_lump_sum_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
UPDATE "property_goals" SET "location_code" = 'VIC' WHERE "target_city" = 'Melbourne' AND "location_code" = 'SA';--> statement-breakpoint
UPDATE "property_goals" SET "target_date" = make_date("target_year", 7, 1) WHERE "target_year" <> 2029;