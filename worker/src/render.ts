import { drawArrow, drawText, drawTextScaled, fillRect, textWidth, textWidthScaled } from "./font";
import type { LiveWind, Slot } from "./types";

export const FRAME_WIDTH = 200;
export const FRAME_HEIGHT = 200;
export const FRAME_BYTES = (FRAME_WIDTH * FRAME_HEIGHT) / 8;
export const FRAME_ROWS = 11;

const DIR_CENTER = 64;
const WIND_RIGHT = 132;
const GUST_RIGHT = 194;
const TOP_Y = 1;
const START_Y = 24;
const ROW_HEIGHT = 16;
const ARROW_SIZE = 5;
const ARROW_THICKNESS = 2;

export interface FrameInput {
  spot: string;
  slots: Slot[];
  live?: LiveWind | null;
}

function hourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}

function valueLabel(value: number | null): string {
  return value == null ? "--" : String(Math.round(value));
}

const SPOT_SCALE = 1.5;

function drawSpot(frame: Uint8Array, spot: string, right: number, space: number): void {
  let text = spot;
  while (text.length > 0 && textWidthScaled(text, SPOT_SCALE, true) > space) {
    text = text.slice(0, -1);
  }
  text = text.trimEnd();
  if (!text) return;

  drawTextScaled(frame, text, right, TOP_Y, SPOT_SCALE, { bold: true, align: "right" });
}

function drawTopLine(frame: Uint8Array, spot: string, live: LiveWind | null | undefined): void {
  if (!live) {
    drawSpot(frame, spot, 196, 188);
    return;
  }

  const windText = valueLabel(live.windKt);
  drawText(frame, windText, 6, TOP_Y, { scale: 2, bold: true });
  let liveEnd = 6 + textWidth(windText, 2, true);

  if (live.directionDeg != null) {
    const snapped = (Math.round(live.directionDeg / 45) % 8) * 45;
    const arrowX = liveEnd + 8;
    drawArrow(frame, arrowX, TOP_Y + 7, snapped, true, ARROW_SIZE, 200, ARROW_THICKNESS);
    liveEnd = arrowX + 6;
  }

  drawSpot(frame, spot, 196, 196 - (liveEnd + 8));
}

export function renderFrame(input: FrameInput): Uint8Array {
  const frame = new Uint8Array(FRAME_BYTES).fill(0xff);

  drawTopLine(frame, input.spot.toUpperCase(), input.live);

  input.slots.slice(0, FRAME_ROWS).forEach((slot, index) => {
    const y = START_Y + index * ROW_HEIGHT;
    if (slot.isNow) fillRect(frame, 4, y, 192, ROW_HEIGHT - 1, true);

    const black = !slot.isNow;
    drawText(frame, hourLabel(slot.hour), 8, y, { black, bold: true, scale: 2 });

    if (slot.direction == null) {
      drawText(frame, "-", DIR_CENTER, y, { black, align: "center", scale: 2 });
    } else {
      const snapped = (Math.round(slot.direction / 45) % 8) * 45;
      drawArrow(frame, DIR_CENTER, y + 7, snapped, black, ARROW_SIZE, 200, ARROW_THICKNESS);
    }

    drawText(frame, valueLabel(slot.wind), WIND_RIGHT, y, {
      black,
      bold: true,
      align: "right",
      scale: 2,
    });

    drawText(frame, valueLabel(slot.gust), GUST_RIGHT, y, {
      black,
      bold: true,
      align: "right",
      scale: 2,
    });
  });

  return frame;
}
