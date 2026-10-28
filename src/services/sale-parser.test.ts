import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogKeyForLabel, parseSaleInput } from "./sale-parser.js";

describe("parser de pedidos", () => {
  it("lee varios productos separados por comas, saltos de línea o y", () => {
    const parsed = parseSaleInput("2 vendas, 2 botiquines\n1 chaleco y 3 botiquines");
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }

    assert.deepEqual(
      parsed.items.map((item) => `${item.quantity} ${catalogKeyForLabel(item.label)}`),
      ["2 vendas", "2 botiquines", "1 chalecos", "3 botiquines"],
    );
  });

  it("separa por y solo cuando el siguiente tramo empieza por una cantidad", () => {
    const separated = parseSaleInput("2 vendas y 1 chaleco");
    const named = parseSaleInput("2 botiquin y venda, 1 chaleco");

    assert.equal(separated.ok, true);
    assert.equal(named.ok, true);
    if (!separated.ok || !named.ok) {
      return;
    }

    assert.deepEqual(
      separated.items.map((item) => `${item.quantity} ${catalogKeyForLabel(item.label)}`),
      ["2 vendas", "1 chalecos"],
    );
    assert.deepEqual(
      named.items.map((item) => `${item.quantity} ${item.label}`),
      ["2 botiquin y venda", "1 chaleco"],
    );
  });

  it("acepta los ejemplos previstos, mayúsculas, acentos y singular", () => {
    const first = parseSaleInput("2 vendas, 2 botiquines");
    const second = parseSaleInput("1 chaleco, 3 botiquines");
    const folded = parseSaleInput("2 Vendas, 1 botiquín");

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(folded.ok, true);
    if (!folded.ok) {
      return;
    }

    assert.deepEqual(
      folded.items.map((item) => catalogKeyForLabel(item.label)),
      ["vendas", "botiquines"],
    );
  });

  it("rechaza cantidades que no son enteros positivos y el texto vacío", () => {
    for (const input of ["", "   ", "vendas", "2.5 vendas", "0 vendas", "-1 vendas", "02 vendas"]) {
      const parsed = parseSaleInput(input);
      assert.equal(parsed.ok, false, input);
    }
  });

  it("explica cada tramo que no puede leer", () => {
    const parsed = parseSaleInput("2 vendas, chaleco");
    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }

    assert.match(parsed.message, /chaleco/);
  });

  it("limita la cantidad de cada producto", () => {
    const parsed = parseSaleInput("100001 vendas");
    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }

    assert.match(parsed.message, /máximo/);
  });
});
