import {
  ChannelType,
  Events,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { DEPARTMENT_DENIED, interactionIsManager, type DepartmentAccess } from "./access.js";
import { deactivateAgent, describeAgent, findAgentByBadge, findAgentByThreadId, registerAgent } from "../services/agents.js";

interface AgentCommandOptions extends DepartmentAccess {
  forumChannelId: string | null;
}

export function registerAgentHandlers(client: Client, options: AgentCommandOptions): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "agente") {
      return;
    }

    void handleAgent(interaction, options).catch((error: unknown) => {
      console.error("Error en /agente:", error instanceof Error ? error.message : error);
      if (interaction.deferred || interaction.replied) {
        void interaction.editReply({ content: "No se pudo completar la gestión del agente." }).catch(() => undefined);
      }
    });
  });
}

async function handleAgent(interaction: ChatInputCommandInteraction, options: AgentCommandOptions): Promise<void> {
  if (!(await deferEphemeral(interaction))) {
    return;
  }

  if (!interactionIsManager(interaction, options)) {
    await interaction.editReply({ content: DEPARTMENT_DENIED });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "alta") {
    await registerFromCommand(interaction, options.forumChannelId);
    return;
  }

  if (subcommand === "consultar") {
    await consultFromCommand(interaction, options.forumChannelId);
    return;
  }

  await deactivateFromCommand(interaction);
}

async function registerFromCommand(interaction: ChatInputCommandInteraction, forumChannelId: string | null): Promise<void> {
  const thread = await selectedThread(interaction, forumChannelId, true);
  if (!thread.ok) {
    await interaction.editReply({ content: thread.message });
    return;
  }

  const result = await registerAgent({
    badgeNumber: interaction.options.getString("placa", true),
    discordThreadId: thread.threadId,
    displayName: interaction.options.getString("nombre"),
  });

  if (!result.ok) {
    await interaction.editReply({ content: result.message });
    return;
  }

  const name = result.agent.displayName ?? "sin nombre";
  await interaction.editReply({
    content: [
      "Agente registrado.",
      `Placa: ${result.agent.badgeNumber}`,
      `Nombre: ${name}`,
      `Hilo: ${result.agent.discordThreadId}`,
    ].join("\n"),
  });
}

async function consultFromCommand(interaction: ChatInputCommandInteraction, forumChannelId: string | null): Promise<void> {
  const badge = interaction.options.getString("placa");
  const threadOption = interaction.options.getChannel("hilo");
  let agentId: string | null = null;

  if (badge) {
    const agent = await findAgentByBadge(badge.trim());
    agentId = agent?.id ?? null;
  } else if (threadOption || interaction.channel?.isThread()) {
    const thread = await selectedThread(interaction, forumChannelId, false);
    if (!thread.ok) {
      await interaction.editReply({ content: thread.message });
      return;
    }

    agentId = (await findAgentByThreadId(thread.threadId))?.id ?? null;
  } else {
    await interaction.editReply({ content: "Indica una placa o un hilo para consultar el agente." });
    return;
  }

  if (!agentId) {
    await interaction.editReply({ content: "No hay un agente con esos datos." });
    return;
  }

  const details = await describeAgent(agentId);
  if (!details) {
    await interaction.editReply({ content: "No hay un agente con esos datos." });
    return;
  }

  await interaction.editReply({
    content: [
      `Placa: ${details.badgeNumber}`,
      `Nombre: ${details.displayName ?? "sin nombre"}`,
      `Hilo: ${details.discordThreadId}`,
      `Estado: ${details.active ? "activo" : "desactivado"}`,
      `Ventas: ${details.salesCount}`,
      `Importe vendido: ${details.salesTotal}`,
    ].join("\n"),
  });
}

async function deactivateFromCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const result = await deactivateAgent(interaction.options.getString("placa", true));
  if (!result.ok) {
    await interaction.editReply({ content: result.message });
    return;
  }

  await interaction.editReply({
    content: [
      `Placa ${result.agent.badgeNumber} desactivada.`,
      `Sus ventas siguen en el historial: ${result.agent.salesCount} por ${result.agent.salesTotal}.`,
    ].join("\n"),
  });
}

async function selectedThread(
  interaction: ChatInputCommandInteraction,
  forumChannelId: string | null,
  required: boolean,
): Promise<{ ok: true; threadId: string } | { ok: false; message: string }> {
  const selected = interaction.options.getChannel("hilo");
  if (selected) {
    let parentId = parentOf(selected);
    if (forumChannelId && !parentId) {
      const fetched = await interaction.client.channels.fetch(selected.id).catch(() => null);
      if (fetched?.isThread()) {
        parentId = fetched.parentId;
      }
    }

    return threadDecision(selected.type, selected.id, parentId, forumChannelId, required);
  }

  let channel =
    interaction.channel ??
    (interaction.channelId ? await interaction.client.channels.fetch(interaction.channelId).catch(() => null) : null);

  if (channel?.isThread() && forumChannelId && !channel.parentId) {
    const fetched = await interaction.client.channels.fetch(channel.id).catch(() => null);
    if (fetched) {
      channel = fetched;
    }
  }

  if (!channel?.isThread()) {
    return threadDecision(null, null, null, forumChannelId, required);
  }

  return threadDecision(channel.type, channel.id, channel.parentId, forumChannelId, required);
}

function threadDecision(
  type: ChannelType | null,
  threadId: string | null,
  parentId: string | null,
  forumChannelId: string | null,
  required: boolean,
): { ok: true; threadId: string } | { ok: false; message: string } {
  if (
    !threadId ||
    (type !== ChannelType.PublicThread && type !== ChannelType.PrivateThread && type !== ChannelType.AnnouncementThread)
  ) {
    return {
      ok: false,
      message: required
        ? "Indica el hilo del foro o ejecuta /agente alta dentro de esa publicación."
        : "Ese canal no es un hilo.",
    };
  }

  if (forumChannelId && parentId !== forumChannelId) {
    return { ok: false, message: "Ese hilo no pertenece al canal foro configurado." };
  }

  return { ok: true, threadId };
}

function parentOf(channel: object): string | null {
  const record = channel as { parentId?: unknown; parent_id?: unknown };
  const value = record.parentId ?? record.parent_id;
  return typeof value === "string" ? value : null;
}

async function deferEphemeral(interaction: ChatInputCommandInteraction): Promise<boolean> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch {
    return false;
  }
}
