import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPrismaClient } from "./client.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function shouldApplyMigrations(hasApplicationTables: boolean): boolean {
  return !hasApplicationTables;
}

export async function applyMigrationsIfEmpty(): Promise<void> {
  if (!shouldApplyMigrations(await databaseHasApplicationTables())) {
    console.log("La base ya tiene tablas. No se aplican migraciones.");
    return;
  }

  console.log("La base está vacía. Aplicando migraciones...");
  await runMigrateDeploy();
}

async function databaseHasApplicationTables(): Promise<boolean> {
  const rows = await getPrismaClient().$queryRaw<Array<{ present: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
    ) AS present
  `;

  return rows[0]?.present === true;
}

function runMigrateDeploy(): Promise<void> {
  const require = createRequire(import.meta.url);
  let cli: string;

  try {
    cli = require.resolve("prisma/build/index.js");
  } catch {
    throw new Error("No se encontró la CLI de Prisma. Ejecuta npm install antes de arrancar.");
  }

  return new Promise((resolveMigration, reject) => {
    const child = spawn(process.execPath, [cli, "migrate", "deploy"], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });

    child.once("error", (error: Error) => {
      reject(new Error(`No se pudo iniciar la migración: ${error.message}`));
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolveMigration();
        return;
      }

      reject(
        new Error(
          `La migración terminó con el código ${code ?? "desconocido"}. El bot no arranca.`,
        ),
      );
    });
  });
}
