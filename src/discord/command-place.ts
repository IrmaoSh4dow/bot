const USAGE = [
  "Usa /venta dentro de la publicación del agente en el foro.",
  "Ejemplo: /venta pedido: 2 vendas, 1 chaleco, 3 botiquines",
  "Puedes incluir varios productos. Revisa el resumen y confirma para registrarla.",
].join("\n");

export interface CommandPlaceAgent {
  id: string;
  badgeNumber: string;
  active: boolean;
}

export interface CommandPlaceInput {
  isThread: boolean;
  threadId: string | null;
  parentId: string | null;
  forumChannelId: string | null;
  agent: CommandPlaceAgent | null;
}

export type CommandPlaceDecision =
  | { ok: true; threadId: string; agent: CommandPlaceAgent }
  | { ok: false; message: string };

export function decideCommandPlace(input: CommandPlaceInput): CommandPlaceDecision {
  if (!input.isThread || !input.threadId) {
    return { ok: false, message: USAGE };
  }

  if (input.forumChannelId && input.parentId !== input.forumChannelId) {
    return {
      ok: false,
      message: `Este hilo no pertenece al canal foro configurado.\n${USAGE}`,
    };
  }

  if (!input.agent) {
    return {
      ok: false,
      message: `Este hilo no está asociado a un agente.\n${USAGE}`,
    };
  }

  if (!input.agent.active) {
    return {
      ok: false,
      message: "Este agente está desactivado. No se registró ninguna venta.",
    };
  }

  return { ok: true, threadId: input.threadId, agent: input.agent };
}

export function commandUsage(): string {
  return USAGE;
}
