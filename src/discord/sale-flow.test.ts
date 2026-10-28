import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordAndNotify, retryNotice, SALE_NOT_RECORDED, SALE_RECORDED } from "./sale-flow.js";

describe("flujo de registro y aviso", () => {
  it("no publica un aviso si la transacción falla", async () => {
    let notices = 0;
    const outcome = await recordAndNotify({
      record: async () => {
        throw new Error("rollback");
      },
      notify: async () => {
        notices += 1;
        return "sent";
      },
    });

    assert.equal(notices, 0);
    assert.equal(outcome.recorded, false);
    assert.equal(outcome.message, SALE_NOT_RECORDED);
    assert.equal(outcome.components, "keep");
    assert.doesNotMatch(outcome.message, /quedó registrada/);
  });

  it("ofrece reintentar el aviso sin registrar otra venta", async () => {
    const denied = Object.assign(new Error("Missing Permissions"), { code: 50013 });
    const outcome = await recordAndNotify({
      record: async () => undefined,
      notify: async () => {
        throw denied;
      },
    });

    assert.equal(outcome.recorded, true);
    assert.equal(outcome.components, "retry");
    assert.match(outcome.message, /quedó registrada/);
    assert.match(outcome.message, /permiso/);
    assert.match(outcome.message, /No se creará otra venta/);
  });

  it("reintenta solo la publicación", async () => {
    let notices = 0;
    const outcome = await retryNotice(async () => {
      notices += 1;
      return "already-sent";
    });

    assert.equal(notices, 1);
    assert.equal(outcome.recorded, true);
    assert.equal(outcome.message, SALE_RECORDED);
    assert.equal(outcome.components, "clear");
  });
});
