"""Reproducible, mechanical import. Does not change Project B or actuator logic.

Run only when deliberately re-importing a reviewed upstream revision. The committed
reference and manifest let verification run without access to the original checkout.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SKETCH = "ESP32_Control_Center_ServoStop_FIXED_v2.ino"
FUNCTION = re.compile(r"^(?:String|bool|void) \w+\([^{};]*?\)\s*\{", re.M)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(relative, content):
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def import_source(source):
    original = (source / SKETCH).read_bytes()
    expected_hash = "59f7aec11fea06c3942ef25dc323b414f21a424d05b832782ef1a664e0c50326"
    if digest(original) != expected_hash:
        raise ValueError("Unknown upstream sketch. Review module boundaries before importing a new hardware revision.")
    text = original.decode("utf-8-sig").replace("\r\n", "\n")
    lines = text.splitlines(keepends=True)
    manifest = {
        "source_commit": subprocess.check_output(
            ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
        ).strip(),
        "source_sketch": SKETCH,
        "source_sha256": digest(original),
        "modules": {},
        "copied": {},
    }
    reference = ROOT / "reference/project-b"
    reference.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / SKETCH, reference / (SKETCH + ".txt"))
    shutil.copyfile(source / "platformio.ini", reference / "platformio.ini.txt")

    # Board definitions remain verbatim, including legacy override macros.
    write("include/config/board_pins.hpp", "#pragma once\n" + "".join(lines[:60]))

    # Move definitions into one .cpp; expose the exact same types/macros via extern.
    # No inline-variable/C++17 migration and no change to initialization order.
    prefix = "".join(lines[60:253])
    global_declaration = re.compile(
        r"^(?:(?:Arduino_DataBus|Arduino_GFX)\s*\*|const char\s*\*|"
        r"WebServer |Preferences |Servo |bool |int |unsigned long |uint32_t |"
        r"MotionState |ColumnDispenseState )\w+[^;]*;", re.M
    )
    definitions = []

    def declare(match):
        definition = match.group()
        definitions.append((match.start(), definition))
        declaration = re.sub(r"\s*=.*;$", ";", definition, flags=re.S)
        declaration = re.sub(r"^(WebServer \w+)\([^;]*\);$", r"\1;", declaration)
        return "extern " + declaration

    declarations = global_declaration.sub(declare, prefix)
    write("include/core/runtime_state.hpp", '#pragma once\n#include "config/board_pins.hpp"\n' + declarations)
    conditionals = [(m.start(), m.group()) for m in re.finditer(r"^#(?:if[^\n]*|else|endif)$", prefix, re.M)]
    definition_text = "\n".join(value for _, value in sorted(definitions + conditionals))
    write("src/core/runtime_state.cpp", '#include "core/runtime_state.hpp"\n\n' + definition_text + "\n")

    signatures = [m.group()[:-1].strip() + ";" for m in FUNCTION.finditer(text)]
    write("include/core/runtime_api.hpp", '#pragma once\n#include "core/runtime_state.hpp"\n\n'
          '// Explicit declarations replace Arduino .ino auto-prototypes.\n' + "\n".join(signatures) + "\n")

    # Half-open original line ranges; code bodies are copied, not rewritten.
    modules = {
        "src/core/helpers.cpp": [(253, 362)],
        "src/display/display.cpp": [(362, 447)],
        "src/actuators/servo_control.cpp": [(447, 614)],
        "src/motion/motion.cpp": [(614, 868), (889, 1224), (1367, 1376)],
        "src/dispense/column_dispense.cpp": [(868, 889), (1224, 1367)],
        "src/sensors/ir_sensor.cpp": [(1376, 1447)],
        "src/storage/preferences_store.cpp": [(1447, 1633)],
        "src/transport/telemetry.cpp": [(1633, 1803)],
        "src/transport/http_server.cpp": [(1803, 2027)],
        "src/transport/wifi.cpp": [(2027, 2040)],
        "src/transport/serial_cli.cpp": [(2040, 2394)],
        "src/main.cpp": [(2394, len(lines))],
    }
    for path, ranges in modules.items():
        body = "".join("".join(lines[start:end]) for start, end in ranges)
        # C++ default parameters belong in the declaration, never in both places.
        body = FUNCTION.sub(lambda m: m.group().replace(' = ""', ''), body)
        body = body.replace('#include "web_ui.h"', '#include "transport/web_ui.h"')
        write(path, '#include "core/runtime_api.hpp"\n\n' + body)
        manifest["modules"][path] = {"ranges": ranges}

    copies = {"web_ui.h": "include/transport/web_ui.h", "server.py": "tools/control_center/server.py"}
    for directory in ("web", "scripts", "docs"):
        for path in (source / directory).rglob("*"):
            if path.is_file():
                relative = path.relative_to(source).as_posix()
                destination = ("tools/control_center/" + relative if directory == "web"
                               else "reference/project-b/" + relative)
                copies[relative] = destination
    for original_path, destination in copies.items():
        path = ROOT / destination
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / original_path, path)
        manifest["copied"][destination] = digest(path.read_bytes())
    write("reference/import_manifest.json", json.dumps(manifest, indent=2) + "\n")
    print(f"Imported {manifest['source_commit']}: {len(signatures)} functions, {len(definitions)} global definitions")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    import_source(parser.parse_args().source.resolve())
