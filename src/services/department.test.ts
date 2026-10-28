import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeBalances } from "./department.js";
import { Decimal } from "./money.js";

describe("saldo del departamento", () => {
  it("arrastra el saldo anterior y no lo reinicia al cambiar de semana", () => {
    const balances = composeBalances({
      salesBefore: new Decimal("3.00"),
      salesInPeriod: new Decimal("2.50"),
      salesAfter: new Decimal("1.25"),
      paymentsBefore: new Decimal("0.00"),
      paymentsInPeriod: new Decimal("1.00"),
      paymentsAfter: new Decimal("0.00"),
    });

    assert.equal(balances.carried, "3.00");
    assert.equal(balances.weekSales, "2.50");
    assert.equal(balances.weekPayments, "1.00");
    assert.equal(balances.periodClosing, "4.50");
    assert.equal(balances.pending, "5.75");
  });

  it("suma céntimos sin redondeo binario", () => {
    const balances = composeBalances({
      salesBefore: new Decimal("0.10"),
      salesInPeriod: new Decimal("0.20"),
      salesAfter: new Decimal("0.00"),
      paymentsBefore: new Decimal("0.00"),
      paymentsInPeriod: new Decimal("0.00"),
      paymentsAfter: new Decimal("0.00"),
    });

    assert.equal(balances.pending, "0.30");
  });
});
