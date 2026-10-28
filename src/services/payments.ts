import { PaymentMode, Prisma } from "../generated/prisma/client.js";
import { getPrismaClient } from "../database/client.js";
import { AmountError, decimalFrom, money, type Decimal } from "./money.js";
import { DRAFT_TTL_MS } from "./sale-drafts.js";
import { ensureBillingPeriod } from "./billing-periods.js";
import { periodContaining } from "./week-period.js";

export const DEPARTMENT_ACCOUNT_ID = "department";
export type PaymentModeName = "total" | "partial";

const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export interface PaymentQuote {
  mode: PaymentModeName;
  amount: Decimal;
  previousBalance: Decimal;
  remainingBalance: Decimal;
}

export interface PaymentRecord {
  operationId: string;
  mode: PaymentModeName;
  amount: string;
  previousBalance: string;
  remainingBalance: string;
  paidAt: Date;
  authorName: string | null;
  periodStartsAt: Date | null;
  agentId: string | null;
}

export interface PaymentDraftRecord {
  operationId: string;
  discordAuthorId: string;
  authorName: string;
  mode: PaymentModeName;
  amount: string;
  previousBalance: string;
  remainingBalance: string;
  periodStartsAt: Date;
  expiresAt: Date;
}

export function proposePayment(
  pending: Decimal,
  mode: PaymentModeName,
  rawAmount: string | null,
): { ok: true; quote: PaymentQuote } | { ok: false; message: string } {
  if (pending.lt(0)) {
    return { ok: false, message: "El saldo pendiente es negativo. No se registró ningún pago." };
  }

  if (pending.isZero()) {
    return { ok: false, message: "No hay saldo pendiente. No se registró ningún pago." };
  }

  if (mode === "total") {
    if (rawAmount) {
      return {
        ok: false,
        message: "La modalidad total cobra el saldo completo. Quita el importe o elige abono parcial.",
      };
    }

    return {
      ok: true,
      quote: {
        mode,
        amount: pending,
        previousBalance: pending,
        remainingBalance: new Prisma.Decimal(0),
      },
    };
  }

  if (!rawAmount) {
    return { ok: false, message: "Indica el importe del abono parcial." };
  }

  if (!AMOUNT_PATTERN.test(rawAmount)) {
    return { ok: false, message: "El importe debe ser un número con hasta dos decimales. Ejemplo: 12.50" };
  }

  return acceptQuotedPayment({
    pending,
    mode,
    amount: decimalFrom(rawAmount),
    previousBalance: pending,
  });
}

export function acceptQuotedPayment(input: {
  pending: Decimal;
  mode: PaymentModeName;
  amount: Decimal;
  previousBalance: Decimal;
}): { ok: true; quote: PaymentQuote } | { ok: false; message: string } {
  if (money(input.pending) !== money(input.previousBalance)) {
    return {
      ok: false,
      message: "El saldo cambió desde el resumen. Ejecuta /pago otra vez. No se registró ningún pago.",
    };
  }

  let amount: Decimal;
  try {
    amount = assertPaymentAmount(input.amount);
  } catch {
    return { ok: false, message: "El importe del pago no es válido. No se registró ningún pago." };
  }

  if (input.mode === "total") {
    if (money(amount) !== money(input.pending)) {
      return {
        ok: false,
        message: "El saldo cambió desde el resumen. Ejecuta /pago otra vez. No se registró ningún pago.",
      };
    }
  } else if (!amount.lt(input.pending)) {
    return {
      ok: false,
      message: "El abono parcial tiene que ser inferior al saldo pendiente. No se registró ningún pago.",
    };
  }

  const remaining = input.pending.minus(amount);
  if (remaining.lt(0) || money(input.pending) !== money(amount.plus(remaining))) {
    return { ok: false, message: "El importe del pago no cuadra. No se registró ningún pago." };
  }

  return {
    ok: true,
    quote: {
      mode: input.mode,
      amount,
      previousBalance: input.pending,
      remainingBalance: remaining,
    },
  };
}

export function assertPaymentAmount(value: Decimal): Decimal {
  if (!value.isFinite() || value.isNaN() || value.lte(0) || value.decimalPlaces() > 2) {
    throw new AmountError("El importe del pago no es válido.");
  }

  return value;
}

export async function savePaymentDraft(input: {
  operationId: string;
  discordAuthorId: string;
  authorName: string;
  quote: PaymentQuote;
  periodStartsAt: Date;
  now: Date;
}): Promise<void> {
  const prisma = getPrismaClient();
  const data = {
    discordAuthorId: input.discordAuthorId,
    authorName: input.authorName,
    mode: prismaMode(input.quote.mode),
    amount: input.quote.amount,
    previousBalance: input.quote.previousBalance,
    remainingBalance: input.quote.remainingBalance,
    periodStartsAt: input.periodStartsAt,
    expiresAt: new Date(input.now.getTime() + DRAFT_TTL_MS),
  };

  await prisma.paymentDraft.deleteMany({ where: { expiresAt: { lt: input.now } } });
  await prisma.paymentDraft.upsert({
    where: { operationId: input.operationId },
    create: { operationId: input.operationId, ...data },
    update: data,
  });
}

