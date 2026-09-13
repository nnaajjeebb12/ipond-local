// ============================================================================
// ESP32 IoT GATEWAY - SOLETRONIX (USB-WIRED, NO WIFI, NO SD)
// ============================================================================
// RECEIVE: unchanged from esp32_iotgateway_old_code_working.ino. The sensor
//          board talks to Serial2 exactly as it always has, and the parsing,
//          LCD display and timing (including the 5 s LCD hold) are the same.
// SEND:    over USB Serial to the Raspberry Pi as one JSON line per reading.
//          The Pi's serial listener forwards it to the local dashboard.
//          There is no Wi-Fi, no HTTP, no SD card, no backlog: the Pi stores
//          everything and syncs to the cloud itself.
//
// RULE: the ONLY thing that may be printed to Serial starting with "{" is the
//       reading payload from sendToPi(). The Pi ignores every other line, so
//       plain-text diagnostics are fine; raw JSON echoes are not.
// ============================================================================

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "GravityRtc.h"
#include <ArduinoJson.h>

// -------------------------------------------- PERIPHERALS ------------------

LiquidCrystal_I2C lcd(0x27, 20, 4);
GravityRtc rtc;
DynamicJsonDocument jsonDoc(200);

// ------------------------------------------ GLOBAL VARIABLES ---------------

int pnd;
float rtd;
float ph;
float sal;
float dox;

// ============================================================================

void setup()
{
  Serial.begin(9600); // USB link to the Pi. Must match SERIAL_BAUD on the Pi.
  lcd.init();
  lcd.backlight();

  lcd.setCursor(0, 0);
  lcd.print("USB Mode - No WiFi");
  delay(1000);

  rtc.setup();
  rtc.read();
  delay(1000);
  Serial2.begin(9600); // sensor board — unchanged
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Finished Set-up");
  delay(2000);
  lcd.clear();
  delay(3000);
}

// ============================================================================

void loop()
{
  if (Serial2.available())
  {
    // ---- RECEIVE: identical to the old working firmware --------------------
    String val = Serial2.readString();
    val.trim();
    int start = val.indexOf('{');
    int end = val.lastIndexOf('}');
    String extractedString = val.substring(start, end + 1);

    // (The old firmware echoed the raw line here with Serial.println(val).
    //  That must not happen any more: Serial is now the data link to the Pi.)

    if (val.length() > 10)
    {
      DeserializationError error = deserializeJson(jsonDoc, val);

      if (error)
      {
        displayLCDError();
      }
      else
      {
        deserializeToJSON();
        delay(200);
        printToLCD();
        delay(5000);
        rtc.read();

        // ---- SEND: replaces the SD-card + Wi-Fi block --------------------
        sendToPi(extractedString);
      }
    }
    else if (val == "P1" || val == "p1")
    {
      lcd.clear();
      lcd.setCursor(0, 2);
      lcd.print("Requesting Data");
    }
  }

  delay(200);
}

// ============================================================================
// SEND OVER USB SERIAL
// ============================================================================
// Same second parse of the extracted JSON and the same sprintf the old
// firmware used for the HTTP body, so the payload the Pi receives is
// byte-for-byte what the cloud used to receive.

void sendToPi(const String &extractedString)
{
  DeserializationError error2 = deserializeJson(jsonDoc, extractedString);

  if (error2)
  {
    lcd.clear();
    lcd.setCursor(0, 2);
    lcd.print("Data Invalid");
    lcd.setCursor(0, 3);
    lcd.print("Data not Sent");
    return;
  }

  float pnd = jsonDoc["pnd"];
  float rtd = jsonDoc["rtd"];
  float ph = jsonDoc["ph"];
  float sal = jsonDoc["sal"];
  float dox = jsonDoc["dox"];

  char jsonString[100];
  sprintf(jsonString, "{\"data\":{\"pnd\":%.2f,\"rtd\":%.2f,\"ph\":%.2f,\"sal\":%.2f,\"dox\":%.2f}}", pnd, rtd, ph, sal, dox);
  Serial.println(jsonString);

  lcd.setCursor(0, 3);
  lcd.print("Sent to Pi (USB)");
}

// ============================================================================
// LCD — unchanged from the old firmware
// ============================================================================

void printToLCD()
{
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("TP:");
  lcd.setCursor(3, 0);
  lcd.print(rtd);

  lcd.setCursor(0, 1);
  lcd.print("PH:");
  lcd.setCursor(3, 1);
  lcd.print(ph);

  lcd.setCursor(9, 0);
  lcd.print("SL:");
  lcd.setCursor(12, 0);
  lcd.print(sal);

  lcd.setCursor(8, 1);
  lcd.print("DO:");
  lcd.setCursor(11, 1);
  lcd.print(dox);

  lcd.setCursor(0, 2);
  lcd.print("Json Parse Success");
}

void displayLCDError()
{
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Json String Fail");
}

// ============================================================================
// JSON → globals — unchanged
// ============================================================================

void deserializeToJSON()
{
  pnd = jsonDoc["pnd"];
  rtd = jsonDoc["rtd"];
  ph = jsonDoc["ph"];
  sal = jsonDoc["sal"];
  dox = jsonDoc["dox"];
}

// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx---END OF CODE---xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
