"""One dispense cycle on real hardware, with the calibrated values: open 2000 us / close 1000 us for 600 ms per gate.

Expected sequence (lower gate = servo 1, upper gate = servo 2):
  OPENING_LOWER 600 ms -> HOLD_LOWER 700 ms -> CLOSING_LOWER 600 ms ->
  OPENING_UPPER 600 ms -> HOLD_UPPER 700 ms -> CLOSING_UPPER 600 ms -> DONE   (total about 3.8 s)

Usage (close the Serial Monitor first):
  python test/hw_one_cycle_test.py COM5 [commandId]
"""
import sys
import time
import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM5"
COMMAND_ID = sys.argv[2] if len(sys.argv) > 2 else "cycle-" + time.strftime("%H%M%S")
MOVE_MS, HOLD_MS = 600, 700
EXPECTED = [("OPENING_LOWER", MOVE_MS), ("HOLD_LOWER", HOLD_MS), ("CLOSING_LOWER", MOVE_MS),
            ("OPENING_UPPER", MOVE_MS), ("HOLD_UPPER", HOLD_MS), ("CLOSING_UPPER", MOVE_MS)]
TOTAL_MS = sum(ms for _, ms in EXPECTED)
TOLERANCE_MS = 250

ser = serial.Serial(PORT, 115200, timeout=0.02)
t0 = time.time()
buffer = b""
queue = []
results = []


def log(line):
    print(f"[{time.time() - t0:6.2f}s] {line}", flush=True)


def pump():
    global buffer
    chunk = ser.read(256)
    if chunk:
        buffer += chunk
        while b"\n" in buffer:
            raw, buffer = buffer.split(b"\n", 1)
            line = raw.decode("utf-8", "replace").strip()
            if line:
                queue.append((time.time(), line))


def next_line(prefixes, timeout):
    deadline = time.time() + timeout
    while True:
        while queue:
            at, line = queue.pop(0)
            log("<< " + line)
            if any(line.startswith(p) for p in prefixes):
                return at, line
        if time.time() >= deadline:
            return None, None
        pump()


def send(cmd, quiet=False):
    if not quiet:
        log(">> " + cmd)
    ser.write((cmd + "\n").encode())


def check(name, ok, detail=""):
    results.append((name, ok))
    log(("PASS " if ok else "FAIL ") + name + (" - " + detail if detail else ""))


# 1. Reset and wait for the firmware banner.
ser.dtr = False
ser.rts = True
time.sleep(0.1)
ser.rts = False
_, line = next_line(["READY"], 8)
check("board ready (firmware 0.3.0)", line is not None and "0.3.0" in line, line or "no READY")
time.sleep(0.3)
send("STATUS")
_, line = next_line(["STATE"], 2)
check("starts IDLE (both gates closed)", line == "STATE IDLE", line or "")

# 2. One cycle, polling STATUS every ~40 ms to time each phase.
print(f"\n--- DISPENSE {COMMAND_ID}: watch the gates (lower first, then upper) ---\n", flush=True)
start = time.time()
send(f"DISPENSE {COMMAND_ID}")
_, line = next_line(["ACK", "BUSY", "ERR"], 2)
check("command accepted", line == f"ACK {COMMAND_ID}", line or "")

phases = []          # [name, first_seen]
done_at = None
done_line = None
while time.time() - start < (TOTAL_MS + 3000) / 1000:
    send("STATUS", quiet=True)
    deadline = time.time() + 0.2
    while time.time() < deadline:
        pump()
        if not queue:
            continue
        at, text = queue.pop(0)
        if text.startswith("STATE"):
            name = text.split()[1]
            if name != "IDLE" and (not phases or phases[-1][0] != name):
                phases.append([name, at])
                log(f"   phase {name}")
            break
        if text.startswith("DONE"):
            done_at, done_line = at, text
            log("<< " + text)
            break
        log("<< " + text)
    if done_line:
        break
    time.sleep(0.04)

total_ms = (done_at - start) * 1000 if done_at else None
check("cycle finished OK", done_line == f"DONE {COMMAND_ID} OK", done_line or "no DONE")
check("phase order: lower opens, closes, then upper opens, closes",
      [p[0] for p in phases] == [name for name, _ in EXPECTED], " > ".join(p[0] for p in phases))
check(f"total time about {TOTAL_MS / 1000:.1f} s", total_ms is not None and abs(total_ms - TOTAL_MS) <= 2 * TOLERANCE_MS,
      f"{total_ms:.0f} ms" if total_ms else "")

# 3. Phase timeline (measured from the first time each phase was seen).
print("\n--- timeline ---")
boundaries = [p[1] for p in phases] + ([done_at] if done_at else [])
for i, (name, first) in enumerate(phases):
    measured = (boundaries[i + 1] - first) * 1000 if i + 1 < len(boundaries) else None
    expected = dict(EXPECTED).get(name)
    ok = measured is not None and expected is not None and abs(measured - expected) <= TOLERANCE_MS
    print(f"  {name:<14} expected {expected or 0:>4} ms  measured {measured or 0:>5.0f} ms  {'ok' if ok else 'CHECK'}")

send("STATUS")
_, line = next_line(["STATE"], 2)
check("back to IDLE (both gates closed)", line == "STATE IDLE", line or "")

ser.close()
passed = sum(1 for _, ok in results if ok)
print(f"\nRESULT: {passed}/{len(results)} checks passed")
print("Now confirm by eye: exactly ONE bowl fell out, the next bowl sits on the lower gate, both gates are closed.")
