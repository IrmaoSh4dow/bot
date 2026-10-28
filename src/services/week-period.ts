export const SUMMARY_LOOKBACK_DAYS = 14;

export interface WeekPeriod {
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function periodContainingLocalDate(isoDate: string, timeZone: string): WeekPeriod | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = instantFromLocal({ year, month, day, hour: 12, minute: 0, second: 0 }, timeZone);
  const parts = localParts(probe, timeZone);
  if (parts.year !== year || parts.month !== month || parts.day !== day) {
    return null;
  }

  return periodContaining(probe, timeZone);
}

export function periodContaining(instant: Date, timeZone: string): WeekPeriod {
  const local = localParts(instant, timeZone);
  if (local.weekday < 1) {
    throw new Error("No se pudo calcular el día de la semana.");
  }

  const monday = shiftDate(local, 1 - local.weekday);
  const nextMonday = shiftDate(monday, 7);

  return {
    startsAt: instantFromLocal({ ...monday, hour: 0, minute: 0, second: 0 }, timeZone),
    endsAt: instantFromLocal({ ...nextMonday, hour: 0, minute: 0, second: 0 }, timeZone),
    timeZone,
  };
}

export function summaryInstant(period: WeekPeriod, hour: number, minute: number): Date {
  const start = localParts(period.startsAt, period.timeZone);
  const sunday = shiftDate(start, 6);
  return instantFromLocal({ ...sunday, hour, minute, second: 0 }, period.timeZone);
}

export function dueWeeks(
  now: Date,
  timeZone: string,
  hour: number,
  minute: number,
  lookbackDays = SUMMARY_LOOKBACK_DAYS,
): WeekPeriod[] {
  const earliest = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  let period = periodContaining(earliest, timeZone);
  const last = periodContaining(now, timeZone);
  const due: WeekPeriod[] = [];

  for (let guard = 0; guard < 8; guard += 1) {
    if (summaryInstant(period, hour, minute).getTime() <= now.getTime()) {
      due.push(period);
    }

    if (period.startsAt.getTime() >= last.startsAt.getTime()) {
      break;
    }

    const next = periodContaining(period.endsAt, timeZone);
    if (next.startsAt.getTime() <= period.startsAt.getTime()) {
      break;
    }

    period = next;
  }

  return due;
}

export function formatDepartmentTime(instant: Date, timeZone: string): string {
  const parts = localParts(instant, timeZone);
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

function localParts(instant: Date, timeZone: string): LocalDateTime {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const parts = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday ?? ""] ?? 0,
  };
}

function shiftDate(local: Pick<LocalDateTime, "year" | "month" | "day">, days: number): Pick<LocalDateTime, "year" | "month" | "day"> {
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function instantFromLocal(local: Omit<LocalDateTime, "weekday">, timeZone: string): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = localParts(instant, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - instant.getTime();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
