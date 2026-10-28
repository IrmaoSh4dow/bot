import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Client,
} from "discord.js";
import { MAX_SALE_INPUT_LENGTH } from "../services/sale-parser.js";

export const VENTA_COMMAND_NAME = "venta";
export const VENTA_OPTION_NAME = "pedido";

const departmentPermissions = PermissionFlagsBits.Administrator;

export const ventaCommand = new SlashCommandBuilder()
  .setName(VENTA_COMMAND_NAME)
  .setDescription("Registra una venta del agente de este hilo.")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option
      .setName(VENTA_OPTION_NAME)
      .setDescription("Cantidades y productos. Ejemplo: 2 vendas, 1 chaleco")
      .setRequired(true)
      .setMaxLength(MAX_SALE_INPUT_LENGTH),
  );

export const agenteCommand = new SlashCommandBuilder()
  .setName("agente")
  .setDescription("Gestiona los agentes del departamento.")
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(departmentPermissions)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("alta")
      .setDescription("Registra un agente y lo asocia a un hilo del foro.")
      .addStringOption((option) =>
        option.setName("placa").setDescription("Identidad única del agente.").setRequired(true).setMaxLength(32),
      )
      .addStringOption((option) =>
        option.setName("nombre").setDescription("Nombre visible. Opcional.").setRequired(false).setMaxLength(80),
      )
      .addChannelOption((option) =>
        option
          .setName("hilo")
          .setDescription("Publicación del foro. Si se omite, se usa el hilo actual.")
          .addChannelTypes(ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("consultar")
      .setDescription("Muestra la placa, el hilo y el historial de ventas.")
      .addStringOption((option) => option.setName("placa").setDescription("Placa del agente.").setMaxLength(32))
      .addChannelOption((option) =>
        option
          .setName("hilo")
          .setDescription("Publicación del agente.")
          .addChannelTypes(ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("desactivar")
      .setDescription("Desactiva un agente sin borrar sus ventas.")
      .addStringOption((option) =>
        option.setName("placa").setDescription("Placa del agente.").setRequired(true).setMaxLength(32),
      ),
  );

export const cobroCommand = new SlashCommandBuilder()
  .setName("cobro")
  .setDescription("Consulta el cobro semanal del departamento.")
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(departmentPermissions)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("resumen")
      .setDescription("Muestra ventas, pagos y saldo pendiente sin registrar un pago.")
      .addStringOption((option) =>
        option
          .setName("fecha")
          .setDescription("Día del periodo, en formato AAAA-MM-DD. Si se omite, usa la semana actual.")
          .setMaxLength(10),
      ),
  );

export const pagoCommand = new SlashCommandBuilder()
  .setName("pago")
  .setDescription("Registra un pago global del departamento.")
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(departmentPermissions)
  .addStringOption((option) =>
    option
      .setName("modalidad")
      .setDescription("Total es la opción predeterminada.")
      .addChoices({ name: "Total", value: "total" }, { name: "Abono parcial", value: "partial" }),
  )
  .addStringOption((option) =>
    option
      .setName("importe")
      .setDescription("Obligatorio solo en el abono parcial. Ejemplo: 12.50")
      .setMaxLength(16),
  );

export const applicationCommands = [ventaCommand, agenteCommand, cobroCommand, pagoCommand];

export async function registerCommands(client: Client<true>, guildId: string | null): Promise<void> {
  const commands = applicationCommands.map((command) => command.toJSON());

  if (guildId) {
    await client.application.commands.set(commands, guildId);
    console.log("Comandos de esta aplicación registrados en el servidor configurado.");
    return;
  }

  await client.application.commands.set(commands);
  console.log("Comandos de esta aplicación registrados de forma global. Pueden tardar en aparecer.");
}
