import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AmountError, Decimal, lineTotal, money, quoteIsExact, saleTotal } from "./money.js";

describe("cálculo de importes", () => {
  it("multiplica un precio decimal sin error binario", () => {
    assert.equal(money(lineTotal(new Decimal("0.10"), 3)), "0.30");
    assert.equal(money(lineTotal(new Decimal("1.15"), 3)), "3.45");
    assert.equal(money(lineTotal(new Decimal("10.50"), 2)), "21.00");
  });

  it("suma los totales de línea de forma exacta", () => {
    const total = saleTotal([lineTotal(new Decimal("10.10"), 1), lineTotal(new Decimal("0.20"), 1)]);
    assert.equal(money(total), "10.30");
  });

  it("acepta un precio cero y rechaza cantidades o precios inválidos", () => {
    assert.equal(money(lineTotal(new Decimal("0.00"), 4)), "0.00");
    assert.throws(() => lineTotal(new Decimal("1.00"), 0), AmountError);
    assert.throws(() => lineTotal(new Decimal("1.00"), 1.5), AmountError);
    assert.throws(() => lineTotal(new Decimal("-1.00"), 1), AmountError);
    assert.throws(() => lineTotal(new Decimal("1.005"), 1), AmountError);
  });

  it("rechaza un total que no cabe en el importe máximo", () => {
    assert.throws(() => lineTotal(new Decimal("9999999999.99"), 2), AmountError);
  });

  it("comprueba que cada línea y el total coinciden con el precio por la cantidad", () => {
    const lines = [
      {
        productId: "catalog_vendas",
        productName: "Vendas",
        quantity: 2,
        unitPrice: "10.50",
        lineTotal: "21.00",
        position: 1,
      },
      {
        productId: "catalog_botiquines",
        productName: "Botiquines",
        quantity: 3,
        unitPrice: "0.10",
        lineTotal: "0.30",
        position: 2,
      },
    ];

    const vendas = lines[0];
    const botiquines = lines[1];
    if (!vendas || !botiquines) {
      throw new Error("Faltan líneas de prueba.");
    }

    assert.equal(quoteIsExact(lines, "21.30"), true);
    assert.equal(quoteIsExact(lines, "21.31"), false);
    assert.equal(quoteIsExact([{ ...vendas, lineTotal: "20.00" }], "20.00"), false);
    assert.equal(quoteIsExact([vendas, { ...botiquines, position: 3 }], "21.30"), false);
  });
});
