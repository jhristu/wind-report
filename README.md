# wind-report

A tiny hourly wind forecast display for the **Waveshare ESP32-C6-ePaper-1.54**.
It shows an 11-hour wind table in knots (08:00–18:00), with the current hour
inverted, plus an optional live wind reading from Rijkswaterstaat Waterinfo.

```
8 kt ↗      WIJK AAN ZEE
 08     ↓     21         32
 09     ↙     21         31
 10     ←     22         33
 ...
 16     ↖     19         28
 17     ↑     18         26   <- current hour, inverted
 18     ↗     18         25
```

## How it works

```
Windguru API      ->  Cloudflare Worker  ->  200x200 1-bit frame  ->  ESP32-C6  ->  e-paper
RWS Waterinfo API ->
```

The Worker is the only thing that knows the Windguru API key. It fetches the
forecast, converts the times to the spot's local time zone, and renders a
200x200 monochrome bitmap. The device just downloads 5000 bytes, blits them to
the display, and deep-sleeps until the next hour.

This keeps the firmware tiny and the API key off the device. It also means you
can change the layout by editing one TypeScript file and redeploying the Worker.

## Display layout

- 11 rows (08:00–18:00): local hour, wind direction, wind in knots, gusts in knots (rounded).
- Columns are unlabeled; `DIR` is a bold arrow showing where the wind blows to
  (a north wind points down). Speeds are in knots.
- If `LIVE_STATION` is set, a live reading such as `8 kt ↗` (wind speed plus a
  direction arrow) appears at the top left, with the spot name on the right.
  The rest of the table stays forecast.
- The current hour is a black row with white text.
- `START=day:8` (default) shows the 08:00–18:00 wind day. If the current time is
  outside that window, it shows the current or next wind day and no row is
  highlighted.
- `START=now` shows 11 hours starting at the current hour, with the current hour
  at the top.

## Repository

```
worker/                 Cloudflare Worker (TypeScript)
  src/index.ts          HTTP routes, auth, caching, headers
  src/windguru.ts       Windguru API client + mock data
  src/livewind.ts       RWS Waterinfo live wind client
  src/forecast.ts       UTC -> local time, 11-hour window
  src/render.ts         e-paper layout
  src/font.ts           5x7 bitmap font
  src/png.ts            1-bit PNG preview encoder
  wrangler.toml.example copy to wrangler.toml and set your spot
  .dev.vars.example     copy to .dev.vars for local secrets
  test/preview.ts       local mock preview (no key needed)
  test/preview-real.ts  local real preview (uses your key)

firmware/wind_report/   Arduino sketch for the ESP32-C6-ePaper-1.54
  wind_report.ino       WiFi, HTTP fetch, deep sleep
  display.cpp/.h        SSD1681 e-paper driver + TCA9554 power control
  config.h.example      copy to config.h and fill in
```

## Quick start

### 1. Find your Windguru spot id

Open your spot on Windguru. The id is the number in the URL:

```
https://www.windguru.cz/43   ->   spot id 43 (Tarifa)
```

Windguru's API requires a **Personal** plan or higher (Personal is included in
Windguru PRO). The free Developer plan returns realistic-looking *test* data,
not real forecasts. Keep the API key secret; it must stay in the Worker.

### 2. Deploy the Worker

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
cp wrangler.toml.example wrangler.toml
# edit .dev.vars: WINDGURU_API_KEY=... and optionally DEVICE_TOKEN=...
```

Edit `wrangler.toml` and set `SPOT_ID` to your spot. Then:

```bash
npx wrangler login
npx wrangler deploy
npx wrangler secret put WINDGURU_API_KEY
# only if you set DEVICE_TOKEN in .dev.vars:
npx wrangler secret put DEVICE_TOKEN
```

`wrangler secret put` is required in production; `.dev.vars` only affects
`wrangler dev`.

Test it:

```bash
# 5000-byte raw frame
curl -H "X-Device-Key: YOUR_TOKEN" \
  https://wind-report.YOUR-SUBDOMAIN.workers.dev/frame -o frame.bin

# 200x200 PNG preview
curl -H "X-Device-Key: YOUR_TOKEN" \
  "https://wind-report.YOUR-SUBDOMAIN.workers.dev/preview.png" -o preview.png
```

Open `preview.png` to check the layout before flashing the device.

### 3. Flash the firmware

One command, from the repo root:

```bash
./firmware/flash.sh
```

It installs the ESP32 Arduino core once if needed, asks for WiFi and the Worker
`/frame` URL, compiles, finds the USB port, and uploads. You can also pass the
values non-interactively:

```bash
WIFI_SSID='my-wifi' WIFI_PASSWORD='secret' \
WORKER_URL='https://wind-report.YOUR-SUBDOMAIN.workers.dev/frame' \
DEVICE_TOKEN='your-token' ./firmware/flash.sh
```

Use `PORT=/dev/cu.usbmodem101 ./firmware/flash.sh` if you have more than one
serial port. If the board is not detected, hold **BOOT**, tap **PWR**/reset,
release **BOOT**, and rerun.

<details>
<summary>Manual arduino-cli commands</summary>

```bash
arduino-cli core install esp32:esp32@3.3.0
arduino-cli compile --fqbn 'esp32:esp32:esp32c6:CDCOnBoot=cdc' firmware/wind_report
arduino-cli upload -p /dev/cu.usbmodem101 \
  --fqbn 'esp32:esp32:esp32c6:CDCOnBoot=cdc' firmware/wind_report
