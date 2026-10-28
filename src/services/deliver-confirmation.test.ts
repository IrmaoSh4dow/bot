import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliverConfirmation } from "./deliver-confirmation.js";

describe("entrega del aviso", () => {
  it("libera el aviso si Discord rechaza el envío", async () => {
    let persisted = 0;
    let released = 0;

    await assert.rejects(
      () =>
        deliverConfirmation({
          send: async () => {
            throw new Error("discord");
          },
          persist: async () => {
            persisted += 1;
          },
          releaseClaim: async () => {
            released += 1;
          },
        }),
      /discord/,
    );

    assert.equal(persisted, 0);
    assert.equal(released, 1);
  });

  it("conserva el aviso ya publicado si no se puede guardar su identificador", async () => {
    let released = 0;
    let attempts = 0;

    await assert.rejects(
      () =>
        deliverConfirmation({
          send: async () => "mensaje-1",
          persist: async () => {
            attempts += 1;
            throw new Error("postgres");
          },
          releaseClaim: async () => {
            released += 1;
          },
        }),
      /postgres/,
    );

    assert.equal(attempts, 2);
    assert.equal(released, 0);
  });

  it("guarda el identificador del aviso publicado", async () => {
    const stored: string[] = [];

    await deliverConfirmation({
      send: async () => "mensaje-1",
      persist: async (messageId) => {
        stored.push(messageId);
      },
      releaseClaim: async () => {
        throw new Error("no debía liberar");
      },
    });

    assert.deepEqual(stored, ["mensaje-1"]);
  });
});
