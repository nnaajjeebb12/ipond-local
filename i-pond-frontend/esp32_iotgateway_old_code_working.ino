//-------------------------------------------------ARDUINO VARIABLE HEADER FILES-------------------------------------------------------------

#include "FS.h"
#include "SD.h"
#include "SPI.h"
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
DynamicJsonDocument jsonDoc2(200);

//--------------------------------------------------FOR PERIPHERALS DECLARATIONS --------------------------------------------------------------

//--------------------------------------------------GLOBAL VARIABLE DECLARATIONS-------------------------------------------------------------

int pnd;
float rtd;
float ph;
float sal;
float dox;
bool failWifiSending = true;
long int backlogCtr = 0;
int i = 1;
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

  setupSD();
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

  // if(WiFi.status() != WL_CONNECTED)
  //   {
  //     if(millis() - prevMillis >= 30000)
  //     {
  //
  //
  //     }
  //   }

  if (Serial2.available())
  {
    // Serial.println("Serial2 is available");
    String val = Serial2.readString();
    val.trim();
    int start = val.indexOf('{');
    int end = val.lastIndexOf('}');
    String extractedString = val.substring(start, end + 1);

    Serial.println(val);

    if (val.length() > 10)
    {
      // Serial.println("val.length is greater than 10");
      DeserializationError error = deserializeJson(jsonDoc, val);

      if (error)
      {
        // Serial.println("LCD Error");
        displayLCDError();
      }
      else
      {
        deserializeToJSON();
        delay(200);
        printToLCD();
        delay(5000);
        rtc.read();
        String fileName = String(rtc.day) + "_" + String(rtc.month) + "_" + String(rtc.year);
        //   String SDvalue = "N" +String(pnd)+ ",D" +String(rtc.day) +"/"+String(rtc.month)+"/"+String(rtc.year)+ ",T" +String(rtc.hour) +":"+String(rtc.minute)+":"+String(rtc.second)+",P" +ph+",R" +rtd+",S" +sal+",O" +dox+"\n";
        //  FORMAT OF STRING ON BACKLOGS FOLDER---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
        String SDvalue = "Pond#:" + String(pnd) + ",Date:" + String(rtc.day) + "-" + String(rtc.month) + "-" + String(rtc.year) + ",Time:" + String(rtc.hour) + "-" + String(rtc.minute) + "-" + String(rtc.second) + ",PH:" + ph + ",Temp:" + rtd + ",Sal:" + sal + ",DO:" + dox + "\n";
        //  FORMAT OF STRING ON BACKLOGS FOLDER---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
        const char *SDval = SDvalue.c_str(); // necessary for string concatenation
        const char *SDval2 = val.c_str();

        //-------------------------------------------------------------------save to sd card------------------------------------------------------------------------------------
        if (pnd == 2)
        {
          String path = "/pond2/" + fileName + ".txt";
          const char *path2 = path.c_str();
          if (SD.exists("/pond2/" + fileName + ".txt"))
          {
            appendFile(SD, path2, SDval);
            delay(1000);
          }
          else
          {
            writeFile(SD, path2, SDval);
            delay(1000);
          }
        }
        else if (pnd == 1)
        {
          String path = "/pond1/" + fileName + ".txt";
          const char *path1 = path.c_str();
          if (SD.exists("/pond1/" + fileName + ".txt"))
          {
            appendFile(SD, path1, SDval);
            delay(1000);
          }
          else
          {
            writeFile(SD, path1, SDval);
            delay(1000);
          }
        }
        else if (pnd == 3)
        {
          String path = "/pond3/" + fileName + ".txt";
          const char *path3 = path.c_str();
          if (SD.exists("/pond3/" + fileName + ".txt"))
          {
            appendFile(SD, path3, SDval);
            delay(1000);
          }
          else
          {
            writeFile(SD, path3, SDval);
            delay(1000);
          }
        }
        else if (pnd == 4)
        {
          String path = "/pond4/" + fileName + ".txt";
          const char *path4 = path.c_str();
          if (SD.exists("/pond4/" + fileName + ".txt"))
          {
            appendFile(SD, path4, SDval);
            delay(1000);
          }
          else
          {
            writeFile(SD, path4, SDval);
            delay(1000);
          }
        }
        else if (pnd == 5)
        {
          String path = "/pond5/" + fileName + ".txt";
          const char *path5 = path.c_str();
          if (SD.exists("/pond5/" + fileName + ".txt"))
          {
            appendFile(SD, path5, SDval);
            delay(1000);
          }
          else
          {
            appendFile(SD, path5, SDval);
            delay(1000);
          }
        }

        //-------------------------------------------------------------------save to sd card------------------------------------------------------------------------------------

        // Serial.println("Before sending to the server");

        // CODE IN SENDING TO WIFI HERE
        if (WiFi.status() == WL_CONNECTED)
        {

          int cnt = getFileCount();

          if (cnt < 1)
          {
            // send data real time

            // Serial.println("send data to server");
            // Serial.println(SDvalue);
            lcd.clear();
            lcd.setCursor(0, 2);
            lcd.print("No Backlogs");
            lcd.setCursor(0, 3);
            lcd.print("sending to cloud");
            delay(2000);

            // DynamicJsonDocument jsonDoc(100);
            DeserializationError error2 = deserializeJson(jsonDoc, extractedString);

            if (error2)
            {
              //  Serial.print("Failed to parse JSON: ");
              //  Serial.println(error2.c_str());
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

              // Your Domain name with URL path or IP address with path
              http.begin(serverPath.c_str());
              http.addHeader("Content-Type", "application/json");
              // Add the authorization header
              http.addHeader("Authorization", "Bearer " + String(authToken));

              float pnd = jsonDoc["pnd"];
              float rtd = jsonDoc["rtd"];
              float ph = jsonDoc["ph"];
              float sal = jsonDoc["sal"];
              float dox = jsonDoc["dox"];

              char jsonString[100];
              //                  sprintf(jsonString, "{\"data\":{\"pond\":%.2f,\"temperature\":%.2f,\"pH\":%.2f,\"salinity\":%.2f,\"dissolved_oxygen\":%.2f}}", pnd, rtd, ph, sal, dox);
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
                lcd.setCursor(0, 3);
                lcd.print("Saving as backlogs");

                String backlogNumber = "/backlogsWifi/" + String(getFileCount() + 1) + ".txt";
                const char *backlogNum = backlogNumber.c_str();
                writeFile(SD, backlogNum, SDval2);
                printToSerial(val);
                delay(1000);
                lcd.clear();
                lcd.setCursor(0, 2);
                lcd.print("backlogs saved");
                lcd.setCursor(0, 3);
                lcd.print("NO of backlogs: ");
                lcd.print(getFileCount());
                delay(2000);
              }
              // Free resources
              http.end();
            }
          }
          else
          {
            // backlog
            Serial.println("There are backlogs");
            delay(200);
            lcd.clear();
            lcd.setCursor(0, 2);
            lcd.print("There are Backlogs");
            lcd.setCursor(0, 3);
            lcd.print("Attempting to resend...");
            delay(2000);

            for (int i = 1; i <= cnt; i++)
            {
              // send backlog data 1 by 1

              String backlogNumber = "/backlogsWifi/" + String(i) + ".txt";
              const char *backlogNum = backlogNumber.c_str();
              String data_backlogs = readFile(SD, backlogNum);

              if (data_backlogs == "0")
              {
                Serial.println("read backlog error");
                i--;
              }
              else
              {
                // Serial.println("send data");
                data_backlogs.trim();
                DeserializationError error3 = deserializeJson(jsonDoc2, data_backlogs);

                if (error3)
                {
                  Serial.print("Failed to parse JSON: ");
                  Serial.println(error.c_str());
                  return;
                }
                else
                {
                  HTTPClient http;
                  String serverPath = serverName;

                  // Your Domain name with URL path or IP address with path
                  http.begin(serverPath.c_str());
                  http.addHeader("Content-Type", "application/json");
                  // Add the authorization header
                  http.addHeader("Authorization", "Bearer " + String(authToken));

                  float pnd = jsonDoc2["pnd"];
                  float rtd = jsonDoc2["rtd"];
                  float ph = jsonDoc2["ph"];
                  float sal = jsonDoc2["sal"];
                  float dox = jsonDoc2["dox"];
                  // String time = jsonDoc2["time"];
                  // String date_time = jsonDoc2["date_time"];

                  char jsonString[100];
                  //                      sprintf(jsonString, "{\"data\":{\"pond\":%.2f,\"temperature\":%.2f,\"pH\":%.2f,\"salinity\":%.2f,\"dissolved_oxygen\":%.2f}}", pnd, rtd, ph, sal, dox);
                  sprintf(jsonString, "{\"data\":{\"pnd\":%.2f,\"rtd\":%.2f,\"ph\":%.2f,\"sal\":%.2f,\"dox\":%.2f}}", pnd, rtd, ph, sal, dox);
                  Serial.println(jsonString);

                  int httpResponseCode = http.POST(jsonString);
                  if (httpResponseCode == 200 || httpResponseCode == 201 || httpResponseCode == 202)
                  {
                    // Delete File
                    String delete_backlog = "/backlogsWifi/" + String(i) + ".txt";
                    const char *backlogDel = delete_backlog.c_str();
                    int del_backlog = deleteFile(SD, backlogDel);

                    Serial.print("HTTP Response code: ");
                    Serial.println(httpResponseCode);
                    String payload = http.getString();
                    Serial.println(payload);
                  }
                  else
                  {
                    Serial.print("Error code: ");
                    Serial.println(httpResponseCode);
                    lcd.clear();
                    lcd.setCursor(0, 1);
                    lcd.print("Error code: ");
                    lcd.print(httpResponseCode);
                    i--;
                  }
                  // Free resources
                  http.end();
                }
                // if(false){
                //   // data sent
                // }else{
                //   // failed
                //   i--;
                // }
              }
            }

            delay(200);
            lcd.clear();
            lcd.setCursor(0, 2);
            lcd.print("Backlogs Empty");
            lcd.setCursor(0, 3);
            lcd.print("sent to cloud");
            delay(2000);
          }
        }
        else
        {
          // Disconnected to WIFI
          Serial.println("Fail to send to wifi");
          delay(200);
          //    lcd.clear();
          //    lcd.setCursor(0,1);
          //    lcd.print("Failed to send");
          lcd.setCursor(0, 2);
          lcd.print("saving as backlogs");
          delay(2000);

          //   String SDvalue = "Pond#:"+String(pnd)+ ",Date:" +String(rtc.day) +"-"+String(rtc.month)+"-"+String(rtc.year)+ ",Time:" +String(rtc.hour) +"-"+String(rtc.minute)+"-"+String(rtc.second)+",PH:" +ph+",Temp:" +rtd+",Sal:" +sal+",DO:" +dox+"\n";

          // backlogCtr++;
          String backlogNumber = "/backlogsWifi/" + String(getFileCount() + 1) + ".txt";
          const char *backlogNum = backlogNumber.c_str();
          writeFile(SD, backlogNum, SDval2);
          printToSerial(val);
          delay(200);
          lcd.clear();
          lcd.setCursor(0, 2);
          lcd.print("backlogs saved");
          lcd.setCursor(0, 3);
          lcd.print("NO of backlogs: ");
          lcd.print(getFileCount());
          delay(2000);
        }
      }
    }
    else if (val == "P1" || val == "p1")
    {
      // Serial.println("val error 1");
      lcd.clear();
      lcd.setCursor(0, 2);
      lcd.print("Requesting Data");
    }
    else
    {
      // Serial.println("val error 2");
    }
  }

  delay(200);

  // while (Serial2.available() >0 ) {
  //   Serial2.read();
  //}
}

