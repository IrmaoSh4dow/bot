import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canClaimNotification, NOTIFICATION_LEASE_MS } from "./notification-claim.js";

describe("reintento del aviso", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");

  it("permite avisar cuando la venta todavía no tiene mensaje", () => {
    assert.equal(canClaimNotification({ confirmationMessageId: null, notificationClaimedAt: null }, now), true);
  });

  it("no vuelve a avisar si el mensaje ya quedó registrado", () => {
    assert.equal(
      canClaimNotification({ confirmationMessageId: "123456789012345678", notificationClaimedAt: null }, now),
      false,
    );
  });

  it("espera a que caduque una publicación en curso y luego permite reintentar", () => {
    const claimedAt = new Date(now.getTime() - NOTIFICATION_LEASE_MS);
    const expired = new Date(now.getTime() - NOTIFICATION_LEASE_MS - 1);

    assert.equal(canClaimNotification({ confirmationMessageId: null, notificationClaimedAt: claimedAt }, now), false);
    assert.equal(canClaimNotification({ confirmationMessageId: null, notificationClaimedAt: expired }, now), true);
  });
});