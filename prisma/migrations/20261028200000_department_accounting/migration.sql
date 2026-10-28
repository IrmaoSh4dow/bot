-- Alta de agentes, periodos semanales y pagos globales del departamento.
-- No borra ventas, artículos, agentes ni pagos ya guardados.

CREATE TYPE "payment_mode" AS ENUM ('total', 'partial');

ALTER TABLE "agents" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "department_accounts" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_accounts_pkey" PRIMARY KEY ("id")
);

INSERT INTO "department_accounts" ("id", "created_at")
VALUES ('department', CURRENT_TIMESTAMP);

CREATE TABLE "billing_periods" (
    "id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "summary_message_id" TEXT,
    "summary_channel_id" TEXT,
    "notification_claimed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_periods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_drafts" (
    "operation_id" TEXT NOT NULL,
    "discord_author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "previous_balance" DECIMAL(12,2) NOT NULL,
    "remaining_balance" DECIMAL(12,2) NOT NULL,
    "period_starts_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_drafts_pkey" PRIMARY KEY ("operation_id")
);

ALTER TABLE "payments" ALTER COLUMN "agent_id" DROP NOT NULL;

ALTER TABLE "payments" ADD COLUMN "operation_id" TEXT;
UPDATE "payments" SET "operation_id" = 'legacy-' || "id" WHERE "operation_id" IS NULL;
ALTER TABLE "payments" ALTER COLUMN "operation_id" SET NOT NULL;

ALTER TABLE "payments" ADD COLUMN "period_id" TEXT;
ALTER TABLE "payments" ADD COLUMN "mode" "payment_mode";
UPDATE "payments" SET "mode" = 'partial' WHERE "mode" IS NULL;
ALTER TABLE "payments" ALTER COLUMN "mode" SET NOT NULL;

ALTER TABLE "payments" ADD COLUMN "previous_balance" DECIMAL(12,2);
ALTER TABLE "payments" ADD COLUMN "remaining_balance" DECIMAL(12,2);
ALTER TABLE "payments" ADD COLUMN "discord_author_id" TEXT;
ALTER TABLE "payments" ADD COLUMN "author_name" TEXT;

CREATE UNIQUE INDEX "billing_periods_starts_at_key" ON "billing_periods"("starts_at");
CREATE UNIQUE INDEX "billing_periods_summary_message_id_key" ON "billing_periods"("summary_message_id");
CREATE UNIQUE INDEX "payments_operation_id_key" ON "payments"("operation_id");
CREATE INDEX "payments_period_id_idx" ON "payments"("period_id");

ALTER TABLE "payments" ADD CONSTRAINT "payments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_balance_covers_amount" CHECK (
    "previous_balance" IS NULL
    OR "remaining_balance" IS NULL
    OR (
        "amount" > 0
        AND "remaining_balance" >= 0
        AND "previous_balance" = "amount" + "remaining_balance"
    )
);
