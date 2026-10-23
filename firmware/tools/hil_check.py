"""Real-device smoke check; motion requires --exercise and an explicit --column.

Never reads payments, never authorizes a sale, never retries a dispense, and never
changes calibration/NVS. A sensor count is an observation, not a backend receipt.
"""
import argparse
import json
from pathlib import Path
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def command(device, value, timeout=3):
    device.reset_input_buffer()
    device.write((value + "\n").encode("ascii"))
    device.flush()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        line = device.readline().decode("utf-8", errors="replace").strip()
        if not line.startswith("[RES] "):
            continue
        payload = line[6:]
        if value == "PING":
            if payload != "PONG":
                raise RuntimeError("Unexpected PING response")
            return payload
        result = json.loads(payload)
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise RuntimeError(f"Device rejected {value}: {result}")
        return result
    raise TimeoutError(f"No response to {value}; do not blindly resend motion commands")


def idle(status):
    return all(status[key]["running"] is False for key in ("s1", "s2", "s3", "s4", "col1", "col2"))


def check(device, args, report):
    command(device, "PING")
    config = command(device, "CONFIG")
    report["config"] = config
    for index, pin in enumerate((18, 19, 21, 22), 1):
        if config[f"s{index}"]["pin"] != pin:
            raise RuntimeError(f"Unexpected servo {index} GPIO; stop and verify board/wiring")
    before = command(device, "STATUS")
    report["before"] = before
    if not idle(before):
        raise RuntimeError("Device already moving; no test command sent")
    if before["ir"]["autoTrigger"] != 0:
        raise RuntimeError("IR auto-trigger is enabled; confirm and disable via existing maintenance tools first")
    # Read-only means the tool only sends queries; opening USB may reset some boards.
    after = command(device, "STATUS")
    if not idle(after):
        raise RuntimeError("Motion started during read-only observation")
    if not args.exercise:
        report.update(after=after, result="PASS_READ_ONLY", physical_drop_verified=False)
        return
    expected_seconds = sum(config[f"s{i}"][key] for i in
                           ((1, 2) if args.column == 1 else (3, 4))
                           for key in ("forwardMs", "reverseMs")) / 1000 + 1.5
    if args.timeout < expected_seconds + 5:
        raise RuntimeError("Timeout too short for current calibration; increase --timeout, do not change servo timing")
    baseline = after["ir"]["count"]
    try:
        report["ack"] = command(device, f"DISPENSE {args.column}")  # exactly once
        seen_running = False
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            status = command(device, "STATUS")
            seen_running |= status[f"col{args.column}"]["running"]
            if seen_running and idle(status):
                report["after"] = status
                delta = status["ir"]["count"] - baseline
                report["ir_count_delta"] = delta
                if delta != 1:
                    raise RuntimeError(f"Motion ended but IR count changed by {delta}, expected exactly one bowl; inspect physically")
                report.update(result="PASS_MOTION_AND_IR_OBSERVATION", physical_drop_verified=False)
                return
            time.sleep(0.1)
        raise TimeoutError("FIFO did not finish; physical result unknown, no retry")
    except Exception:
        # STOP is the preserved all-servo clamp command, not a second dispense.
        try:
            command(device, "STOP")
            report["stop_sent_on_failure"] = True
        except Exception as stop_error:
            report["stop_error"] = str(stop_error)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True)
    parser.add_argument("--exercise", action="store_true", help="Physically move one FIFO column once")
    parser.add_argument("--column", type=int, choices=(1, 2))
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/validation/local-hil.json")
    args = parser.parse_args()
    if args.exercise != (args.column is not None):
        parser.error("--exercise and --column must be provided together")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    output = args.output.resolve()
    if not output.is_relative_to(ROOT):
        parser.error("Report output must stay inside firmware/")
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "port": args.port,
              "exercise": args.exercise, "column": args.column, "result": "FAIL"}
    try:
        import serial
        with serial.Serial(port=None, baudrate=115200, timeout=0.2, write_timeout=2) as device:
            device.dtr = False
            device.rts = False
            device.port = args.port
            device.open()
            time.sleep(2)  # allow boards that reset on open to reach READY
            check(device, args, report)
    except Exception as error:
        report["error"] = str(error)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["result"].startswith("PASS_") else 1


if __name__ == "__main__":
    raise SystemExit(main())
