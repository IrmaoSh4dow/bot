import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDepartmentManager } from "./access.js";

const access = { adminRoleId: "200000000000000001", adminUserIds: ["300000000000000001"] };

describe("permisos del departamento", () => {
  it("admite administradores, el rol configurado y los usuarios autorizados", () => {
    assert.equal(
      isDepartmentManager({
        userId: "300000000000000099",
        roleIds: [],
        administrator: true,
        access,
      }),
      true,
    );
    assert.equal(
      isDepartmentManager({
        userId: "300000000000000099",
        roleIds: ["200000000000000001"],
        administrator: false,
        access,
      }),
      true,
    );
    assert.equal(
      isDepartmentManager({
        userId: "300000000000000001",
        roleIds: [],
        administrator: false,
        access,
      }),
      true,
    );
  });

  it("rechaza a quien no está autorizado", () => {
    assert.equal(
      isDepartmentManager({
        userId: "300000000000000099",
        roleIds: ["200000000000000002"],
        administrator: false,
        access,
      }),
      false,
    );
    assert.equal(
      isDepartmentManager({
        userId: "300000000000000099",
        roleIds: [],
        administrator: false,
        access: { adminRoleId: null, adminUserIds: [] },
      }),
      false,
    );
  });
});