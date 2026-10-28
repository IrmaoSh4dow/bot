import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { decideCommandPlace } from "./command-place.js";
import { VENTA_COMMAND_NAME, VENTA_OPTION_NAME } from "./register-commands.js";
import { recordAndNotify, retryNotice, type ReplyComponents } from "./sale-flow.js";
import { findAgentByThreadId } from "../services/agents.js";
import { listCatalog } from "../services/catalog.js";
import { acceptSaleQuote, prepareSaleQuote, sameQuote, type ResolvedSale } from "../services/resolve-sale.js";
import { deleteSaleDraft, findSaleDraft, saveSaleDraft } from "../services/sale-drafts.js";
import { formatQuote } from "../services/sale-text.js";
import { createSale, findSaleByOperation, publishSaleConfirmation } from "../services/sales.js";

interface SaleCommandOptions {
  forumChannelId: string | null;
}

export function registerSaleHandlers(client: Client, options: SaleCommandOptions): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, options).catch((error: unknown) => {
      console.error("Error en una interacción:", error instanceof Error ? error.message : error);
      if (!interaction.isRepliable() || (!interaction.deferred && !interaction.replied)) {
        return;
      }

      void interaction
        .editReply({
          content: "No se pudo completar la respuesta. Si ya confirmaste, revisa el hilo antes de volver a intentarlo.",
        })
        .catch(() => undefined);
    });
  });
}

async function handleInteraction(interaction: Interaction, options: SaleCommandOptions): Promise<void> {
  if (interaction.isChatInputCommand() && interaction.commandName === VENTA_COMMAND_NAME) {
    await handleVentaCommand(interaction, options);
    return;
  }

  if (interaction.isButton()) {
    const action = readAction(interaction.customId);
    if (!action) {
      return;
    }

    if (action.kind === "confirm") {
      await handleConfirm(interaction, action.operationId, options);
      return;
    }

    if (action.kind === "retry") {
      await handleRetry(interaction, action.operationId);
      return;
    }

    await handleCancel(interaction, action.operationId);
  }
}

async function handleVentaCommand(
  interaction: ChatInputCommandInteraction,
  options: SaleCommandOptions,
): Promise<void> {
  if (!(await deferEphemeral(interaction))) {
    return;
  }

  const place = await commandPlace(interaction, options);
  if (!place.ok) {
    await interaction.editReply({ content: place.message });
    return;
  }

  const pedido = interaction.options.getString(VENTA_OPTION_NAME, true);
  const authorName = (interaction.user.globalName ?? interaction.user.username).slice(0, 80);
  let quoted: ResolvedSale | undefined;

  try {
    const accepted = await acceptSaleQuote(pedido, await listCatalog(), async (sale) => {
      quoted = sale;
      await saveSaleDraft({
        operationId: interaction.id,
        agentId: place.agent.id,
        discordThreadId: place.threadId,
        discordAuthorId: interaction.user.id,
        authorName,
        rawContent: pedido,
        sale,
        now: new Date(),
      });
    });

    if (!accepted.ok) {
      await interaction.editReply({ content: accepted.message });
      return;
    }
  } catch (error) {
    console.error("No se pudo preparar la venta:", error instanceof Error ? error.message : error);
    await interaction.editReply({ content: "No se pudo preparar la venta. Inténtalo otra vez." });
    return;
  }

  if (!quoted) {
    await interaction.editReply({ content: "No se pudo preparar la venta. Inténtalo otra vez." });
    return;
  }

  await interaction.editReply({
    content: formatQuote(place.agent.badgeNumber, quoted),
    components: [summaryRow(interaction.id)],
  });
}

