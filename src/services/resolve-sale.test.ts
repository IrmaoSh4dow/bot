import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Decimal, money } from "./money.js";
import {
  acceptSaleQuote,
  prepareSaleQuote,
  readStoredLines,
  sameQuote,
  toStoredLines,
  type CatalogProduct,
} from "./resolve-sale.js";

function catalog(overrides: Partial<CatalogProduct> = {}): CatalogProduct[] {
  const products: CatalogProduct[] = [
    {
      id: "catalog_vendas",
      name: "Vendas",
      normalizedName: "vendas",
      unitPrice: new Decimal("0.10"),
      active: true,
    },
    {
      id: "catalog_botiquines",
      name: "Botiquines",
      normalizedName: "botiquines",
      unitPrice: new Decimal("4.25"),
      active: true,
    },
    {
      id: "catalog_chalecos",
      name: "Chalecos",
      normalizedName: "chalecos",
      unitPrice: new Decimal("25.00"),
      active: true,
    },
  ];

  return products.map((product) => (product.id === overrides.id ? { ...product, ...overrides } : product));
}

describe("resolución del pedido contra el catálogo", () => {
  it("calcula el pedido de ejemplo con el precio del catálogo", () => {
    const quote = prepareSaleQuote("2 vendas, 1 chaleco, 3 botiquines", catalog());
    assert.equal(quote.ok, true);
    if (!quote.ok) {
      return;
    }

    assert.deepEqual(
      quote.sale.lines.map((line) => `${line.quantity} ${line.productName} ${money(line.lineTotal)}`),
      ["2 Vendas 0.20", "1 Chalecos 25.00", "3 Botiquines 12.75"],
    );
    assert.equal(money(quote.sale.total), "37.95");
    assert.equal(sameQuote(quote.sale, toStoredLines(quote.sale), money(quote.sale.total)), true);
  });

  it("trata singular y plural como el mismo producto", () => {
    const quote = prepareSaleQuote("1 chaleco, 1 chalecos", catalog());
    assert.equal(quote.ok, false);
    if (quote.ok) {
      return;
    }

    assert.match(quote.message, /repetido/);
  });

  it("no vende un producto desconocido, inactivo o sin precio", () => {
    const unknown = prepareSaleQuote("2 radios", catalog());
    const inactive = prepareSaleQuote("1 chaleco", catalog({ id: "catalog_chalecos", active: false }));
    const unpriced = prepareSaleQuote("2 vendas", catalog({ id: "catalog_vendas", unitPrice: null }));

    assert.equal(unknown.ok, false);
    assert.equal(inactive.ok, false);
    assert.equal(unpriced.ok, false);
    if (unknown.ok || inactive.ok || unpriced.ok) {
      return;
    }

    assert.match(unknown.message, /No reconozco/);
    assert.match(inactive.message, /no está activo/);
    assert.match(unpriced.message, /no tiene un precio/);
  });

  it("detecta si el resumen guardado ya no coincide con el catálogo", () => {
    const original = prepareSaleQuote("2 vendas", catalog());
    const changed = prepareSaleQuote("2 vendas", catalog({ id: "catalog_vendas", unitPrice: new Decimal("0.20") }));
    assert.equal(original.ok, true);
    assert.equal(changed.ok, true);
    if (!original.ok || !changed.ok) {
      return;
    }

    assert.equal(sameQuote(changed.sale, toStoredLines(original.sale), money(original.sale.total)), false);
  });

  it("rechaza un resumen guardado con una forma inválida", () => {
    assert.equal(readStoredLines([{ productId: "x" }]), null);
    assert.equal(readStoredLines("2 vendas"), null);
  });

  it("no guarda el resumen si el pedido no es válido", async () => {
    let saved = 0;
    const rejected = await acceptSaleQuote("2 radios, 1 vendas", catalog(), async () => {
      saved += 1;
    });
    const unpriced = await acceptSaleQuote("2 vendas", catalog({ id: "catalog_vendas", unitPrice: null }), async () => {
      saved += 1;
    });
    const accepted = await acceptSaleQuote("2 vendas", catalog(), async () => {
      saved += 1;
    });

    assert.equal(rejected.ok, false);
    assert.equal(unpriced.ok, false);
    assert.equal(accepted.ok, true);
    assert.equal(saved, 1);
  });
});
