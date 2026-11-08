import { FRAME_ROWS, type FrameInput } from "./render";
import type { LocalParts, Slot, WgForecastResponse } from "./types";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      hourCycle: "h23",
    });
    formatters.set(timeZone, value);
  }
  return value;
}

export function localParts(ms: number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday").toUpperCase(),
  };
}

function wallClockMs(ms: number, timeZone: string): number {
  const parts = localParts(ms, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function localWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, 0, 0);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const offset = wallClockMs(guess, timeZone) - Math.floor(guess / 1000) * 1000;
    guess = wall - offset;
  }
  return guess;
}

function startForNow(nowMs: number): number {
  return Math.floor(nowMs / 3_600_000) * 3_600_000;
}

function startForDay(nowMs: number, timeZone: string, targetHour: number): number {
  const current = localParts(nowMs, timeZone);
  let start = localWallToUtc(current.year, current.month, current.day, targetHour, timeZone);
  const end = start + FRAME_ROWS * 3_600_000;
  if (nowMs >= end) start += 24 * 3_600_000;
  return start;
}

export function buildFrameInput(
  data: WgForecastResponse,
  nowMs: number,
  startMode: string,
  titleOverride?: string,
): FrameInput {
  const forecast = data.forecasts[0];
  const timeZone = data.spot.timezone || "UTC";
  const indexByTime = new Map<number, number>();
  forecast.time.forEach((time, index) => indexByTime.set(Date.parse(time), index));

  let start = startForNow(nowMs);
  const dayMatch = /^day:(\d{1,2})$/.exec(startMode.trim());
  if (dayMatch) {
    const hour = Number(dayMatch[1]);
    if (hour >= 0 && hour <= 23) start = startForDay(nowMs, timeZone, hour);
  }

  const slots: Slot[] = [];
  for (let offset = 0; offset < FRAME_ROWS; offset++) {
    const time = start + offset * 3_600_000;
    const index = indexByTime.get(time);
    const local = localParts(time, timeZone);
    slots.push({
      time: new Date(time).toISOString(),
      wind: index == null ? null : (forecast.WINDSPD?.[index] ?? null),
      gust: index == null ? null : (forecast.GUST?.[index] ?? null),
      direction: index == null ? null : (forecast.WINDDIR?.[index] ?? null),
      hour: local.hour,
      minute: local.minute,
      isNow: time <= nowMs && nowMs < time + 3_600_000,
      isMidnight: local.hour === 0,
    });
  }

  return {
    spot: titleOverride || data.spot.name,
    slots,
  };
}
