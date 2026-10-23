"""Hardware test over USB Serial for firmware 0.3.0 (lower gate first, then upper gate)."""
import sys
import time
import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM5"
ser = serial.Serial(PORT, 115200, timeout=0.05)
t0 = time.time()
results = []
buffer = b""
queue = []


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
                log("<< " + line)
                queue.append(line)


def read_until(predicate, timeout):
    """Consume lines until predicate matches; unmatched lines are consumed too. Returns (match, lines)."""
    deadline = time.time() + timeout
    seen = []
    while True:
        while queue:
            line = queue.pop(0)
            seen.append(line)
            if predicate(line):
                return line, seen
        if time.time() >= deadline:
            return None, seen
        pump()


def send(cmd):
    log(">> " + cmd)
    ser.write((cmd + "\n").encode())


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    log(("PASS " if ok else "FAIL ") + name + (" - " + detail if detail else ""))


def reply(prefixes, timeout=2):
    line, _ = read_until(lambda l: any(l.startswith(p) for p in prefixes), timeout)
    return line


# Reset the board so we see READY.
ser.dtr = False
ser.rts = True
time.sleep(0.1)
ser.rts = False
line = reply(["READY"], 8)
check("boot READY 0.3.0", line is not None and "0.3.0" in line, line or "no READY line")

send("PING")
check("PING -> PONG", reply(["PONG"]) == "PONG")
send("STATUS")
line = reply(["STATE"])
check("STATUS idle", line == "STATE IDLE", line or "")

# Manual gate moves.
for gate, action in [("LOWER", "OPEN"), ("LOWER", "CLOSE"), ("UPPER", "OPEN"), ("UPPER", "CLOSE")]:
    send(f"GATE {gate} {action}")
    line = reply(["OK", "ERR"])
    check(f"GATE {gate} {action}", line == "OK GATE", line or "")
    time.sleep(0.6)
send("GATE MIDDLE OPEN")
line = reply(["ERR", "OK"])
check("GATE invalid rejected", line is not None and line.startswith("ERR USAGE"), line or "")
send("SERVO 5 1500 100")
line = reply(["ERR", "OK"])
check("SERVO invalid number rejected", line is not None and line.startswith("ERR RANGE"), line or "")

# One full cycle, timed.
start = time.time()
send("DISPENSE test-001")
line = reply(["ACK", "BUSY", "ERR"])
check("DISPENSE test-001 ACK", line == "ACK test-001", line or "")
done = reply(["DONE"], 6)
elapsed = time.time() - start
check("DISPENSE test-001 DONE OK", done == "DONE test-001 OK", f"{done} after {elapsed:.2f}s")
check("cycle duration ~2.6s", done is not None and 2.4 <= elapsed <= 3.4, f"{elapsed:.2f}s")

# Phase order: poll STATUS during a cycle.
send("DISPENSE order-001")
reply(["ACK"])
phases = []
finished = False
deadline = time.time() + 6
while time.time() < deadline and not finished:
    send("STATUS")
    line, seen = read_until(lambda l: l.startswith("STATE"), 1)
    finished = any(l.startswith("DONE order-001") for l in seen)
    if line and not finished:
        name = line.split()[1]
        if not phases or phases[-1] != name:
            phases.append(name)
    time.sleep(0.05)
if not finished:
    reply(["DONE order-001"], 3)
expected = ["OPENING_LOWER", "HOLD_LOWER", "CLOSING_LOWER", "OPENING_UPPER", "HOLD_UPPER", "CLOSING_UPPER"]
in_cycle = [p for p in phases if p in expected]
order_ok = in_cycle == sorted(in_cycle, key=expected.index) and "HOLD_LOWER" in in_cycle and "HOLD_UPPER" in in_cycle
check("phase order: lower opens/closes before upper", order_ok, " > ".join(phases))

# Idempotency and busy.
start = time.time()
send("DISPENSE test-001")
line = reply(["DONE", "ACK", "BUSY"])
check("repeat test-001 is idempotent", line == "DONE test-001 OK" and time.time() - start < 0.5, line or "")
send("STATUS")
line = reply(["STATE"])
check("repeat did not start a cycle", line == "STATE IDLE", line or "")
send("DISPENSE test-002")
send("DISPENSE test-003")
line = reply(["BUSY test-003"])
check("second command while busy -> BUSY", line is not None and "OPENING_LOWER" in line, line or "")
done = reply(["DONE test-002"], 6)
check("test-002 still completes", done == "DONE test-002 OK", done or "")

# Emergency stop -> FAULT -> RESET.
send("DISPENSE test-004")
reply(["ACK"])
time.sleep(0.15)
send("STOP")
_, seen = read_until(lambda l: l.startswith("DONE test-004"), 2)
check("STOP -> STOPPED", "STOPPED" in seen, str(seen))
check("STOP -> DONE test-004 ABORTED", "DONE test-004 ABORTED" in seen, str(seen))
send("STATUS")
line = reply(["STATE"])
check("after STOP state is FAULT", line == "STATE FAULT", line or "")
send("DISPENSE test-005")
line = reply(["BUSY", "ACK"])
check("FAULT blocks new dispense", line is not None and line.startswith("BUSY test-005 FAULT"), line or "")
send("GATE LOWER CLOSE")
line = reply(["OK", "ERR"])
check("manual GATE allowed in FAULT", line == "OK GATE", line or "")
time.sleep(0.6)
send("STATUS")
line = reply(["STATE"])
check("still FAULT after manual move", line == "STATE FAULT", line or "")
send("RESET")
check("RESET clears FAULT", reply(["RESET", "ERR"]) == "RESET OK")
send("RESET")
check("RESET when not faulted rejected", reply(["RESET", "ERR"]) == "ERR NOT_IN_FAULT")

# Invalid input.
send("DISPENSE bad id!")
check("invalid commandId rejected", reply(["ERR", "ACK"]) == "ERR INVALID_COMMAND_ID")
send("HELLO")
check("unknown command rejected", reply(["ERR"]) == "ERR UNKNOWN_COMMAND")

send("DISPENSE test-006")
done = reply(["DONE"], 6)
check("dispense works again after RESET", done == "DONE test-006 OK", done or "")

ser.close()
passed = sum(1 for _, ok, _ in results if ok)
print(f"\nRESULT: {passed}/{len(results)} checks passed")
for name, ok, detail in results:
    if not ok:
        print(f"  FAILED: {name} ({detail})")
