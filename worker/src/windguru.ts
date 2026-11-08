import type { Env } from "./env";
import type { WgForecastResponse } from "./types";

const API_BASE = "https://api.windguru.cz/v1/forecast/spot";

export class UpstreamError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

function cacheKey(spotId: string, model: string, nowMs: number): Request {
  const bucket = Math.floor(nowMs / (15 * 60 * 1000));
  return new Request(`https://wind-report.internal/forecast/${spotId}/${model}/${bucket}`);
}

async function fetchModel(
  env: Env,
  ctx: ExecutionContext,
  spotId: string,
  model: string,
  nowMs: number,
): Promise<WgForecastResponse> {
  const key = cacheKey(spotId, model, nowMs);
  const cached = await caches.default.match(key);
  if (cached) {
    return (await cached.json()) as WgForecastResponse;
  }

  const url = new URL(`${API_BASE}/${encodeURIComponent(spotId)}`);
  url.searchParams.set("models", model);
  url.searchParams.set("hours", "48");
  url.searchParams.set("vars", "WINDSPD,GUST,WINDDIR");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.WINDGURU_API_KEY}`,
      Accept: "application/json",
      "User-Agent": "wind-report/1.0",
    },
    signal: AbortSignal.timeout(15000),
    cf: { cacheTtl: 900, cacheEverything: true },
  });

  if (!response.ok) {
    let code = "upstream_error";
    let message = `Windguru returned HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // Keep the HTTP status based message.
    }
    throw new UpstreamError(response.status, code, message);
  }

  const data = (await response.json()) as WgForecastResponse;
  if (!data.forecasts?.length) {
    throw new UpstreamError(502, "empty_forecast", "Windguru returned no forecasts");
  }

  const cacheResponse = new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=900" },
  });
  ctx.waitUntil(caches.default.put(key, cacheResponse));

  return data;
}

export async function fetchForecast(env: Env, ctx: ExecutionContext, nowMs: number): Promise<WgForecastResponse> {
  if (env.MOCK === "1") return mockForecast(env, nowMs);

  if (!env.WINDGURU_API_KEY) {
    throw new UpstreamError(500, "missing_key", "WINDGURU_API_KEY is not configured");
  }
  if (!env.SPOT_ID || env.SPOT_ID === "REPLACE_ME") {
    throw new UpstreamError(500, "missing_spot", "SPOT_ID is not configured");
  }

  const requested = (env.MODEL || "ifs").trim() || "ifs";
  const models = requested === "gfs" ? ["gfs"] : [requested, "gfs"];

  let lastError: unknown;
  for (const model of models) {
    try {
      return await fetchModel(env, ctx, env.SPOT_ID, model, nowMs);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof UpstreamError && [403, 404, 422].includes(error.status) && model !== "gfs";
      if (!retryable) throw error;
    }
  }

  throw lastError;
}

export function mockForecast(env: Env, nowMs: number): WgForecastResponse {
  const nowHour = Math.floor(nowMs / 3_600_000) * 3_600_000;
  const firstHour = nowHour - 24 * 3_600_000;
  const time: string[] = [];
  const hours: number[] = [];
  const WINDSPD: number[] = [];
  const GUST: number[] = [];
  const WINDDIR: number[] = [];

  for (let i = 0; i < 73; i++) {
    time.push(new Date(firstHour + i * 3_600_000).toISOString());
    hours.push(i);
    const wind = 9 + 5 * Math.sin((i + 1) / 3.2) + 2 * Math.sin(i / 7);
    WINDSPD.push(Math.round(wind * 10) / 10);
    GUST.push(Math.round((wind + 4.5 + 2 * Math.cos(i / 2.5)) * 10) / 10);
    WINDDIR.push((i % 8) * 45);
  }

  return {
    spot: {
      id: Number(env.SPOT_ID) || 43,
      name: env.TITLE || "Amsterdam",
      country: "Mock",
      timezone: env.TIMEZONE || "Europe/Madrid",
      lat: 36,
      lon: -5.65,
      models: [env.MODEL || "ifs", "gfs"],
    },
    units: { wind: "kt", temp: "C", precip: "mm", wave: "m", pressure: "hPa", cloud: "%", rh: "%" },
    forecasts: [
      {
        model: env.MODEL || "ifs",
        model_name: "Mock model",
        run: new Date(nowHour - 6 * 3_600_000).toISOString(),
        hours,
        time,
        WINDSPD,
        GUST,
        WINDDIR,
      },
    ],
    meta: { cost: 0, cached: false },
  };
}
