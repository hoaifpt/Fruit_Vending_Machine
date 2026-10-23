"""Exercise the real-device test runner's failure behavior without opening USB."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("hil_check", Path(__file__).resolve().parents[1] / "tools/hil_check.py")
HIL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HIL)


def status(count=3, moving=None, auto=0):
    value = {"ok": True, "ir": {"count": count, "autoTrigger": auto}}
    value.update({key: {"running": key == moving} for key in ("s1", "s2", "s3", "s4", "col1", "col2")})
    return value


def config():
    return {f"s{i}": {"pin": pin, "forwardMs": 1000, "reverseMs": 1000}
            for i, pin in enumerate((18, 19, 21, 22), 1)}


class HilRunnerTest(unittest.TestCase):
    def args(self, exercise=False, column=None, timeout=60):
        return SimpleNamespace(exercise=exercise, column=column, timeout=timeout)

    def run_case(self, responses, args):
        report = {}
        commands = []
        def respond(device, cmd):
            commands.append(cmd)
            result = next(responses)
            if isinstance(result, Exception):
                raise result
            return result
        with patch.object(HIL, "command", side_effect=respond), patch.object(HIL.time, "sleep"):
            HIL.check(object(), args, report)
        return report, commands

    def test_read_only_never_sends_motion(self):
        report, commands = self.run_case(iter(["PONG", config(), status(), status()]), self.args())
        self.assertEqual(commands, ["PING", "CONFIG", "STATUS", "STATUS"])
        self.assertEqual(report["result"], "PASS_READ_ONLY")
        self.assertFalse(report["physical_drop_verified"])

    def test_both_columns_send_exactly_one_dispense(self):
        for column in (1, 2):
            with self.subTest(column=column):
                responses = iter(["PONG", config(), status(), status(), {"ok": True},
                                  status(moving=f"col{column}"), status(count=4)])
                report, commands = self.run_case(responses, self.args(True, column))
                self.assertEqual(commands.count(f"DISPENSE {column}"), 1)
                self.assertEqual(report["ir_count_delta"], 1)

    def test_busy_machine_is_rejected_without_motion(self):
        with patch.object(HIL, "command", side_effect=["PONG", config(), status(moving="s3")]) as call:
            with self.assertRaisesRegex(RuntimeError, "already moving"):
                HIL.check(object(), self.args(True, 1), {})
            self.assertEqual([c.args[1] for c in call.call_args_list], ["PING", "CONFIG", "STATUS"])

    def test_ir_auto_trigger_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "auto-trigger"):
            self.run_case(iter(["PONG", config(), status(auto=4)]), self.args(True, 1))

    def test_wrong_gpio_is_rejected(self):
        wrong = config()
        wrong["s1"]["pin"] = 1
        with self.assertRaisesRegex(RuntimeError, "GPIO"):
            self.run_case(iter(["PONG", wrong]), self.args(True, 1))

    def test_too_short_timeout_never_starts_motion(self):
        with self.assertRaisesRegex(RuntimeError, "Timeout too short"):
            self.run_case(iter(["PONG", config(), status(), status()]), self.args(True, 1, 1))

    def test_ack_timeout_stops_without_repeating_dispense(self):
        responses = ["PONG", config(), status(), status(), TimeoutError("ACK lost"), {"ok": True}]
        with patch.object(HIL, "command", side_effect=responses) as call:
            with self.assertRaisesRegex(TimeoutError, "ACK lost"):
                HIL.check(object(), self.args(True, 1), {})
            commands = [c.args[1] for c in call.call_args_list]
            self.assertEqual(commands.count("DISPENSE 1"), 1)
            self.assertEqual(commands[-1], "STOP")

    def test_motion_without_sensor_confirmation_fails_and_stops(self):
        responses = ["PONG", config(), status(), status(), {"ok": True}, status(moving="col1"), status(), {"ok": True}]
        with patch.object(HIL, "command", side_effect=responses) as call, patch.object(HIL.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "IR count changed by 0"):
                HIL.check(object(), self.args(True, 1), {})
            commands = [c.args[1] for c in call.call_args_list]
            self.assertEqual(commands.count("DISPENSE 1"), 1)
            self.assertEqual(commands[-1], "STOP")


if __name__ == "__main__":
    unittest.main()
