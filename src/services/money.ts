import { Prisma } from "../generated/prisma/client.js";

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

const MAX_AMOUNT = new Decimal("9999999999.99");

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

export function decimalFrom(value: string | Decimal): Decimal {
  try {
    return value instanceof Decimal ? value : new Decimal(value);
  } catch {
    throw new AmountError("El importe no es un número decimal válido.");
  }
}

export function assertSellableUnitPrice(value: Decimal): Decimal {
  if (!value.isFinite() || value.isNaN() || value.lt(0) || value.decimalPlaces() > 2) {
    throw new AmountError("El precio unitario no es válido.");
  }

  if (value.gt(MAX_AMOUNT)) {
    throw new AmountError("El precio unitario supera el máximo permitido.");
  }

  return value;
}

export function lineTotal(unitPrice: Decimal, quantity: number): Decimal {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new AmountError("La cantidad debe ser un entero positivo.");
  }

  const price = assertSellableUnitPrice(unitPrice);
  const total = price.mul(quantity);

  if (total.decimalPlaces() > 2 || total.gt(MAX_AMOUNT)) {
    throw new AmountError("El importe de la línea no es un total exacto válido.");
  }

  return total;
}

export function saleTotal(amounts: readonly Decimal[]): Decimal {
  const total = amounts.reduce((sum, amount) => sum.add(amount), new Decimal(0));

  if (total.decimalPlaces() > 2 || total.gt(MAX_AMOUNT) || total.lt(0)) {
    throw new AmountError("El total de la venta no es un importe exacto válido.");
  }

  return total;
}

export function money(value: Decimal): string {
  return value.toFixed(2);
}

export interface QuotedLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  position: number;
}

export function quoteIsExact(lines: readonly QuotedLine[], totalAmount: string): boolean {
  if (lines.length === 0) {
    return false;
  }

  const positions = new Set<number>();

  try {
    const computedLines = lines.map((line) => {
      if (!Number.isSafeInteger(line.position) || line.position <= 0 || positions.has(line.position)) {
        throw new AmountError("Posición duplicada.");
      }

      positions.add(line.position);
      const unitPrice = assertSellableUnitPrice(decimalFrom(line.unitPrice));
      const computed = lineTotal(unitPrice, line.quantity);

      if (money(computed) !== money(decimalFrom(line.lineTotal))) {
        throw new AmountError("El total de línea no coincide.");
      }

      if (money(unitPrice) !== money(decimalFrom(line.unitPrice))) {
        throw new AmountError("El precio no coincide.");
      }

      return computed;
    });

    const ordered = [...lines].sort((left, right) => left.position - right.position);
    if (ordered.some((line, index) => line.position !== index + 1)) {
      return false;
    }

    return money(saleTotal(computedLines)) === money(decimalFrom(totalAmount));
  } catch {
    return false;
  }
}
