import type { Env } from "./env";
import type { LiveWind } from "./types";

const API_URL =
  "https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenLaatsteWaarnemingen";
const MS_TO_KT = 1.943844;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 10 * 60 * 1000;
const CACHE_SECONDS = 300;

interface RwsWaarde {
  Waarde_Numeriek?: number | null;
}

interface RwsMeting {
  Meetwaarde?: RwsWaarde;
  Tijdstip?: string;
}

interface RwsWaarneming {
  AquoMetadata?: {
    Grootheid?: { Code?: string };
    Eenheid?: { Code?: string };
    WaardeBepalingsMethode?: { Omschrijving?: string };
  };
  MetingenLijst?: RwsMeting[];
}

interface RwsResponse {
  WaarnemingenLijst?: RwsWaarneming[];
}

interface Candidate {
  timeMs: number;
  value: number;
  score: number;
}

function cacheKey(station: string, nowMs: number): Request {
  const bucket = Math.floor(nowMs / (CACHE_SECONDS * 1000));
  return new Request(`https://wind-report.internal/live/${encodeURIComponent(station)}/${bucket}`);
}

function methodScore(description: string | undefined): number {
  const text = (description || "").toLowerCase();
  if (text.includes("10 minuut")) return 2;
  if (text.includes("10 min.")) return 1;
  return 0;
}

function newestMeasurement(series: RwsWaarneming): Candidate | null {
  const score = methodScore(series.AquoMetadata?.WaardeBepalingsMethode?.Omschrijving);
  let newest: Candidate | null = null;
  for (const meting of series.MetingenLijst || []) {
    const value = meting.Meetwaarde?.Waarde_Numeriek;
    const timeMs = Date.parse(meting.Tijdstip || "");
    if (value == null || !Number.isFinite(value) || !Number.isFinite(timeMs)) continue;
    if (!newest || timeMs > newest.timeMs) newest = { timeMs, value, score };
  }
  return newest;
}

function freshCandidates(
  response: RwsResponse,
  grootheid: string,
  nowMs: number,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const series of response.WaarnemingenLijst || []) {
    if (series.AquoMetadata?.Grootheid?.Code !== grootheid) continue;
    const candidate = newestMeasurement(series);
    if (candidate) candidates.push(candidate);
  }

  return candidates
    .filter(
      (candidate) =>
        nowMs - candidate.timeMs <= MAX_AGE_MS && candidate.timeMs - nowMs <= MAX_FUTURE_MS,
    )
    .sort((a, b) => b.score - a.score || b.timeMs - a.timeMs);
}

function pickLive(response: RwsResponse, station: string, nowMs: number): LiveWind | null {
  const wind = freshCandidates(response, "WINDSHD", nowMs)[0];
  if (!wind) return null;

  const direction = freshCandidates(response, "WINDRTG", nowMs)[0];
  const directionDeg = direction ? Math.round(direction.value) : null;

  return {
    station,
    windMs: Math.round(wind.value * 10) / 10,
    windKt: Math.round(wind.value * MS_TO_KT),
    directionDeg,
    time: new Date(wind.timeMs).toISOString(),
  };
}

async function requestLiveWind(
  station: string,
  nowMs: number,
): Promise<LiveWind | null> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "wind-report/1.0",
    },
    body: JSON.stringify({
      AquoPlusWaarnemingMetadataLijst: [
        {
          AquoMetadata: {
            Compartiment: { Code: "LT" },
            Eenheid: { Code: "m/s" },
            Grootheid: { Code: "WINDSHD" },
          },
        },
        {
          AquoMetadata: {
            Compartiment: { Code: "LT" },
            Eenheid: { Code: "graad" },
            Grootheid: { Code: "WINDRTG" },
          },
        },
      ],
      LocatieLijst: [{ Code: station }],
    }),
    signal: AbortSignal.timeout(10000),
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });

  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(`Rijkswaterstaat returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as RwsResponse;
  return pickLive(data, station, nowMs);
}

export async function fetchLiveWind(
  env: Env,
  ctx: ExecutionContext,
  nowMs: number,
): Promise<LiveWind | null> {
  const station = (env.LIVE_STATION || "").trim();
  if (!station) return null;

  const key = cacheKey(station, nowMs);
  const cached = await caches.default.match(key);
  if (cached) return (await cached.json()) as LiveWind | null;

  const live = await requestLiveWind(station, nowMs);
  const stored = new Response(JSON.stringify(live), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `max-age=${CACHE_SECONDS}`,
    },
  });
  ctx.waitUntil(caches.default.put(key, stored));
  return live;
}
