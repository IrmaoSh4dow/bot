-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "pending_review_status" AS ENUM ('pending', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "badge_number" TEXT NOT NULL,
    "discord_thread_id" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "discord_message_id" TEXT NOT NULL,
    "discord_thread_id" TEXT NOT NULL,
    "discord_author_id" TEXT NOT NULL,
    "raw_content" TEXT NOT NULL,
    "sold_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "discord_message_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_review_messages" (
    "id" TEXT NOT NULL,
    "discord_message_id" TEXT NOT NULL,
    "discord_thread_id" TEXT NOT NULL,
    "discord_author_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "raw_content" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "pending_review_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "pending_review_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_name_key" ON "products"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_normalized_name_key" ON "products"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "agents_badge_number_key" ON "agents"("badge_number");

-- CreateIndex
CREATE UNIQUE INDEX "agents_discord_thread_id_key" ON "agents"("discord_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_discord_message_id_key" ON "sales"("discord_message_id");

-- CreateIndex
CREATE INDEX "sales_agent_id_idx" ON "sales"("agent_id");

-- CreateIndex
CREATE INDEX "sales_sold_at_idx" ON "sales"("sold_at");

-- CreateIndex
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_discord_message_id_key" ON "payments"("discord_message_id");

-- CreateIndex
CREATE INDEX "payments_agent_id_idx" ON "payments"("agent_id");

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "pending_review_messages_discord_message_id_key" ON "pending_review_messages"("discord_message_id");

-- CreateIndex
CREATE INDEX "pending_review_messages_status_created_at_idx" ON "pending_review_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "pending_review_messages_agent_id_idx" ON "pending_review_messages"("agent_id");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_review_messages" ADD CONSTRAINT "pending_review_messages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
