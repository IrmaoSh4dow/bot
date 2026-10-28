import "dotenv/config";
import { Client, Events } from "discord.js";
import { loadConfig } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./database/client.js";
import { createDiscordClient } from "./discord/client.js";
import { registerAgentHandlers } from "./discord/agente.js";
import { registerCollectionHandlers } from "./discord/cobro.js";
import { registerPaymentHandlers } from "./discord/pago.js";
import { registerCommands } from "./discord/register-commands.js";
import { registerSaleHandlers } from "./discord/venta.js";
import { startWeeklySummary } from "./discord/weekly-job.js";

let activeClient: Client | undefined;

async function closeResources(): Promise<void> {
  const client = activeClient;
  activeClient = undefined;
  client?.destroy();
  await disconnectDatabase();
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Señal ${signal} recibida. Cerrando...`);
  await closeResources();
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.forumChannelId) {
    console.log("Canal foro configurado. /venta solo se acepta en hilos de ese canal asociados a un agente.");
  } else {
    console.log("FORUM_CHANNEL_ID no está definido. /venta exige un hilo asociado a un agente.");
  }

  await connectDatabase(config.databaseUrl);
  console.log("Conectado a PostgreSQL.");

  const client = createDiscordClient();
  activeClient = client;
  const departmentAccess = {
    adminRoleId: config.adminRoleId,
    adminUserIds: config.adminUserIds,
  };
  registerSaleHandlers(client, { forumChannelId: config.forumChannelId });
  registerAgentHandlers(client, { ...departmentAccess, forumChannelId: config.forumChannelId });
  registerCollectionHandlers(client, { ...departmentAccess, departmentTimeZone: config.departmentTimeZone });
  registerPaymentHandlers(client, { ...departmentAccess, departmentTimeZone: config.departmentTimeZone });
  let shuttingDown = false;

  const handleSignal = (signal: string): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    shutdown(signal)
      .catch((error: unknown) => {
        console.error("Error al cerrar:", error instanceof Error ? error.message : error);
        process.exitCode = 1;
      })
      .finally(() => {
        const code = process.exitCode;
        scheduleExit(typeof code === "number" ? code : 0);
      });
  };

  process.once("SIGINT", () => {
    handleSignal("SIGINT");
  });

  process.once("SIGTERM", () => {
    handleSignal("SIGTERM");
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Bot conectado como ${readyClient.user.tag}.`);
    registerCommands(readyClient, config.discordGuildId).catch((error: unknown) => {
      console.error(
        "No se pudieron registrar los comandos:",
        error instanceof Error ? error.message : error,
      );
    });
    startWeeklySummary(readyClient, config);
  });

  try {
    await client.login(config.discordToken);
  } catch (error) {
    await closeResources();
    throw error;
  }
}

process.on("unhandledRejection", (reason: unknown) => {
  console.error("Promesa rechazada sin manejar:", reason instanceof Error ? reason.message : reason);
});

process.on("uncaughtException", (error: unknown) => {
  console.error("Excepción no capturada:", error instanceof Error ? error.message : error);
  scheduleExit(1);
});

main().catch(async (error: unknown) => {
  console.error("No se pudo arrancar el bot.");
  console.error(error instanceof Error ? error.message : error);

  try {
    await closeResources();
  } catch (closeError: unknown) {
    console.error(
      "Tampoco se pudieron cerrar las conexiones:",
      closeError instanceof Error ? closeError.message : closeError,
    );
  }

  scheduleExit(1);
});

function scheduleExit(code: number): void {
  process.exitCode = code;
  setTimeout(() => {
    process.exit(code);
  }, 250).unref();
}
