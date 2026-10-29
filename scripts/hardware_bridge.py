#!/usr/bin/env python3
"""Hardware Serial Bridge for ESP32 on COM4.
Listens for HTTP requests on port 5001 and forwards DISPENSE commands to ESP32 over COM4.
When ESP32 finishes dispensing, syncs completion to Supabase database.
"""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.parse
from pathlib import Path
from dotenv import load_dotenv
import pg8000.native
import serial

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

load_dotenv(Path(__file__).parent.parent / ".env")

PORT = os.environ.get("ESP32_PORT", "COM4")
BAUD = 115200
HTTP_PORT = 5001

ser = None
ser_lock = threading.Lock()
latest_status = {"state": "IDLE", "last_command": "", "last_outcome": ""}

def init_serial():
    global ser
    try:
        ser = serial.Serial(PORT, BAUD, timeout=1)
        time.sleep(1.5)
        print(f"[Bridge] Connected to ESP32 on {PORT} at {BAUD} baud.")
        threading.Thread(target=serial_reader_thread, daemon=True).start()
    except Exception as e:
        print(f"[Bridge] Warning: Could not open {PORT}: {e}")

def mark_completed_in_db(cmd_id):
    def _task():
        try:
            print(f"[Bridge DB] Syncing completion for command: {cmd_id}...")
            conn = pg8000.native.Connection(
                user=os.environ.get("DB_USER"),
                password=os.environ.get("DB_PASSWORD"),
                host=os.environ.get("DB_HOST"),
                port=int(os.environ.get("DB_PORT", 5432)),
                database=os.environ.get("DB_NAME", "postgres"),
                ssl_context=True,
            )
            # 1. Update dispense_commands
            conn.run("""
                UPDATE dispense_commands 
                SET status = 'SUCCESS', sent_at = COALESCE(sent_at, NOW()), completed_at = NOW() 
                WHERE command_code = :cmd OR order_id IN (SELECT id FROM orders WHERE order_code = :cmd)
            """, cmd=cmd_id)
            # 2. Update allocations
            conn.run("""
                UPDATE order_item_allocations 
                SET status = 'DISPENSED', updated_at = NOW() 
                WHERE order_item_id IN (
                    SELECT id FROM order_items 
                    WHERE order_id IN (SELECT id FROM orders WHERE order_code = :cmd)
                       OR order_id IN (SELECT order_id FROM dispense_commands WHERE command_code = :cmd)
                )
            """, cmd=cmd_id)
            # 3. Update inventory_items to SOLD
            conn.run("""
                UPDATE inventory_items 
                SET status = 'SOLD', sold_at = NOW(), updated_at = NOW() 
                WHERE id IN (
                    SELECT inventory_item_id FROM dispense_commands 
                    WHERE command_code = :cmd OR order_id IN (SELECT id FROM orders WHERE order_code = :cmd)
                )
            """, cmd=cmd_id)
            # 4. Update orders to COMPLETED
            conn.run("""
                UPDATE orders 
                SET status = 'COMPLETED', completed_at = NOW() 
                WHERE order_code = :cmd OR id IN (SELECT order_id FROM dispense_commands WHERE command_code = :cmd)
            """, cmd=cmd_id)
            conn.close()
            print(f"[Bridge DB] Successfully synced completion for {cmd_id}: Order COMPLETED, item SOLD")
        except Exception as e:
            print(f"[Bridge DB] Error syncing order completion to DB: {e}")
    threading.Thread(target=_task, daemon=True).start()

def serial_reader_thread():
    global latest_status
    while True:
        try:
            if ser and ser.is_open:
                line = ser.readline().decode("utf-8", errors="replace").strip()
                if line:
                    print(f"[ESP32 -> Bridge] {line}")
                    if line.startswith("STATE "):
                        latest_status["state"] = line.split(" ")[1]
                    elif line.startswith("DONE "):
                        parts = line.split(" ")
                        if len(parts) >= 3:
                            cmd_id = parts[1]
                            outcome = parts[2]
                            latest_status["last_command"] = cmd_id
                            latest_status["last_outcome"] = outcome
                            if outcome == "OK":
                                mark_completed_in_db(cmd_id)
            else:
                time.sleep(1)
        except Exception as e:
            time.sleep(1)

def send_dispense(command_id, column=1):
    global ser
    cmd = f"DISPENSE {command_id} {column}\n"
    with ser_lock:
        if ser and ser.is_open:
            print(f"[Bridge -> ESP32] Sending: {cmd.strip()}")
            ser.write(cmd.encode("utf-8"))
            ser.flush()
            return True
        else:
            print(f"[Bridge] Serial port not open. Cannot send: {cmd.strip()}")
            return False

class BridgeHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(latest_status).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/dispense", "/bridge/dispense"):
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                data = {}

            params = urllib.parse.parse_qs(parsed.query)
            cmd_id = data.get("commandId") or (params.get("commandId", ["test"])[0])
            col = data.get("column") or (params.get("column", ["1"])[0])
            try:
                col = int(col)
            except ValueError:
                col = 1

            success = send_dispense(cmd_id, col)
            self.send_response(200 if success else 500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            resp = {"ok": success, "commandId": cmd_id, "column": col}
            self.wfile.write(json.dumps(resp).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

def run_server():
    init_serial()
    server = HTTPServer(("0.0.0.0", HTTP_PORT), BridgeHandler)
    print(f"[Bridge] Hardware HTTP bridge listening on http://0.0.0.0:{HTTP_PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if ser and ser.is_open:
            ser.close()

if __name__ == "__main__":
    run_server()
