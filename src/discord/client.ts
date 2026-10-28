import { Client, GatewayIntentBits } from "discord.js";

/**
 * El bot no lee los mensajes del foro. Las ventas entran solo por /venta.
 */
export function createDiscordClient(): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.on("error", (error: Error) => {
    console.error("Error del cliente de Discord:", error.message);
  });

  return client;
}
