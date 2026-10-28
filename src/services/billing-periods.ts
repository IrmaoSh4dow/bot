import { getPrismaClient } from "../database/client.js";
import type { WeekPeriod } from "./week-period.js";

export async function ensureBillingPeriod(period: WeekPeriod) {
  const prisma = getPrismaClient();

  try {
    return await prisma.billingPeriod.upsert({
      where: { startsAt: period.startsAt },
      create: {
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        timeZone: period.timeZone,
      },
      update: {},
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const existing = await prisma.billingPeriod.findUnique({ where: { startsAt: period.startsAt } });
    if (!existing) {
      throw error;
    }

    return existing;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
