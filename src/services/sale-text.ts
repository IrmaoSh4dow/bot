import { money } from "./money.js";
import type { ResolvedSale, StoredLine } from "./resolve-sale.js";

export function formatQuote(badgeNumber: string, sale: ResolvedSale): string {
  return [
    `Placa ${badgeNumber}`,
    ...sale.lines.map((line) => formatLine(line.quantity, line.productName, money(line.unitPrice), money(line.lineTotal))),
    `Total: ${money(sale.total)}`,
    "Confirma para registrar la venta.",
  ].join("\n");
}

export function formatSaleConfirmation(input: {
  badgeNumber: string;
  lines: readonly StoredLine[];
  totalAmount: string;
  authorName: string;
}): string {
  const lines = [...input.lines].sort((left, right) => left.position - right.position);

  return [
    `Venta registrada. Placa ${input.badgeNumber}.`,
    ...lines.map((line) => formatLine(line.quantity, line.productName, line.unitPrice, line.lineTotal)),
    `Total: ${input.totalAmount}`,
    `Registrada por ${input.authorName}.`,
  ].join("\n");
}

export function formatLine(quantity: number, productName: string, unitPrice: string, lineTotal: string): string {
  return `${quantity} ${productName} x ${unitPrice} = ${lineTotal}`;
}
