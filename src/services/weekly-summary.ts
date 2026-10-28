import { getPrismaClient } from "../database/client.js";
import { formatDepartmentStatement } from "./accounting-text.js";
import { ensureBillingPeriod } from "./billing-periods.js";
import { readDepartmentStatement } from "./department.js";
import { deliverConfirmation } from "./deliver-confirmation.js";
import { canClaimNotification } from "./notification-claim.js";
import type { WeekPeriod } from "./week-period.js";

export async function publishPeriodSummary(
  period: WeekPeriod,
  channelId: string,
  send: (content: string) => Promise<string>,
  now = new Date(),
): Promise<"sent" | "already-sent" | "in-progress"> {
  const prisma = getPrismaClient();
  const saved = await ensureBillingPeriod(period);

  if (saved.summaryMessageId) {
    return "already-sent";
  }

  if (
    !canClaimNotification(
      {
        confirmationMessageId: saved.summaryMessageId,
        notificationClaimedAt: saved.notificationClaimedAt,
      },
      now,
    )
  ) {
    return "in-progress";
  }

  const claimed = await prisma.billingPeriod.updateMany({
    where: {
      startsAt: period.startsAt,
      summaryMessageId: null,
      notificationClaimedAt: saved.notificationClaimedAt,
    },
    data: { notificationClaimedAt: now },
  });

  if (claimed.count !== 1) {
    const latest = await prisma.billingPeriod.findUnique({ where: { startsAt: period.startsAt } });
    return latest?.summaryMessageId ? "already-sent" : "in-progress";
  }

  const statement = await readDepartmentStatement(period);
  const content = formatDepartmentStatement(statement);

  await deliverConfirmation({
    send: () => send(content),
    persist: (messageId) => persistSummary(period.startsAt, channelId, messageId),
    releaseClaim: () => releaseSummaryClaim(period.startsAt),
  });

  return "sent";
}

async function persistSummary(startsAt: Date, channelId: string, messageId: string): Promise<void> {
  const prisma = getPrismaClient();
  const current = await prisma.billingPeriod.findUnique({ where: { startsAt } });
  if (current?.summaryMessageId) {
    if (current.summaryMessageId === messageId) {
      return;
    }

    throw new Error("Ese periodo ya tiene otro resumen registrado.");
  }

  await prisma.billingPeriod.update({
    where: { startsAt },
    data: {
      summaryMessageId: messageId,
      summaryChannelId: channelId,
      notificationClaimedAt: null,
    },
  });
}

async function releaseSummaryClaim(startsAt: Date): Promise<void> {
  await getPrismaClient().billingPeriod.updateMany({
    where: { startsAt, summaryMessageId: null },
    data: { notificationClaimedAt: null },
  });
}
