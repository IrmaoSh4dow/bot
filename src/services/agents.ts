import { getPrismaClient } from "../database/client.js";
import { decimalFrom, money } from "./money.js";

export interface AgentRecord {
  id: string;
  badgeNumber: string;
  discordThreadId: string;
  displayName: string | null;
  active: boolean;
}

export interface AgentDetails extends AgentRecord {
  salesCount: number;
  salesTotal: string;
}

export function normalizeBadge(raw: string): { ok: true; badge: string } | { ok: false; message: string } {
  const badge = raw.trim();
  if (!badge || badge.length > 32 || /[\r\n]/.test(badge)) {
    return { ok: false, message: "La placa debe tener entre 1 y 32 caracteres." };
  }

  return { ok: true, badge };
}

export async function findAgentByThreadId(threadId: string): Promise<AgentRecord | null> {
  const agent = await getPrismaClient().agent.findUnique({ where: { discordThreadId: threadId } });
  return agent ? toAgentRecord(agent) : null;
}

export async function findAgentByBadge(badgeNumber: string): Promise<AgentRecord | null> {
  const agent = await getPrismaClient().agent.findUnique({ where: { badgeNumber } });
  return agent ? toAgentRecord(agent) : null;
}

export async function describeAgent(agentId: string): Promise<AgentDetails | null> {
  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    return null;
  }

  const sales = await prisma.sale.aggregate({
    where: { agentId },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });

  return {
    ...toAgentRecord(agent),
    salesCount: sales._count._all,
    salesTotal: money(decimalFrom(sales._sum.totalAmount?.toString() ?? "0")),
  };
}

export async function registerAgent(input: {
  badgeNumber: string;
  discordThreadId: string;
  displayName: string | null;
}): Promise<{ ok: true; agent: AgentRecord } | { ok: false; message: string }> {
  const badge = normalizeBadge(input.badgeNumber);
  if (!badge.ok) {
    return badge;
  }

  const displayName = normalizeDisplayName(input.displayName);
  if (!displayName.ok) {
    return displayName;
  }

  const prisma = getPrismaClient();
  const [byThread, byBadge] = await Promise.all([
    prisma.agent.findUnique({ where: { discordThreadId: input.discordThreadId } }),
    prisma.agent.findUnique({ where: { badgeNumber: badge.badge } }),
  ]);

  if (byThread) {
    return { ok: false, message: "Ese hilo ya está asociado a un agente." };
  }

  if (byBadge) {
    return { ok: false, message: "Esa placa ya está registrada." };
  }

  try {
    const agent = await prisma.agent.create({
      data: {
        badgeNumber: badge.badge,
        discordThreadId: input.discordThreadId,
        displayName: displayName.name,
        active: true,
      },
    });
    return { ok: true, agent: toAgentRecord(agent) };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const target = uniqueTarget(error);
    if (target.includes("discord_thread")) {
      return { ok: false, message: "Ese hilo ya está asociado a un agente." };
    }

    return { ok: false, message: "La placa o el hilo ya están registrados." };
  }
}

export async function deactivateAgent(
  badgeNumber: string,
): Promise<{ ok: true; agent: AgentDetails } | { ok: false; message: string }> {
  const badge = normalizeBadge(badgeNumber);
  if (!badge.ok) {
    return badge;
  }

  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({ where: { badgeNumber: badge.badge } });
  if (!agent) {
    return { ok: false, message: "No hay un agente con esa placa." };
  }

  if (!agent.active) {
    const details = await describeAgent(agent.id);
    if (!details) {
      return { ok: false, message: "No hay un agente con esa placa." };
    }

    return {
      ok: false,
      message: `La placa ${details.badgeNumber} ya está desactivada. Sus ventas siguen en el historial (${details.salesCount}).`,
    };
  }

  await prisma.agent.update({
    where: { id: agent.id },
    data: { active: false },
  });
  const details = await describeAgent(agent.id);
  if (!details) {
    return { ok: false, message: "No se pudo consultar el agente después de desactivarlo." };
  }

  return { ok: true, agent: details };
}

function normalizeDisplayName(value: string | null): { ok: true; name: string | null } | { ok: false; message: string } {
  if (!value?.trim()) {
    return { ok: true, name: null };
  }

  const name = value.trim();
  if (name.length > 80 || /[\r\n]/.test(name)) {
    return { ok: false, message: "El nombre admite como máximo 80 caracteres." };
  }

  return { ok: true, name };
}

function toAgentRecord(agent: {
  id: string;
  badgeNumber: string;
  discordThreadId: string;
  displayName: string | null;
  active: boolean;
}): AgentRecord {
  return {
    id: agent.id,
    badgeNumber: agent.badgeNumber,
    discordThreadId: agent.discordThreadId,
    displayName: agent.displayName,
    active: agent.active,
  };
}

function uniqueTarget(error: unknown): string {
  if (typeof error !== "object" || error === null || !("meta" in error)) {
    return "";
  }

  const meta = error.meta;
  if (typeof meta !== "object" || meta === null || !("target" in meta)) {
    return "";
  }

  return Array.isArray(meta.target) ? meta.target.join(",") : String(meta.target ?? "");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