async function handleConfirm(
  interaction: ButtonInteraction,
  operationId: string,
  options: SaleCommandOptions,
): Promise<void> {
  if (!(await deferButton(interaction))) {
    return;
  }

  const existing = await findSaleSafely(operationId);
  if (existing instanceof Error) {
    await interaction.editReply({ content: "No se pudo registrar la venta. Puedes confirmar otra vez." });
    return;
  }

  if (existing) {
    if (existing.discordAuthorId !== interaction.user.id) {
      await interaction.editReply({ content: "Solo quien inició /venta puede confirmarla." });
      return;
    }

    if (existing.discordThreadId !== interaction.channelId) {
      await interaction.editReply({ content: "Confirma la venta desde el hilo del agente." });
      return;
    }

    const outcome = await retryNotice(() =>
      publishSaleConfirmation(operationId, (content) => sendInChannel(interaction, content)),
    );
    await replyFlow(interaction, operationId, outcome);
    return;
  }

  let draft: Awaited<ReturnType<typeof findSaleDraft>>;
  try {
    draft = await findSaleDraft(operationId);
  } catch (error) {
    console.error("No se pudo leer el resumen:", error instanceof Error ? error.message : error);
    await interaction.editReply({ content: "No se pudo registrar la venta. Puedes confirmar otra vez." });
    return;
  }
  if (!draft || draft.expiresAt.getTime() <= Date.now()) {
    await deleteSaleDraft(operationId).catch(() => undefined);
    await interaction.editReply({
      content: "El resumen caducó. Vuelve a ejecutar /venta. No se registró ninguna venta.",
      components: [],
    });
    return;
  }

  if (draft.discordAuthorId !== interaction.user.id) {
    await interaction.editReply({ content: "Solo quien inició /venta puede confirmarla." });
    return;
  }

  const place = await commandPlace(interaction, options);
  if (!place.ok || place.threadId !== draft.discordThreadId || place.agent.id !== draft.agentId) {
    await interaction.editReply({
      content: place.ok ? "Este hilo ya no corresponde al agente del resumen." : place.message,
      components: [],
    });
    return;
  }

  let quote: ReturnType<typeof prepareSaleQuote>;
  try {
    quote = prepareSaleQuote(draft.rawContent, await listCatalog());
  } catch (error) {
    console.error("No se pudo volver a calcular la venta:", error instanceof Error ? error.message : error);
    await interaction.editReply({ content: "No se pudo registrar la venta. Puedes confirmar otra vez." });
    return;
  }

  if (!quote.ok || !sameQuote(quote.sale, draft.lines, draft.totalAmount)) {
    await deleteSaleDraft(operationId).catch(() => undefined);
    await interaction.editReply({
      content: quote.ok
        ? "El catálogo cambió desde el resumen. Ejecuta /venta otra vez. No se registró ninguna venta."
        : `${quote.message}\nNo se registró ninguna venta.`,
      components: [],
    });
    return;
  }

  const outcome = await recordAndNotify({
    record: async () => {
      try {
        await createSale({
          operationId,
          agentId: draft.agentId,
          discordThreadId: draft.discordThreadId,
          discordAuthorId: draft.discordAuthorId,
          authorName: draft.authorName,
          rawContent: draft.rawContent,
          sale: quote.sale,
          soldAt: new Date(),
        });
      } catch (error) {
        console.error("Falló la transacción de la venta:", error instanceof Error ? error.message : error);
        throw error;
      }

      await deleteSaleDraft(operationId).catch((error: unknown) => {
        console.error("No se pudo borrar el resumen:", error instanceof Error ? error.message : error);
      });
    },
    notify: () => publishSaleConfirmation(operationId, (content) => sendInChannel(interaction, content)),
  });

  await replyFlow(interaction, operationId, outcome);
}

async function handleRetry(interaction: ButtonInteraction, operationId: string): Promise<void> {
  if (!(await deferButton(interaction))) {
    return;
  }

  const sale = await findSaleSafely(operationId);
  if (sale instanceof Error) {
    await interaction.editReply({
      content: "No se pudo publicar el aviso. Puedes reintentarlo. No se creará otra venta.",
      components: [retryRow(operationId)],
    });
    return;
  }

  if (!sale) {
    await interaction.editReply({
      content: "No hay una venta registrada para este aviso.",
      components: [],
    });
    return;
  }

  if (sale.discordAuthorId !== interaction.user.id) {
    await interaction.editReply({ content: "Solo quien registró la venta puede reintentar el aviso." });
    return;
  }

  const place = await commandPlace(interaction, { forumChannelId: null });
  if (!place.ok || place.threadId !== sale.discordThreadId) {
    await interaction.editReply({ content: "Reintenta el aviso desde el hilo del agente." });
    return;
  }

  const outcome = await retryNotice(() =>
    publishSaleConfirmation(operationId, (content) => sendInChannel(interaction, content)),
  );
  await replyFlow(interaction, operationId, outcome);
}

