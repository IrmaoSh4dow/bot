import type { Decimal } from "./money.js";
import { AmountError, decimalFrom, lineTotal, money, quoteIsExact, saleTotal } from "./money.js";
import { catalogKeyForLabel, parseSaleInput, type ParsedItem } from "./sale-parser.js";

export interface CatalogProduct {
  id: string;
  name: string;
  normalizedName: string;
  unitPrice: Decimal | null;
  active: boolean;
}

export interface ResolvedLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: Decimal;
  lineTotal: Decimal;
  position: number;
}

export interface ResolvedSale {
  lines: ResolvedLine[];
  total: Decimal;
}

export type ResolveResult = { ok: true; sale: ResolvedSale } | { ok: false; message: string };

export interface StoredLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  position: number;
}

export function resolveSale(items: readonly ParsedItem[], products: readonly CatalogProduct[]): ResolveResult {
  const byKey = new Map(products.map((product) => [product.normalizedName, product]));
  const lines: ResolvedLine[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const item of items) {
    const key = catalogKeyForLabel(item.label);
    const product = byKey.get(key);

    if (!product) {
      errors.push(`No reconozco el producto «${item.label}».`);
      continue;
    }

    if (seen.has(product.id)) {
      errors.push(`«${product.name}» está repetido. Indícalo una sola vez.`);
      continue;
    }

    seen.add(product.id);

    if (!product.active) {
      errors.push(`«${product.name}» no está activo.`);
      continue;
    }

    if (!product.unitPrice) {
      errors.push(`«${product.name}» no tiene un precio configurado.`);
      continue;
    }

    try {
      const unitPrice = decimalFrom(product.unitPrice);
      const total = lineTotal(unitPrice, item.quantity);
      lines.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        lineTotal: total,
        position: lines.length + 1,
      });
    } catch (error) {
      const message = error instanceof AmountError ? error.message : "No se pudo calcular el importe.";
      errors.push(`«${product.name}»: ${message}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, message: errors.join("\n") };
  }

  try {
    return { ok: true, sale: { lines, total: saleTotal(lines.map((line) => line.lineTotal)) } };
  } catch (error) {
    const message = error instanceof AmountError ? error.message : "No se pudo calcular el total.";
    return { ok: false, message };
  }
}

export function prepareSaleQuote(raw: string, products: readonly CatalogProduct[]): ResolveResult {
  const parsed = parseSaleInput(raw);
  if (!parsed.ok) {
    return parsed;
  }

  return resolveSale(parsed.items, products);
}

export async function acceptSaleQuote(
  raw: string,
  products: readonly CatalogProduct[],
  save: (sale: ResolvedSale) => Promise<void>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const quote = prepareSaleQuote(raw, products);
  if (!quote.ok) {
    return quote;
  }

  await save(quote.sale);
  return { ok: true };
}

export function toStoredLines(sale: ResolvedSale): StoredLine[] {
  return sale.lines.map((line) => ({
    productId: line.productId,
    productName: line.productName,
    quantity: line.quantity,
    unitPrice: money(line.unitPrice),
    lineTotal: money(line.lineTotal),
    position: line.position,
  }));
}

export function readStoredLines(value: unknown): StoredLine[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const lines: StoredLine[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const line = entry as Record<string, unknown>;
    if (
      typeof line.productId !== "string" ||
      typeof line.productName !== "string" ||
      typeof line.quantity !== "number" ||
      typeof line.unitPrice !== "string" ||
      typeof line.lineTotal !== "string" ||
      typeof line.position !== "number" ||
      !line.productId ||
      !line.productName
    ) {
      return null;
    }

    lines.push({
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      position: line.position,
    });
  }

  return lines;
}

export function sameQuote(left: ResolvedSale, storedLines: readonly StoredLine[], storedTotal: string): boolean {
  const fresh = toStoredLines(left);
  if (fresh.length !== storedLines.length || !quoteIsExact(storedLines, storedTotal)) {
    return false;
  }

  const storedByPosition = new Map(storedLines.map((line) => [line.position, line]));

  return fresh.every((line) => {
    const stored = storedByPosition.get(line.position);
    return (
      stored !== undefined &&
      stored.productId === line.productId &&
      stored.productName === line.productName &&
      stored.quantity === line.quantity &&
      stored.unitPrice === line.unitPrice &&
      stored.lineTotal === line.lineTotal
    );
  });
}
