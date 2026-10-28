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
import { DEPARTMENT_DENIED, interactionIsManager, type DepartmentAccess } from "./access.js";
import { formatPaymentProposal, formatPaymentRecorded } from "../services/accounting-text.js";
import { readPendingBalance } from "../services/department.js";
import { decimalFrom } from "../services/money.js";
import {
  createPayment,
  deletePaymentDraft,
  findPaymentByOperation,
  findPaymentDraft,
  PaymentRejected,
  proposePayment,
  savePaymentDraft,
  type PaymentModeName,
} from "../services/payments.js";
import { periodContaining } from "../services/week-period.js";

interface PaymentCommandOptions extends DepartmentAccess {
  departmentTimeZone: string;
}

export function registerPaymentHandlers(client: Client, options: PaymentCommandOptions): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, options).catch((error: unknown) => {
      console.error("Error en /pago:", error instanceof Error ? error.message : error);
      if (!interaction.isRepliable() || (!interaction.deferred && !interaction.replied)) {
        return;
      }

      void interaction
        .editReply({
          content: "No se pudo completar la respuesta. Si ya confirmaste, consulta /cobro resumen antes de volver a intentarlo.",
        })
        .catch(() => undefined);
    });
  });
}

async function handleInteraction(interaction: Interaction, options: PaymentCommandOptions): Promise<void> {
  if (interaction.isChatInputCommand() && interaction.commandName === "pago") {
    await handlePaymentCommand(interaction, options);
    return;
  }

  if (!interaction.isButton()) {
    return;
  }

  const action = readAction(interaction.customId);
  if (!action) {
    return;
  }

  if (action.kind === "confirm") {
    await handleConfirm(interaction, action.operationId, options);
    return;
  }

  await handleCancel(interaction, action.operationId);
}

async function handlePaymentCommand(interaction: ChatInputCommandInteraction, options: PaymentCommandOptions): Promise<void> {
  if (!(await deferEphemeral(interaction))) {
    return;
  }

  if (!interactionIsManager(interaction, options)) {
    await interaction.editReply({ content: DEPARTMENT_DENIED });
    return;
  }

  const mode = readMode(interaction.options.getString("modalidad"));
  const pending = await readPendingBalance();
  const proposed = proposePayment(pending, mode, interaction.options.getString("importe")?.trim() || null);
  if (!proposed.ok) {
    await interaction.editReply({ content: proposed.message });
    return;
  }

  const authorName = (interaction.user.globalName ?? interaction.user.username).slice(0, 80);
  await savePaymentDraft({
    operationId: interaction.id,
    discordAuthorId: interaction.user.id,
    authorName,
    quote: proposed.quote,
    periodStartsAt: periodContaining(new Date(), options.departmentTimeZone).startsAt,
    now: new Date(),
  });

  await interaction.editReply({
    content: formatPaymentProposal(proposed.quote),
    components: [confirmRow(interaction.id)],
  });
}

async function handleConfirm(
  interaction: ButtonInteraction,
  operationId: string,
  options: PaymentCommandOptions,
): Promise<void> {
  if (!(await deferButton(interaction))) {
    return;
  }

  if (!interactionIsManager(interaction, options)) {
    await interaction.editReply({ content: DEPARTMENT_DENIED });
    return;
  }

  const existing = await findPaymentByOperation(operationId);
  if (existing) {
    if (existing.agentId) {
      await interaction.editReply({ content: "Ese pago no pertenece al saldo global del departamento." });
      return;
    }

    await interaction.editReply({
      content: formatPaymentRecorded({
        amount: existing.amount,
        previousBalance: existing.previousBalance,
        remainingBalance: existing.remainingBalance,
        authorName: existing.authorName ?? "Registro anterior",
        mode: existing.mode,
      }),
      components: [],
    });
    return;
  }

  const draft = await findPaymentDraft(operationId);
  if (!draft || draft.expiresAt.getTime() <= Date.now()) {
    await deletePaymentDraft(operationId).catch(() => undefined);
    await interaction.editReply({
      content: "El resumen caducó. Vuelve a ejecutar /pago. No se registró ningún pago.",
      components: [],
    });
    return;
  }

  if (draft.discordAuthorId !== interaction.user.id) {
    await interaction.editReply({ content: "Solo quien inició /pago puede confirmarlo." });
    return;
  }

  try {
    const result = await createPayment({
      operationId,
      mode: draft.mode,
      amount: decimalFrom(draft.amount),
      previousBalance: decimalFrom(draft.previousBalance),
      discordAuthorId: draft.discordAuthorId,
      authorName: draft.authorName,
      paidAt: new Date(),
      timeZone: options.departmentTimeZone,
    });
    await deletePaymentDraft(operationId).catch(() => undefined);
    await interaction.editReply({
      content: formatPaymentRecorded({
        amount: result.payment.amount,
        previousBalance: result.payment.previousBalance,
        remainingBalance: result.payment.remainingBalance,
        authorName: result.payment.authorName ?? draft.authorName,
        mode: result.payment.mode,
      }),
      components: [],
    });
  } catch (error) {
    if (error instanceof PaymentRejected) {
      await deletePaymentDraft(operationId).catch(() => undefined);
      await interaction.editReply({ content: error.message, components: [] });
      return;
    }

    console.error("Falló la transacción del pago:", error instanceof Error ? error.message : error);
    await interaction.editReply({ content: "No se pudo registrar el pago. Puedes confirmar otra vez." });
  }
}

async function handleCancel(interaction: ButtonInteraction, operationId: string): Promise<void> {
  if (!(await deferButton(interaction))) {
    return;
  }

  const existing = await findPaymentByOperation(operationId).catch(() => null);
  if (existing) {
    await interaction.editReply({ content: "El pago ya está registrado. Cancelar no lo borra.", components: [] });
    return;
  }

  await deletePaymentDraft(operationId).catch(() => undefined);
  await interaction.editReply({ content: "Pago cancelado. No se registró nada.", components: [] });
}

function readMode(value: string | null): PaymentModeName {
  return value === "partial" ? "partial" : "total";
}

function confirmRow(operationId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`pago:confirm:${operationId}`).setLabel("Confirmar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pago:cancel:${operationId}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
  );
}

function readAction(customId: string): { kind: "confirm" | "cancel"; operationId: string } | null {
  const match = /^pago:(confirm|cancel):(\d{17,20})$/.exec(customId);
  const kind = match?.[1];
  const operationId = match?.[2];
  if ((kind !== "confirm" && kind !== "cancel") || !operationId) {
    return null;
  }

  return { kind, operationId };
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