```

On Apple Silicon, if `arduino-cli` fails with `bad CPU type in executable` for
`ctags`, install Rosetta (`softwareupdate --install-rosetta`) or use the local
shim that `firmware/flash.sh` applies.
</details>

On boot it connects to WiFi, fetches the frame, refreshes the e-paper, and goes
into deep sleep for the number of seconds in the Worker's `X-Refresh-After`
header (until the next local hour, +10 s). If the fetch fails it keeps the old
image and retries in 15 minutes.

## Configuration

Worker variables (in `wrangler.toml`):

| Variable | Default | Meaning |
|---|---|---|
| `SPOT_ID` | `43` | Windguru spot id |
| `MODEL` | `harmnl` | Model short name (`harmnl` = HARM-NL 2 km, `ifs`, `gfs`, ...) |
| `START` | `day:8` | `day:H` for a local-day window, or `now` for 11 hours from now |
| `LIVE_STATION` | `ijmuiden.buitenhaven` | RWS Waterinfo location code for the live wind row; empty disables it |
| `TITLE` | spot name | Optional display title override |
| `TIMEZONE` | spot timezone | Only used by mock data |
| `MOCK` | `0` | Set to `1` to render fake data without calling Windguru |

Secrets:

| Secret | Meaning |
|---|---|
| `WINDGURU_API_KEY` | Your Windguru API key |
| `DEVICE_TOKEN` | Optional shared token; if set, the device must send it |

If the requested `MODEL` is not available for the spot, the Worker falls back
to `gfs`. `harmnl` is set for HARM-NL 2 km; `ifs` is a good global default if
the spot is outside the HARM-NL domain.

## Local preview

```bash
cd worker
npm run preview        # mock data, no API key needed -> preview.png
```

For a real preview:

```bash
cd worker
set -a; . ../.env.local; set +a
SPOT_ID=43 MODEL=harmnl npm run preview:real   # -> preview-real.png
```

`.env.local` and `worker/.dev.vars` are gitignored. Never commit the API key,
and do not put it in the firmware.

## Notes

- **Units:** Windguru returns wind in knots for this endpoint; the frame labels
  them `kt`. RWS Waterinfo returns m/s, so the Worker converts it to knots
  (`1 m/s = 1.943844 kt`) before drawing the `NOW` reading.
- **Live wind:** `LIVE_STATION` uses the RWS Waterinfo `WINDSHD` (10-minute mean
  wind) and `WINDRTG` (wind direction) observations from the
  [WaterWebservices API](https://rijkswaterstaatdata.nl/waterdata/). It only
  covers Dutch waters, updates about every 10 minutes, and is cached for 5
  minutes by the Worker. The device still refreshes hourly, so the live reading
  is a snapshot from the last refresh. The direction is drawn as an arrow in
  the same style as the forecast rows. The `WINDST` gust series is not published
  live by Waterinfo at the moment, so the `GUSTS` column stays forecast-only.
- **Costs and limits:** A Personal plan allows 10 different locations per day
  and 40 per month. Requesting the same spot again during the day does not
  count again. The Worker caches forecast JSON for 15 minutes.
- **Attribution:** The API requires attribution when data is shown publicly.
  Personal use does not. The frame itself does not add an attribution line; the
  full text is in the API `meta.attribution` if you publish the data.
- **TLS:** The prototype firmware uses `client.setInsecure()` because the
  Worker hostname is yours and the payload is not sensitive. If you want
  certificate pinning, put your Worker's root CA in `config.h` and call
  `client.setCACert(...)` instead.
- **Battery:** The firmware gates EPD power through the TCA9554 and keeps the
  battery latch on. It does not implement the vendor's long-press power-off
  handler; unplug the battery to fully power down.
- **Refresh:** Each update is a full e-paper refresh (about 2 s, with a flash).
  The device sleeps until the next local hour using the Worker header, so it
  does not need NTP.

## Troubleshooting

| Symptom | Check |
|---|---|
| `401 unauthorized` | `DEVICE_TOKEN` in the Worker and `config.h` must match |
| `500 missing_key` | Run `npx wrangler secret put WINDGURU_API_KEY` after deploying |
| `500 missing_spot` | Set `SPOT_ID` in `wrangler.toml` and redeploy |
| `403 plan_denied` | The key has no active plan, or the model/hours exceed the plan |
| Fake-looking data | You are on a test key (`wg_test_...` or Developer plan) |
| Device stays blank | Check serial logs; it keeps the old image on fetch failure |
| Image upside down | The frame follows the vendor buffer orientation; tell me and I will add a rotate option |
