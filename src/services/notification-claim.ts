export const NOTIFICATION_LEASE_MS = 120_000;

export function canClaimNotification(
  sale: { confirmationMessageId: string | null; notificationClaimedAt: Date | null },
  now: Date,
): boolean {
  if (sale.confirmationMessageId) {
    return false;
  }

  if (!sale.notificationClaimedAt) {
    return true;
  }

  return now.getTime() - sale.notificationClaimedAt.getTime() > NOTIFICATION_LEASE_MS;
}
