"""Isolated integration-test driver. Simulated UART only; NEVER opens a serial port.

Uses the real backend HTTP API and the real station worker/journal/CLI parser.
Only run against disposable test data with an already verified PAID order.
"""
import argparse
import json
import os
from pathlib import Path
import tempfile

from dispense_bridge import Backend, Journal, Station


class SimulatedController:
    def __init__(self):
        self.response = b""
        self.column = None
        self.phase = 0
        self.count = 10
        self.motor_commands = []

    def reset_input_buffer(self):
        self.response = b""

    def flush(self):
        pass

    def write(self, raw):
        value = raw.decode().strip()
        if value == "CONFIG":
            result = {"ok": True, **{f"s{i}": {"pin": pin, "forwardMs": 1000, "reverseMs": 1000}
                      for i, pin in enumerate((18, 19, 21, 22), 1)}}
        elif value.startswith("DISPENSE "):
            self.motor_commands.append(value)
            self.column = int(value.split()[1])
            self.phase = 1
            result = {"ok": True}
        elif value == "STATUS":
            running = self.phase == 1
            if self.phase == 2:
                self.count += 1
                self.phase = 0
            result = {"ok": True, "ir": {"count": self.count, "detected": False, "autoTrigger": 0}}
            result.update({name: {"running": running if name == f"col{self.column}" else False, "state": "Da dong"}
                           for name in ("s1", "s2", "s3", "s4", "col1", "col2")})
            if running:
                self.phase = 2
        elif value == "STOP":
            self.phase = 0
            result = {"ok": True}
        else:
            result = {"ok": False}
        self.response = ("[RES] " + json.dumps(result) + "\n").encode()

    def readline(self):
        response, self.response = self.response, b""
        return response


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-url", required=True)
    parser.add_argument("--machine-id", required=True)
    parser.add_argument("--slot-id", required=True)
    parser.add_argument("--column", type=int, choices=(1, 2), default=1)
    args = parser.parse_args()
    backend = Backend(args.backend_url, os.environ["KIOSK_API_KEY"])
    if backend.call("GET", "/me")["machineId"] != args.machine_id:
        raise RuntimeError("Wrong test machine")
    device = SimulatedController()
    with tempfile.TemporaryDirectory() as tmp:
        journal = Journal(Path(tmp) / "dispatch.sqlite3")
        try:
            station = Station(backend, device, journal, {args.slot_id: args.column}, sleep=lambda _: None)
            station.tick()
            station.tick()  # successful dispatch must not be replayed
            if device.motor_commands != [f"DISPENSE {args.column}"] or journal.outbox():
                raise RuntimeError("Simulation did not complete exactly one reported command")
            print(json.dumps({"simulation": True, "usbOpened": False, "motorCommands": device.motor_commands, "bowlCount": device.count}))
        finally:
            journal.db.close()


if __name__ == "__main__":
    main()
