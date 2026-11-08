import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../src/env";
import { buildFrameInput } from "../src/forecast";
import { encodePng } from "../src/png";
import { FRAME_HEIGHT, FRAME_WIDTH, renderFrame } from "../src/render";
import { mockForecast } from "../src/windguru";

const env: Env = {
  WINDGURU_API_KEY: "unused",
  SPOT_ID: process.env.SPOT_ID || "43",
  MODEL: process.env.MODEL || "ifs",
  START: process.env.START || "day:8",
  TITLE: process.env.TITLE,
  MOCK: "1",
};

const now = Date.now();
const data = mockForecast(env, now);
const input = buildFrameInput(data, now, env.START || "day:8", env.TITLE);
input.live = {
  station: "mock",
  windMs: 4.1,
  windKt: 8,
  directionDeg: 0,
  time: new Date(now).toISOString(),
};
const frame = renderFrame(input);
const png = await encodePng(frame, FRAME_WIDTH, FRAME_HEIGHT);
const out = join(process.cwd(), "preview.png");
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes, ${frame.length} frame bytes)`);
console.log(`spot: ${input.spot}`);
console.log(
  `slots: ${input.slots
    .slice(0, 4)
    .map((slot) => `${slot.hour}:00 ${slot.wind}-${slot.gust}${slot.isNow ? " <now>" : ""}`)
    .join(", ")}`,
);
