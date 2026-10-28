import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { connectDatabase, disconnectDatabase, getPrismaClient } from "../database/client.js";
import { decimalFrom, money } from "./money.js";
import type { ResolvedSale } from "./resolve-sale.js";
import { createSale, publishSaleConfirmation } from "./sales.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe(
  "ventas en PostgreSQL",
  { skip: databaseUrl ? false : "define TEST_DATABASE_URL para ejecutar la integración" },
  () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const productIds: string[] = [];
    const agentIds: string[] = [];
    const operationIds: string[] = [];

    before(async () => {
      await connectDatabase(databaseUrl ?? "");
    });

    after(async () => {
      if (!databaseUrl) {
        return;
      }

      try {
        const prisma = getPrismaClient();
        if (operationIds.length > 0) {
          await prisma.sale.deleteMany({ where: { operationId: { in: operationIds } } });
        }
        if (agentIds.length > 0) {
          await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
        }
        if (productIds.length > 0) {
          await prisma.product.deleteMany({ where: { id: { in: productIds } } });
        }
      } finally {
        await disconnectDatabase();
      }
    });

    it("registra una sola venta ante confirmaciones concurrentes", async () => {
      const fixture = await createFixture("concurrente");
      const input = saleInput(fixture, `test-op-${suffix}-concurrente`);
      operationIds.push(input.operationId);

      const results = await Promise.all(Array.from({ length: 8 }, () => createSale(input)));
      const created = results.filter((result) => result.created);

      assert.equal(created.length, 1);
      const sales = await getPrismaClient().sale.findMany({
        where: { operationId: input.operationId },
        include: { items: true },
      });
      const sale = sales[0];
      assert.ok(sale);
      assert.equal(sales.length, 1);
      assert.equal(sale.items.length, input.sale.lines.length);
      assert.equal(money(sale.totalAmount), money(input.sale.total));
    });

    it("revierte la transacción si un artículo no puede guardarse", async () => {
      const fixture = await createFixture("rollback");
      const operationId = `test-op-${suffix}-rollback`;
      operationIds.push(operationId);
      const valid = saleInput(fixture, operationId).sale.lines[0];
      assert.ok(valid);

      await assert.rejects(() =>
        createSale({
          ...saleInput(fixture, operationId),
          sale: {
            total: decimalFrom("5.00"),
            lines: [
              valid,
              {
                ...valid,
                position: 2,
                productId: `test-producto-inexistente-${suffix}`,
              },
            ],
          },
        }),
      );

      const count = await getPrismaClient().sale.count({ where: { operationId } });
      assert.equal(count, 0);
    });

    it("no inserta una venta cuyo total no cuadra", async () => {
      const fixture = await createFixture("importe");
      const operationId = `test-op-${suffix}-importe`;
      operationIds.push(operationId);
      const input = saleInput(fixture, operationId);
      input.sale = { ...input.sale, total: decimalFrom("9.99") };

      await assert.rejects(() => createSale(input), /no cuadran/);
      const count = await getPrismaClient().sale.count({ where: { operationId } });
      assert.equal(count, 0);
    });

    it("conserva el precio aplicado aunque cambie el catálogo", async () => {
      const fixture = await createFixture("historico");
      const input = saleInput(fixture, `test-op-${suffix}-historico`);
      operationIds.push(input.operationId);
      const applied = input.sale.lines[0]?.unitPrice;
      assert.ok(applied);

      await createSale(input);
      await getPrismaClient().product.update({
        where: { id: fixture.productId },
        data: { unitPrice: "8.40" },
      });

      const item = await getPrismaClient().saleItem.findFirst({
        where: { sale: { operationId: input.operationId } },
      });
      assert.ok(item);
      assert.equal(money(item.unitPrice), money(applied));
    });

    it("publica el aviso una sola vez y permite reintentarlo si Discord falla", async () => {
      const fixture = await createFixture("aviso");
      const input = saleInput(fixture, `test-op-${suffix}-aviso`);
      operationIds.push(input.operationId);
      await createSale(input);

      let failedSends = 0;
      await assert.rejects(() =>
        publishSaleConfirmation(input.operationId, async () => {
          failedSends += 1;
          throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
        }),
      );

      const pending = await getPrismaClient().sale.findUnique({ where: { operationId: input.operationId } });
      assert.equal(pending?.confirmationMessageId, null);
      assert.equal(pending?.notificationClaimedAt, null);
      assert.equal(await getPrismaClient().sale.count({ where: { operationId: input.operationId } }), 1);

      let sends = 0;
      const send = async () => {
        sends += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return `test-message-${suffix}`;
      };
      const published = await Promise.all([
        publishSaleConfirmation(input.operationId, send),
        publishSaleConfirmation(input.operationId, send),
      ]);

      assert.equal(sends, 1);
      assert.equal(published.filter((result) => result === "sent").length, 1);
      const stored = await getPrismaClient().sale.findUnique({ where: { operationId: input.operationId } });
      assert.equal(stored?.confirmationMessageId, `test-message-${suffix}`);

      let repeated = 0;
      const again = await publishSaleConfirmation(input.operationId, async () => {
        repeated += 1;
        return `test-message-${suffix}-otra`;
      });
      assert.equal(again, "already-sent");
      assert.equal(repeated, 0);
      assert.equal(failedSends, 1);
    });

    it("no reenvía un aviso cuyo identificador no se pudo guardar", async () => {
      const fixture = await createFixture("persistencia");
      const blocking = saleInput(fixture, `test-op-${suffix}-bloqueo`);
      const target = saleInput(fixture, `test-op-${suffix}-objetivo`);
      operationIds.push(blocking.operationId, target.operationId);
      await createSale(blocking);
      await createSale(target);
      const messageId = `test-message-${suffix}-ocupado`;
      await getPrismaClient().sale.update({
        where: { operationId: blocking.operationId },
        data: { confirmationMessageId: messageId },
      });

      let sends = 0;
      await assert.rejects(() =>
        publishSaleConfirmation(target.operationId, async () => {
          sends += 1;
          return messageId;
        }),
      );

      const held = await getPrismaClient().sale.findUnique({ where: { operationId: target.operationId } });
      assert.equal(held?.confirmationMessageId, null);
      assert.ok(held?.notificationClaimedAt);

      const retry = await publishSaleConfirmation(target.operationId, async () => {
        sends += 1;
        return `${messageId}-nuevo`;
      });
      assert.equal(retry, "in-progress");
      assert.equal(sends, 1);
      assert.equal(await getPrismaClient().sale.count({ where: { agentId: fixture.agentId } }), 2);
    });

    async function createFixture(name: string): Promise<{ productId: string; agentId: string }> {
      const prisma = getPrismaClient();
      const product = await prisma.product.create({
        data: {
          name: `test_${name}_${suffix}`,
          normalizedName: `test_${name}_${suffix}`,
          unitPrice: "1.25",
          active: true,
        },
      });
      const agent = await prisma.agent.create({
        data: {
          badgeNumber: `test-${name}-${suffix}`,
          discordThreadId: `test-thread-${name}-${suffix}`,
          displayName: `test ${name}`,
        },
      });
      productIds.push(product.id);
      agentIds.push(agent.id);
      return { productId: product.id, agentId: agent.id };
    }
  },
);

function saleInput(
  fixture: { productId: string; agentId: string },
  operationId: string,
): {
  operationId: string;
  agentId: string;
  discordThreadId: string;
  discordAuthorId: string;
  authorName: string;
  rawContent: string;
  sale: ResolvedSale;
  soldAt: Date;
} {
  const unitPrice = decimalFrom("1.25");
  const lineTotal = decimalFrom("2.50");

  return {
    operationId,
    agentId: fixture.agentId,
    discordThreadId: `test-thread-${operationId}`,
    discordAuthorId: `test-author-${operationId}`,
    authorName: "Prueba",
    rawContent: "2 test",
    soldAt: new Date("2026-10-28T12:00:00.000Z"),
    sale: {
      total: decimalFrom("2.50"),
      lines: [
        {
          productId: fixture.productId,
          productName: "Producto de prueba",
          quantity: 2,
          unitPrice,
          lineTotal,
          position: 1,
        },
      ],
    },
  };
}
