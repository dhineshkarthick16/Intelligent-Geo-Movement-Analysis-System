#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// --- BLE CONSTANTS (DO NOT CHANGE) ---
#define SERVICE_UUID        "12345678-1234-1234-1234-1234567890ab"
#define CHARACTERISTIC_UUID "abcd1234-5678-1234-5678-abcdef123456"

Adafruit_MPU6050 mpu;
BLECharacteristic *pCharacteristic;
bool deviceConnected = false;

// Hardware Lead's Pin Assignments
const int buzzerPin = 18;      
const int buttonPin = 13;      
const int onboardLED = 2;      

float lastAmag = 0;
unsigned long lastTime = 0;

// Variables for Safety Logic
bool alertActive = false;
bool buttonWasPressed = false;
unsigned long crashTime = 0;
const unsigned long safetyWindow = 3000; // Currently set to 3s per your request

// Engineering Thresholds
const float jerkThreshold = 40.0; 
const float accelThreshold = 40.0; 

// --- BLE Server Callbacks ---
class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("Device connected ✅");
  }
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("Device disconnected ❌");
    BLEDevice::getAdvertising()->start();
    Serial.println("Advertising restarted...");
  }
};

void setup() {
  Serial.begin(115200);
  pinMode(buzzerPin, OUTPUT);
  pinMode(onboardLED, OUTPUT);
  pinMode(buttonPin, INPUT_PULLUP); 

  // Initialize MPU6050
  if (!mpu.begin()) {
    while (1) yield();
  }
  digitalWrite(onboardLED, HIGH); 
  lastTime = millis();

  // Initialize BLE
  BLEDevice::init("ESP32_ALERT_DEVICE");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );

  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setValue("START");
  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->start();
  Serial.println("BLE advertising started 🚀");
}

void loop() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  unsigned long currentTime = millis();
  float dt = (currentTime - lastTime) / 1000.0;
  if (dt <= 0) return;

  float Amag = sqrt(pow(a.acceleration.x, 2) + 
                    pow(a.acceleration.y, 2) + 
                    pow(a.acceleration.z - 9.8, 2));

  float jerk = abs(Amag - lastAmag) / dt; 

  // --- STEP 1: DETECT IMPACT ---
  if (jerk > jerkThreshold && Amag > accelThreshold && !alertActive) {
    alertActive = true;
    buttonWasPressed = false; 
    crashTime = currentTime; 
    digitalWrite(buzzerPin, HIGH); 
    Serial.println("!!! IMPACT DETECTED !!!");
  }

  // --- STEP 2: THE MONITORING WINDOW ---
  if (alertActive) {
    if (digitalRead(buttonPin) == LOW) {
      buttonWasPressed = true; 
    }

    // --- STEP 3: FINAL DECISION AFTER WINDOW ---
    if (currentTime - crashTime >= safetyWindow) {
      digitalWrite(buzzerPin, LOW); 
      alertActive = false;

      if (buttonWasPressed) {
        Serial.println("ALARM CANCELLED BY USER");
      } else {
        // NO RESPONSE - SEND BLE MESSAGE
        Serial.println("CRITICAL: NO RESPONSE. SENDING ALERT...");
        
        if (deviceConnected) {
          String msg = "CRASH";
          pCharacteristic->setValue(msg.c_str());
          pCharacteristic->notify();
          Serial.println("Sent via BLE: " + msg);
        } else {
          Serial.println("BLE not connected! App missed the alert.");
        }

        Serial.print("CRASH DATA (JERK): "); 
        Serial.println(jerk);
      }
    }
  }

  lastAmag = Amag;
  lastTime = currentTime;
  delay(10); 
}
