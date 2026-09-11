//-------------------------------------------------ARDUINO VARIABLE HEADER FILES-------------------------------------------------------------

#include <Wire.h>
// #include "DFRobot_LCD.h"
#include <LiquidCrystal_I2C.h>
#include "GravityRtc.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

//-------------------------------------------------ARDUINO VARIABLE HEADER FILES-------------------------------------------------------------

LiquidCrystal_I2C lcd(0x27, 20, 4);

//----------------------------------------------FOR WIFI CONNECTIVITY INITIALIZATION----------------------------------------------------------

const char *ssid = "rmc";
const char *password = "12341234";
// const char* ssid = "IOT-2G";
// const char* password = "244466666";
// String serverName = "https://pchs-backend.ap.ngrok.io/api/sensor-readings";
String serverName = "https://seeme-db.com/api/send-sensor-data";

const char *authToken = "ce1e4a9a8d596bf1f2c046efaa21355ba4bacbdf1c66c3055530ed2958d32a74c68128383bbb21717886889a1d29c9a9263a762d581c6779e92bd915f9115d7efc20c5f9fcb80f2adf58162ef16d4dccaddc0486241991f30e634d45f7c146bb24aa4b172f4426fba3879e56f76fddd410823930e99d5d640014c141b280dc7c";

// const char* cert = "A3 DC 53 25 C2 4E BB AB 1D AC EE 0B 6D F4 7A B2 78 88 2A 20 51 24 F4 39 55 95 F5 51 D2 3F 96 CE";

//----------------------------------------------FOR WIFI CONNECTIVITY INITIALIZATION----------------------------------------------------------

//-------------------------------------------------FOR PERIPHERALS DECLARATIONS --------------------------------------------------------------

// lcd(16,2);
GravityRtc rtc;
DynamicJsonDocument jsonDoc(200);

//--------------------------------------------------FOR PERIPHERALS DECLARATIONS --------------------------------------------------------------

//--------------------------------------------------GLOBAL VARIABLE DECLARATIONS-------------------------------------------------------------

int pnd;
float rtd;
float ph;
float sal;
float dox;
bool failWifiSending = true;
long int prevMillis;

//--------------------------------------------------GLOBAL VARIABLE DECLARATIONS-------------------------------------------------------------

//--------------------------------------------------------------------------------------------------------------------------------

void setup()
{
  Serial.begin(9600);
  lcd.init();
  lcd.backlight();
  WiFi.begin(ssid, password);
  Serial.println("Connecting");
  delay(250);
  lcd.setCursor(0, 0);
  lcd.print("Connecting...");
  while (WiFi.status() != WL_CONNECTED && millis() <= 10000)
  {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() != WL_CONNECTED)
  {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Connection Timeout");
    lcd.setCursor(0, 2);
    lcd.print("Local-Only Mode");
    delay(2000);
  }
  else
  {
    Serial.println("");
    Serial.print("Connected to WiFi network with IP Address: ");
    Serial.println(WiFi.localIP());
    delay(250);
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Connected to Wifi!");
    delay(2000);
  }

  rtc.setup();

  rtc.read();
  delay(1000);
  Serial2.begin(9600);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Finished Set-up");
  delay(2000);
  lcd.clear();
  delay(3000);

  prevMillis = millis();
}

//------------------------------------------------------------------------------------------------------------------------------------------------

void loop()
{

  if (Serial2.available())
  {
    String val = Serial2.readString();
    val.trim();
    int start = val.indexOf('{');
    int end = val.lastIndexOf('}');
    String extractedString = val.substring(start, end + 1);

    Serial.println(val);

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

        if (WiFi.status() == WL_CONNECTED)
        {
          lcd.clear();
          lcd.setCursor(0, 3);
          lcd.print("sending to cloud");
          delay(2000);

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
          else
          {
            HTTPClient http;
            String serverPath = serverName;

            http.begin(serverPath.c_str());
            http.addHeader("Content-Type", "application/json");
            http.addHeader("Authorization", "Bearer " + String(authToken));

            float pnd = jsonDoc["pnd"];
            float rtd = jsonDoc["rtd"];
            float ph = jsonDoc["ph"];
            float sal = jsonDoc["sal"];
            float dox = jsonDoc["dox"];

            char jsonString[100];
            sprintf(jsonString, "{\"data\":{\"pnd\":%.2f,\"rtd\":%.2f,\"ph\":%.2f,\"sal\":%.2f,\"dox\":%.2f}}", pnd, rtd, ph, sal, dox);
            Serial.println(jsonString);

            int httpResponseCode = http.POST(jsonString);
            if (httpResponseCode == 200 || httpResponseCode == 201 || httpResponseCode == 202)
            {
              Serial.print("HTTP Response code: ");
              Serial.println(httpResponseCode);
              delay(200);
              lcd.clear();
              lcd.setCursor(0, 2);
              lcd.print("HTTP Response: ");
              lcd.print(httpResponseCode);
              lcd.setCursor(0, 3);
              lcd.print("Sent to cloud");
              String payload = http.getString();
              Serial.println(payload);
              delay(2000);
            }
            else
            {
              Serial.print("Error code: ");
              Serial.println(httpResponseCode);
              delay(200);
              lcd.clear();
              lcd.setCursor(0, 1);
              lcd.print("Error code: ");
              lcd.print(httpResponseCode);
              lcd.setCursor(0, 2);
              lcd.print("Failed to send");
              delay(2000);
            }
            http.end();
          }
        }
        else
        {
          Serial.println("Fail to send to wifi");
          delay(200);
          delay(2000);
        }
      }
    }
    else if (val == "P1" || val == "p1")
    {
      lcd.clear();
      lcd.setCursor(0, 2);
      lcd.print("Requesting Data");
    }
    else
    {
    }
  }

  delay(200);
}

//--------------------------------------------------------------------------------------------------------------------------------------------

//--------------------------------------------------PRINT SENSOR DATA TO LCD--------------------------------------------------------------

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

//--------------------------------------------------PRINT SENSOR DATA TO LCD--------------------------------------------------------------

//------------------------------------------DESERIALIZE JSON STRING TO GLOBAL VARIABLES--------------------------------------------------------------

void deserializeToJSON()
{
  pnd = jsonDoc["pnd"];
  rtd = jsonDoc["rtd"];
  ph = jsonDoc["ph"];
  sal = jsonDoc["sal"];
  dox = jsonDoc["dox"];
}

//------------------------------------------DESERIALIZE JSON STRING TO GLOBAL VARIABLES--------------------------------------------------------------

//-------------------------------------------------DISPLAY LCD ERROR FUNCTION--------------------------------------------------------------

void displayLCDError()
{
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Json String Fail");
}

//-------------------------------------------------DISPLAY LCD ERROR FUNCTION--------------------------------------------------------------

// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx---END OF CODE---xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
