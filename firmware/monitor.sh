#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ARDUINO_DIRECTORIES_DATA="$ROOT/.arduino/data"
export ARDUINO_DIRECTORIES_DOWNLOADS="$ROOT/.arduino/downloads"
export ARDUINO_DIRECTORIES_USER="$ROOT/.arduino/user"

find_port() {
  for candidate in /dev/cu.usbmodem* /dev/cu.usbserial*; do
    [ -e "$candidate" ] && echo "$candidate" && return 0
  done
  arduino-cli board list 2>/dev/null |
    awk 'tolower($0) ~ /usbmodem|usbserial/ {print $1; exit}'
}

PORT="${PORT:-}"
if [ -z "$PORT" ]; then
  PORT="$(find_port || true)"
fi

if [ -z "$PORT" ]; then
  WAIT_SECONDS="${WAIT_SECONDS:-60}"
  echo "No ESP32 serial port yet; deep sleep removes the USB CDC port."
  echo "Tap PWR/reset (or replug USB) on the board — waiting ${WAIT_SECONDS}s..."
  for _ in $(seq 1 "$WAIT_SECONDS"); do
    PORT="$(find_port || true)"
    [ -n "$PORT" ] && break
    sleep 1
  done
fi

if [ -z "$PORT" ]; then
  echo "Still no port. Press and hold PWR to power the board on, then rerun."
  echo "You can also wait for the next hourly wake."
  exit 1
fi

echo "Monitoring $PORT (Ctrl-C to quit)"
exec arduino-cli monitor -p "$PORT" -c baudrate=115200
