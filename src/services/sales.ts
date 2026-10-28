import { Prisma } from "../generated/prisma/client.js";
import { getPrismaClient } from "../database/client.js";
import { deliverConfirmation } from "./deliver-confirmation.js";
import { money, quoteIsExact, type Decimal } from "./money.js";
import { canClaimNotification } from "./notification-claim.js";
import type { ResolvedSale, StoredLine } from "./resolve-sale.js";
import { toStoredLines } from "./resolve-sale.js";
import { formatSaleConfirmation } from "./sale-text.js";

const saleInclude = {
  agent: true,
  items: { orderBy: { position: "asc" as const } },
} satisfies Prisma.SaleInclude;

type SaleWithDetails = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

export interface SaleRecord {
  operationId: string;
  agentId: string;
  badgeNumber: string;
  discordThreadId: string;
  discordAuthorId: string;
  authorName: string;
  totalAmount: string;
  confirmationMessageId: string | null;
  lines: StoredLine[];
}

export interface NewSale {
  operationId: string;
  agentId: string;
  discordThreadId: string;
  discordAuthorId: string;
  authorName: string;
  rawContent: string;
  sale: ResolvedSale;
  soldAt: Date;
}

export async function findSaleByOperation(operationId: string): Promise<SaleRecord | null> {
  const sale = await getPrismaClient().sale.findUnique({
    where: { operationId },
    include: saleInclude,
  });

  return sale ? toSaleRecord(sale) : null;
}

export async function createSale(input: NewSale): Promise<{ sale: SaleRecord; created: boolean }> {
  const storedLines = toStoredLines(input.sale);
  if (!quoteIsExact(storedLines, money(input.sale.total))) {
    throw new Error("Los importes de la venta no cuadran. No se registró nada.");
  }

  const existing = await findSaleByOperation(input.operationId);
  if (existing) {
    return { sale: existing, created: false };
  }

  try {
    const sale = await getPrismaClient().$transaction(async (tx) => {
      const agent = await tx.agent.findUnique({
        where: { id: input.agentId },
        select: { active: true },
      });
      if (!agent?.active) {
        throw new Error("El agente está desactivado. No se registró ninguna venta.");
      }

      return tx.sale.create({
        data: {
          operationId: input.operationId,
          agentId: input.agentId,
          discordThreadId: input.discordThreadId,
          discordAuthorId: input.discordAuthorId,
          authorName: input.authorName,
          rawContent: input.rawContent,
          totalAmount: input.sale.total,
          soldAt: input.soldAt,
          items: {
            create: input.sale.lines.map((line) => ({
              position: line.position,
              productId: line.productId,
              productName: line.productName,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
            })),
          },
        },
        include: saleInclude,
      });
    });

    return { sale: toSaleRecord(sale), created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const raced = await findSaleByOperation(input.operationId);
    if (!raced) {
      throw error;
    }

    return { sale: raced, created: false };
  }
}

export async function publishSaleConfirmation(
  operationId: string,
  send: (content: string) => Promise<string>,
  now = new Date(),
): Promise<"sent" | "already-sent" | "in-progress"> {
  const prisma = getPrismaClient();
  const current = await prisma.sale.findUnique({
    where: { operationId },
    include: saleInclude,
  });

  if (!current) {
    throw new Error("No existe la venta que se quiere avisar.");
  }

  if (current.confirmationMessageId) {
    return "already-sent";
  }

  if (
    !canClaimNotification(
      {
        confirmationMessageId: current.confirmationMessageId,
        notificationClaimedAt: current.notificationClaimedAt,
      },
      now,
    )
  ) {
    return "in-progress";
  }

  const claimed = await prisma.sale.updateMany({
    where: {
      operationId,
      confirmationMessageId: null,
      notificationClaimedAt: current.notificationClaimedAt,
    },
    data: { notificationClaimedAt: now },
  });

  if (claimed.count !== 1) {
    const latest = await prisma.sale.findUnique({ where: { operationId } });
    return latest?.confirmationMessageId ? "already-sent" : "in-progress";
  }

  const record = toSaleRecord(current);
  const content = formatSaleConfirmation({
    badgeNumber: record.badgeNumber,
    lines: record.lines,
    totalAmount: record.totalAmount,
    authorName: record.authorName,
  });

  await deliverConfirmation({
    send: () => send(content),
    persist: (messageId) => persistConfirmation(operationId, messageId),
    releaseClaim: () => releaseClaim(operationId),
  });

  return "sent";
}

async function persistConfirmation(operationId: string, messageId: string): Promise<void> {
  const prisma = getPrismaClient();
  const current = await prisma.sale.findUnique({ where: { operationId } });

  if (current?.confirmationMessageId) {
    if (current.confirmationMessageId === messageId) {
      return;
    }

    throw new Error("La venta ya tiene otro aviso registrado.");
  }

  await prisma.sale.update({
    where: { operationId },
    data: {
      confirmationMessageId: messageId,
      notificationClaimedAt: null,
    },
  });
}

async function releaseClaim(operationId: string): Promise<void> {
  await getPrismaClient().sale.updateMany({
    where: { operationId, confirmationMessageId: null },
    data: { notificationClaimedAt: null },
  });
}

function toSaleRecord(sale: SaleWithDetails): SaleRecord {
  const lines: StoredLine[] = sale.items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: money(item.unitPrice as Decimal),
    lineTotal: money(item.lineTotal as Decimal),
    position: item.position,
  }));

  return {
    operationId: sale.operationId,
    agentId: sale.agentId,
    badgeNumber: sale.agent.badgeNumber,
    discordThreadId: sale.discordThreadId,
    discordAuthorId: sale.discordAuthorId,
    authorName: sale.authorName,
    totalAmount: money(sale.totalAmount as Decimal),
    confirmationMessageId: sale.confirmationMessageId,
    lines,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