//--------------------------------------------------------------------------------------------------------------------------------------------

//--------------------------------------------------PRINT SENSOR DATA TO LCD--------------------------------------------------------------

void printToLCD()
{
  lcd.clear();
  //  lcd.setRGB(255,0,255);
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

//---------------------------------------------PRINT TO CONSOLE FOR TROUBLESHOOTING--------------------------------------------------------------

void printToSerial(String val)
{
  //          Serial.print(rtc.day);
  //          Serial.print("/");
  //          Serial.print(rtc.month);
  //          Serial.print("/");
  //          Serial.print(rtc.year);
  //          Serial.print(" ");
  //
  //          Serial.print(rtc.hour);
  //          Serial.print(":");
  //          Serial.print(rtc.minute);
  //          Serial.print(":");
  //          Serial.print(rtc.second);
  //          Serial.print(" --> ");
  //
  Serial.print("File Count of Backlogs: ");
  Serial.println(getFileCount());
  Serial.println(val);
}

//---------------------------------------------PRINT TO CONSOLE FOR TROUBLESHOOTING--------------------------------------------------------------

//-------------------------------------------------DISPLAY LCD ERROR FUNCTION--------------------------------------------------------------

void displayLCDError()
{
  lcd.clear();
  //  lcd.setRGB(255,255,0);
  lcd.setCursor(0, 0);
  lcd.print("Json String Fail");
}

//-------------------------------------------------DISPLAY LCD ERROR FUNCTION--------------------------------------------------------------

//-------------------------------------------------------FOR REFERENCE--------------------------------------------------------------------

void cheatCodes()
{

  //    Serial.print("SD Card Type: ");
  //    if(cardType == CARD_MMC){
  //        Serial.println("MMC");
  //    } else if(cardType == CARD_SD){
  //        Serial.println("SDSC");
  //    } else if(cardType == CARD_SDHC){
  //        Serial.println("SDHC");
  //    } else {
  //        Serial.println("UNKNOWN");
  //    }

  //   uint64_t cardSize = SD.cardSize() / (1024 * 1024);
  //   Serial.printf("SD Card Size: %lluMB\n", cardSize);
  //   listDir(SD, "/", 0);
  //   createDir(SD, "/pond1");
  //   createDir(SD, "/pond2");
  //   createDir(SD, "/pond3");
  //   createDir(SD, "/pond4");
  //   createDir(SD, "/pond5");
  //   listDir(SD, "/", 0);
  //   removeDir(SD, "/mydir");
  //   listDir(SD, "/", 2);
  //   writeFile(SD, "/hello.txt", "Hello ");
  //   appendFile(SD, "/hello.txt", "World!\n");
  //   readFile(SD, "/hello.txt");
  //   deleteFile(SD, "/foo.txt");
  //   renameFile(SD, "/hello.txt", "/foo.txt");
  //   readFile(SD, "/foo.txt");
  //   testFileIO(SD, "/test.txt");
  //   Serial.printf("Total space: %lluMB\n", SD.totalBytes() / (1024 * 1024));
  //   Serial.printf("Used space: %lluMB\n", SD.usedBytes() / (1024 * 1024));
}

//-------------------------------------------------------FOR REFERENCE--------------------------------------------------------

//---------------------------------------------------SET UP SD CARD FUNCTION--------------------------------------------------------

void setupSD()
{
  if (!SD.begin())
  {
    Serial.println("Card Mount Failed");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("SD Card Mount Fail");
    delay(200);
    return;
  }
  uint8_t cardType = SD.cardType();

  if (cardType == CARD_NONE)
  {
    Serial.println("No SD Xard Attached");
    delay(200);
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("No SD Inserted");

    return;
  }
}

//---------------------------------------------------SET UP SD CARD FUNCTION--------------------------------------------------------

//-----------------------------------------------ATTEMP SEND DATA TO WIFI FUNCTION--------------------------------------------------------

//-----------------------------------------------ATTEMP SEND DATA TO WIFI FUNCTION--------------------------------------------------------

void sendToWifi()
{

  // INSERT CODE HERE
}

//-----------------------------------------------ATTEMP SEND DATA TO WIFI FUNCTION--------------------------------------------------------

//-------------------------------------------GET FILECOUNT FROM SD CARD DIRECTORY FUNCTION-------------------------------------------------

int getFileCount()
{
  File d = SD.open("/backlogsWifi");
  int count_files = 0;
  while (true)
  {
    File entry = d.openNextFile();
    if (!entry)
    {
      // no more files. Let's return the number of files.
      return count_files;
      d.close();
    }
    String file_name = entry.name(); // Get file name so that we can check
                                     // if it's a duplicate
    if (file_name.indexOf('~') != 0) // Igrnore filenames with a ~. It's a mac thing.
    {                                // Just don't have file names that have a ~ in them
      count_files++;
    }
    //  d.close();
  }
}

//-------------------------------------------GET FILECOUNT FROM SD CARD DIRECTORY FUNCTION-------------------------------------------------

//--------------------------------------------------LIST DIRECTORY FROM SD FUNCTION-------------------------------------------------------------

void listDir(fs::FS &fs, const char *dirname, uint8_t levels)
{
  Serial.printf("Listing directory: %s\n", dirname);

  File root = fs.open(dirname);
  if (!root)
  {
    Serial.println("Failed to open directory");
    return;
  }
  if (!root.isDirectory())
  {
    Serial.println("Not a directory");
    return;
  }

  File file = root.openNextFile();
  while (file)
  {
    if (file.isDirectory())
    {
      Serial.print("  DIR : ");
      Serial.println(file.name());
      if (levels)
      {
        listDir(fs, file.path(), levels - 1);
      }
    }
    else
    {
      Serial.print("  FILE: ");
      Serial.print(file.name());
      Serial.print("  SIZE: ");
      Serial.println(file.size());
    }
    file = root.openNextFile();
  }
}

//--------------------------------------------------LIST DIRECTORY FROM SD FUNCTION-------------------------------------------------------------

//--------------------------------------------------CREATE DIRECTORY FROM SD FUNCTION-------------------------------------------------------------

void createDir(fs::FS &fs, const char *path)
{
  Serial.printf("Creating Dir: %s\n", path);
  if (fs.mkdir(path))
  {
    Serial.println("Dir created");
  }
  else
  {
    Serial.println("mkdir failed");
  }
}

//--------------------------------------------------CREATE DIRECTORY FROM SD FUNCTION-------------------------------------------------------------

//--------------------------------------------------REMOVE DIRECTORY FROM SD FUNCTION-------------------------------------------------------------

void removeDir(fs::FS &fs, const char *path)
{
  Serial.printf("Removing Dir: %s\n", path);
  if (fs.rmdir(path))
  {
    Serial.println("Dir removed");
  }
  else
  {
    Serial.println("rmdir failed");
  }
}

//--------------------------------------------------REMOVE DIRECTORY FROM SD FUNCTION-------------------------------------------------------------

//--------------------------------------------------READ FILE FROM SD FUNCTION-------------------------------------------------------------

String readFile(fs::FS &fs, const char *path)
{
  Serial.printf("Reading file: %s\n", path);
  String data = "0";
  File file = fs.open(path);
  if (!file)
  {
    Serial.println("Failed to open file for reading");
    return "0";
  }

  Serial.print("Read from file: ");
  while (file.available())
  {
    // Serial.write(file.read());
    data = file.readString();
    Serial.print(data);
  }
  file.close();
  return data;
}

//--------------------------------------------------READ FILE FROM SD FUNCTION-------------------------------------------------------------

//--------------------------------------------------WRITE FILE FROM SD FUNCTION-------------------------------------------------------------

int writeFile(fs::FS &fs, const char *path, const char *message)
{
  Serial.printf("Writing file: %s\n", path);
  int error = 0;
  File file = fs.open(path, FILE_WRITE);
  if (!file)
  {
    Serial.println("Failed to open file for writing");
    delay(200);
    //  lcd.clear();
    lcd.setCursor(0, 3);
    lcd.print("Failed saving");
    return 0;
  }
  if (file.print(message))
  {
    Serial.println("File written");
    delay(200);
    //  lcd.clear();

    lcd.setCursor(0, 3);
    lcd.print("Saved to SD");
    error = 1;
  }
  else
  {
    Serial.println("Write failed");
    delay(200);
    //  lcd.clear();

    lcd.setCursor(0, 3);
    lcd.print("Failed saving");
    error = 0;
  }
  file.close();
  return error;
}

//--------------------------------------------------WRITE FILE FROM SD FUNCTION-------------------------------------------------------------

//--------------------------------------------------APPEND FILE FROM SD FUNCTION-------------------------------------------------------------

int appendFile(fs::FS &fs, const char *path, const char *message)
{
  Serial.printf("Appending to file: %s\n", path);

  File file = fs.open(path, FILE_APPEND);
  int error = 0;
  if (!file)
  {
    Serial.println("Failed to open file for appending");
    delay(200);
    // lcd.clear();

    lcd.setCursor(0, 3);
    lcd.print("Failed to save");
    return 0;
  }
  if (file.print(message))
  {
    Serial.println("Message appended");
    delay(200);
    //  lcd.clear();
    lcd.setCursor(0, 3);
    lcd.print("Saved to SD");
    error = 1;
  }
  else
  {
    Serial.println("Append failed");
    delay(200);
    // lcd.clear();

    lcd.setCursor(0, 3);
    lcd.print("Failed to save");
    error = 0;
  }
  file.close();
  return error;
}

//--------------------------------------------------APPEND FILE FROM SD FUNCTION-------------------------------------------------------------

//--------------------------------------------------RENAME FILE FROM SD FUNCTION-------------------------------------------------------------

int renameFile(fs::FS &fs, const char *path1, const char *path2)
{
  Serial.printf("Renaming file %s to %s\n", path1, path2);
  if (fs.rename(path1, path2))
  {
    Serial.println("File renamed");
    return 1;
  }
  else
  {
    Serial.println("Rename failed");
    return 0;
  }
}

//--------------------------------------------------RENAME FILE FROM SD FUNCTION-------------------------------------------------------------

//--------------------------------------------------DELETE FILE FROM SD FUNCTION-------------------------------------------------------------

int deleteFile(fs::FS &fs, const char *path)
{
  Serial.printf("Deleting file: %s\n", path);
  if (fs.remove(path))
  {
    Serial.println("File deleted");
    return 1;
  }
  else
  {
    Serial.println("Delete failed");
    return 0;
  }
}

//--------------------------------------------------DELETE FILE FROM SD FUNCTION-------------------------------------------------------------

// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx---END OF CODE---xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
