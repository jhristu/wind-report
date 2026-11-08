import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFrameInput } from "../src/forecast";
import { encodePng } from "../src/png";
import { FRAME_HEIGHT, FRAME_WIDTH, renderFrame } from "../src/render";
import type { WgForecastResponse } from "../src/types";

const key = process.env.WINDGURU_API_KEY;
if (!key) {
  console.error("Set WINDGURU_API_KEY first (for example: set -a; . ../.env.local; set +a)");
  process.exit(1);
}

const spot = process.env.SPOT_ID || "43";
const model = process.env.MODEL || "ifs";
const url = new URL(`https://api.windguru.cz/v1/forecast/spot/${spot}`);
url.searchParams.set("models", model);
url.searchParams.set("hours", "48");
url.searchParams.set("vars", "WINDSPD,GUST,WINDDIR");

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
});
if (!response.ok) {
  console.error(`Windguru HTTP ${response.status}: ${await response.text()}`);
  process.exit(1);
}

const data = (await response.json()) as WgForecastResponse;
const now = Date.now();
const input = buildFrameInput(data, now, process.env.START || "day:8", process.env.TITLE);
const frame = renderFrame(input);
const png = await encodePng(frame, FRAME_WIDTH, FRAME_HEIGHT);
const out = join(process.cwd(), "preview-real.png");
writeFileSync(out, png);

console.log(`wrote ${out} (${png.length} bytes)`);
console.log(`spot: ${data.spot.name} (${data.spot.timezone}), model: ${data.forecasts[0].model}`);
console.log(`cost: ${data.meta?.cost ?? "?"} CU, request: ${data.meta?.request_id ?? "?"}`);
console.log(
  `first slots: ${input.slots
    .slice(0, 4)
    .map((slot) => `${slot.hour}:00 ${slot.wind}-${slot.gust}${slot.isNow ? " <now>" : ""}`)
    .join(", ")}`,
);
