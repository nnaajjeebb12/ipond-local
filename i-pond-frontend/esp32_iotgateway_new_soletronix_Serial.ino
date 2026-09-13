// ============================================================================
// ESP32 IoT GATEWAY - SOLETRONIX (USB-WIRED, NO WIFI)
// ============================================================================
// Receives sensor JSON over Serial2, displays on LCD, forwards JSON over
// USB Serial to the Raspberry Pi. No WiFi, no HTTP, no SD backlog.
// ============================================================================

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "GravityRtc.h"
#include <ArduinoJson.h>

LiquidCrystal_I2C lcd(0x27, 20, 4);
GravityRtc rtc;
DynamicJsonDocument jsonDoc(200);

int pnd;
float rtd, ph, sal, dox;

// ----------------------------------------------------------------------------
// LCD HELPERS
// ----------------------------------------------------------------------------

void lcdLine(uint8_t row, const String &msg)
{
  lcd.setCursor(0, row);
  lcd.print(msg);
}

void lcdShow(const String &l0, const String &l1 = "", const String &l2 = "", const String &l3 = "")
{
  lcd.clear();
  lcdLine(0, l0);
  lcdLine(1, l1);
  lcdLine(2, l2);
  lcdLine(3, l3);
}

void displayLCDError()
{
  lcdShow("Json String Fail");
}

void printToLCD()
{
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("TP:");
  lcd.print(rtd);
  lcd.setCursor(9, 0);
  lcd.print("SL:");
  lcd.print(sal);
  lcd.setCursor(0, 1);
  lcd.print("PH:");
  lcd.print(ph);
  lcd.setCursor(8, 1);
  lcd.print("DO:");
  lcd.print(dox);
  lcdLine(2, "Sent to Pi (USB)");
}

// ----------------------------------------------------------------------------
// JSON
// ----------------------------------------------------------------------------

void deserializeToGlobals()
{
  pnd = jsonDoc["pnd"];
  rtd = jsonDoc["rtd"];
  ph = jsonDoc["ph"];
  sal = jsonDoc["sal"];
  dox = jsonDoc["dox"];
}

String extractJson(const String &raw)
{
  int s = raw.indexOf('{');
  int e = raw.lastIndexOf('}');
  if (s < 0 || e < 0)
    return "";
  return raw.substring(s, e + 1);
}

// ----------------------------------------------------------------------------
// SEND OVER USB SERIAL (replaces HTTP POST)
// ----------------------------------------------------------------------------

void sendToPi()
{
  char body[120];
  sprintf(body, "{\"data\":{\"pnd\":%.2f,\"rtd\":%.2f,\"ph\":%.2f,\"sal\":%.2f,\"dox\":%.2f}}",
          (float)pnd, rtd, ph, sal, dox);
  Serial.println(body);
}

// ----------------------------------------------------------------------------
// LOOP HANDLER
// ----------------------------------------------------------------------------

void handleSerialInput()
{
  String val = Serial2.readString();
  val.trim();

  if (val == "P1" || val == "p1")
  {
    lcdShow("", "", "Requesting Data");
    return;
  }

  if (val.length() <= 10)
    return;

  String json = extractJson(val);

  if (deserializeJson(jsonDoc, json))
  {
    displayLCDError();
    return;
  }

  deserializeToGlobals();
  delay(200);
  printToLCD();
  rtc.read();

  sendToPi();
}

// ----------------------------------------------------------------------------
// ARDUINO ENTRY POINTS
// ----------------------------------------------------------------------------

void setup()
{
  Serial.begin(9600);
  lcd.init();
  lcd.backlight();

  rtc.setup();
  rtc.read();

  Serial2.begin(9600);
  delay(1000);
  lcdShow("Finished Set-up", "", "USB Mode - No WiFi");
  delay(2000);

  lcd.clear();
}

void loop()
{
  if (Serial2.available())
  {
    handleSerialInput();
  }
  delay(200);
}

// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx---END OF CODE---xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
