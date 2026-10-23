"""Kiosk station worker: backend claim -> durable journal -> original ESP32 CLI.

No browser/ESP32 payment authority and no automatic motor retry. Runs separately
from the purchase UI on the kiosk computer. Never run alongside maintenance tools.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import time
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID

from hil_check import command, idle

ROOT = Path(__file__).resolve().parents[1]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a machine credential through a redirect.


class Backend:
    def __init__(self, base_url, key):
        self.base_url = base_url.rstrip("/") + "/api/v1/kiosk"
        self.key = key
        self.http = build_opener(NoRedirect())

    def call(self, method, path, body=None):
        payload = None if body is None else json.dumps(body).encode()
        req = Request(self.base_url + path, data=payload, method=method,
                      headers={"X-Kiosk-Key": self.key, "Accept": "application/json", "Content-Type": "application/json"})
        try:
            with self.http.open(req, timeout=8) as response:
                return json.load(response)["data"]
        except HTTPError as error:
            # Never print the request, key, token or provider response.
            raise RuntimeError(f"Backend HTTP {error.code}") from None


class Journal:
    """SQLite FULL sync commits BEFORE every irreversible action. Tokens stay local."""
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS dispatches (
            id TEXT PRIMARY KEY, phase TEXT NOT NULL, token TEXT, result TEXT, updated_at TEXT NOT NULL)""")
        self.db.commit()

    def save(self, identifier, phase, token=None, result=None):
        with self.db:
            self.db.execute("""INSERT INTO dispatches VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET phase=excluded.phase,
                token=coalesce(excluded.token,dispatches.token), result=coalesce(excluded.result,dispatches.result),
                updated_at=excluded.updated_at""", (identifier, phase, token,
                None if result is None else json.dumps(result), datetime.now(timezone.utc).isoformat()))

    def exists(self, identifier):
        return self.db.execute("SELECT 1 FROM dispatches WHERE id=?", (identifier,)).fetchone() is not None

    def recover(self):
        # Even CLAIMED may have reached the UART before a crash. Never replay it.
        with self.db:
            self.db.execute("UPDATE dispatches SET phase='UNKNOWN' WHERE phase IN ('CLAIMING','CLAIMED','DISPATCHING')")

    def outbox(self):
        return self.db.execute("SELECT id, token, result FROM dispatches WHERE phase='REPORT_PENDING' ORDER BY updated_at").fetchall()

    def unresolved(self):
        return self.db.execute("SELECT count(*) FROM dispatches WHERE phase='UNKNOWN'").fetchone()[0] != 0


