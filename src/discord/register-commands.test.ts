import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationCommandOptionType, InteractionContextType } from "discord.js";
import { MAX_SALE_INPUT_LENGTH } from "../services/sale-parser.js";
import {
  agenteCommand,
  applicationCommands,
  cobroCommand,
  pagoCommand,
  VENTA_COMMAND_NAME,
  VENTA_OPTION_NAME,
  ventaCommand,
} from "./register-commands.js";

describe("registro de /venta", () => {
  it("declara el mismo nombre, opción y longitud que usa el comando", () => {
    const command = ventaCommand.toJSON();
    const option = command.options?.[0];

    assert.equal(command.name, VENTA_COMMAND_NAME);
    assert.equal(command.name, "venta");
    assert.deepEqual(command.contexts, [InteractionContextType.Guild]);
    assert.equal(option?.type, ApplicationCommandOptionType.String);
    assert.equal(option?.name, VENTA_OPTION_NAME);
    assert.equal(option?.name, "pedido");
    assert.equal(option?.required, true);
    assert.equal(option?.max_length, MAX_SALE_INPUT_LENGTH);
    assert.equal(MAX_SALE_INPUT_LENGTH, 500);
    assert.equal(command.default_member_permissions, undefined);
  });

  it("registra la gestión de agentes, el resumen y el pago junto a /venta", () => {
    const names = applicationCommands.map((command) => command.toJSON().name).sort();
    assert.deepEqual(names, ["agente", "cobro", "pago", "venta"]);

    const agent = agenteCommand.toJSON();
    assert.deepEqual(
      agent.options?.map((option) => option.name),
      ["alta", "consultar", "desactivar"],
    );
    assert.equal(agent.default_member_permissions, "8");

    const collection = cobroCommand.toJSON();
    assert.equal(collection.options?.[0]?.name, "resumen");
    assert.equal(collection.options?.[0]?.type, ApplicationCommandOptionType.Subcommand);
    assert.equal(collection.default_member_permissions, "8");

    const payment = pagoCommand.toJSON();
    const mode = payment.options?.find((option) => option.name === "modalidad");
    const amount = payment.options?.find((option) => option.name === "importe");
    assert.equal(mode?.required ?? false, false);
    assert.equal(amount?.required ?? false, false);
    assert.equal(payment.default_member_permissions, "8");
    assert.equal(ventaCommand.toJSON().name, "venta");
  });
});
