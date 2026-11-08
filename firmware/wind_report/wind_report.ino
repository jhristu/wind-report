#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_sleep.h>

#include "config.h"
#include "display.h"

#ifndef KEEP_AWAKE_SECONDS
#define KEEP_AWAKE_SECONDS 0
#endif

namespace {

constexpr uint32_t FRAME_WIDTH = 200;
constexpr uint32_t FRAME_HEIGHT = 200;
constexpr uint32_t FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT / 8;
constexpr uint8_t PWR_BUTTON_PIN = 2;

uint8_t frame[FRAME_BYTES];
uint32_t refreshAfterSeconds = 0;

bool connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 25000) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("wifi: failed");
    return false;
  }
  Serial.print("wifi: ");
  Serial.println(WiFi.localIP());
  return true;
}

bool fetchFrame() {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(20000);

  if (!http.begin(client, WORKER_URL)) {
    Serial.println("http: begin failed");
    return false;
  }

  http.addHeader("Accept", "application/octet-stream");
  if (strlen(DEVICE_TOKEN) > 0) {
    http.addHeader("X-Device-Key", DEVICE_TOKEN);
  }

  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.printf("http: %d\n", code);
    http.end();
    return false;
  }

  const String frameBytes = http.header("X-Frame-Bytes");
  if (frameBytes.length() > 0 && frameBytes.toInt() != static_cast<int>(FRAME_BYTES)) {
    Serial.printf("http: unexpected frame size %s\n", frameBytes.c_str());
    http.end();
    return false;
  }

  WiFiClient *stream = http.getStreamPtr();
  size_t read = 0;
  const uint32_t started = millis();
  while (read < FRAME_BYTES && millis() - started < 20000) {
    const size_t available = stream->available();
    if (available > 0) {
      const size_t remaining = FRAME_BYTES - read;
      const int count = stream->readBytes(frame + read, available < remaining ? available : remaining);
      if (count <= 0) break;
      read += count;
    } else {
      if (!http.connected()) break;
      delay(10);
    }
  }

  const String spot = http.header("X-Spot");
  const String model = http.header("X-Model");
  const String refresh = http.header("X-Refresh-After");
  if (refresh.length() > 0) refreshAfterSeconds = refresh.toInt();
  http.end();

  if (read != FRAME_BYTES) {
    Serial.printf("http: short frame %u/%u\n", static_cast<unsigned>(read), static_cast<unsigned>(FRAME_BYTES));
    return false;
  }

  Serial.printf("frame: %s / %s\n", spot.c_str(), model.c_str());
  return true;
}

void deepSleep(uint32_t seconds) {
  pinMode(PWR_BUTTON_PIN, INPUT_PULLUP);
  esp_sleep_enable_ext1_wakeup(1ULL << PWR_BUTTON_PIN, ESP_EXT1_WAKEUP_ALL_LOW);

#if KEEP_AWAKE_SECONDS > 0
  Serial.printf("debug: staying awake %ds\n", KEEP_AWAKE_SECONDS);
  Serial.flush();
  delay(static_cast<uint32_t>(KEEP_AWAKE_SECONDS) * 1000UL);
#endif
  Serial.printf("sleep: %us\n", static_cast<unsigned>(seconds));
  Serial.flush();
  esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(seconds) * 1000000ULL);
  esp_deep_sleep_start();
}

void sleepUntilNextHour() {
  const uint32_t seconds =
      (refreshAfterSeconds >= 5 && refreshAfterSeconds <= 7200) ? refreshAfterSeconds : 3600;
  deepSleep(seconds);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.printf("\nwind-report (wake cause %d)\n", static_cast<int>(esp_sleep_get_wakeup_cause()));

  boardPowerOn();

  bool ok = false;
  if (connectWifi()) {
    for (int attempt = 0; attempt < 3 && !ok; attempt++) {
      ok = fetchFrame();
      if (!ok) delay(5000);
    }
  }

  if (ok) {
    epdPower(true);
    epdInit();
    epdDisplay(frame);
    epdSleep();
    epdPower(false);
    Serial.println("display: updated");
  } else {
    Serial.println("display: keeping previous image");
  }

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  if (!ok) deepSleep(15 * 60);
  sleepUntilNextHour();
}

void loop() {}