async function handleCancel(interaction: ButtonInteraction, operationId: string): Promise<void> {
  if (!(await deferButton(interaction))) {
    return;
  }

  const sale = await findSaleByOperation(operationId).catch(() => null);
  if (sale) {
    await interaction.editReply({
      content: "La venta ya está registrada. Cancelar no la borra.",
      components: [],
    });
    return;
  }

  await deleteSaleDraft(operationId).catch(() => undefined);
  await interaction.editReply({
    content: "Venta cancelada. No se registró nada.",
    components: [],
  });
}

async function replyFlow(
  interaction: ButtonInteraction,
  operationId: string,
  outcome: { message: string; components: ReplyComponents },
): Promise<void> {
  if (outcome.components === "keep") {
    await interaction.editReply({ content: outcome.message });
    return;
  }

  await interaction.editReply({
    content: outcome.message,
    components: outcome.components === "retry" ? [retryRow(operationId)] : [],
  });
}

async function sendInChannel(interaction: ButtonInteraction, content: string): Promise<string> {
  const channel = interaction.channel;
  if (!channel || channel.isDMBased() || !channel.isSendable()) {
    throw new Error("No se puede escribir en el hilo.");
  }

  const message = await channel.send({
    content,
    allowedMentions: { parse: [] },
  });
  return message.id;
}

async function commandPlace(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  options: SaleCommandOptions,
): Promise<{ ok: true; threadId: string; agent: { id: string; badgeNumber: string } } | { ok: false; message: string }> {
  let channel =
    interaction.channel ??
    (interaction.channelId ? await interaction.client.channels.fetch(interaction.channelId).catch(() => null) : null);

  if (channel?.isThread() && options.forumChannelId && !channel.parentId) {
    const fetched = await interaction.client.channels.fetch(channel.id).catch(() => null);
    if (fetched) {
      channel = fetched;
    }
  }

  if (!channel?.isThread()) {
    return decideCommandPlace({
      isThread: false,
      threadId: null,
      parentId: null,
      forumChannelId: options.forumChannelId,
      agent: null,
    });
  }

  return decideCommandPlace({
    isThread: true,
    threadId: channel.id,
    parentId: channel.parentId,
    forumChannelId: options.forumChannelId,
    agent: await findAgentByThreadId(channel.id),
  });
}

async function findSaleSafely(operationId: string) {
  try {
    return await findSaleByOperation(operationId);
  } catch (error) {
    console.error("No se pudo consultar la venta:", error instanceof Error ? error.message : error);
    return new Error("consulta");
  }
}

async function deferEphemeral(interaction: ChatInputCommandInteraction): Promise<boolean> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch {
    return false;
  }
}

async function deferButton(interaction: ButtonInteraction): Promise<boolean> {
  try {
    await interaction.deferUpdate();
    return true;
  } catch {
    return false;
  }
}

function summaryRow(operationId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`venta:confirm:${operationId}`).setLabel("Confirmar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`venta:cancel:${operationId}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
  );
}

function retryRow(operationId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`venta:retry:${operationId}`)
      .setLabel("Reintentar aviso")
      .setStyle(ButtonStyle.Primary),
  );
}

function readAction(customId: string): { kind: "confirm" | "cancel" | "retry"; operationId: string } | null {
  const match = /^venta:(confirm|cancel|retry):(\d{17,20})$/.exec(customId);
  const kind = match?.[1];
  const operationId = match?.[2];

  if ((kind !== "confirm" && kind !== "cancel" && kind !== "retry") || !operationId) {
    return null;
  }

  return { kind, operationId };
}
