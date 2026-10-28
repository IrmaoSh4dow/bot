export type NodeEnvironment = "development" | "production" | "test";

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  discordToken: string;
  databaseUrl: string;
  forumChannelId: string | null;
  discordGuildId: string | null;
  departmentTimeZone: string;
  adminRoleId: string | null;
  adminUserIds: readonly string[];
  weeklySummaryEnabled: boolean;
  weeklySummaryChannelId: string | null;
  weeklySummaryHour: number;
  weeklySummaryMinute: number;
}

const SNOWFLAKE = /^[0-9]{17,20}$/;
const NODE_ENVIRONMENTS = ["development", "production", "test"] as const;

function readTrimmed(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function loadConfig(): AppConfig {
  const missing: string[] = [];
  const discordToken = readTrimmed("DISCORD_TOKEN");
  const databaseUrl = readTrimmed("DATABASE_URL");

  if (!discordToken) {
    missing.push("DISCORD_TOKEN");
  }

  if (!databaseUrl) {
    missing.push("DATABASE_URL");
  }

  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno: ${missing.join(", ")}. Copia .env.example a .env y completa los valores.`,
    );
  }

  if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
    throw new Error(
      "DATABASE_URL debe ser una cadena de conexión de PostgreSQL (postgresql:// o postgres://).",
    );
  }

  const nodeEnvRaw = readTrimmed("NODE_ENV") || "development";
  if (!NODE_ENVIRONMENTS.includes(nodeEnvRaw as NodeEnvironment)) {
    throw new Error("NODE_ENV debe ser development, production o test.");
  }

  const forumChannelRaw = readTrimmed("FORUM_CHANNEL_ID");
  if (forumChannelRaw && !SNOWFLAKE.test(forumChannelRaw)) {
    throw new Error("FORUM_CHANNEL_ID no tiene el formato de un ID de Discord.");
  }

  const guildRaw = readTrimmed("DISCORD_GUILD_ID");
  if (guildRaw && !SNOWFLAKE.test(guildRaw)) {
    throw new Error("DISCORD_GUILD_ID no tiene el formato de un ID de Discord.");
  }

  const adminRoleRaw = readTrimmed("ADMIN_ROLE_ID");
  if (adminRoleRaw && !SNOWFLAKE.test(adminRoleRaw)) {
    throw new Error("ADMIN_ROLE_ID no tiene el formato de un ID de Discord.");
  }

  const summaryChannelRaw = readTrimmed("WEEKLY_SUMMARY_CHANNEL_ID");
  if (summaryChannelRaw && !SNOWFLAKE.test(summaryChannelRaw)) {
    throw new Error("WEEKLY_SUMMARY_CHANNEL_ID no tiene el formato de un ID de Discord.");
  }

  return {
    nodeEnv: nodeEnvRaw as NodeEnvironment,
    discordToken,
    databaseUrl,
    forumChannelId: forumChannelRaw || null,
    discordGuildId: guildRaw || null,
    departmentTimeZone: readTimeZone(readTrimmed("DEPARTMENT_TIMEZONE") || "America/Bogota"),
    adminRoleId: adminRoleRaw || null,
    adminUserIds: readUserIds(readTrimmed("ADMIN_USER_IDS")),
    weeklySummaryEnabled: readEnabled(readTrimmed("WEEKLY_SUMMARY_ENABLED")),
    weeklySummaryChannelId: summaryChannelRaw || null,
    weeklySummaryHour: readBoundedInteger(readTrimmed("WEEKLY_SUMMARY_HOUR"), "WEEKLY_SUMMARY_HOUR", 0, 23, 23),
    weeklySummaryMinute: readBoundedInteger(readTrimmed("WEEKLY_SUMMARY_MINUTE"), "WEEKLY_SUMMARY_MINUTE", 0, 59, 0),
  };
}

function readTimeZone(value: string): string {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new Error("DEPARTMENT_TIMEZONE no es una zona horaria IANA válida.");
  }

  return value;
}

function readUserIds(value: string): string[] {
  if (!value) {
    return [];
  }

  const ids = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  for (const id of ids) {
    if (!SNOWFLAKE.test(id)) {
      throw new Error("ADMIN_USER_IDS debe ser una lista de IDs de Discord separados por comas.");
    }
  }

  return ids;
}

function readEnabled(value: string): boolean {
  if (!value) {
    return true;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error("WEEKLY_SUMMARY_ENABLED debe ser true o false.");
}

function readBoundedInteger(value: string, name: string, min: number, max: number, fallback: number): number {
  if (!value) {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  }

  return parsed;
}
