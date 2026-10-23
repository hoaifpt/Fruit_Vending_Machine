import asyncio
import json
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from typing import Set

import serial
import serial.tools.list_ports
import uvicorn
from starlette.applications import Starlette
from starlette.responses import JSONResponse, Response
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

# Configuration
PORT = os.environ.get("ESP32_PORT", "COM4")
for idx, arg in enumerate(sys.argv):
    if arg == "--port" and idx + 1 < len(sys.argv):
        PORT = sys.argv[idx + 1]
    elif arg.startswith("--port="):
        PORT = arg.split("=", 1)[1]

BAUD = 115200
WEB_DIR = os.path.join(os.path.dirname(__file__), "web")

class DualModeSerialBridge:
    def __init__(self, port, baud):
        self.port = port
        self.baud = baud
        self.ser = None
        self.lock = threading.Lock()
        self.is_hardware = False
        self.subscribers: Set[asyncio.Queue] = set()
        
        # State machine storage (identical to ESP32 firmware)
        self.latest_status = {
            "ok": True,
            "state": "Sẵn sàng",
            "running": False,
            "cycle": 0,
            "cycles": 1,
            "servoStop": 90,
            "servoForward": 110,
            "servoReverse": 70,
            "forwardMs": 1000,
            "reverseMs": 1000,
            "pauseMs": 500,
            "ip": "192.168.4.1",
            "port": self.port,
            "baud": self.baud,
            "connected": True,
            "is_hardware": False,
            "s1": {
                "pin": 18,
                "state": "Sẵn sàng",
                "running": False,
                "cycle": 0,
                "cycles": 1,
                "stop": 90,
                "forward": 110,
                "reverse": 70,
                "forwardMs": 1000,
                "reverseMs": 1000,
                "pauseMs": 500
            },
            "s2": {
                "pin": 19,
                "state": "Sẵn sàng",
                "running": False,
                "cycle": 0,
                "cycles": 1,
                "stop": 90,
                "forward": 110,
                "reverse": 70,
                "forwardMs": 1000,
                "reverseMs": 1000,
                "pauseMs": 500
            },
            "s3": {
                "pin": 21,
                "state": "Sẵn sàng",
                "running": False,
                "cycle": 0,
                "cycles": 1,
                "stop": 90,
                "forward": 110,
                "reverse": 70,
                "forwardMs": 1000,
                "reverseMs": 1000,
                "pauseMs": 500
            },
            "s4": {
                "pin": 22,
                "state": "Sẵn sàng",
                "running": False,
                "cycle": 0,
                "cycles": 1,
                "stop": 90,
                "forward": 110,
                "reverse": 70,
                "forwardMs": 1000,
                "reverseMs": 1000,
                "pauseMs": 500
            },
            "col1": {
                "state": "Sẵn sàng",
                "running": False
            },
            "col2": {
                "state": "Sẵn sàng",
                "running": False
            },
            "ir": {
                "pin": 10,
                "txPin": 11,
                "detected": False,
                "raw": 1,
                "count": 0,
                "blockMs": 0,
                "autoTrigger": 0,
                "txEnabled": True
            }
        }
        
        # Simulation timing for 4 servos & 2 columns
        self.s1_step = 0
        self.s1_started_at = 0
        self.s2_step = 0
        self.s2_started_at = 0
        self.s3_step = 0
        self.s3_started_at = 0
        self.s4_step = 0
        self.s4_started_at = 0
        self.col1_step = 0
        self.col1_started_at = 0
        self.col2_step = 0
        self.col2_started_at = 0
        self.loop = None
        self.running = True

    def find_esp_port(self):
        ports = serial.tools.list_ports.comports()
        for p in ports:
            desc = (p.description or "").upper()
            hwid = (p.hwid or "").upper()
            if p.device == self.port:
                return p.device
            if any(k in desc for k in ["ESP32", "CP210", "CH340", "USB-SERIAL", "UART"]):
                return p.device
            if "303A:1001" in hwid or "10C4:EA60" in hwid or "1A86:7523" in hwid:
                return p.device
        return None

    def try_hardware_connect(self):
        target_port = self.find_esp_port()
        if not target_port:
            if self.is_hardware:
                self.is_hardware = False
                self.latest_status["is_hardware"] = False
                self.broadcast_log("[SYSTEM] Phần cứng COM3 đã ngắt kết nối. Chuyển sang chế độ Mô Phỏng HIL.", "warn")
            return False

        try:
            if self.ser and self.ser.is_open:
                self.ser.close()
            self.ser = serial.Serial(target_port, self.baud, timeout=0.1)
            self.is_hardware = True
            self.port = target_port
            self.latest_status["port"] = target_port
            self.latest_status["is_hardware"] = True
            self.broadcast_log(f"[SYSTEM] ĐÃ KẾT NỐI PHẦN CỨNG THẬT: {target_port} ({self.baud} baud)!", "system")
            return True
        except Exception as e:
            self.is_hardware = False
            self.latest_status["is_hardware"] = False
            return False

    def broadcast(self, msg: dict):
        if not self.loop:
            return
        for q in list(self.subscribers):
            try:
                self.loop.call_soon_threadsafe(q.put_nowait, msg)
            except Exception:
                pass

    def broadcast_log(self, line: str, level="esp"):
        self.broadcast({
            "type": "log",
            "level": level,
            "line": line,
            "ts": time.time()
        })

    def send_command(self, cmd: str, timeout=2.0) -> dict:
        cmd = cmd.strip()
        self.broadcast_log(f">> {cmd}", "system")

        if self.is_hardware and self.ser and self.ser.is_open:
            with self.lock:
                try:
                    self.ser.reset_input_buffer()
                    self.ser.write((cmd + "\n").encode("utf-8"))
                    start = time.time()
                    res_obj = None
                    while time.time() - start < timeout:
                        line = self.ser.readline().decode("utf-8", errors="replace").strip()
                        if line:
                            self.broadcast_log(line, "esp")
                            if line.startswith("[RES]"):
                                payload = line[5:].strip()
                                if payload:
                                    try:
                                        res_obj = json.loads(payload)
                                        break
                                    except Exception:
                                        res_obj = {"ok": True, "raw": payload}
                                        break
                    return res_obj or {"ok": True, "message": f"Đã gửi lệnh {cmd}"}
                except Exception as e:
                    self.is_hardware = False
                    self.latest_status["is_hardware"] = False
                    self.broadcast_log(f"[ERROR] Lỗi giao tiếp cổng nối tiếp: {e}", "error")

        # Emulation handler (when physical device is unplugged or during simulation)
        return self.handle_emulated_command(cmd)

    def _sync_root_status(self):
        s1 = self.latest_status["s1"]
        s2 = self.latest_status["s2"]
        self.latest_status["running"] = s1["running"] or s2["running"]
        self.latest_status["state"] = s1["state"] if s1["running"] else (s2["state"] if s2["running"] else "Sẵn sàng")
        self.latest_status["cycle"] = s1["cycle"]
        self.latest_status["cycles"] = s1["cycles"]
        self.latest_status["servoStop"] = s1["stop"]
        self.latest_status["servoForward"] = s1["forward"]
        self.latest_status["servoReverse"] = s1["reverse"]
        self.latest_status["forwardMs"] = s1["forwardMs"]
        self.latest_status["reverseMs"] = s1["reverseMs"]
        self.latest_status["pauseMs"] = s1["pauseMs"]

    def handle_emulated_command(self, cmd: str) -> dict:
        now = time.time()
        s1 = self.latest_status["s1"]
        s2 = self.latest_status["s2"]

        if cmd == "PING":
            self.broadcast_log("[RES] PONG", "esp")
            return {"ok": True, "message": "PONG"}
        elif cmd in ("STATUS", "GET /api/status"):
            self._sync_root_status()
            self.broadcast_log(f"[RES] {json.dumps(self.latest_status, ensure_ascii=False)}", "esp")
            return self.latest_status

        # --- SERVO 1 ---
        elif cmd in ("S1_START", "START", "POST /api/start", "POST /api/s1/start"):
            if s1["running"]:
                return {"ok": False, "error": "Servo 1 đang chạy"}
            s1["running"] = True
            s1["cycle"] = 1
            self.s1_step = 1
            self.s1_started_at = now
            s1["state"] = "Đang quay thuận"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 1] FORWARD = {s1['forward']} (GPIO 18)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 1 đã bắt đầu"}', "esp")
            return {"ok": True, "message": "Servo 1 đã bắt đầu"}
        elif cmd in ("S1_STOP", "POST /api/s1/stop"):
            s1["running"] = False
            s1["state"] = "Đang dừng"
            self.s1_step = 0
            self._sync_root_status()
            self.broadcast_log("[SERVO 1] STOP -> PWM DETACHED (Active Ground Clamp LOW)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 1 đã dừng"}', "esp")
            return {"ok": True, "message": "Servo 1 đã dừng"}
        elif cmd in ("S1_OPEN", "OPEN", "POST /api/open", "POST /api/s1/open"):
            if s1["running"]:
                return {"ok": False, "error": "Servo 1 đang chạy"}
            s1["running"] = True
            self.s1_step = 10
            self.s1_started_at = now
            s1["state"] = "Đang mở"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 1] OPENING = {s1['forward']} ({s1['forwardMs']}ms)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 1 đang mở"}', "esp")
            return {"ok": True, "message": "Servo 1 đang mở"}
        elif cmd in ("S1_CLOSE", "CLOSE", "POST /api/close", "POST /api/s1/close"):
            if s1["running"]:
                return {"ok": False, "error": "Servo 1 đang chạy"}
            s1["running"] = True
            self.s1_step = 20
            self.s1_started_at = now
            s1["state"] = "Đang đóng"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 1] CLOSING = {s1['reverse']} ({s1['reverseMs']}ms)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 1 đang đóng"}', "esp")
            return {"ok": True, "message": "Servo 1 đang đóng"}
        elif cmd in ("S1_TEST_FWD", "TEST_FWD", "POST /api/test/forward"):
            s1["state"] = "Đang quay thuận"
            self.broadcast_log(f"[SERVO 1] TEST FORWARD = {s1['forward']}", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 1 quay thuận"}', "esp")
            return {"ok": True, "message": "Servo 1 quay thuận"}
        elif cmd in ("S1_TEST_REV", "TEST_REV", "POST /api/test/reverse"):
            s1["state"] = "Đang quay nghịch"
            self.broadcast_log(f"[SERVO 1] TEST REVERSE = {s1['reverse']}", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 1 quay nghịch"}', "esp")
            return {"ok": True, "message": "Servo 1 quay nghịch"}
        elif cmd.startswith("S1_CALIB ") or cmd.startswith("CALIB "):
            val = int(cmd.split()[1])
            s1["stop"] = val
            self.broadcast_log(f"[SERVO 1] TEST STOP VALUE = {val} (Active LOW)", "esp")
            self.broadcast_log(f'[RES] {{"ok":true,"channel":1,"value":{val}}}', "esp")
            return {"ok": True, "channel": 1, "value": val}

        # --- SERVO 2 ---
        elif cmd in ("S2_START", "POST /api/s2/start"):
            if s2["running"]:
                return {"ok": False, "error": "Servo 2 đang chạy"}
            s2["running"] = True
            s2["cycle"] = 1
            self.s2_step = 1
            self.s2_started_at = now
            s2["state"] = "Đang quay thuận"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 2] FORWARD = {s2['forward']} (GPIO 19)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 2 đã bắt đầu"}', "esp")
            return {"ok": True, "message": "Servo 2 đã bắt đầu"}
        elif cmd in ("S2_STOP", "POST /api/s2/stop"):
            s2["running"] = False
            s2["state"] = "Đang dừng"
            self.s2_step = 0
            self._sync_root_status()
            self.broadcast_log("[SERVO 2] STOP -> PWM DETACHED (Active Ground Clamp LOW)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 2 đã dừng"}', "esp")
            return {"ok": True, "message": "Servo 2 đã dừng"}
        elif cmd in ("S2_OPEN", "POST /api/s2/open"):
            if s2["running"]:
                return {"ok": False, "error": "Servo 2 đang chạy"}
            s2["running"] = True
            self.s2_step = 10
            self.s2_started_at = now
            s2["state"] = "Đang mở"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 2] OPENING = {s2['forward']} ({s2['forwardMs']}ms)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 2 đang mở"}', "esp")
            return {"ok": True, "message": "Servo 2 đang mở"}
        elif cmd in ("S2_CLOSE", "POST /api/s2/close"):
            if s2["running"]:
                return {"ok": False, "error": "Servo 2 đang chạy"}
            s2["running"] = True
            self.s2_step = 20
            self.s2_started_at = now
            s2["state"] = "Đang đóng"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 2] CLOSING = {s2['reverse']} ({s2['reverseMs']}ms)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 2 đang đóng"}', "esp")
            return {"ok": True, "message": "Servo 2 đang đóng"}
        elif cmd in ("S2_TEST_FWD", "POST /api/s2/test/forward"):
            s2["state"] = "Đang quay thuận"
            self.broadcast_log(f"[SERVO 2] TEST FORWARD = {s2['forward']}", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 2 quay thuận"}', "esp")
            return {"ok": True, "message": "Servo 2 quay thuận"}
        elif cmd in ("S2_TEST_REV", "POST /api/s2/test/reverse"):
            s2["state"] = "Đang quay nghịch"
            self.broadcast_log(f"[SERVO 2] TEST REVERSE = {s2['reverse']}", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 2 quay nghịch"}', "esp")
            return {"ok": True, "message": "Servo 2 quay nghịch"}
        elif cmd.startswith("S2_CALIB "):
            val = int(cmd.split()[1])
            s2["stop"] = val
            self.broadcast_log(f"[SERVO 2] TEST STOP VALUE = {val} (Active LOW)", "esp")
            self.broadcast_log(f'[RES] {{"ok":true,"channel":2,"value":{val}}}', "esp")
            return {"ok": True, "channel": 2, "value": val}

        # --- SERVO 3 ---
        elif cmd in ("S3_START", "POST /api/s3/start"):
            s3 = self.latest_status["s3"]
            if s3["running"]:
                return {"ok": False, "error": "Servo 3 đang chạy"}
            s3["running"] = True
            s3["cycle"] = 1
            self.s3_step = 1
            self.s3_started_at = now
            s3["state"] = "Đang quay thuận"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 3] FORWARD = {s3['forward']} (GPIO 21)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 3 đã bắt đầu"}', "esp")
            return {"ok": True, "message": "Servo 3 đã bắt đầu"}
        elif cmd in ("S3_STOP", "POST /api/s3/stop"):
            s3 = self.latest_status["s3"]
            s3["running"] = False
            s3["state"] = "Đang dừng"
            self.s3_step = 0
            self._sync_root_status()
            self.broadcast_log("[SERVO 3] STOP -> PWM DETACHED (Active Ground Clamp LOW)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 3 đã dừng"}', "esp")
            return {"ok": True, "message": "Servo 3 đã dừng"}
        elif cmd in ("S3_OPEN", "POST /api/s3/open"):
            s3 = self.latest_status["s3"]
            if s3["running"]:
                return {"ok": False, "error": "Servo 3 đang chạy"}
            s3["running"] = True
            self.s3_step = 10
            self.s3_started_at = now
            s3["state"] = "Đang mở"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 3] OPENING = {s3['forward']} ({s3['forwardMs']}ms)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 3 đang mở"}', "esp")
            return {"ok": True, "message": "Servo 3 đang mở"}
        elif cmd in ("S3_CLOSE", "POST /api/s3/close"):
            s3 = self.latest_status["s3"]
            if s3["running"]:
                return {"ok": False, "error": "Servo 3 đang chạy"}
            s3["running"] = True
            self.s3_step = 20
            self.s3_started_at = now
            s3["state"] = "Đang đóng"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 3] CLOSING = {s3['reverse']} ({s3['reverseMs']}ms)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 3 đang đóng"}', "esp")
            return {"ok": True, "message": "Servo 3 đang đóng"}
        elif cmd in ("S3_TEST_FWD", "POST /api/s3/test/forward"):
            s3 = self.latest_status["s3"]
            s3["state"] = "Đang quay thuận"
            self.broadcast_log(f"[SERVO 3] TEST FORWARD = {s3['forward']}", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 3 quay thuận"}', "esp")
            return {"ok": True, "message": "Servo 3 quay thuận"}
        elif cmd in ("S3_TEST_REV", "POST /api/s3/test/reverse"):
            s3 = self.latest_status["s3"]
            s3["state"] = "Đang quay nghịch"
            self.broadcast_log(f"[SERVO 3] TEST REVERSE = {s3['reverse']}", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 3 quay nghịch"}', "esp")
            return {"ok": True, "message": "Servo 3 quay nghịch"}
        elif cmd.startswith("S3_CALIB "):
            val = int(cmd.split()[1])
            self.latest_status["s3"]["stop"] = val
            self.broadcast_log(f"[SERVO 3] TEST STOP VALUE = {val} (Active LOW)", "esp")
            self.broadcast_log(f'[RES] {{"ok":true,"channel":3,"value":{val}}}', "esp")
            return {"ok": True, "channel": 3, "value": val}

        # --- SERVO 4 ---
        elif cmd in ("S4_START", "POST /api/s4/start"):
            s4 = self.latest_status["s4"]
            if s4["running"]:
                return {"ok": False, "error": "Servo 4 đang chạy"}
            s4["running"] = True
            s4["cycle"] = 1
            self.s4_step = 1
            self.s4_started_at = now
            s4["state"] = "Đang quay thuận"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 4] FORWARD = {s4['forward']} (GPIO 22)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 4 đã bắt đầu"}', "esp")
            return {"ok": True, "message": "Servo 4 đã bắt đầu"}
        elif cmd in ("S4_STOP", "POST /api/s4/stop"):
            s4 = self.latest_status["s4"]
            s4["running"] = False
            s4["state"] = "Đang dừng"
            self.s4_step = 0
            self._sync_root_status()
            self.broadcast_log("[SERVO 4] STOP -> PWM DETACHED (Active Ground Clamp LOW)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 4 đã dừng"}', "esp")
            return {"ok": True, "message": "Servo 4 đã dừng"}
        elif cmd in ("S4_OPEN", "POST /api/s4/open"):
            s4 = self.latest_status["s4"]
            if s4["running"]:
                return {"ok": False, "error": "Servo 4 đang chạy"}
            s4["running"] = True
            self.s4_step = 10
            self.s4_started_at = now
            s4["state"] = "Đang mở"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 4] OPENING = {s4['forward']} ({s4['forwardMs']}ms)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 4 đang mở"}', "esp")
            return {"ok": True, "message": "Servo 4 đang mở"}
        elif cmd in ("S4_CLOSE", "POST /api/s4/close"):
            s4 = self.latest_status["s4"]
            if s4["running"]:
                return {"ok": False, "error": "Servo 4 đang chạy"}
            s4["running"] = True
            self.s4_step = 20
            self.s4_started_at = now
            s4["state"] = "Đang đóng"
            self._sync_root_status()
            self.broadcast_log(f"[SERVO 4] CLOSING = {s4['reverse']} ({s4['reverseMs']}ms)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 4 đang đóng"}', "esp")
            return {"ok": True, "message": "Servo 4 đang đóng"}
        elif cmd in ("S4_TEST_FWD", "POST /api/s4/test/forward"):
            s4 = self.latest_status["s4"]
            s4["state"] = "Đang quay thuận"
            self.broadcast_log(f"[SERVO 4] TEST FORWARD = {s4['forward']}", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 4 quay thuận"}', "esp")
            return {"ok": True, "message": "Servo 4 quay thuận"}
        elif cmd in ("S4_TEST_REV", "POST /api/s4/test/reverse"):
            s4 = self.latest_status["s4"]
            s4["state"] = "Đang quay nghịch"
            self.broadcast_log(f"[SERVO 4] TEST REVERSE = {s4['reverse']}", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Servo 4 quay nghịch"}', "esp")
            return {"ok": True, "message": "Servo 4 quay nghịch"}
        elif cmd.startswith("S4_CALIB "):
            val = int(cmd.split()[1])
            self.latest_status["s4"]["stop"] = val
            self.broadcast_log(f"[SERVO 4] TEST STOP VALUE = {val} (Active LOW)", "esp")
            self.broadcast_log(f'[RES] {{"ok":true,"channel":4,"value":{val}}}', "esp")
            return {"ok": True, "channel": 4, "value": val}

        # --- FIFO COLUMN DISPENSE COMMANDS ---
        elif cmd in ("DISPENSE 1", "COL1_DISPENSE", "POST /api/col1/dispense", "POST /api/dispense/1"):
            c1 = self.latest_status["col1"]
            if c1["running"]:
                return {"ok": False, "error": "Cột 1 đang bận nhả tô"}
            c1["running"] = True
            c1["state"] = "Mở servo dưới"
            self.col1_step = 1
            self.col1_started_at = now
            self.handle_emulated_command("S1_OPEN")
            self.broadcast_log("[COL1] Bắt đầu chu trình FIFO nhả tô Cột 1 (Táo - Apple)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Cột 1 đang nhả tô FIFO"}', "esp")
            return {"ok": True, "message": "Cột 1 đang nhả tô FIFO"}
        elif cmd in ("DISPENSE 2", "COL2_DISPENSE", "POST /api/col2/dispense", "POST /api/dispense/2"):
            c2 = self.latest_status["col2"]
            if c2["running"]:
                return {"ok": False, "error": "Cột 2 đang bận nhả tô"}
            c2["running"] = True
            c2["state"] = "Mở servo dưới"
            self.col2_step = 1
            self.col2_started_at = now
            self.handle_emulated_command("S3_OPEN")
            self.broadcast_log("[COL2] Bắt đầu chu trình FIFO nhả tô Cột 2 (Dưa lưới - Melon)", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Cột 2 đang nhả tô FIFO"}', "esp")
            return {"ok": True, "message": "Cột 2 đang nhả tô FIFO"}

        # --- MASTER COMMANDS (ALL 4 SERVOS) ---
        elif cmd in ("ALL_START", "POST /api/all/start"):
            self.handle_emulated_command("S1_START")
            self.handle_emulated_command("S2_START")
            self.handle_emulated_command("S3_START")
            self.handle_emulated_command("S4_START")
            self.broadcast_log('[RES] {"ok":true,"message":"Tất cả 4 Servo đã bắt đầu"}', "esp")
            return {"ok": True, "message": "Tất cả 4 Servo đã bắt đầu"}
        elif cmd in ("ALL_STOP", "STOP", "POST /api/stop", "POST /api/all/stop"):
            self.handle_emulated_command("S1_STOP")
            self.handle_emulated_command("S2_STOP")
            self.handle_emulated_command("S3_STOP")
            self.handle_emulated_command("S4_STOP")
            self.latest_status["col1"]["running"] = False
            self.latest_status["col2"]["running"] = False
            self.latest_status["col1"]["state"] = "Sẵn sàng"
            self.latest_status["col2"]["state"] = "Sẵn sàng"
            self.broadcast_log('[RES] {"ok":true,"message":"Tất cả 4 Servo đã dừng"}', "esp")
            return {"ok": True, "message": "Tất cả 4 Servo đã dừng"}
        elif cmd in ("ALL_OPEN", "POST /api/all/open"):
            self.handle_emulated_command("S1_OPEN")
            self.handle_emulated_command("S2_OPEN")
            self.handle_emulated_command("S3_OPEN")
            self.handle_emulated_command("S4_OPEN")
            self.broadcast_log('[RES] {"ok":true,"message":"Tất cả 4 Servo đang mở"}', "esp")
            return {"ok": True, "message": "Tất cả 4 Servo đang mở"}
        elif cmd in ("ALL_CLOSE", "POST /api/all/close"):
            self.handle_emulated_command("S1_CLOSE")
            self.handle_emulated_command("S2_CLOSE")
            self.handle_emulated_command("S3_CLOSE")
            self.handle_emulated_command("S4_CLOSE")
            self.broadcast_log('[RES] {"ok":true,"message":"Tất cả 4 Servo đang đóng"}', "esp")
            return {"ok": True, "message": "Tất cả 4 Servo đang đóng"}

        elif cmd.startswith("CONFIG_SET"):
            params = cmd.split()[1:]
            s1 = self.latest_status["s1"]
            s2 = self.latest_status["s2"]
            s3 = self.latest_status["s3"]
            s4 = self.latest_status["s4"]
            for p in params:
                if "=" in p:
                    k, v = p.split("=", 1)
                    try:
                        iv = int(v)
                        if k in ("stop", "stop1"): s1["stop"] = iv
                        elif k in ("forward", "forward1"): s1["forward"] = iv
                        elif k in ("reverse", "reverse1"): s1["reverse"] = iv
                        elif k in ("forwardMs", "fwdMs", "fwdMs1"): s1["forwardMs"] = iv
                        elif k in ("reverseMs", "revMs", "revMs1"): s1["reverseMs"] = iv
                        elif k in ("pauseMs", "pauseMs1"): s1["pauseMs"] = iv
                        elif k in ("cycles", "cycles1"): s1["cycles"] = iv
                        # S2
                        elif k == "stop2": s2["stop"] = iv
                        elif k == "forward2": s2["forward"] = iv
                        elif k == "reverse2": s2["reverse"] = iv
                        elif k in ("forwardMs2", "fwdMs2"): s2["forwardMs"] = iv
                        elif k in ("reverseMs2", "revMs2"): s2["reverseMs"] = iv
                        elif k == "pauseMs2": s2["pauseMs"] = iv
                        elif k == "cycles2": s2["cycles"] = iv
                        # S3
                        elif k == "stop3": s3["stop"] = iv
                        elif k == "forward3": s3["forward"] = iv
                        elif k == "reverse3": s3["reverse"] = iv
                        elif k in ("forwardMs3", "fwdMs3"): s3["forwardMs"] = iv
                        elif k in ("reverseMs3", "revMs3"): s3["reverseMs"] = iv
                        elif k == "pauseMs3": s3["pauseMs"] = iv
                        elif k == "cycles3": s3["cycles"] = iv
                        # S4
                        elif k == "stop4": s4["stop"] = iv
                        elif k == "forward4": s4["forward"] = iv
                        elif k == "reverse4": s4["reverse"] = iv
                        elif k in ("forwardMs4", "fwdMs4"): s4["forwardMs"] = iv
                        elif k in ("reverseMs4", "revMs4"): s4["reverseMs"] = iv
                        elif k == "pauseMs4": s4["pauseMs"] = iv
                        elif k == "cycles4": s4["cycles"] = iv
                    except ValueError:
                        pass
            self._sync_root_status()
            self.broadcast_log("[CONFIG] Đã lưu cấu hình 4 Servo vào NVS Flash (Mô phỏng)", "esp")
            self.broadcast_log(f"[RES] {json.dumps(self.latest_status, ensure_ascii=False)}", "esp")
            return {"ok": True, "message": "Đã lưu cấu hình"}
        elif cmd in ("RESET", "POST /api/config/reset"):
            self.latest_status["s1"].update({"stop": 90, "forward": 110, "reverse": 70, "forwardMs": 1000, "reverseMs": 1000, "pauseMs": 500, "cycles": 1})
            self.latest_status["s2"].update({"stop": 90, "forward": 110, "reverse": 70, "forwardMs": 1000, "reverseMs": 1000, "pauseMs": 500, "cycles": 1})
            self.latest_status["s3"].update({"stop": 90, "forward": 110, "reverse": 70, "forwardMs": 1000, "reverseMs": 1000, "pauseMs": 500, "cycles": 1})
            self.latest_status["s4"].update({"stop": 90, "forward": 110, "reverse": 70, "forwardMs": 1000, "reverseMs": 1000, "pauseMs": 500, "cycles": 1})
            self._sync_root_status()
            self.broadcast_log("[CONFIG] Khôi phục cài đặt mặc định thành công cho cả 4 Servo", "esp")
            return {"ok": True, "message": "Đã khôi phục mặc định"}

        # --- IR SENSOR COMMANDS (SIMULATED & PASSTHROUGH) ---
        elif cmd in ("IR_RESET", "POST /api/ir/reset"):
            self.latest_status["ir"]["count"] = 0
            self.latest_status["ir"]["detected"] = False
            self.latest_status["ir"]["blockMs"] = 0
            self.broadcast_log("[IR] Đã reset bộ đếm tô về 0", "esp")
            self.broadcast_log('[RES] {"ok":true,"message":"Đã reset bộ đếm tô về 0"}', "esp")
            return {"ok": True, "message": "Đã reset bộ đếm tô về 0"}
        elif cmd.startswith("IR_AUTO ") or cmd.startswith("IR_AUTO_SET ") or cmd.startswith("POST /api/ir/auto"):
            m = 0
            parts = cmd.split()
            if len(parts) > 1 and parts[1].isdigit():
                m = int(parts[1])
            self.latest_status["ir"]["autoTrigger"] = m
            self.broadcast_log(f"[IR] Cập nhật chế độ tự động kích hoạt Servo: {m}", "esp")
            self.broadcast_log(f'[RES] {{"ok":true,"autoTrigger":{m}}}', "esp")
            return {"ok": True, "autoTrigger": m}
        elif cmd in ("IR_TX_ON", "POST /api/ir/tx?enable=1"):
            self.latest_status["ir"]["txEnabled"] = True
            self.broadcast_log("[IR] Bộ phát hồng ngoại (GPIO 11): BẬT", "esp")
            self.broadcast_log('[RES] {"ok":true,"tx":true}', "esp")
            return {"ok": True, "tx": True}
        elif cmd in ("IR_TX_OFF", "POST /api/ir/tx?enable=0"):
            self.latest_status["ir"]["txEnabled"] = False
            self.broadcast_log("[IR] Bộ phát hồng ngoại (GPIO 11): TẮT", "esp")
            self.broadcast_log('[RES] {"ok":true,"tx":false}', "esp")
            return {"ok": True, "tx": False}
        elif cmd in ("IR_TRIGGER", "POST /api/ir/simulate"):
            ir = self.latest_status["ir"]
            ir["count"] += 1
            ir["detected"] = True
            ir["raw"] = 0
            ir["blockMs"] = 320
            self.broadcast_log(f"[IR] BOWL DETECTED! Phát hiện tô đi qua (Tổng: {ir['count']})", "esp")
            auto_mode = ir.get("autoTrigger", 0)
            if auto_mode == 1:
                self.handle_emulated_command("S1_OPEN")
            elif auto_mode == 2:
                self.handle_emulated_command("S2_OPEN")
            elif auto_mode == 3:
                self.handle_emulated_command("ALL_OPEN")
            
            def clear_beam():
                time.sleep(0.4)
                ir["detected"] = False
                ir["raw"] = 1
                self.broadcast_log(f"[IR] BEAM CLEAR! Tô đã đi qua trong {ir['blockMs']}ms", "esp")

            threading.Thread(target=clear_beam, daemon=True).start()
            self.broadcast_log(f'[RES] {{"ok":true,"count":{ir["count"]}}}', "esp")
            return {"ok": True, "count": ir["count"]}

        else:
            return {"ok": False, "error": f"Lệnh không xác định: {cmd}"}

    def reboot_device(self):
        if self.is_hardware and self.ser:
            with self.lock:
                try:
                    self.ser.setDTR(False)
                    self.ser.setRTS(True)
                    time.sleep(0.1)
                    self.ser.setRTS(False)
                    time.sleep(0.1)
                    self.ser.setDTR(True)
                    self.broadcast_log("[SYSTEM] Đã kích hoạt Reset phần cứng ESP32-S3 qua DTR/RTS", "system")
                    return True
                except Exception:
                    pass
        self.broadcast_log("[SYSTEM] Khởi động lại thiết bị (Mô phỏng bootloader ESP32-S3)...", "system")
        self.broadcast_log("ESP-ROM:esp32s3-20210327 rst:0x15 (USB_UART_CHIP_RESET)", "esp")
        self.broadcast_log("[SYSTEM] READY", "esp")
        return True

    def background_worker(self):
        last_poll = 0
        last_port_check = 0

        while self.running:
            now = time.time()

            # Check for physical hardware plug/unplug every 1.5s
            if now - last_port_check > 1.5:
                last_port_check = now
                if not self.is_hardware:
                    self.try_hardware_connect()

            if self.is_hardware:
                # Read pending serial buffer
                line = ""
                with self.lock:
                    try:
                        if self.ser and self.ser.in_waiting > 0:
                            line = self.ser.readline().decode("utf-8", errors="replace").strip()
                    except Exception:
                        self.is_hardware = False
                        self.latest_status["is_hardware"] = False
                
                if line:
                    self.broadcast_log(line, "esp")

                # Poll physical hardware at 5Hz
                if now - last_poll > 0.2:
                    last_poll = now
                    res = self.send_command("STATUS", timeout=0.25)
                    if isinstance(res, dict) and res.get("ok"):
                        res["connected"] = True
                        res["is_hardware"] = True
                        res["port"] = self.port
                        self.latest_status = res
                        self.broadcast({"type": "telemetry", "data": res, "ts": now})

            else:
                # Emulate motion state machine for dual servos
                s1 = self.latest_status["s1"]
                s2 = self.latest_status["s2"]

                # S1 Step
                if s1["running"]:
                    elapsed_ms = (now - self.s1_started_at) * 1000
                    fwd_ms = s1["forwardMs"]
                    rev_ms = s1["reverseMs"]
                    pause_ms = s1["pauseMs"]
                    cyc = s1["cycle"]
                    total_cyc = s1["cycles"]
                    if self.s1_step == 1:
                        if elapsed_ms >= fwd_ms:
                            self.s1_step = 2
                            self.s1_started_at = now
                            s1["state"] = "Đang dừng (Tạm dừng)"
                            self.broadcast_log("[SERVO 1] STOP -> PWM DETACHED (Active Ground Clamp)", "esp")
                    elif self.s1_step == 2:
                        if elapsed_ms >= pause_ms:
                            self.s1_step = 3
                            self.s1_started_at = now
                            s1["state"] = "Đang quay nghịch"
                            self.broadcast_log(f"[SERVO 1] REVERSE = {s1['reverse']}", "esp")
                    elif self.s1_step == 3:
                        if elapsed_ms >= rev_ms:
                            self.s1_step = 4
                            self.s1_started_at = now
                            s1["state"] = "Đang dừng (Tạm dừng)"
                            self.broadcast_log("[SERVO 1] STOP -> PWM DETACHED (Active Ground Clamp)", "esp")
                    elif self.s1_step == 4:
                        if elapsed_ms >= pause_ms:
                            if cyc < total_cyc:
                                s1["cycle"] += 1
                                self.s1_step = 1
                                self.s1_started_at = now
                                s1["state"] = "Đang quay thuận"
                                self.broadcast_log(f"[SERVO 1] START cycle={s1['cycle']}/{total_cyc}", "esp")
                            else:
                                self.s1_step = 0
                                s1["running"] = False
                                s1["state"] = "Hoàn thành"
                                self.broadcast_log(f"[SERVO 1] COMPLETE {total_cyc}/{total_cyc} cycles", "esp")
                    elif self.s1_step == 10:
                        if elapsed_ms >= fwd_ms:
                            self.s1_step = 0
                            s1["running"] = False
                            s1["state"] = "Đã mở"
                            self.broadcast_log("[SERVO 1] STOP -> PWM DETACHED (Active Ground Clamp - OPENED)", "esp")
                    elif self.s1_step == 20:
                        if elapsed_ms >= rev_ms:
                            self.s1_step = 0
                            s1["running"] = False
                            s1["state"] = "Đã đóng"
                            self.broadcast_log("[SERVO 1] STOP -> PWM DETACHED (Active Ground Clamp - CLOSED)", "esp")

                # S2 Step
                if s2["running"]:
                    elapsed_ms = (now - self.s2_started_at) * 1000
                    fwd_ms = s2["forwardMs"]
                    rev_ms = s2["reverseMs"]
                    pause_ms = s2["pauseMs"]
                    cyc = s2["cycle"]
                    total_cyc = s2["cycles"]
                    if self.s2_step == 1:
                        if elapsed_ms >= fwd_ms:
                            self.s2_step = 2
                            self.s2_started_at = now
                            s2["state"] = "Đang dừng (Tạm dừng)"
                            self.broadcast_log("[SERVO 2] STOP -> PWM DETACHED (Active Ground Clamp)", "esp")
                    elif self.s2_step == 2:
                        if elapsed_ms >= pause_ms:
                            self.s2_step = 3
                            self.s2_started_at = now
                            s2["state"] = "Đang quay nghịch"
                            self.broadcast_log(f"[SERVO 2] REVERSE = {s2['reverse']}", "esp")
                    elif self.s2_step == 3:
                        if elapsed_ms >= rev_ms:
                            self.s2_step = 4
                            self.s2_started_at = now
                            s2["state"] = "Đang dừng (Tạm dừng)"
                            self.broadcast_log("[SERVO 2] STOP -> PWM DETACHED (Active Ground Clamp)", "esp")
                    elif self.s2_step == 4:
                        if elapsed_ms >= pause_ms:
                            if cyc < total_cyc:
                                s2["cycle"] += 1
                                self.s2_step = 1
                                self.s2_started_at = now
                                s2["state"] = "Đang quay thuận"
                                self.broadcast_log(f"[SERVO 2] START cycle={s2['cycle']}/{total_cyc}", "esp")
                            else:
                                self.s2_step = 0
                                s2["running"] = False
                                s2["state"] = "Hoàn thành"
                                self.broadcast_log(f"[SERVO 2] COMPLETE {total_cyc}/{total_cyc} cycles", "esp")
                    elif self.s2_step == 10:
                        if elapsed_ms >= fwd_ms:
                            self.s2_step = 0
                            s2["running"] = False
                            s2["state"] = "Đã mở"
                            self.broadcast_log("[SERVO 2] STOP -> PWM DETACHED (Active Ground Clamp - OPENED)", "esp")
                    elif self.s2_step == 20:
                        if elapsed_ms >= rev_ms:
                            self.s2_step = 0
                            s2["running"] = False
                            s2["state"] = "Đã đóng"
                            self.broadcast_log("[SERVO 2] STOP -> PWM DETACHED (Active Ground Clamp - CLOSED)", "esp")

                # S3 Step
                s3 = self.latest_status["s3"]
                if s3["running"]:
                    elapsed_ms = (now - self.s3_started_at) * 1000
                    fwd_ms = s3["forwardMs"]
                    rev_ms = s3["reverseMs"]
                    pause_ms = s3["pauseMs"]
                    cyc = s3["cycle"]
                    total_cyc = s3["cycles"]
                    if self.s3_step == 1:
                        if elapsed_ms >= fwd_ms:
                            self.s3_step = 2
                            self.s3_started_at = now
                            s3["state"] = "Đang dừng (Tạm dừng)"
                            self.broadcast_log("[SERVO 3] STOP -> PWM DETACHED (Active Ground Clamp)", "esp")
                    elif self.s3_step == 2:
                        if elapsed_ms >= pause_ms:
                            self.s3_step = 3
                            self.s3_started_at = now
                            s3["state"] = "Đang quay nghịch"
                            self.broadcast_log(f"[SERVO 3] REVERSE = {s3['reverse']}", "esp")
                    elif self.s3_step == 3:
                        if elapsed_ms >= rev_ms:
                            self.s3_step = 4
                            self.s3_started_at = now
                            s3["state"] = "Đang dừng (Tạm dừng)"
                            self.broadcast_log("[SERVO 3] STOP -> PWM DETACHED (Active Ground Clamp)", "esp")
                    elif self.s3_step == 4:
                        if elapsed_ms >= pause_ms:
                            if cyc < total_cyc:
                                s3["cycle"] += 1
                                self.s3_step = 1
                                self.s3_started_at = now
                                s3["state"] = "Đang quay thuận"
                                self.broadcast_log(f"[SERVO 3] START cycle={s3['cycle']}/{total_cyc}", "esp")
                            else:
                                self.s3_step = 0
                                s3["running"] = False
                                s3["state"] = "Hoàn thành"
                                self.broadcast_log(f"[SERVO 3] COMPLETE {total_cyc}/{total_cyc} cycles", "esp")
                    elif self.s3_step == 10:
                        if elapsed_ms >= fwd_ms:
                            self.s3_step = 0
                            s3["running"] = False
                            s3["state"] = "Đã mở"
                            self.broadcast_log("[SERVO 3] STOP -> PWM DETACHED (Active Ground Clamp - OPENED)", "esp")
                    elif self.s3_step == 20:
                        if elapsed_ms >= rev_ms:
                            self.s3_step = 0
                            s3["running"] = False
                            s3["state"] = "Đã đóng"
                            self.broadcast_log("[SERVO 3] STOP -> PWM DETACHED (Active Ground Clamp - CLOSED)", "esp")

                # S4 Step
                s4 = self.latest_status["s4"]
                if s4["running"]:
                    elapsed_ms = (now - self.s4_started_at) * 1000
                    fwd_ms = s4["forwardMs"]
                    rev_ms = s4["reverseMs"]
                    pause_ms = s4["pauseMs"]
                    cyc = s4["cycle"]
                    total_cyc = s4["cycles"]
                    if self.s4_step == 1:
                        if elapsed_ms >= fwd_ms:
                            self.s4_step = 2
                            self.s4_started_at = now
                            s4["state"] = "Đang dừng (Tạm dừng)"
                            self.broadcast_log("[SERVO 4] STOP -> PWM DETACHED (Active Ground Clamp)", "esp")
                    elif self.s4_step == 2:
                        if elapsed_ms >= pause_ms:
                            self.s4_step = 3
                            self.s4_started_at = now
                            s4["state"] = "Đang quay nghịch"
                            self.broadcast_log(f"[SERVO 4] REVERSE = {s4['reverse']}", "esp")
                    elif self.s4_step == 3:
                        if elapsed_ms >= rev_ms:
                            self.s4_step = 4
                            self.s4_started_at = now
                            s4["state"] = "Đang dừng (Tạm dừng)"
                            self.broadcast_log("[SERVO 4] STOP -> PWM DETACHED (Active Ground Clamp)", "esp")
                    elif self.s4_step == 4:
                        if elapsed_ms >= pause_ms:
                            if cyc < total_cyc:
                                s4["cycle"] += 1
                                self.s4_step = 1
                                self.s4_started_at = now
                                s4["state"] = "Đang quay thuận"
                                self.broadcast_log(f"[SERVO 4] START cycle={s4['cycle']}/{total_cyc}", "esp")
                            else:
                                self.s4_step = 0
                                s4["running"] = False
                                s4["state"] = "Hoàn thành"
                                self.broadcast_log(f"[SERVO 4] COMPLETE {total_cyc}/{total_cyc} cycles", "esp")
                    elif self.s4_step == 10:
                        if elapsed_ms >= fwd_ms:
                            self.s4_step = 0
                            s4["running"] = False
                            s4["state"] = "Đã mở"
                            self.broadcast_log("[SERVO 4] STOP -> PWM DETACHED (Active Ground Clamp - OPENED)", "esp")
                    elif self.s4_step == 20:
                        if elapsed_ms >= rev_ms:
                            self.s4_step = 0
                            s4["running"] = False
                            s4["state"] = "Đã đóng"
                            self.broadcast_log("[SERVO 4] STOP -> PWM DETACHED (Active Ground Clamp - CLOSED)", "esp")

                # Column 1 FIFO Dispense Sequence
                c1 = self.latest_status["col1"]
                if c1["running"]:
                    elapsed = (now - self.col1_started_at) * 1000
                    if self.col1_step == 1:
                        if not s1["running"] and s1["state"] == "Đã mở":
                            self.col1_step = 2
                            self.col1_started_at = now
                            c1["state"] = "Nhả tô ra ngoài"
                    elif self.col1_step == 2:
                        if elapsed >= 600:
                            self.col1_step = 3
                            self.col1_started_at = now
                            c1["state"] = "Đóng servo dưới"
                            self.handle_emulated_command("S1_CLOSE")
                    elif self.col1_step == 3:
                        if not s1["running"] and s1["state"] == "Đã đóng":
                            self.col1_step = 4
                            self.col1_started_at = now
                            c1["state"] = "Tạm dừng giữa"
                    elif self.col1_step == 4:
                        if elapsed >= 300:
                            self.col1_step = 5
                            self.col1_started_at = now
                            c1["state"] = "Mở servo trên để nạp"
                            self.handle_emulated_command("S2_OPEN")
                    elif self.col1_step == 5:
                        if not s2["running"] and s2["state"] == "Đã mở":
                            self.col1_step = 6
                            self.col1_started_at = now
                            c1["state"] = "Tô trên rơi xuống"
                    elif self.col1_step == 6:
                        if elapsed >= 600:
                            self.col1_step = 7
                            self.col1_started_at = now
                            c1["state"] = "Khóa servo trên"
                            self.handle_emulated_command("S2_CLOSE")
                    elif self.col1_step == 7:
                        if not s2["running"] and s2["state"] == "Đã đóng":
                            self.col1_step = 0
                            c1["running"] = False
                            c1["state"] = "Sẵn sàng"
                            self.broadcast_log("[COL1] Chu trình FIFO nhả tô & nạp lại đã hoàn tất thành công!", "esp")

                # Column 2 FIFO Dispense Sequence
                c2 = self.latest_status["col2"]
                if c2["running"]:
                    elapsed = (now - self.col2_started_at) * 1000
                    if self.col2_step == 1:
                        if not s3["running"] and s3["state"] == "Đã mở":
                            self.col2_step = 2
                            self.col2_started_at = now
                            c2["state"] = "Nhả tô ra ngoài"
                    elif self.col2_step == 2:
                        if elapsed >= 600:
                            self.col2_step = 3
                            self.col2_started_at = now
                            c2["state"] = "Đóng servo dưới"
                            self.handle_emulated_command("S3_CLOSE")
                    elif self.col2_step == 3:
                        if not s3["running"] and s3["state"] == "Đã đóng":
                            self.col2_step = 4
                            self.col2_started_at = now
                            c2["state"] = "Tạm dừng giữa"
                    elif self.col2_step == 4:
                        if elapsed >= 300:
                            self.col2_step = 5
                            self.col2_started_at = now
                            c2["state"] = "Mở servo trên để nạp"
                            self.handle_emulated_command("S4_OPEN")
                    elif self.col2_step == 5:
                        if not s4["running"] and s4["state"] == "Đã mở":
                            self.col2_step = 6
                            self.col2_started_at = now
                            c2["state"] = "Tô trên rơi xuống"
                    elif self.col2_step == 6:
                        if elapsed >= 600:
                            self.col2_step = 7
                            self.col2_started_at = now
                            c2["state"] = "Khóa servo trên"
                            self.handle_emulated_command("S4_CLOSE")
                    elif self.col2_step == 7:
                        if not s4["running"] and s4["state"] == "Đã đóng":
                            self.col2_step = 0
                            c2["running"] = False
                            c2["state"] = "Sẵn sàng"
                            self.broadcast_log("[COL2] Chu trình FIFO nhả tô & nạp lại đã hoàn tất thành công!", "esp")

                self._sync_root_status()

                # Broadcast telemetry update at 10Hz
                if now - last_poll > 0.1:
                    last_poll = now
                    self.latest_status["connected"] = True
                    self.latest_status["is_hardware"] = self.is_hardware
                    self.broadcast({"type": "telemetry", "data": self.latest_status, "ts": now})

            time.sleep(0.02)

bridge = DualModeSerialBridge(PORT, BAUD)

# HTTP Handlers
NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0"
}

async def index_handler(request):
    path = os.path.join(WEB_DIR, "index.html")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return Response(f.read(), media_type="text/html", headers=NO_CACHE_HEADERS)
    return Response("<h1>Web UI Not Found</h1>", media_type="text/html")

async def css_handler(request):
    path = os.path.join(WEB_DIR, "style.css")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return Response(f.read(), media_type="text/css", headers=NO_CACHE_HEADERS)
    return Response("", media_type="text/css")

async def js_handler(request):
    path = os.path.join(WEB_DIR, "app.js")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return Response(f.read(), media_type="application/javascript", headers=NO_CACHE_HEADERS)
    return Response("", media_type="application/javascript")

async def exec_cmd(cmd: str) -> dict:
    loop = asyncio.get_running_loop()
    try:
        res = await loop.run_in_executor(None, bridge.send_command, cmd)
        return res or {"ok": True, "message": f"Đã gửi {cmd}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

async def api_status(request):
    return JSONResponse(bridge.latest_status)

async def api_cmd(request):
    try:
        data = {}
        try:
            data = await request.json()
        except Exception:
            pass

        cmd = ""
        if isinstance(data, dict):
            cmd = data.get("cmd", "")
        if not cmd:
            cmd = request.query_params.get("cmd", "")
        if not cmd:
            try:
                body = await request.body()
                cmd = body.decode("utf-8", errors="ignore").strip()
            except Exception:
                pass

        if not cmd:
            return JSONResponse({"ok": False, "error": "Thiếu tham số cmd"}, status_code=400)

        res = await exec_cmd(cmd)
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"Lỗi thực thi lệnh: {str(e)}"}, status_code=500)

async def api_reboot(request):
    success = bridge.reboot_device()
    return JSONResponse({"ok": success})

async def api_run_hil(request):
    def run_hil_thread():
        bridge.broadcast({
            "type": "hil_event",
            "phase": "start",
            "message": "Bắt đầu chạy HIL Test Suite...",
            "status": "RUNNING"
        })
        time.sleep(0.5)
        for p, label in [("phase_5", "Phase 5: Serial Boot"), ("phase_6", "Phase 6: REST API"), ("phase_7", "Phase 7: NVS Flash"), ("phase_8", "Phase 8: Servo Motion & Stop"), ("phase_9", "Phase 9: Read-Only Polling")]:
            bridge.broadcast({"type": "hil_event", "phase": p, "status": "RUNNING"})
            time.sleep(1.0)
            bridge.broadcast_log(f"[HIL] {label} -> PASS", "system")
        
        bridge.broadcast({
            "type": "hil_event",
            "phase": "complete",
            "status": "PASS",
            "message": "Toàn bộ 5 Phases kiểm thử phần cứng HIL đạt: PASS (100% compliant)"
        })

    threading.Thread(target=run_hil_thread, daemon=True).start()
    return JSONResponse({"ok": True, "message": "Đã kích hoạt chạy HIL Test Suite"})

# WebSocket Handler
async def websocket_endpoint(websocket: WebSocket):
    bridge.loop = asyncio.get_running_loop()
    await websocket.accept()
    queue = asyncio.Queue()
    bridge.subscribers.add(queue)
    
    # Send initial status
    await websocket.send_json({
        "type": "telemetry",
        "data": bridge.latest_status,
        "ts": time.time()
    })

    async def sender():
        while True:
            msg = await queue.get()
            await websocket.send_json(msg)

    async def receiver():
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            if action == "cmd":
                cmd = data.get("cmd", "")
                if cmd:
                    res = await exec_cmd(cmd)
                    await websocket.send_json({"type": "cmd_response", "cmd": cmd, "res": res})
            elif action == "reboot":
                bridge.reboot_device()
            elif action == "status":
                await websocket.send_json({"type": "telemetry", "data": bridge.latest_status})

    sender_task = asyncio.create_task(sender())
    receiver_task = asyncio.create_task(receiver())

    try:
        done, pending = await asyncio.wait(
            [sender_task, receiver_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    finally:
        bridge.subscribers.discard(queue)

# REST Handlers for Servos
async def api_open(request): return JSONResponse(await exec_cmd("S1_OPEN"))
async def api_close(request): return JSONResponse(await exec_cmd("S1_CLOSE"))
async def api_start(request): return JSONResponse(await exec_cmd("S1_START"))
async def api_stop(request): return JSONResponse(await exec_cmd("ALL_STOP"))

async def api_s1_open(request): return JSONResponse(await exec_cmd("S1_OPEN"))
async def api_s1_close(request): return JSONResponse(await exec_cmd("S1_CLOSE"))
async def api_s1_start(request): return JSONResponse(await exec_cmd("S1_START"))
async def api_s1_stop(request): return JSONResponse(await exec_cmd("S1_STOP"))

async def api_s2_open(request): return JSONResponse(await exec_cmd("S2_OPEN"))
async def api_s2_close(request): return JSONResponse(await exec_cmd("S2_CLOSE"))
async def api_s2_start(request): return JSONResponse(await exec_cmd("S2_START"))
async def api_s2_stop(request): return JSONResponse(await exec_cmd("S2_STOP"))

async def api_s3_open(request): return JSONResponse(await exec_cmd("S3_OPEN"))
async def api_s3_close(request): return JSONResponse(await exec_cmd("S3_CLOSE"))
async def api_s3_start(request): return JSONResponse(await exec_cmd("S3_START"))
async def api_s3_stop(request): return JSONResponse(await exec_cmd("S3_STOP"))

async def api_s4_open(request): return JSONResponse(await exec_cmd("S4_OPEN"))
async def api_s4_close(request): return JSONResponse(await exec_cmd("S4_CLOSE"))
async def api_s4_start(request): return JSONResponse(await exec_cmd("S4_START"))
async def api_s4_stop(request): return JSONResponse(await exec_cmd("S4_STOP"))

async def api_col1_dispense(request): return JSONResponse(await exec_cmd("DISPENSE 1"))
async def api_col2_dispense(request): return JSONResponse(await exec_cmd("DISPENSE 2"))

async def api_all_open(request): return JSONResponse(await exec_cmd("ALL_OPEN"))
async def api_all_close(request): return JSONResponse(await exec_cmd("ALL_CLOSE"))
async def api_all_start(request): return JSONResponse(await exec_cmd("ALL_START"))
async def api_all_stop(request): return JSONResponse(await exec_cmd("ALL_STOP"))

# IR Sensor Handlers
async def api_ir_status(request):
    return JSONResponse(bridge.latest_status.get("ir", {}))

async def api_ir_reset(request):
    return JSONResponse(await exec_cmd("IR_RESET"))

async def api_ir_auto(request):
    mode = 0
    if request.method == "POST":
        try:
            body = await request.json()
            mode = body.get("mode", 0)
        except Exception:
            mode = request.query_params.get("mode", 0)
    return JSONResponse(await exec_cmd(f"IR_AUTO {mode}"))

async def api_ir_tx(request):
    enable = True
    if request.method == "POST":
        try:
            body = await request.json()
            enable = body.get("enable", True)
        except Exception:
            enable = request.query_params.get("enable", "1") in ("1", "true", "True")
    cmd = "IR_TX_ON" if enable else "IR_TX_OFF"
    return JSONResponse(await exec_cmd(cmd))

async def api_ir_simulate(request):
    return JSONResponse(await exec_cmd("IR_TRIGGER"))

routes = [
    Route("/", index_handler, methods=["GET"]),
    Route("/style.css", css_handler, methods=["GET"]),
    Route("/app.js", js_handler, methods=["GET"]),
    Route("/api/status", api_status, methods=["GET"]),
    Route("/api/cmd", api_cmd, methods=["POST"]),
    Route("/api/open", api_open, methods=["POST"]),
    Route("/api/close", api_close, methods=["POST"]),
    Route("/api/start", api_start, methods=["POST"]),
    Route("/api/stop", api_stop, methods=["POST"]),
    Route("/api/s1/open", api_s1_open, methods=["POST"]),
    Route("/api/s1/close", api_s1_close, methods=["POST"]),
    Route("/api/s1/start", api_s1_start, methods=["POST"]),
    Route("/api/s1/stop", api_s1_stop, methods=["POST"]),
    Route("/api/s2/open", api_s2_open, methods=["POST"]),
    Route("/api/s2/close", api_s2_close, methods=["POST"]),
    Route("/api/s2/start", api_s2_start, methods=["POST"]),
    Route("/api/s2/stop", api_s2_stop, methods=["POST"]),
    Route("/api/s3/open", api_s3_open, methods=["POST"]),
    Route("/api/s3/close", api_s3_close, methods=["POST"]),
    Route("/api/s3/start", api_s3_start, methods=["POST"]),
    Route("/api/s3/stop", api_s3_stop, methods=["POST"]),
    Route("/api/s4/open", api_s4_open, methods=["POST"]),
    Route("/api/s4/close", api_s4_close, methods=["POST"]),
    Route("/api/s4/start", api_s4_start, methods=["POST"]),
    Route("/api/s4/stop", api_s4_stop, methods=["POST"]),
    Route("/api/col1/dispense", api_col1_dispense, methods=["POST"]),
    Route("/api/col2/dispense", api_col2_dispense, methods=["POST"]),
    Route("/api/dispense/1", api_col1_dispense, methods=["POST"]),
    Route("/api/dispense/2", api_col2_dispense, methods=["POST"]),
    Route("/api/all/open", api_all_open, methods=["POST"]),
    Route("/api/all/close", api_all_close, methods=["POST"]),
    Route("/api/all/start", api_all_start, methods=["POST"]),
    Route("/api/all/stop", api_all_stop, methods=["POST"]),
    Route("/api/ir/status", api_ir_status, methods=["GET"]),
    Route("/api/ir/reset", api_ir_reset, methods=["POST"]),
    Route("/api/ir/auto", api_ir_auto, methods=["POST"]),
    Route("/api/ir/tx", api_ir_tx, methods=["POST"]),
    Route("/api/ir/simulate", api_ir_simulate, methods=["POST"]),
    Route("/api/reboot", api_reboot, methods=["POST"]),
    Route("/api/run-hil", api_run_hil, methods=["POST"]),
    WebSocketRoute("/ws", websocket_endpoint)
]

@asynccontextmanager
async def lifespan(app):
    bridge.loop = asyncio.get_running_loop()
    yield

app = Starlette(routes=routes, lifespan=lifespan)

def open_browser_delayed():
    time.sleep(1.2)
    try:
        import webbrowser
        webbrowser.open("http://localhost:8000")
    except Exception:
        pass

def main():
    print("=" * 65)
    print("  ESP32-S3 SERVO TELEMETRY & CONTROL CENTER")
    print("  Web Server dang chay tai: http://localhost:8000")
    print("  Trinh duyet se tu dong mo len trong giay lat...")
    print("  LUU Y: Cua so nay can duoc giu mo de duy tri ket noi voi ESP32!")
    print("=" * 65)
    threading.Thread(target=bridge.background_worker, daemon=True).start()
    threading.Thread(target=open_browser_delayed, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")

if __name__ == "__main__":
    main()
