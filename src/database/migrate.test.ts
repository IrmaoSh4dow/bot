import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldApplyMigrations } from "./migrate.js";

describe("migraciones al arrancar", () => {
  it("aplica las migraciones solo cuando la base no tiene tablas", () => {
    assert.equal(shouldApplyMigrations(false), true);
    assert.equal(shouldApplyMigrations(true), false);
  });
});
