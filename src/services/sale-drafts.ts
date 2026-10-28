import { Prisma } from "../generated/prisma/client.js";
import { getPrismaClient } from "../database/client.js";
import { money, type Decimal } from "./money.js";
import { readStoredLines, toStoredLines, type ResolvedSale, type StoredLine } from "./resolve-sale.js";

export const DRAFT_TTL_MS = 15 * 60 * 1000;

export interface NewSaleDraft {
  operationId: string;
  agentId: string;
  discordThreadId: string;
  discordAuthorId: string;
  authorName: string;
  rawContent: string;
  sale: ResolvedSale;
  now: Date;
}

export interface SaleDraftRecord {
  operationId: string;
  agentId: string;
  discordThreadId: string;
  discordAuthorId: string;
  authorName: string;
  rawContent: string;
  lines: StoredLine[];
  totalAmount: string;
  expiresAt: Date;
}

export async function saveSaleDraft(draft: NewSaleDraft): Promise<void> {
  const lines = toStoredLines(draft.sale);
  const data = {
    agentId: draft.agentId,
    discordThreadId: draft.discordThreadId,
    discordAuthorId: draft.discordAuthorId,
    authorName: draft.authorName,
    rawContent: draft.rawContent,
    lines: lines as unknown as Prisma.InputJsonValue,
    totalAmount: draft.sale.total,
    expiresAt: new Date(draft.now.getTime() + DRAFT_TTL_MS),
  };

  const prisma = getPrismaClient();
  await prisma.saleDraft.deleteMany({
    where: { expiresAt: { lt: draft.now } },
  });

  await prisma.saleDraft.upsert({
    where: { operationId: draft.operationId },
    create: { operationId: draft.operationId, ...data },
    update: data,
  });
}

export async function findSaleDraft(operationId: string): Promise<SaleDraftRecord | null> {
  const draft = await getPrismaClient().saleDraft.findUnique({
    where: { operationId },
  });

  if (!draft) {
    return null;
  }

  const lines = readStoredLines(draft.lines);
  if (!lines) {
    return null;
  }

  return {
    operationId: draft.operationId,
    agentId: draft.agentId,
    discordThreadId: draft.discordThreadId,
    discordAuthorId: draft.discordAuthorId,
    authorName: draft.authorName,
    rawContent: draft.rawContent,
    lines,
    totalAmount: money(draft.totalAmount as Decimal),
    expiresAt: draft.expiresAt,
  };
}

export async function deleteSaleDraft(operationId: string): Promise<void> {
  await getPrismaClient().saleDraft.deleteMany({
    where: { operationId },
  });
}
