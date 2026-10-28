import { Events, MessageFlags, type ChatInputCommandInteraction, type Client } from "discord.js";
import { DEPARTMENT_DENIED, interactionIsManager, type DepartmentAccess } from "./access.js";
import { formatDepartmentStatement } from "../services/accounting-text.js";
import { readDepartmentStatement } from "../services/department.js";
import { periodContaining, periodContainingLocalDate } from "../services/week-period.js";

interface CollectionCommandOptions extends DepartmentAccess {
  departmentTimeZone: string;
}

export function registerCollectionHandlers(client: Client, options: CollectionCommandOptions): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "cobro") {
      return;
    }

    void handleCollection(interaction, options).catch((error: unknown) => {
      console.error("Error en /cobro:", error instanceof Error ? error.message : error);
      if (interaction.deferred || interaction.replied) {
        void interaction.editReply({ content: "No se pudo consultar el resumen." }).catch(() => undefined);
      }
    });
  });
}

async function handleCollection(
  interaction: ChatInputCommandInteraction,
  options: CollectionCommandOptions,
): Promise<void> {
  if (!(await deferEphemeral(interaction))) {
    return;
  }

  if (interaction.options.getSubcommand() !== "resumen") {
    await interaction.editReply({ content: "Usa /cobro resumen." });
    return;
  }

  if (!interactionIsManager(interaction, options)) {
    await interaction.editReply({ content: DEPARTMENT_DENIED });
    return;
  }

  const rawDate = interaction.options.getString("fecha");
  const period = rawDate
    ? periodContainingLocalDate(rawDate, options.departmentTimeZone)
    : periodContaining(new Date(), options.departmentTimeZone);

  if (!period) {
    await interaction.editReply({ content: "La fecha debe tener el formato AAAA-MM-DD." });
    return;
  }

  const statement = await readDepartmentStatement(period);
  const content = formatDepartmentStatement(statement);
  await interaction.editReply({
    content: content.length <= 2000 ? content : `${content.slice(0, 1970)}\n… El total sigue incluyendo a todos los agentes.`,
  });
}

async function deferEphemeral(interaction: ChatInputCommandInteraction): Promise<boolean> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch {
    return false;
  }
}
