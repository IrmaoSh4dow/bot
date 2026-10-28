-- AlterTable
ALTER TABLE "products" ALTER COLUMN "unit_price" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sales" DROP COLUMN "discord_message_id";

ALTER TABLE "sales" ADD COLUMN "operation_id" TEXT NOT NULL,
ADD COLUMN "author_name" TEXT NOT NULL,
ADD COLUMN "total_amount" DECIMAL(12,2) NOT NULL,
ADD COLUMN "confirmation_message_id" TEXT,
ADD COLUMN "notification_claimed_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "sales_operation_id_key" ON "sales"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_confirmation_message_id_key" ON "sales"("confirmation_message_id");

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN "position" INTEGER NOT NULL;

-- DropIndex
DROP INDEX "sale_items_sale_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_sale_id_position_key" ON "sale_items"("sale_id", "position");

-- CreateTable
CREATE TABLE "sale_drafts" (
    "operation_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "discord_thread_id" TEXT NOT NULL,
    "discord_author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "raw_content" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sale_drafts_pkey" PRIMARY KEY ("operation_id")
);

-- CreateIndex
CREATE INDEX "sale_drafts_agent_id_idx" ON "sale_drafts"("agent_id");

-- AddForeignKey
ALTER TABLE "sale_drafts" ADD CONSTRAINT "sale_drafts_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Insert catalog without prices. The names are fixed; the prices are not.
INSERT INTO "products" ("id", "name", "normalized_name", "unit_price", "active", "created_at", "updated_at")
VALUES
    ('catalog_vendas', 'Vendas', 'vendas', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('catalog_botiquines', 'Botiquines', 'botiquines', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('catalog_chalecos', 'Chalecos', 'chalecos', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("normalized_name") DO NOTHING;
