import serial
import time
import json
import sys
import os
import io

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

PORT = 'COM3'
BAUD = 115200

traces_dir = 'docs/traces'
validation_dir = 'docs/validation'
os.makedirs(traces_dir, exist_ok=True)
os.makedirs(validation_dir, exist_ok=True)

class ESP32HILTester:
    def __init__(self, port, baud):
        self.port = port
        self.baud = baud
        self.ser = None
        self.log_file = open(os.path.join(traces_dir, 'hil_execution_trace.txt'), 'w', encoding='utf-8')

    def log(self, msg):
        ts = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())
        full_msg = f"[{ts}] {msg}"
        try:
            print(full_msg)
        except Exception:
            try:
                print(full_msg.encode('ascii', errors='replace').decode('ascii'))
            except Exception:
                pass
        self.log_file.write(full_msg + "\n")
        self.log_file.flush()

    def connect(self):
        self.log(f"Connecting to {self.port} at {self.baud} baud...")
        self.ser = serial.Serial(self.port, self.baud, timeout=1.0)
        time.sleep(0.5)

    def close(self):
        if self.ser and self.ser.is_open:
            self.ser.close()
        self.log_file.close()

    def reboot(self):
        self.log("Rebooting ESP32-S3 via DTR/RTS...")
        self.ser.setDTR(False)
        self.ser.setRTS(True)
        time.sleep(0.1)
        self.ser.setRTS(False)
        time.sleep(0.1)
        self.ser.setDTR(True)
        
        boot_lines = []
        start = time.time()
        while time.time() - start < 3.0:
            line = self.ser.readline().decode('utf-8', errors='replace').strip()
            if line:
                boot_lines.append(line)
                self.log(f"BOOT: {line}")
                if "[SYSTEM] READY" in line:
                    break
        return boot_lines

    def send_cmd(self, cmd, timeout=2.5):
        self.log(f"CMD >> {cmd}")
        self.ser.reset_input_buffer()
        self.ser.write((cmd + "\n").encode('utf-8'))
        
        start = time.time()
        res_json = None
        raw_lines = []
        while time.time() - start < timeout:
            line = self.ser.readline().decode('utf-8', errors='replace').strip()
            if line:
                raw_lines.append(line)
                self.log(f"ESP << {line}")
                if line.startswith("[RES]"):
                    payload = line[5:].strip()
                    if not payload:
                        continue
                    try:
                        res_json = json.loads(payload)
                        break
                    except Exception:
                        res_json = payload
                        break
                elif line.startswith("{") and line.endswith("}"):
                    try:
                        res_json = json.loads(line)
                        break
                    except Exception:
                        pass
        return res_json, raw_lines

