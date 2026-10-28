import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Decimal } from "./money.js";
import { proposePayment } from "./payments.js";

describe("propuesta de pago", () => {
  it("propone el saldo completo y un abono parcial exacto", () => {
    const total = proposePayment(new Decimal("10.50"), "total", null);
    const partial = proposePayment(new Decimal("10.50"), "partial", "4.25");
    const cents = proposePayment(new Decimal("0.30"), "partial", "0.10");

    assert.equal(total.ok, true);
    assert.equal(partial.ok, true);
    assert.equal(cents.ok, true);
    if (!total.ok || !partial.ok || !cents.ok) {
      return;
    }

    assert.equal(total.quote.amount.toFixed(2), "10.50");
    assert.equal(total.quote.remainingBalance.toFixed(2), "0.00");
    assert.equal(partial.quote.remainingBalance.toFixed(2), "6.25");
    assert.equal(cents.quote.remainingBalance.toFixed(2), "0.20");
  });

  it("rechaza importes vacíos, nulos, excesivos o mal formados", () => {
    const pending = new Decimal("10.50");
    const rejected = [
      proposePayment(pending, "partial", null),
      proposePayment(pending, "partial", "0"),
      proposePayment(pending, "partial", "-1"),
      proposePayment(pending, "partial", "10.50"),
      proposePayment(pending, "partial", "10.51"),
      proposePayment(pending, "partial", "1.256"),
      proposePayment(new Decimal("0.00"), "total", null),
      proposePayment(pending, "total", "10.50"),
    ];

    for (const result of rejected) {
      assert.equal(result.ok, false);
      if (result.ok) {
        continue;
      }

      assert.match(result.message, /No se registró ningún pago|Quita el importe|Indica el importe|dos decimales/);
      assert.doesNotMatch(result.message, /Pago registrado/);
    }
  });
});
