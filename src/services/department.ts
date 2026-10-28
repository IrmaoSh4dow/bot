import { Prisma } from "../generated/prisma/client.js";
import { getPrismaClient } from "../database/client.js";
import { decimalFrom, money, saleTotal, type Decimal } from "./money.js";
import type { PaymentModeName } from "./payments.js";
import type { WeekPeriod } from "./week-period.js";

export interface AgentSalesTotal {
  badgeNumber: string;
  displayName: string | null;
  active: boolean;
  amount: string;
}

export interface PeriodPaymentLine {
  paidAt: Date;
  amount: string;
  mode: PaymentModeName;
  authorName: string | null;
  agentId: string | null;
}

export interface DepartmentStatement {
  period: WeekPeriod;
  agents: AgentSalesTotal[];
  payments: PeriodPaymentLine[];
  carried: string;
  weekSales: string;
  weekPayments: string;
  periodClosing: string;
  pending: string;
}

export function composeBalances(input: {
  salesBefore: Decimal;
  salesInPeriod: Decimal;
  salesAfter: Decimal;
  paymentsBefore: Decimal;
  paymentsInPeriod: Decimal;
  paymentsAfter: Decimal;
}): Pick<DepartmentStatement, "carried" | "weekSales" | "weekPayments" | "periodClosing" | "pending"> {
  const carried = input.salesBefore.minus(input.paymentsBefore);
  const periodClosing = carried.plus(input.salesInPeriod).minus(input.paymentsInPeriod);
  const pending = periodClosing.plus(input.salesAfter).minus(input.paymentsAfter);

  return {
    carried: money(carried),
    weekSales: money(input.salesInPeriod),
    weekPayments: money(input.paymentsInPeriod),
    periodClosing: money(periodClosing),
    pending: money(pending),
  };
}

export async function readDepartmentStatement(period: WeekPeriod): Promise<DepartmentStatement> {
  const db = getPrismaClient();
  const before = { lt: period.startsAt };
  const during = { gte: period.startsAt, lt: period.endsAt };
  const after = { gte: period.endsAt };

  const [salesBefore, salesInPeriod, salesAfter, paymentsBefore, paymentsInPeriod, paymentsAfter, grouped, paymentRows] =
    await Promise.all([
      sumSales(db, before),
      sumSales(db, during),
      sumSales(db, after),
      sumPayments(db, before),
      sumPayments(db, during),
      sumPayments(db, after),
      db.sale.groupBy({
        by: ["agentId"],
        where: { soldAt: during },
        _sum: { totalAmount: true },
      }),
      db.payment.findMany({
        where: { paidAt: during },
        orderBy: { paidAt: "asc" },
      }),
    ]);

  const agentIds = grouped.map((row) => row.agentId);
  const agents = agentIds.length === 0 ? [] : await db.agent.findMany({ where: { id: { in: agentIds } } });
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const lines = grouped.map((row) => {
    const agent = byId.get(row.agentId);
    return {
      badgeNumber: agent?.badgeNumber ?? row.agentId,
      displayName: agent?.displayName ?? null,
      active: agent?.active ?? false,
      amount: money(asDecimal(row._sum.totalAmount)),
    };
  });
  lines.sort((left, right) => left.badgeNumber.localeCompare(right.badgeNumber, "es"));

  const listed = lines.map((line) => decimalFrom(line.amount));
  if (listed.length > 0 && money(saleTotal(listed)) !== money(salesInPeriod)) {
    throw new Error("El desglose por agente no coincide con las ventas del periodo.");
  }

  return {
    period,
    agents: lines,
    payments: paymentRows.map((payment) => ({
      paidAt: payment.paidAt,
      amount: money(payment.amount),
      mode: payment.mode,
      authorName: payment.authorName,
      agentId: payment.agentId,
    })),
    ...composeBalances({
      salesBefore,
      salesInPeriod,
      salesAfter,
      paymentsBefore,
      paymentsInPeriod,
      paymentsAfter,
    }),
  };
}

export async function readPendingBalance(): Promise<Decimal> {
  const db = getPrismaClient();
  const sales = await sumSales(db);
  const payments = await sumPayments(db);
  return sales.minus(payments);
}

async function sumSales(
  db: Pick<Prisma.TransactionClient, "sale">,
  range?: { lt?: Date; gte?: Date },
): Promise<Decimal> {
  const result = await db.sale.aggregate({
    where: range ? { soldAt: range } : undefined,
    _sum: { totalAmount: true },
  });
  return asDecimal(result._sum.totalAmount);
}

async function sumPayments(
  db: Pick<Prisma.TransactionClient, "payment">,
  range?: { lt?: Date; gte?: Date },
): Promise<Decimal> {
  const result = await db.payment.aggregate({
    where: range ? { paidAt: range } : undefined,
    _sum: { amount: true },
  });
  return asDecimal(result._sum.amount);
}

function asDecimal(value: Prisma.Decimal | null): Decimal {
  return decimalFrom(value?.toString() ?? "0");
}
