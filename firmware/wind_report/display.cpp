#include "display.h"

#include <SPI.h>
#include <Wire.h>

namespace {

constexpr int PIN_SCK = 6;
constexpr int PIN_MOSI = 5;
constexpr int PIN_MISO = 4;
constexpr int PIN_CS = 7;
constexpr int PIN_DC = 15;
constexpr int PIN_RST = 11;
constexpr int PIN_BUSY = 10;

constexpr int I2C_SDA = 18;
constexpr int I2C_SCL = 8;
constexpr uint8_t TCA9554_ADDR = 0x20;
constexpr uint8_t TCA_OUTPUT_REG = 0x01;
constexpr uint8_t TCA_CONFIG_REG = 0x03;
constexpr uint8_t TCA_EPD_BIT = 0;
constexpr uint8_t TCA_VBAT_BIT = 5;

constexpr uint32_t EPD_WIDTH = 200;
constexpr uint32_t EPD_HEIGHT = 200;
constexpr uint32_t EPD_FRAME_BYTES = EPD_WIDTH * EPD_HEIGHT / 8;

SPISettings spiSettings(10000000, MSBFIRST, SPI_MODE0);

const uint8_t WF_FULL_1IN54[159] = {
  0x80, 0x48, 0x40, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x40, 0x48, 0x80, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x80, 0x48, 0x40, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x40, 0x48, 0x80, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0xA, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x8, 0x1, 0x0, 0x8, 0x1,
  0x0, 0x2, 0xA, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x0, 0x0, 0x0, 0x22, 0x17, 0x41,
  0x0, 0x32, 0x20,
};

void tcaWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(TCA9554_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

bool waitBusy(uint32_t timeoutMs = 20000) {
  const uint32_t started = millis();
  while (digitalRead(PIN_BUSY) == HIGH) {
    if (millis() - started > timeoutMs) return false;
    delay(5);
  }
  return true;
}

void epdCommand(uint8_t command) {
  digitalWrite(PIN_DC, LOW);
  digitalWrite(PIN_CS, LOW);
  SPI.beginTransaction(spiSettings);
  SPI.transfer(command);
  SPI.endTransaction();
  digitalWrite(PIN_CS, HIGH);
}

void epdData(const uint8_t *data, size_t length) {
  digitalWrite(PIN_DC, HIGH);
  digitalWrite(PIN_CS, LOW);
  SPI.beginTransaction(spiSettings);
  SPI.writeBytes(data, length);
  SPI.endTransaction();
  digitalWrite(PIN_CS, HIGH);
}

void epdDataByte(uint8_t value) {
  epdData(&value, 1);
}

void setWindows(uint16_t xStart, uint16_t yStart, uint16_t xEnd, uint16_t yEnd) {
  epdCommand(0x44);
  epdDataByte((xStart >> 3) & 0xFF);
  epdDataByte((xEnd >> 3) & 0xFF);

  epdCommand(0x45);
  epdDataByte(yStart & 0xFF);
  epdDataByte((yStart >> 8) & 0xFF);
  epdDataByte(yEnd & 0xFF);
  epdDataByte((yEnd >> 8) & 0xFF);
}

void setCursor(uint16_t x, uint16_t y) {
  epdCommand(0x4E);
  epdDataByte(x & 0xFF);
  epdCommand(0x4F);
  epdDataByte(y & 0xFF);
  epdDataByte((y >> 8) & 0xFF);
}

void setLut(const uint8_t *lut) {
  epdCommand(0x32);
  epdData(lut, 153);
  waitBusy();

  epdCommand(0x3F);
  epdDataByte(lut[153]);

  epdCommand(0x03);
  epdDataByte(lut[154]);

  epdCommand(0x04);
  epdData(lut + 155, 3);

  epdCommand(0x2C);
  epdDataByte(lut[158]);
}

}  // namespace

void boardPowerOn() {
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);

  // Latch the outputs first, then make pins 0 (EPD), 1 (audio) and 5 (battery)
  // outputs. This avoids a brief all-high glitch when the expander powers up.
  tcaWrite(TCA_OUTPUT_REG, 1 << TCA_VBAT_BIT);
  tcaWrite(TCA_CONFIG_REG, 0xDC);
  delay(10);
}

void epdPower(bool on) {
  uint8_t value = 1 << TCA_VBAT_BIT;
  if (on) value |= 1 << TCA_EPD_BIT;
  tcaWrite(TCA_OUTPUT_REG, value);
  delay(10);
}

void epdInit() {
  pinMode(PIN_CS, OUTPUT);
  pinMode(PIN_DC, OUTPUT);
  pinMode(PIN_RST, OUTPUT);
  pinMode(PIN_BUSY, INPUT);
  digitalWrite(PIN_CS, HIGH);
  digitalWrite(PIN_DC, HIGH);

  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_CS);
  delay(10);

  digitalWrite(PIN_RST, HIGH);
  delay(50);
  digitalWrite(PIN_RST, LOW);
  delay(20);
  digitalWrite(PIN_RST, HIGH);
  delay(50);

  waitBusy();
  epdCommand(0x12);
  waitBusy();

  epdCommand(0x01);
  epdDataByte(0xC7);
  epdDataByte(0x00);
  epdDataByte(0x01);

  epdCommand(0x11);
  epdDataByte(0x01);

  setWindows(0, EPD_WIDTH - 1, EPD_HEIGHT - 1, 0);

  epdCommand(0x3C);
  epdDataByte(0x01);

  epdCommand(0x18);
  epdDataByte(0x80);

  epdCommand(0x22);
  epdDataByte(0xB1);
  epdCommand(0x20);
  waitBusy();

  setCursor(0, EPD_HEIGHT - 1);
  waitBusy();

  setLut(WF_FULL_1IN54);
}

void epdDisplay(const uint8_t *frame) {
  epdCommand(0x24);
  epdData(frame, EPD_FRAME_BYTES);

  epdCommand(0x22);
  epdDataByte(0xC7);
  epdCommand(0x20);
  waitBusy();
}

void epdSleep() {
  epdCommand(0x10);
  epdDataByte(0x01);
  delay(100);
}
