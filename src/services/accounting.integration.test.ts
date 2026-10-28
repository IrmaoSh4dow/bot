import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { connectDatabase, disconnectDatabase, getPrismaClient } from "../database/client.js";
import { deactivateAgent, describeAgent, registerAgent } from "./agents.js";
import { readDepartmentStatement, readPendingBalance } from "./department.js";
import { decimalFrom, money, type Decimal } from "./money.js";
import { createPayment, PaymentRejected, proposePayment } from "./payments.js";
import type { ResolvedSale } from "./resolve-sale.js";
import { createSale } from "./sales.js";
import { periodContaining } from "./week-period.js";
import { publishPeriodSummary } from "./weekly-summary.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const zone = "America/Bogota";

describe(
  "contabilidad del departamento",
  { skip: databaseUrl ? false : "define TEST_DATABASE_URL para ejecutar la integración", concurrency: 1 },
  () => {
    const suffix = `${process.pid.toString(36)}${Date.now().toString(36)}`;
    const productIds: string[] = [];
    const agentIds: string[] = [];
    const saleIds: string[] = [];
    const paymentIds: string[] = [];
    const periodStarts: Date[] = [];

    before(async () => {
      await connectDatabase(databaseUrl ?? "");
      const prisma = getPrismaClient();
      const foreignSales = await prisma.sale.count({
        where: { operationId: { not: { startsWith: "test-" } } },
      });
      const foreignPayments = await prisma.payment.count({
        where: { operationId: { not: { startsWith: "test-" } } },
      });
      if (foreignSales > 0 || foreignPayments > 0) {
        throw new Error("La base de prueba ya tiene ventas o pagos ajenos. No se modificó la contabilidad.");
      }
    });

    after(async () => {
      if (!databaseUrl) {
        return;
      }

      try {
        const prisma = getPrismaClient();
        if (paymentIds.length > 0) {
          await prisma.paymentDraft.deleteMany({ where: { operationId: { in: paymentIds } } });
          await prisma.payment.deleteMany({ where: { operationId: { in: paymentIds } } });
        }
        if (saleIds.length > 0) {
          await prisma.sale.deleteMany({ where: { operationId: { in: saleIds } } });
        }
        if (periodStarts.length > 0) {
          await prisma.billingPeriod.deleteMany({ where: { startsAt: { in: periodStarts } } });
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

    it("impide repetir placa o hilo y conserva las ventas al desactivar", async () => {
      const productId = await createProduct("agente");
      const first = await registerAgent({
        badgeNumber: `T-${suffix}-a`,
        discordThreadId: `test-thread-${suffix}-a`,
        displayName: "Agente de prueba",
      });
      assert.equal(first.ok, true);
      if (!first.ok) {
        return;
      }
      agentIds.push(first.agent.id);

      const sameThread = await registerAgent({
        badgeNumber: `T-${suffix}-b`,
        discordThreadId: first.agent.discordThreadId,
        displayName: null,
      });
      const sameBadge = await registerAgent({
        badgeNumber: first.agent.badgeNumber,
        discordThreadId: `test-thread-${suffix}-b`,
        displayName: null,
      });
      assert.equal(sameThread.ok, false);
      assert.equal(sameBadge.ok, false);

      const operationId = trackSale(`test-sale-${suffix}-historial`);
      await createSale(saleInput(first.agent.id, productId, operationId, new Date("2026-10-20T15:00:00.000Z")));
      const deactivated = await deactivateAgent(first.agent.badgeNumber);
      assert.equal(deactivated.ok, true);
      if (!deactivated.ok) {
        return;
      }

      assert.equal(deactivated.agent.active, false);
      assert.equal(deactivated.agent.salesCount, 1);
      assert.equal(deactivated.agent.salesTotal, "2.50");
      await assert.rejects(
        () => createSale(saleInput(first.agent.id, productId, trackSale(`test-sale-${suffix}-rechazada`), new Date())),
        /desactivado/,
      );
      const details = await describeAgent(first.agent.id);
      assert.equal(details?.salesCount, 1);
      assert.equal(await getPrismaClient().sale.count({ where: { operationId } }), 1);
    });

    it("arrastra el saldo, acepta un abono y después el resto sin asignarlo a un agente", async () => {
      const productId = await createProduct("saldo");
      const agent = await registerAgent({
        badgeNumber: `T-${suffix}-c`,
        discordThreadId: `test-thread-${suffix}-c`,
        displayName: null,
      });
      assert.equal(agent.ok, true);
      if (!agent.ok) {
        return;
      }
      agentIds.push(agent.agent.id);

      const baseline = await readPendingBalance();
      const previousSale = trackSale(`test-sale-${suffix}-anterior`);
      await createSale(saleInput(agent.agent.id, productId, previousSale, new Date("2026-10-20T15:00:00.000Z")));
      const currentPeriod = periodContaining(new Date("2026-10-28T17:00:00.000Z"), zone);
      remember(currentPeriod.startsAt);
      remember(periodContaining(new Date("2026-10-20T15:00:00.000Z"), zone).startsAt);

      const beforePayment = await readDepartmentStatement(currentPeriod);
      assert.equal(beforePayment.weekSales, "0.00");
      assert.equal(beforePayment.carried, money(baseline.plus(decimalFrom("2.50"))));
      assert.equal(beforePayment.pending, beforePayment.carried);
      assert.equal(beforePayment.payments.length, 0);

      const repeated = await readDepartmentStatement(currentPeriod);
      assert.equal(repeated.pending, beforePayment.pending);
      assert.equal(await getPrismaClient().payment.count({ where: { operationId: { in: paymentIds } } }), 0);

      const partialQuote = proposePayment(decimalFrom(beforePayment.pending), "partial", "1.00");
      assert.equal(partialQuote.ok, true);
      if (!partialQuote.ok) {
        return;
      }

      const partialId = trackPayment(`test-pay-${suffix}-parcial`);
      const partial = await createPayment({
        operationId: partialId,
        mode: "partial",
        amount: partialQuote.quote.amount,
        previousBalance: partialQuote.quote.previousBalance,
        discordAuthorId: `test-author-${suffix}`,
        authorName: "Responsable de prueba",
        paidAt: new Date("2026-10-28T18:00:00.000Z"),
        timeZone: zone,
      });
      assert.equal(partial.created, true);
      assert.equal(partial.payment.agentId, null);
      assert.equal(partial.payment.mode, "partial");
      assert.equal(partial.payment.amount, "1.00");
      assert.equal(partial.payment.remainingBalance, money(decimalFrom(beforePayment.pending).minus("1.00")));

      const duplicate = await createPayment({
        operationId: partialId,
        mode: "partial",
        amount: partialQuote.quote.amount,
        previousBalance: partialQuote.quote.previousBalance,
        discordAuthorId: `test-author-${suffix}`,
        authorName: "Responsable de prueba",
        paidAt: new Date("2026-10-28T18:05:00.000Z"),
        timeZone: zone,
      });
      assert.equal(duplicate.created, false);
      assert.equal(await getPrismaClient().payment.count({ where: { operationId: partialId } }), 1);

      const pending = await readPendingBalance();
      const totalQuote = proposePayment(pending, "total", null);
      assert.equal(totalQuote.ok, true);
      if (!totalQuote.ok) {
        return;
      }
      const totalId = trackPayment(`test-pay-${suffix}-total`);
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          createPayment({
            operationId: totalId,
            mode: "total",
            amount: totalQuote.quote.amount,
            previousBalance: totalQuote.quote.previousBalance,
            discordAuthorId: `test-author-${suffix}`,
            authorName: "Responsable de prueba",
            paidAt: new Date("2026-10-28T19:00:00.000Z"),
            timeZone: zone,
          }),
        ),
      );
      assert.equal(results.filter((result) => result.created).length, 1);
      assert.equal(results.every((result) => result.payment.agentId === null), true);
      assert.equal(money(await readPendingBalance()), "0.00");

      const item = await getPrismaClient().saleItem.findFirst({ where: { sale: { operationId: previousSale } } });
      assert.ok(item);
      assert.equal(money(item.unitPrice), "1.25");
    });

    it("rechaza un pago mayor que el saldo y no deja un registro parcial", async () => {
      const productId = await createProduct("exceso");
      const agent = await registerAgent({
        badgeNumber: `T-${suffix}-d`,
        discordThreadId: `test-thread-${suffix}-d`,
        displayName: null,
      });
      assert.equal(agent.ok, true);
      if (!agent.ok) {
        return;
      }
      agentIds.push(agent.agent.id);
      const before = await readPendingBalance();
      await createSale(saleInput(agent.agent.id, productId, trackSale(`test-sale-${suffix}-exceso`), new Date("2026-10-28T17:00:00.000Z")));
      const pending = await readPendingBalance();
      const operationId = trackPayment(`test-pay-${suffix}-exceso`);
      remember(periodContaining(new Date("2026-10-28T17:00:00.000Z"), zone).startsAt);

      await assert.rejects(
        () =>
          createPayment({
            operationId,
            mode: "partial",
            amount: pending.plus("0.01"),
            previousBalance: pending,
            discordAuthorId: `test-author-${suffix}`,
            authorName: "Responsable de prueba",
            paidAt: new Date("2026-10-28T20:00:00.000Z"),
            timeZone: zone,
          }),
        PaymentRejected,
      );
      assert.equal(await getPrismaClient().payment.count({ where: { operationId } }), 0);
      assert.equal(money(await readPendingBalance()), money(before.plus("2.50")));
    });

    it("serializa dos pagos totales concurrentes sobre el mismo saldo", async () => {
      const productId = await createProduct("carrera");
      const agent = await registerAgent({
        badgeNumber: `T-${suffix}-e`,
        discordThreadId: `test-thread-${suffix}-e`,
        displayName: null,
      });
      assert.equal(agent.ok, true);
      if (!agent.ok) {
        return;
      }
      agentIds.push(agent.agent.id);
      const before = await readPendingBalance();
      await createSale(saleInput(agent.agent.id, productId, trackSale(`test-sale-${suffix}-carrera`), new Date("2026-10-28T17:00:00.000Z")));
      const pending = await readPendingBalance();
      assert.equal(money(pending.minus(before)), "2.50");
      const firstId = trackPayment(`test-pay-${suffix}-carrera-1`);
      const secondId = trackPayment(`test-pay-${suffix}-carrera-2`);
      remember(periodContaining(new Date(), zone).startsAt);

      const results = await Promise.allSettled([
        createPayment(paymentInput(firstId, pending)),
        createPayment(paymentInput(secondId, pending)),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      assert.equal(fulfilled.length, 1);
      assert.equal(await getPrismaClient().payment.count({ where: { operationId: { in: [firstId, secondId] } } }), 1);
      assert.equal(money(await readPendingBalance()), "0.00");
    });

    it("publica el resumen dominical una sola vez y no registra pagos", async () => {
      const productId = await createProduct("resumen");
      const agent = await registerAgent({
        badgeNumber: `T-${suffix}-f`,
        discordThreadId: `test-thread-${suffix}-f`,
        displayName: "Resumen",
      });
      assert.equal(agent.ok, true);
      if (!agent.ok) {
        return;
      }
      agentIds.push(agent.agent.id);
      const soldAt = new Date("2026-10-21T15:00:00.000Z");
      await createSale(saleInput(agent.agent.id, productId, trackSale(`test-sale-${suffix}-resumen`), soldAt));
      const period = periodContaining(soldAt, zone);
      remember(period.startsAt);
      const paymentsBefore = await getPrismaClient().payment.count();
      const firstView = await readDepartmentStatement(period);
      const secondView = await readDepartmentStatement(period);
      assert.equal(secondView.weekSales, firstView.weekSales);
      assert.equal(secondView.pending, firstView.pending);
      assert.equal(firstView.agents.find((line) => line.badgeNumber === agent.agent.badgeNumber)?.amount, "2.50");

      let sends = 0;
      const send = async () => {
        sends += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return `test-summary-${suffix}`;
      };
      const published = await Promise.all([
        publishPeriodSummary(period, `test-channel-${suffix}`, send),
        publishPeriodSummary(period, `test-channel-${suffix}`, send),
      ]);
      assert.equal(sends, 1);
      assert.equal(published.filter((result) => result === "sent").length, 1);
      const again = await publishPeriodSummary(period, `test-channel-${suffix}`, async () => {
        sends += 1;
        return `test-summary-${suffix}-otra`;
      });
      assert.equal(again, "already-sent");
      assert.equal(sends, 1);
      assert.equal(await getPrismaClient().payment.count(), paymentsBefore);

      const failedPeriod = periodContaining(new Date("2026-10-14T15:00:00.000Z"), zone);
      remember(failedPeriod.startsAt);
      let failures = 0;
      await assert.rejects(() =>
        publishPeriodSummary(failedPeriod, `test-channel-${suffix}`, async () => {
          failures += 1;
          throw new Error("discord");
        }),
      );
      const recovered = await publishPeriodSummary(failedPeriod, `test-channel-${suffix}`, async () => {
        failures += 1;
        return `test-summary-${suffix}-recuperado`;
      });
      assert.equal(recovered, "sent");
      assert.equal(failures, 2);
      assert.equal(await getPrismaClient().payment.count(), paymentsBefore);
    });

    async function createProduct(name: string): Promise<string> {
      const product = await getPrismaClient().product.create({
        data: {
          name: `test_${name}_${suffix}`,
          normalizedName: `test_${name}_${suffix}`,
          unitPrice: "1.25",
          active: true,
        },
      });
      productIds.push(product.id);
      return product.id;
    }

    function trackSale(operationId: string): string {
      saleIds.push(operationId);
      return operationId;
    }

    function trackPayment(operationId: string): string {
      paymentIds.push(operationId);
      return operationId;
    }

    function remember(startsAt: Date): void {
      if (!periodStarts.some((current) => current.getTime() === startsAt.getTime())) {
        periodStarts.push(startsAt);
      }
    }

    function paymentInput(operationId: string, pending: Decimal) {
      return {
        operationId,
        mode: "total" as const,
        amount: pending,
        previousBalance: pending,
        discordAuthorId: `test-author-${suffix}`,
        authorName: "Responsable de prueba",
        paidAt: new Date("2026-10-28T21:00:00.000Z"),
        timeZone: zone,
      };
    }
  },
);

function saleInput(agentId: string, productId: string, operationId: string, soldAt: Date) {
  const unitPrice = decimalFrom("1.25");
  const lineTotal = decimalFrom("2.50");
  const sale: ResolvedSale = {
    total: lineTotal,
    lines: [
      {
        productId,
        productName: "Producto de prueba",
        quantity: 2,
        unitPrice,
        lineTotal,
        position: 1,
      },
    ],
  };

  return {
    operationId,
    agentId,
    discordThreadId: `test-thread-${operationId}`,
    discordAuthorId: `test-author-${operationId}`,
    authorName: "Prueba",
    rawContent: "2 test",
    soldAt,
    sale,
  };
}
