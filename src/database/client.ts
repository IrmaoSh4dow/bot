import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    throw new Error("La base de datos no está conectada.");
  }

  return prisma;
}

export async function connectDatabase(
  connectionString: string,
  options?: { requireSchema?: boolean },
): Promise<void> {
  if (prisma) {
    return;
  }

  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      connectionTimeoutMillis: 5_000,
    }),
  });

  try {
    await client.$queryRaw`SELECT 1`;
  } catch (error) {
    await client.$disconnect().catch(() => undefined);
    throw new Error(
      "No se pudo conectar a PostgreSQL. Comprueba DATABASE_URL y que el servidor esté en ejecución.",
      { cause: error },
    );
  }

  prisma = client;

  if (options?.requireSchema === false) {
    return;
  }

  try {
    await assertSchemaReady();
  } catch (error) {
    await disconnectDatabase();
    throw error;
  }
}

export async function assertSchemaReady(): Promise<void> {
  const rows = await getPrismaClient().$queryRaw<Array<{ ready: boolean }>>`
    SELECT (
      to_regclass('public.department_accounts') IS NOT NULL
      AND to_regclass('public.billing_periods') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'agents' AND column_name = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'operation_id'
      )
    ) AS ready
  `;

  if (rows[0]?.ready !== true) {
    throw new Error(
      "La base no tiene las migraciones del bot. Ejecuta npm run db:migrate:deploy y vuelve a arrancar.",
    );
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (!prisma) {
    return;
  }

  await prisma.$disconnect();
  prisma = undefined;
}
