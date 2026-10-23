"""No USB and no external backend: exercise dispatch crash boundaries and HTTP outbox."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
SPEC = importlib.util.spec_from_file_location("dispense_bridge", TOOLS / "dispense_bridge.py")
BRIDGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BRIDGE)
ID = "11111111-1111-4111-8111-111111111111"
SLOT = "22222222-2222-4222-8222-222222222222"
TOKEN = "33333333-3333-4333-8333-333333333333"
ITEM = {"id": ID, "slotId": SLOT}


class Api:
    def __init__(self):
        self.calls = []
        self.lost_claim = False
        self.lost_result = False

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path.endswith("/claim"):
            if self.lost_claim:
                raise TimeoutError("lost claim")
            return {"command": ITEM, "dispatchToken": TOKEN}
        if path.endswith("/results"):
            if body["status"] == "SUCCESS" and self.lost_result:
                raise TimeoutError("result delivery failed")
            return {}
        return []


def status(count=10, moving=False):
    state = {"ok": True, "ir": {"count": count, "autoTrigger": 0, "detected": False}}
    state.update({name: {"running": moving if name == "col1" else False, "state": "Da dong"}
                  for name in ("s1", "s2", "s3", "s4", "col1", "col2")})
    return state


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.journal = BRIDGE.Journal(Path(self.tmp.name) / "journal.sqlite3")
        self.api = Api()
        self.station = BRIDGE.Station(self.api, object(), self.journal, {SLOT: 1}, sleep=lambda _: None)
        self.commands = []
        self.responses = iter([status(), status(moving=True), status(count=11)])

    def tearDown(self):
        self.journal.db.close()
        self.tmp.cleanup()

    def serial(self, device, value):
        self.commands.append(value)
        if value == "CONFIG":
            return {f"s{i}": {"pin": pin, "forwardMs": 1000, "reverseMs": 1000}
                    for i, pin in enumerate((18, 19, 21, 22), 1)}
        if value == "STATUS":
            return next(self.responses)
        return {"ok": True}

    def test_success_uses_backend_assigned_slot_and_sends_once(self):
        with patch.object(BRIDGE, "command", side_effect=self.serial):
            self.station.dispatch(ITEM)
            self.station.dispatch(ITEM)
        self.assertEqual(self.commands.count("DISPENSE 1"), 1)
        result = self.api.calls[-1][2]
        self.assertEqual(result, {"dispatchToken": TOKEN, "status": "SUCCESS", "bowlCountBefore": 10, "bowlCountAfter": 11})
        self.assertEqual(self.journal.outbox(), [])

    def test_network_retry_sends_only_terminal_http_evidence_never_motor(self):
        self.api.lost_result = True
        with patch.object(BRIDGE, "command", side_effect=self.serial):
            with self.assertRaises(TimeoutError): self.station.dispatch(ITEM)
            self.assertEqual(len(self.journal.outbox()), 1)
            self.api.lost_result = False
            self.station.tick()
        self.assertEqual(self.commands.count("DISPENSE 1"), 1)
        self.assertEqual(self.journal.outbox(), [])

    def test_lost_claim_never_sends_motion_or_reclaims(self):
        self.api.lost_claim = True
        with patch.object(BRIDGE, "command", side_effect=self.serial):
            with self.assertRaises(TimeoutError): self.station.dispatch(ITEM)
            self.station.dispatch(ITEM)
        self.assertNotIn("DISPENSE 1", self.commands)
        self.assertTrue(self.journal.unresolved())
        self.assertEqual(sum(path.endswith("/claim") for _, path, _ in self.api.calls), 1)

    def test_crash_boundaries_are_unknown_and_never_replayed(self):
        for phase in ("CLAIMING", "CLAIMED", "DISPATCHING"):
            self.journal.save(ID, phase, TOKEN)
            self.journal.recover()
            self.assertTrue(self.journal.unresolved())
            with patch.object(BRIDGE, "command") as serial:
                self.station.dispatch(ITEM)
                serial.assert_not_called()

    def test_unknown_mapping_does_not_claim_or_move(self):
        self.station.slots = {}
        with patch.object(BRIDGE, "command") as serial:
            with self.assertRaisesRegex(RuntimeError, "mapping"): self.station.dispatch(ITEM)
            serial.assert_not_called()
        self.assertEqual(self.api.calls, [])

    def test_busy_or_blocked_sensor_prevents_dispatch(self):
        busy = status(moving=True)
        self.responses = iter([busy])
        with patch.object(BRIDGE, "command", side_effect=self.serial):
            with self.assertRaisesRegex(RuntimeError, "busy"): self.station.dispatch(ITEM)
        self.assertEqual(self.api.calls, [])

    def test_missing_bowl_or_unclosed_gates_is_not_success(self):
        self.responses = iter([status(), status(moving=True), status(count=10)])
        with patch.object(BRIDGE, "command", side_effect=self.serial):
            self.station.dispatch(ITEM)
        self.assertEqual(self.commands.count("DISPENSE 1"), 1)
        self.assertIn("STOP", self.commands)
        self.assertEqual(self.api.calls[-1][2]["status"], "FAILED")

    def test_serial_ack_loss_reports_timeout_without_resend(self):
        def lost(device, value):
            if value.startswith("DISPENSE "):
                self.commands.append(value)
                raise TimeoutError("ACK lost")
            return self.serial(device, value)
        with patch.object(BRIDGE, "command", side_effect=lost):
            self.station.dispatch(ITEM)
        self.assertEqual(self.commands.count("DISPENSE 1"), 1)
        self.assertIn("STOP", self.commands)
        self.assertEqual(self.api.calls[-1][2]["status"], "TIMEOUT")


if __name__ == "__main__":
    unittest.main()
