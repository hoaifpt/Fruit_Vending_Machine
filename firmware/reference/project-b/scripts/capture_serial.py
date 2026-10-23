import serial
import time
import sys

port = 'COM3'
baud = 115200

print(f"Opening {port} at {baud}...")
try:
    ser = serial.Serial(port, baud, timeout=0.5)
except Exception as e:
    print(f"Error opening port: {e}")
    sys.exit(1)

# Reset ESP32-S3 by toggling DTR / RTS
ser.setDTR(False)
ser.setRTS(True)
time.sleep(0.1)
ser.setRTS(False)
time.sleep(0.1)
ser.setDTR(True)

start = time.time()
lines = []

while time.time() - start < 5.0:
    line = ser.readline().decode('utf-8', errors='replace')
    if line:
        print(line, end='')
        lines.append(line)

ser.close()

with open('docs/traces/boot_log.txt', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("\n--- Done capturing serial log ---")
