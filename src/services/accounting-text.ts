import { money } from "./money.js";
import type { PaymentQuote } from "./payments.js";
import type { DepartmentStatement } from "./department.js";
import { formatDepartmentTime } from "./week-period.js";

export function formatPaymentProposal(quote: PaymentQuote): string {
  return [
    "Pago del departamento",
    `Modalidad: ${modeLabel(quote.mode)}`,
    `Saldo pendiente anterior: ${money(quote.previousBalance)}`,
    `Importe: ${money(quote.amount)}`,
    `Saldo restante: ${money(quote.remainingBalance)}`,
    "",
    "Confirma para registrarlo. Cancelar no guarda ningún pago.",
  ].join("\n");
}

export function formatPaymentRecorded(input: {
  amount: string;
  previousBalance: string;
  remainingBalance: string;
  authorName: string;
  mode: PaymentQuote["mode"];
}): string {
  return [
    "Pago registrado.",
    `Modalidad: ${modeLabel(input.mode)}`,
    `Saldo pendiente anterior: ${input.previousBalance}`,
    `Importe: ${input.amount}`,
    `Saldo restante: ${input.remainingBalance}`,
    `Responsable: ${input.authorName}`,
  ].join("\n");
}

export function formatDepartmentStatement(statement: DepartmentStatement): string {
  const zone = statement.period.timeZone;
  const agentLines =
    statement.agents.length === 0
      ? ["Sin ventas en este periodo."]
      : statement.agents.map((agent) => {
          const name = agent.displayName ? ` — ${agent.displayName}` : "";
          const state = agent.active ? "" : " (desactivado)";
          return `- Placa ${agent.badgeNumber}${name}${state}: ${agent.amount}`;
        });
  const paymentLines =
    statement.payments.length === 0
      ? ["Sin pagos en este periodo."]
      : statement.payments.map((payment) => {
          const author = payment.authorName ?? "Registro anterior";
          return `- ${formatDepartmentTime(payment.paidAt, zone)} — ${modeLabel(payment.mode)} — ${payment.amount} — ${author}`;
        });

  return [
    "Cobro del departamento",
    `Periodo: ${formatDepartmentTime(statement.period.startsAt, zone)} – ${formatDepartmentTime(statement.period.endsAt, zone)} (${zone})`,
    "La semana empieza el lunes a las 00:00 y termina el lunes siguiente. Este resumen no registra ningún pago.",
    "",
    "Ventas de la semana por agente:",
    ...agentLines,
    `Total de ventas de la semana: ${statement.weekSales}`,
    "",
    "Pagos del departamento en la semana:",
    ...paymentLines,
    `Total pagado en la semana: ${statement.weekPayments}`,
    "",
    `Saldo arrastrado de semanas anteriores: ${statement.carried}`,
    `Saldo al cierre del periodo: ${statement.periodClosing}`,
    `Saldo pendiente actual del departamento: ${statement.pending}`,
  ].join("\n");
}

export function modeLabel(mode: PaymentQuote["mode"]): string {
  return mode === "total" ? "total" : "abono parcial";
}