class Station:
    def __init__(self, backend, device, journal, slots, timeout=90, sleep=time.sleep):
        self.backend, self.device, self.journal = backend, device, journal
        self.slots, self.timeout, self.sleep = slots, timeout, sleep

    def flush_reports(self):
        for identifier, token, raw in self.journal.outbox():
            self.backend.call("POST", f"/dispense-commands/{identifier}/results",
                              {"dispatchToken": token, **json.loads(raw)})
            self.journal.save(identifier, "REPORTED")

    def dispatch(self, item):
        identifier = str(UUID(item["id"]))
        column = self.slots.get(str(UUID(item["slotId"])))
        if column not in (1, 2):
            raise RuntimeError("Backend-assigned slot has no physical column mapping; no claim or motion")
        if self.journal.exists(identifier):
            return  # seen before, including ambiguous claims; never repeat physical dispatch
        if self.journal.unresolved():
            raise RuntimeError("Unresolved local dispatch; staff reconciliation required")
        config = command(self.device, "CONFIG")
        for index, pin in enumerate((18, 19, 21, 22), 1):
            if config[f"s{index}"]["pin"] != pin:
                raise RuntimeError("Unexpected board GPIO; no claim or motion")
        lower, upper = ((1, 2) if column == 1 else (3, 4))
        duration = sum(config[f"s{i}"][key] for i in (lower, upper)
                       for key in ("forwardMs", "reverseMs")) / 1000 + 1.5
        if duration + 5 >= self.timeout:
            raise RuntimeError("Calibrated motion exceeds station timeout; no claim or motion")
        before = command(self.device, "STATUS")
        if not idle(before) or before["ir"]["autoTrigger"] != 0 or before["ir"]["detected"]:
            raise RuntimeError("Station busy, IR blocked or auto-trigger enabled; no claim or motion")
        self.journal.save(identifier, "CLAIMING")
        try:
            claim = self.backend.call("POST", f"/dispense-commands/{identifier}/claim")
            token = claim["dispatchToken"]
            # Never substitute a different slot/order even if the claim response is unexpected.
            if claim["command"]["id"] != identifier or claim["command"]["slotId"] != item["slotId"]:
                raise RuntimeError("Claim response does not match queued command")
            self.journal.save(identifier, "CLAIMED", token)
        except Exception:
            self.journal.save(identifier, "UNKNOWN")
            raise
        baseline = before["ir"]["count"]
        self.journal.save(identifier, "DISPATCHING", token)
        result = {"status": "TIMEOUT"}
        try:
            command(self.device, f"DISPENSE {column}")  # ONE send only; original firmware protocol
            first = command(self.device, "STATUS")
            seen_running = first[f"col{column}"]["running"]
            try:
                self.backend.call("POST", f"/dispense-commands/{identifier}/results",
                                  {"dispatchToken": token, "status": "ACKNOWLEDGED"})
            except Exception:
                pass  # A lost network ACK must never trigger another motor command.
            deadline = time.monotonic() + self.timeout
            while time.monotonic() < deadline:
                state = command(self.device, "STATUS")
                seen_running |= state[f"col{column}"]["running"]
                if seen_running and idle(state):
                    closed = all(state[f"s{i}"]["state"] == "Da dong" for i in (lower, upper))
                    delta = state["ir"]["count"] - baseline
                    if closed and delta == 1 and not state["ir"]["detected"]:
                        result = {"status": "SUCCESS", "bowlCountBefore": baseline, "bowlCountAfter": state["ir"]["count"]}
                    else:
                        result = {"status": "FAILED"}
                    break
                self.sleep(0.1)
        except Exception:
            # A timeout or malformed reply means UNKNOWN, not proof that nothing fell.
            result = {"status": "TIMEOUT"}
        if result["status"] != "SUCCESS":
            try: command(self.device, "STOP")
            except Exception: pass
        self.journal.save(identifier, "REPORT_PENDING", token, result)
        self.flush_reports()  # Failure leaves a durable outbox; retry HTTP evidence only.

    def tick(self):
        self.flush_reports()
        if self.journal.unresolved():
            raise RuntimeError("Unresolved dispatch in journal; inspect physically, never clear and resend blindly")
        pending = self.backend.call("GET", "/dispense-commands")
        if pending:
            self.dispatch(pending[0])


def load_config(path):
    config = json.loads(path.read_text(encoding="utf-8"))
    if not config["backendUrl"].startswith(("http://", "https://")):
        raise ValueError("backendUrl must be an HTTP(S) origin")
    UUID(config["machineId"])
    slots = {str(UUID(slot)): column for slot, column in config["slots"].items()}
    if not slots or any(type(column) is not int or column not in (1, 2) for column in slots.values()) or len(set(slots.values())) != len(slots):
        raise ValueError("Configure explicit, unique slot UUID -> column 1/2 mappings")
    timeout = float(config.get("timeoutSeconds", 90))
    if timeout <= 0:
        raise ValueError("timeoutSeconds must be positive")
    return config, slots, timeout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--journal", type=Path, default=ROOT / ".local/dispense-journal.sqlite3")
    parser.add_argument("--enable-motion", action="store_true", help="Required for connecting USB and executing real paid dispatches")
    args = parser.parse_args()
    config, slots, timeout = load_config(args.config)
    key = os.environ.get("KIOSK_API_KEY", "")
    if not key:
        parser.error("KIOSK_API_KEY environment variable is required")
    backend = Backend(config["backendUrl"], key)
    me = backend.call("GET", "/me")
    if me["machineId"] != config["machineId"]:
        parser.error("Kiosk key does not belong to configured machine")
    if not args.enable_motion:
        print("Configuration and machine identity verified. USB NOT opened; motion disabled.")
        return
    import serial
    journal = Journal(args.journal.resolve())
    journal.recover()
    with serial.Serial(port=None, baudrate=115200, timeout=0.2, write_timeout=2) as device:
        device.dtr = False
        device.rts = False
        device.port = config.get("port", "COM4")
        device.open()
        time.sleep(2)
        station = Station(backend, device, journal, slots, timeout)
        while True:
            try: station.tick()
            except Exception as error:
                print(f"Station paused: {type(error).__name__}. Check backend, device and journal; no motor retry.")
            time.sleep(2)


if __name__ == "__main__":
    main()
