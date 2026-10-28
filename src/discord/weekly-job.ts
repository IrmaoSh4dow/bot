import type { Client } from "discord.js";
import { publishPeriodSummary } from "../services/weekly-summary.js";
import { dueWeeks } from "../services/week-period.js";

export interface WeeklyJobConfig {
  weeklySummaryEnabled: boolean;
  weeklySummaryChannelId: string | null;
  weeklySummaryHour: number;
  weeklySummaryMinute: number;
  departmentTimeZone: string;
}

export function startWeeklySummary(client: Client<true>, config: WeeklyJobConfig): void {
  if (!config.weeklySummaryEnabled || !config.weeklySummaryChannelId) {
    console.log("Resumen dominical desactivado. /cobro resumen sigue disponible.");
    return;
  }

  const channelId = config.weeklySummaryChannelId;
  const run = (): void => {
    void publishDueSummaries(client, config, channelId).catch((error: unknown) => {
      console.error("No se pudo publicar el resumen dominical:", error instanceof Error ? error.message : error);
    });
  };

  run();
  setInterval(run, 60_000).unref();
}

async function publishDueSummaries(client: Client<true>, config: WeeklyJobConfig, channelId: string): Promise<void> {
  const periods = dueWeeks(new Date(), config.departmentTimeZone, config.weeklySummaryHour, config.weeklySummaryMinute);

  for (const period of periods) {
    const result = await publishPeriodSummary(period, channelId, async (content) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.isDMBased() || !channel.isSendable()) {
        throw new Error("No se puede escribir en el canal del resumen semanal.");
      }

      const message = await channel.send({
        content: content.length <= 2000 ? content : `${content.slice(0, 1970)}\n… El total sigue incluyendo a todos los agentes.`,
        allowedMentions: { parse: [] },
      });
      return message.id;
    });

    if (result === "sent") {
      console.log(`Resumen semanal publicado para el periodo ${period.startsAt.toISOString()}.`);
    }
  }
}
