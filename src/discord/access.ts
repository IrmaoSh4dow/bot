import { PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";

export interface DepartmentAccess {
  adminRoleId: string | null;
  adminUserIds: readonly string[];
}

export const DEPARTMENT_DENIED = "No tienes permiso para gestionar el departamento.";

export function isDepartmentManager(input: {
  userId: string;
  roleIds: readonly string[];
  administrator: boolean;
  access: DepartmentAccess;
}): boolean {
  if (input.administrator) {
    return true;
  }

  if (input.access.adminRoleId && input.roleIds.includes(input.access.adminRoleId)) {
    return true;
  }

  return input.access.adminUserIds.includes(input.userId);
}

export function interactionIsManager(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  access: DepartmentAccess,
): boolean {
  return isDepartmentManager({
    userId: interaction.user.id,
    roleIds: memberRoleIds(interaction.member),
    administrator: interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
    access,
  });
}

function memberRoleIds(member: unknown): string[] {
  if (!member || typeof member !== "object" || !("roles" in member)) {
    return [];
  }

  const roles = member.roles;
  if (Array.isArray(roles)) {
    return roles.filter((role): role is string => typeof role === "string");
  }

  if (typeof roles === "object" && roles !== null && "cache" in roles && roles.cache instanceof Map) {
    return [...roles.cache.keys()];
  }

  return [];
}
