import type { Env } from "./env";
import { buildFrameInput, localParts } from "./forecast";
import { fetchLiveWind } from "./livewind";
import { encodePng } from "./png";
import { FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH, renderFrame } from "./render";
import { fetchForecast, UpstreamError } from "./windguru";

const DATA_PATHS = new Set(["/", "/frame", "/preview", "/preview.png"]);

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function authorized(request: Request, env: Env, url: URL): boolean {
  if (!env.DEVICE_TOKEN) return true;
  const token = request.headers.get("X-Device-Key") || url.searchParams.get("key");
  return token === env.DEVICE_TOKEN;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "wind-report",
        spot: env.SPOT_ID,
        model: env.MODEL || "ifs",
        start: env.START || "day:8",
        liveStation: env.LIVE_STATION || null,
        mock: env.MOCK === "1",
      });
    }

    if (!DATA_PATHS.has(url.pathname)) {
      return jsonError(404, "not_found", "Unknown path");
    }
    if (request.method !== "GET") {
      return jsonError(405, "method_not_allowed", "Use GET");
    }
    if (!authorized(request, env, url)) {
      return jsonError(401, "unauthorized", "Missing or invalid X-Device-Key");
    }

    const wantsPng = url.searchParams.get("format") === "png" || url.pathname.endsWith(".png");

    try {
      const now = Date.now();
      const data = await fetchForecast(env, ctx, now);
      const live = await fetchLiveWind(env, ctx, now).catch((error) => {
        console.error("Live wind unavailable", error);
        return null;
      });
      const input = buildFrameInput(data, now, env.START || "day:8", env.TITLE);
      input.live = live;
      const frame = renderFrame(input);
      const local = localParts(now, data.spot.timezone || "UTC");
      const refreshAfter = 3600 - (local.minute * 60 + local.second) + 10;

      const headers = new Headers({
        "Cache-Control": wantsPng ? "public, max-age=60" : "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
        "X-Frame-Width": String(FRAME_WIDTH),
        "X-Frame-Height": String(FRAME_HEIGHT),
        "X-Frame-Bytes": String(FRAME_BYTES),
        "X-Spot": data.spot.name,
        "X-Model": data.forecasts[0].model,
        "X-Model-Run": data.forecasts[0].run,
        "X-Forecast-Start": input.slots[0]?.time || "",
        "X-Refresh-After": String(refreshAfter),
      });

      if (live) {
        headers.set("X-Live-Station", live.station);
        headers.set("X-Live-Wind-Kt", String(live.windKt));
        headers.set("X-Live-Wind-Ms", String(live.windMs));
        if (live.directionDeg != null) {
          headers.set("X-Live-Direction", String(live.directionDeg));
        }
        headers.set("X-Live-Time", live.time);
      }

      if (env.MOCK === "1") headers.set("X-Test-Data", "1");

      if (wantsPng) {
        const png = await encodePng(frame);
        headers.set("Content-Type", "image/png");
        return new Response(png, { headers });
      }

      headers.set("Content-Type", "application/octet-stream");
      return new Response(frame, { headers });
    } catch (error) {
      if (error instanceof UpstreamError) {
        const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
        return jsonError(status, error.code, error.message);
      }
      console.error("Unhandled error", error);
      return jsonError(502, "internal_error", "Could not build the forecast frame");
    }
  },
} satisfies ExportedHandler<Env>;