export async function findPaymentDraft(operationId: string): Promise<PaymentDraftRecord | null> {
  const draft = await getPrismaClient().paymentDraft.findUnique({ where: { operationId } });
  if (!draft) {
    return null;
  }

  return {
    operationId: draft.operationId,
    discordAuthorId: draft.discordAuthorId,
    authorName: draft.authorName,
    mode: draft.mode,
    amount: money(draft.amount),
    previousBalance: money(draft.previousBalance),
    remainingBalance: money(draft.remainingBalance),
    periodStartsAt: draft.periodStartsAt,
    expiresAt: draft.expiresAt,
  };
}

export async function deletePaymentDraft(operationId: string): Promise<void> {
  await getPrismaClient().paymentDraft.deleteMany({ where: { operationId } });
}

export async function findPaymentByOperation(operationId: string): Promise<PaymentRecord | null> {
  const payment = await getPrismaClient().payment.findUnique({
    where: { operationId },
    include: { period: true },
  });
  return payment ? toPaymentRecord(payment) : null;
}

export async function createPayment(input: {
  operationId: string;
  mode: PaymentModeName;
  amount: Decimal;
  previousBalance: Decimal;
  discordAuthorId: string;
  authorName: string;
  paidAt: Date;
  timeZone: string;
}): Promise<{ payment: PaymentRecord; created: boolean }> {
  const existing = await findPaymentByOperation(input.operationId);
  if (existing) {
    return { payment: existing, created: false };
  }

  const period = await ensureBillingPeriod(periodContaining(input.paidAt, input.timeZone));

  try {
    const outcome = await getPrismaClient().$transaction(async (tx) => {
      await lockDepartment(tx);
      const raced = await tx.payment.findUnique({
        where: { operationId: input.operationId },
        include: { period: true },
      });
      if (raced) {
        return { payment: raced, created: false };
      }

      const pending = await pendingBalance(tx);
      const reviewed = acceptQuotedPayment({
        pending,
        mode: input.mode,
        amount: input.amount,
        previousBalance: input.previousBalance,
      });
      if (!reviewed.ok) {
        throw new PaymentRejected(reviewed.message);
      }

      const payment = await tx.payment.create({
        data: {
          operationId: input.operationId,
          mode: prismaMode(input.mode),
          amount: reviewed.quote.amount,
          previousBalance: reviewed.quote.previousBalance,
          remainingBalance: reviewed.quote.remainingBalance,
          paidAt: input.paidAt,
          discordAuthorId: input.discordAuthorId,
          authorName: input.authorName,
          periodId: period.id,
        },
        include: { period: true },
      });
      return { payment, created: true };
    });

    return { payment: toPaymentRecord(outcome.payment), created: outcome.created };
  } catch (error) {
    if (error instanceof PaymentRejected) {
      throw error;
    }

    if (!isUniqueViolation(error)) {
      throw error;
    }

    const raced = await findPaymentByOperation(input.operationId);
    if (!raced) {
      throw error;
    }

    return { payment: raced, created: false };
  }
}

export class PaymentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRejected";
  }
}

async function lockDepartment(tx: Prisma.TransactionClient): Promise<void> {
  await tx.departmentAccount.upsert({
    where: { id: DEPARTMENT_ACCOUNT_ID },
    create: { id: DEPARTMENT_ACCOUNT_ID },
    update: {},
  });
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM department_accounts WHERE id = ${DEPARTMENT_ACCOUNT_ID} FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error("No existe la cuenta del departamento.");
  }
}

async function pendingBalance(tx: Prisma.TransactionClient): Promise<Decimal> {
  const [sales, payments] = await Promise.all([
    tx.sale.aggregate({ _sum: { totalAmount: true } }),
    tx.payment.aggregate({ _sum: { amount: true } }),
  ]);
  const charged = decimalFrom(sales._sum.totalAmount?.toString() ?? "0");
  const paid = decimalFrom(payments._sum.amount?.toString() ?? "0");
  return charged.minus(paid);
}

function toPaymentRecord(payment: {
  operationId: string;
  mode: PaymentMode;
  amount: Prisma.Decimal;
  previousBalance: Prisma.Decimal | null;
  remainingBalance: Prisma.Decimal | null;
  paidAt: Date;
  authorName: string | null;
  agentId: string | null;
  period: { startsAt: Date } | null;
}): PaymentRecord {
  return {
    operationId: payment.operationId,
    mode: payment.mode,
    amount: money(payment.amount),
    previousBalance: payment.previousBalance ? money(payment.previousBalance) : money(payment.amount),
    remainingBalance: payment.remainingBalance ? money(payment.remainingBalance) : "0.00",
    paidAt: payment.paidAt,
    authorName: payment.authorName,
    periodStartsAt: payment.period?.startsAt ?? null,
    agentId: payment.agentId,
  };
}

function prismaMode(mode: PaymentModeName): PaymentMode {
  return mode === "total" ? PaymentMode.total : PaymentMode.partial;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
