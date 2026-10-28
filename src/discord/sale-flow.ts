export const SALE_NOT_RECORDED = "No se pudo registrar la venta. Puedes confirmar otra vez.";
export const SALE_RECORDED = "Venta registrada. El aviso está en el hilo.";
export const NOTICE_IN_PROGRESS =
  "El aviso se está enviando. Si no aparece en el hilo, pulsa Reintentar aviso dentro de un momento.";

export type NoticeResult = "sent" | "already-sent" | "in-progress";
export type ReplyComponents = "keep" | "retry" | "clear";

export interface SaleFlowResult {
  recorded: boolean;
  message: string;
  components: ReplyComponents;
}

export function discordErrorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  return typeof error.code === "number" ? error.code : null;
}

export function saleNoticeFailed(error: unknown): string {
  const code = discordErrorCode(error);

  if (code === 50013 || code === 50001) {
    return "La venta quedó registrada, pero el bot no tiene permiso para escribir en el hilo. Revisa los permisos y pulsa Reintentar aviso. No se creará otra venta.";
  }

  if (code === 10003 || code === 10008) {
    return "La venta quedó registrada, pero no encuentro el hilo para publicar el aviso. Pulsa Reintentar aviso desde el hilo del agente. No se creará otra venta.";
  }

  return "La venta quedó registrada, pero no pude publicar el aviso en el hilo. Pulsa Reintentar aviso. No se creará otra venta.";
}

export async function recordAndNotify(actions: {
  record: () => Promise<void>;
  notify: () => Promise<NoticeResult>;
}): Promise<SaleFlowResult> {
  try {
    await actions.record();
  } catch {
    return { recorded: false, message: SALE_NOT_RECORDED, components: "keep" };
  }

  return completeNotice(actions.notify);
}

export async function retryNotice(notify: () => Promise<NoticeResult>): Promise<SaleFlowResult> {
  return completeNotice(notify);
}

async function completeNotice(notify: () => Promise<NoticeResult>): Promise<SaleFlowResult> {
  try {
    const notice = await notify();
    if (notice === "in-progress") {
      return { recorded: true, message: NOTICE_IN_PROGRESS, components: "retry" };
    }

    return { recorded: true, message: SALE_RECORDED, components: "clear" };
  } catch (error) {
    return { recorded: true, message: saleNoticeFailed(error), components: "retry" };
  }
}