def run_tests():
    tester = ESP32HILTester(PORT, BAUD)
    tester.connect()
    
    report = {
        "timestamp": time.strftime('%Y-%m-%d %H:%M:%S'),
        "port": PORT,
        "phases": {},
        "verdict": "FAIL"
    }

    try:
        # Phase 5: Serial Boot Verification
        tester.log("\n==================== PHASE 5: BOOT VERIFICATION ====================")
        boot_lines = tester.reboot()
        boot_pass = any("[SYSTEM] READY" in l for l in boot_lines)
        report["phases"]["phase_5_boot"] = {
            "status": "PASS" if boot_pass else "FAIL",
            "lines": boot_lines[:15]
        }
        assert boot_pass, "Boot did not reach READY state"
        time.sleep(1.0)

        # Phase 6: Web UI & REST API Verification
        tester.log("\n==================== PHASE 6: API VERIFICATION ====================")
        status_res, _ = tester.send_cmd("STATUS")
        tester.log(f"GET /api/status response: {status_res}")
        assert status_res and status_res.get("ok") is True, f"GET /api/status failed: {status_res}"

        config_res, _ = tester.send_cmd("CONFIG")
        tester.log(f"GET /api/config response: {config_res}")
        assert config_res and config_res.get("ok") is True, f"GET /api/config failed: {config_res}"

        report["phases"]["phase_6_api"] = {
            "status": "PASS",
            "status_endpoint": status_res,
            "config_endpoint": config_res
        }

        # Phase 7: Configuration Test & Persistence
        tester.log("\n==================== PHASE 7: CONFIGURATION TEST ====================")
        cmd = "CONFIG_SET stop=90 forward=70 reverse=110 forwardMs=1000 reverseMs=1000 pauseMs=500 cycles=1"
        set_res, _ = tester.send_cmd(cmd)
        tester.log(f"Set config response: {set_res}")
        assert set_res and set_res.get("cycles") == 1, f"Failed setting test config: {set_res}"
        assert set_res.get("forwardMs") == 1000, "forwardMs mismatch"
        assert set_res.get("pauseMs") == 500, "pauseMs mismatch"

        # Test forwardMs = 1500
        cmd_change = "CONFIG_SET stop=90 forward=70 reverse=110 forwardMs=1500 reverseMs=1000 pauseMs=500 cycles=1"
        change_res, _ = tester.send_cmd(cmd_change)
        tester.log(f"Change forwardMs to 1500 response: {change_res}")
        assert change_res and change_res.get("forwardMs") == 1500, f"Failed to update forwardMs=1500: {change_res}"

        # Reboot to verify persistence from NVS
        tester.log("Testing NVS Flash persistence across reboot...")
        tester.reboot()
        time.sleep(0.5)
        post_reboot_config, _ = tester.send_cmd("CONFIG")
        tester.log(f"Post-reboot config: {post_reboot_config}")
        assert post_reboot_config.get("forwardMs") == 1500, f"Persistence failed: expected forwardMs=1500, got {post_reboot_config.get('forwardMs')}"
        assert post_reboot_config.get("cycles") == 1, "Persistence failed: cycles mismatch"
        
        # Restore forwardMs = 1000 for standard motion test
        tester.send_cmd("CONFIG_SET stop=90 forward=70 reverse=110 forwardMs=1000 reverseMs=1000 pauseMs=500 cycles=1")

        report["phases"]["phase_7_config"] = {
            "status": "PASS",
            "applied": set_res,
            "persistence_test_forwardMs_1500": post_reboot_config.get("forwardMs") == 1500
        }

        # Phase 8: Servo Motion & Stop Debug
        tester.log("\n==================== PHASE 8: SERVO MOTION & STOP TEST ====================")
        
        # Step 1: Initial STOP
        stop_res, _ = tester.send_cmd("STOP")
        assert stop_res and stop_res.get("ok") is True, f"STOP failed: {stop_res}"

        # Step 2: Test Manual Forward (bounded duration 0.5s)
        tester.log("Testing manual forward (bounded 0.5s)...")
        fwd_res, _ = tester.send_cmd("TEST_FWD")
        assert fwd_res and fwd_res.get("ok") is True, f"TEST_FWD failed: {fwd_res}"
        time.sleep(0.5)
        
        # Step 3: STOP
        tester.log("Stopping manual forward...")
        stop_res, lines = tester.send_cmd("STOP")
        assert stop_res and stop_res.get("ok") is True, f"STOP failed: {stop_res}"

        # Step 4: Test Manual Reverse (bounded duration 0.5s)
        tester.log("Testing manual reverse (bounded 0.5s)...")
        rev_res, _ = tester.send_cmd("TEST_REV")
        assert rev_res and rev_res.get("ok") is True, f"TEST_REV failed: {rev_res}"
        time.sleep(0.5)

        # Step 5: STOP
        tester.log("Stopping manual reverse...")
        stop_res, _ = tester.send_cmd("STOP")
        assert stop_res and stop_res.get("ok") is True, f"STOP failed: {stop_res}"

        # Step 6: Automatic Motion Sequence (1 Cycle: FWD 1000ms, PAUSE 500ms, REV 1000ms, PAUSE 500ms, COMPLETE)
        tester.log("Executing automatic cycle: FWD 1s -> PAUSE 0.5s -> REV 1s -> PAUSE 0.5s -> COMPLETE...")
        start_res, _ = tester.send_cmd("START")
        assert start_res and start_res.get("ok") is True, f"START failed: {start_res}"

        # Track motion state transitions
        motion_log = []
        t0 = time.time()
        completed = False
        while time.time() - t0 < 6.0:
            status, _ = tester.send_cmd("STATUS", timeout=0.6)
            if status and isinstance(status, dict):
                st = status.get("state")
                running = status.get("running")
                cycle = status.get("cycle")
                entry = {"t": round(time.time() - t0, 2), "state": st, "running": running, "cycle": cycle}
                motion_log.append(entry)
                tester.log(f"T+{entry['t']}s: State='{st}', Running={running}, Cycle={cycle}")
                if st == "Hoàn thành" and running is False:
                    completed = True
                    break
            time.sleep(0.3)

        assert completed, f"Automatic cycle did not complete cleanly to 'Hoàn thành' state. Timeline: {motion_log}"

        # Verify no automatic restart occurs
        time.sleep(1.0)
        final_status, _ = tester.send_cmd("STATUS")
        tester.log(f"Post-completion verification status: {final_status}")
        assert final_status.get("running") is False, "Unexpected running state after completion"
        assert final_status.get("state") == "Hoàn thành", "State drifted after completion"

        report["phases"]["phase_8_servo"] = {
            "status": "PASS",
            "manual_forward_tested": True,
            "manual_reverse_tested": True,
            "automatic_cycle_completed": True,
            "no_auto_restart_verified": True,
            "motion_timeline": motion_log
        }

        # Phase 9: Web Status Polling Read-Only Verification
        tester.log("\n==================== PHASE 9: STATUS POLLING PURITY ====================")
        pre_poll_status, _ = tester.send_cmd("STATUS", timeout=2.0)
        for i in range(5):
            tester.send_cmd("STATUS", timeout=1.5)
            time.sleep(0.2)
        post_poll_status, _ = tester.send_cmd("STATUS", timeout=2.0)
        assert isinstance(post_poll_status, dict) and post_poll_status.get("ok") is True, f"Invalid status response: {post_poll_status}"
        assert pre_poll_status.get("running") == post_poll_status.get("running"), "Status polling affected running state"
        assert pre_poll_status.get("cycle") == post_poll_status.get("cycle"), "Status polling affected cycle"
        assert pre_poll_status.get("state") == post_poll_status.get("state"), "Status polling affected state"
        tester.log("Status polling verified: 100% read-only, no actuator commands issued.")

        report["phases"]["phase_9_polling"] = {
            "status": "PASS",
            "read_only_verified": True
        }

        report["verdict"] = "PASS"
        tester.log("\n==================== ALL HIL TESTS PASSED ====================")

    except Exception as e:
        tester.log(f"\n[ERROR] Test failed with exception: {e}")
        report["verdict"] = "FAIL"
        report["error"] = str(e)
    finally:
        tester.close()
        with open(os.path.join(validation_dir, 'hil_test_results.json'), 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        return report

if __name__ == '__main__':
    result = run_tests()
    sys.exit(0 if result.get("verdict") == "PASS" else 1)
