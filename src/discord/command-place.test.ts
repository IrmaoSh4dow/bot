import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideCommandPlace } from "./command-place.js";

const agent = { id: "agent-1", badgeNumber: "A-10", active: true };

describe("lugar del comando", () => {
  it("exige un hilo asociado a un agente", () => {
    const outside = decideCommandPlace({
      isThread: false,
      threadId: null,
      parentId: null,
      forumChannelId: null,
      agent: null,
    });
    const unknown = decideCommandPlace({
      isThread: true,
      threadId: "100000000000000001",
      parentId: "100000000000000010",
      forumChannelId: "100000000000000010",
      agent: null,
    });

    assert.equal(outside.ok, false);
    assert.equal(unknown.ok, false);
    if (outside.ok || unknown.ok) {
      return;
    }

    assert.match(outside.message, /publicación del agente/);
    assert.match(unknown.message, /no está asociado/);
  });

  it("rechaza un hilo de otro foro y acepta el del agente", () => {
    const otherForum = decideCommandPlace({
      isThread: true,
      threadId: "100000000000000001",
      parentId: "100000000000000099",
      forumChannelId: "100000000000000010",
      agent,
    });
    const accepted = decideCommandPlace({
      isThread: true,
      threadId: "100000000000000001",
      parentId: "100000000000000010",
      forumChannelId: "100000000000000010",
      agent,
    });

    assert.equal(otherForum.ok, false);
    assert.equal(accepted.ok, true);
    if (otherForum.ok || !accepted.ok) {
      return;
    }

    assert.match(otherForum.message, /canal foro/);
    assert.equal(accepted.threadId, "100000000000000001");
    assert.equal(accepted.agent.badgeNumber, "A-10");
  });

  it("rechaza una venta de un agente desactivado", () => {
    const decision = decideCommandPlace({
      isThread: true,
      threadId: "100000000000000001",
      parentId: null,
      forumChannelId: null,
      agent: { ...agent, active: false },
    });

    assert.equal(decision.ok, false);
    if (decision.ok) {
      return;
    }

    assert.match(decision.message, /desactivado/);
    assert.match(decision.message, /No se registró ninguna venta/);
  });
});
