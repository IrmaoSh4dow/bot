import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Decimal } from "./money.js";
import { prepareSaleQuote } from "./resolve-sale.js";
import type { CatalogProduct } from "./resolve-sale.js";
import { formatQuote, formatSaleConfirmation } from "./sale-text.js";
import { toStoredLines } from "./resolve-sale.js";

const products: CatalogProduct[] = [
  {
    id: "catalog_vendas",
    name: "Vendas",
    normalizedName: "vendas",
    unitPrice: new Decimal("10.00"),
    active: true,
  },
  {
    id: "catalog_botiquines",
    name: "Botiquines",
    normalizedName: "botiquines",
    unitPrice: new Decimal("2.50"),
    active: true,
  },
];

describe("textos de la venta", () => {
  it("muestra el resumen antes de confirmar y el aviso con quien la registró", () => {
    const quote = prepareSaleQuote("2 vendas, 1 botiquin", products);
    assert.equal(quote.ok, true);
    if (!quote.ok) {
      return;
    }

    const summary = formatQuote("4521", quote.sale);
    assert.match(summary, /Placa 4521/);
    assert.match(summary, /2 Vendas x 10\.00 = 20\.00/);
    assert.match(summary, /1 Botiquines x 2\.50 = 2\.50/);
    assert.match(summary, /Total: 22\.50/);
    assert.match(summary, /Confirma para registrar/);

    const confirmation = formatSaleConfirmation({
      badgeNumber: "4521",
      lines: toStoredLines(quote.sale),
      totalAmount: "22.50",
      authorName: "Ana",
    });
    assert.match(confirmation, /Venta registrada\. Placa 4521\./);
    assert.match(confirmation, /Total: 22\.50/);
    assert.match(confirmation, /Registrada por Ana\./);
  });
});
