export const MAX_SALE_INPUT_LENGTH = 500;
const MAX_ITEMS = 20;
const MAX_QUANTITY = 100_000;

const PRODUCT_ALIASES: Readonly<Record<string, string>> = {
  venda: "vendas",
  vendas: "vendas",
  botiquin: "botiquines",
  botiquines: "botiquines",
  chaleco: "chalecos",
  chalecos: "chalecos",
};

export interface ParsedItem {
  quantity: number;
  label: string;
}

export type ParseResult = { ok: true; items: ParsedItem[] } | { ok: false; message: string };

export function normalizeProductLabel(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

export function catalogKeyForLabel(label: string): string {
  const normalized = normalizeProductLabel(label);
  return PRODUCT_ALIASES[normalized] ?? normalized;
}

export function parseSaleInput(input: string): ParseResult {
  const raw = input.trim();
  if (!raw) {
    return { ok: false, message: "Escribe al menos un producto. Ejemplo: 2 vendas, 1 chaleco." };
  }

  if (raw.length > MAX_SALE_INPUT_LENGTH) {
    return { ok: false, message: "El pedido es demasiado largo." };
  }

  const segments = splitProductSegments(raw);

  if (segments.length === 0) {
    return { ok: false, message: "Escribe al menos un producto. Ejemplo: 2 vendas, 1 chaleco." };
  }

  if (segments.length > MAX_ITEMS) {
    return { ok: false, message: `Un pedido admite como máximo ${MAX_ITEMS} productos.` };
  }

  const errors: string[] = [];
  const items: ParsedItem[] = [];

  for (const segment of segments) {
    const match = /^(\d+)\s+(\S(?:.*\S)?)$/u.exec(segment.trim());
    if (!match) {
      errors.push(`No entiendo «${segment}». Usa una cantidad y el producto, por ejemplo: 2 vendas.`);
      continue;
    }

    const quantityText = match[1] ?? "";
    const label = match[2] ?? "";
    const quantity = Number(quantityText);

    if (!Number.isSafeInteger(quantity) || quantityText !== String(quantity)) {
      errors.push(`La cantidad de «${label || segment}» tiene que ser un entero positivo.`);
      continue;
    }

    if (quantity <= 0) {
      errors.push(`La cantidad de «${label}» tiene que ser mayor que cero.`);
      continue;
    }

    if (quantity > MAX_QUANTITY) {
      errors.push(`La cantidad de «${label}» supera el máximo de ${MAX_QUANTITY}.`);
      continue;
    }

    items.push({ quantity, label });
  }

  if (errors.length > 0) {
    return { ok: false, message: errors.join("\n") };
  }

  return { ok: true, items };
}

function splitProductSegments(raw: string): string[] {
  const chunks = raw
    .split(/[,\n;]+/u)
    .map((segment) => segment.trim().replace(/^y\s+/iu, "").trim())
    .filter((segment) => segment.length > 0);

  return chunks.flatMap((chunk) => splitConjunction(chunk));
}

function splitConjunction(segment: string): string[] {
  const parts = segment
    .split(/\s+y\s+/iu)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return parts;
  }

  const items: string[] = [];
  let current = "";

  for (const part of parts) {
    if (/^\d+\s+\S/u.test(part)) {
      if (current) {
        items.push(current);
      }
      current = part;
      continue;
    }

    current = current ? `${current} y ${part}` : part;
  }

  if (current) {
    items.push(current);
  }

  return items;
}
