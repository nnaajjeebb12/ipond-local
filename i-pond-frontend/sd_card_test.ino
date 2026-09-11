#include "FS.h"
#include "SD.h"
#include "SPI.h"

#define CS_PIN 5

//------------------------------------------------- RECURSIVE DIR LIST ---------------------------------------------------------

void listDir(fs::FS &fs, const char *dirname, uint8_t levels)
{
  File root = fs.open(dirname);
  if (!root || !root.isDirectory())
  {
    Serial.println("FAIL: Could not open directory");
    return;
  }
  File file = root.openNextFile();
  while (file)
  {
    if (file.isDirectory())
    {
      Serial.print("  DIR:  ");
      Serial.println(file.name());
      if (levels)
        listDir(fs, file.path(), levels - 1);
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

//------------------------------------------------- RUN ALL TESTS -------------------------------------------------------------

void runTests()
{
  Serial.println("##############################################");
  Serial.println("#     SOLETRONIX iPOND: SD CARD TEST        #");
  Serial.println("##############################################");

  //------------------------------------------------- TEST 1: SD INIT ---------------------------------------------------------
  Serial.println("\n=== TEST 1: SD INIT ===");
  if (!SD.begin(CS_PIN))
  {
    Serial.println("FAIL: SD card not found or init failed");
    Serial.println("Check: card inserted? CS pin correct? SPI wiring?");
    Serial.println("Cannot continue without SD. Halting.");
    return;
  }
  else
  {
    Serial.println("PASS: SD card initialized");
    uint8_t cardType = SD.cardType();
    Serial.print("Card type: ");
    if (cardType == CARD_MMC)
      Serial.println("MMC");
    else if (cardType == CARD_SD)
      Serial.println("SDSC");
    else if (cardType == CARD_SDHC)
      Serial.println("SDHC");
    else
      Serial.println("UNKNOWN");
    Serial.print("Card size: ");
    Serial.print(SD.cardSize() / (1024 * 1024));
    Serial.println(" MB");
  }

  //------------------------------------------------- TEST 2: WRITE FILE -------------------------------------------------------
  Serial.println("\n=== TEST 2: WRITE FILE ===");
  File f = SD.open("/sd_test.txt", FILE_WRITE);
  if (!f)
  {
    Serial.println("FAIL: Could not open /sd_test.txt for writing");
  }
  else
  {
    f.println("Soletronix iPond SD Test");
    f.println("Pag nabasa mo to sir, nagana ang writing.");
    f.println("Timestamp: " + String(millis()));
    f.close();
    Serial.println("PASS: Wrote /sd_test.txt");
  }

  //------------------------------------------------- TEST 3: READ IT BACK -----------------------------------------------------
  Serial.println("\n=== TEST 3: READ FILE ===");
  File r = SD.open("/sd_test.txt");
  if (!r)
  {
    Serial.println("FAIL: Could not open /sd_test.txt for reading");
  }
  else
  {
    Serial.println("Contents of /sd_test.txt:");
    Serial.println("---");
    while (r.available())
      Serial.write(r.read());
    r.close();
    Serial.println("---");
    Serial.println("PASS: File read successfully");
  }

  //------------------------------------------------- TEST 4: LIST ALL FILES ---------------------------------------------------
  Serial.println("\n=== TEST 4: LIST ALL FILES ===");
  listDir(SD, "/", 2);

  //------------------------------------------------- TEST 5: CREATE POND DIRS -------------------------------------------------
  Serial.println("\n=== TEST 5: CREATE POND DIRS ===");
  const char *dirs[] = {"/pond1", "/pond2", "/pond3", "/pond4", "/pond5"};
  for (int i = 0; i < 5; i++)
  {
    if (!SD.exists(dirs[i]))
    {
      if (SD.mkdir(dirs[i]))
      {
        Serial.print("PASS: Created ");
        Serial.println(dirs[i]);
      }
      else
      {
        Serial.print("FAIL: Could not create ");
        Serial.println(dirs[i]);
      }
    }
    else
    {
      Serial.print("EXISTS: ");
      Serial.println(dirs[i]);
    }
  }

  //------------------------------------------------- TEST 6: SIMULATE BACKLOG SAVE --------------------------------------------
  Serial.println("\n=== TEST 6: SIMULATE BACKLOG SAVE ===");
  // Payload shape matches firmware POST body: {"data":{"pnd":..,"rtd":..,"ph":..,"sal":..,"dox":..}}
  String payload = "{\"data\":{\"pnd\":1.00,\"rtd\":27.50,\"ph\":7.20,\"sal\":35.00,\"dox\":6.80}}";
  String filename = "/pond1/" + String(millis()) + ".txt";

  File b = SD.open(filename.c_str(), FILE_WRITE);
  if (!b)
  {
    Serial.print("FAIL: Could not write backlog file: ");
    Serial.println(filename);
  }
  else
  {
    b.println(payload);
    b.close();
    Serial.print("PASS: Saved backlog to ");
    Serial.println(filename);

    // Read it back to confirm
    File rb = SD.open(filename.c_str());
    if (rb)
    {
      Serial.println("Backlog file contents:");
      Serial.println("---");
      while (rb.available())
        Serial.write(rb.read());
      rb.close();
      Serial.println("\n---");
      Serial.println("PASS: Backlog file verified");
    }
    else
    {
      Serial.println("FAIL: Could not reopen backlog file");
    }
  }

  //------------------------------------------------- TEST 7: CLEANUP ---------------------------------------------------------
  Serial.println("\n=== TEST 7: CLEANUP ===");
  if (SD.remove("/sd_test.txt"))
    Serial.println("PASS: Deleted /sd_test.txt");
  else
    Serial.println("FAIL: Could not delete /sd_test.txt");

  //------------------------------------------------- FINAL SUMMARY ------------------------------------------------------------
  Serial.println("\n=== SD CARD TEST COMPLETE ===");
  Serial.println("Check above for any FAIL messages.");
  Serial.println("If pass lahat, then wala problema sa saving. Goods na");
  Serial.println("If may nag fail, scroll up para makita san nag fail");
}

//------------------------------------------------- SETUP ----------------------------------------------------------------------

void setup()
{
  Serial.begin(9600);
  delay(1000);
  Serial.println();
  runTests();
}

//------------------------------------------------- LOOP (listen for 'run') ----------------------------------------------------

void loop()
{
  Serial.println("\nType 'run' to run tests");
  Serial.println("Waiting...");

  while (true)
  {
    if (Serial.available())
    {
      String cmd = Serial.readStringUntil('\n');
      cmd.trim();
      cmd.toLowerCase();

      if (cmd == "run")
      {
        Serial.println("\n========================================");
        Serial.println("RE-RUNNING SD CARD TESTS...");
        Serial.println("========================================\n");
        runTests();
        Serial.println("\nType 'run' to run again.");
      }
      else
      {
        Serial.print("Unknown command: '");
        Serial.print(cmd);
        Serial.println("'. Type 'run' to run tests.");
      }
    }
    delay(100);
  }
}

// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx---END OF CODE---xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
