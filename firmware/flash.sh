#!/usr/bin/env bash
set -euo pipefail

WIFI_SSID="${WIFI_SSID:-}"
WIFI_PASSWORD="${WIFI_PASSWORD:-}"
WORKER_URL="${WORKER_URL:-}"
DEVICE_TOKEN="${DEVICE_TOKEN:-}"
WROTE_CONFIG=0

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKETCH="$ROOT/firmware/wind_report"
FQBN="esp32:esp32:esp32c6:CDCOnBoot=cdc"

export ARDUINO_DIRECTORIES_DATA="$ROOT/.arduino/data"
export ARDUINO_DIRECTORIES_DOWNLOADS="$ROOT/.arduino/downloads"
export ARDUINO_DIRECTORIES_USER="$ROOT/.arduino/user"

if ! command -v arduino-cli >/dev/null 2>&1; then
  echo "arduino-cli is not installed."
  echo "Install it with: brew install arduino-cli"
  exit 1
fi

escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

write_config() {
  cat > "$SKETCH/config.h" <<EOF
#pragma once

#define WIFI_SSID "$(escape "${WIFI_SSID}")"
#define WIFI_PASSWORD "$(escape "${WIFI_PASSWORD}")"
#define WORKER_URL "$(escape "${WORKER_URL}")"
#define DEVICE_TOKEN "$(escape "${DEVICE_TOKEN:-}")"
EOF
  echo "Wrote $SKETCH/config.h"
  WROTE_CONFIG=1
}

if [ -n "${WIFI_SSID:-}" ] || [ -n "${WORKER_URL:-}" ]; then
  : "${WIFI_SSID:?Set WIFI_SSID}"
  : "${WIFI_PASSWORD:?Set WIFI_PASSWORD}"
  : "${WORKER_URL:?Set WORKER_URL}"
  write_config
elif [ ! -f "$SKETCH/config.h" ] || grep -Eq 'your-wifi|YOUR-SUBDOMAIN' "$SKETCH/config.h"; then
  echo "Firmware configuration:"
  read -rp "  WiFi SSID: " WIFI_SSID
  read -rsp "  WiFi password: " WIFI_PASSWORD; echo
  read -rp "  Worker /frame URL: " WORKER_URL
  read -rp "  Device token (blank if none): " DEVICE_TOKEN
  write_config
else
  echo "Using existing $SKETCH/config.h"
fi

if [ "$WROTE_CONFIG" = 1 ]; then
  case "$WORKER_URL" in
    https://*/frame|https://*/frame/*) ;;
    *) echo "Warning: WORKER_URL should normally end in /frame." ;;
  esac
fi

if ! arduino-cli core list 2>/dev/null | grep -q '^esp32:esp32'; then
  echo "Installing esp32:esp32 3.3.0 (one-time, large download)..."
  arduino-cli core update-index
  arduino-cli core install esp32:esp32@3.3.0
fi

CTAGS="$ARDUINO_DIRECTORIES_DATA/packages/builtin/tools/ctags/5.8-arduino11/ctags"
if [ -x "$CTAGS" ] && [ "$(uname -m)" = "arm64" ] && ! "$CTAGS" --version >/dev/null 2>&1; then
  echo "Applying local ctags shim for Apple Silicon..."
  mv "$CTAGS" "$CTAGS.x86_64"
  printf '#!/bin/sh\nexit 0\n' > "$CTAGS"
  chmod +x "$CTAGS"
fi

echo "Compiling..."
if [ -n "${DEBUG_AWAKE:-}" ]; then
  echo "Debug build: staying awake ${DEBUG_AWAKE}s after boot."
  arduino-cli compile --fqbn "$FQBN" \
    --build-property "build.extra_flags=-DKEEP_AWAKE_SECONDS=${DEBUG_AWAKE}" "$SKETCH"
else
  arduino-cli compile --fqbn "$FQBN" "$SKETCH"
fi

find_port() {
  for candidate in /dev/cu.usbmodem* /dev/cu.usbserial*; do
    [ -e "$candidate" ] && echo "$candidate" && return 0
  done
  arduino-cli board list 2>/dev/null |
    awk 'tolower($0) ~ /usbmodem|usbserial/ {print $1; exit}'
}

PORT="${PORT:-}"
if [ -z "$PORT" ]; then PORT="$(find_port || true)"; fi
if [ -z "$PORT" ]; then
  WAIT_SECONDS="${WAIT_SECONDS:-60}"
  echo "No ESP32 serial port yet."
  echo "Plug in USB (data cable), then press/hold PWR."
  echo "For download mode: hold BOOT, tap PWR, release BOOT."
  echo "Waiting ${WAIT_SECONDS}s..."
  for _ in $(seq 1 "$WAIT_SECONDS"); do
    PORT="$(find_port || true)"
    [ -n "$PORT" ] && break
    sleep 1
  done
fi
if [ -z "$PORT" ]; then
  echo "Still no port. Check the cable/USB port, or use download mode."
  exit 1
fi

echo "Uploading to $PORT..."
arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$SKETCH"

echo
echo "Done. Monitor with:"
echo "  ./firmware/monitor.sh"
