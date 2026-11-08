#pragma once

#include <Arduino.h>

void boardPowerOn();
void epdPower(bool on);
void epdInit();
void epdDisplay(const uint8_t *frame);
void epdSleep();
