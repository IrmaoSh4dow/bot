import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dueWeeks, periodContaining, periodContainingLocalDate, summaryInstant } from "./week-period.js";

describe("periodo semanal", () => {
  it("empieza el lunes y termina el lunes siguiente en America/Bogota", () => {
    const wednesday = new Date("2026-10-28T17:00:00.000Z");
    const period = periodContaining(wednesday, "America/Bogota");

    assert.equal(period.startsAt.toISOString(), "2026-10-26T05:00:00.000Z");
    assert.equal(period.endsAt.toISOString(), "2026-11-02T05:00:00.000Z");
    assert.equal(summaryInstant(period, 23, 0).toISOString(), "2026-11-02T04:00:00.000Z");
    assert.equal(periodContainingLocalDate("2026-02-31", "America/Bogota"), null);
    assert.equal(periodContainingLocalDate("2026-10-28", "America/Bogota")?.startsAt.toISOString(), period.startsAt.toISOString());
  });

  it("conserva el límite cuando cambia el horario de verano", () => {
    const period = periodContaining(new Date("2026-03-04T15:00:00.000Z"), "America/New_York");

    assert.equal(period.startsAt.toISOString(), "2026-03-02T05:00:00.000Z");
    assert.equal(period.endsAt.toISOString(), "2026-03-09T04:00:00.000Z");
  });

  it("recupera los domingos vencidos dentro de la ventana y puede repetirse", () => {
    const wednesday = new Date("2026-10-28T17:00:00.000Z");
    const first = dueWeeks(wednesday, "America/Bogota", 23, 0);
    const second = dueWeeks(wednesday, "America/Bogota", 23, 0);
    const sunday = dueWeeks(new Date("2026-11-02T04:00:00.000Z"), "America/Bogota", 23, 0);

    assert.deepEqual(
      first.map((period) => period.startsAt.toISOString()),
      ["2026-10-12T05:00:00.000Z", "2026-10-19T05:00:00.000Z"],
    );
    assert.deepEqual(
      second.map((period) => period.startsAt.toISOString()),
      first.map((period) => period.startsAt.toISOString()),
    );
    assert.equal(sunday.at(-1)?.startsAt.toISOString(), "2026-10-26T05:00:00.000Z");
  });
});
