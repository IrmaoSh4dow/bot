import { getPrismaClient } from "../database/client.js";
import type { Decimal } from "./money.js";
import type { CatalogProduct } from "./resolve-sale.js";

export async function listCatalog(): Promise<CatalogProduct[]> {
  const products = await getPrismaClient().product.findMany({
    orderBy: { name: "asc" },
  });

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    normalizedName: product.normalizedName,
    unitPrice: product.unitPrice as Decimal | null,
    active: product.active,
  }));
}
