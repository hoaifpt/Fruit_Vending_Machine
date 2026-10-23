"""Migration regression checks against the exact imported, reviewed hardware code."""
from pathlib import Path
import ast
import hashlib
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "reference/import_manifest.json").read_text())
REFERENCE = ROOT / "reference/project-b" / (MANIFEST["source_sketch"] + ".txt")
ORIGINAL = REFERENCE.read_text(encoding="utf-8-sig")


class SourceParityTest(unittest.TestCase):
    def test_original_snapshot_has_recorded_hash(self):
        self.assertEqual(hashlib.sha256(REFERENCE.read_bytes()).hexdigest(), MANIFEST["source_sha256"])

    def test_every_migrated_function_body_matches_original(self):
        lines = ORIGINAL.splitlines(keepends=True)
        covered = []
        for path, metadata in MANIFEST["modules"].items():
            with self.subTest(module=path):
                expected = ""
                for start, end in metadata["ranges"]:
                    expected += "".join(lines[start:end])
                    covered.extend(range(start, end))
                # Only declaration syntax/include location changed, never function logic.
                signature = re.compile(r"^(?:String|bool|void) \w+\([^{};]*?\)\s*\{", re.M)
                expected = signature.sub(lambda m: m.group().replace(' = ""', ''), expected)
                expected = expected.replace('#include "web_ui.h"', '#include "transport/web_ui.h"')
                actual = (ROOT / path).read_text(encoding="utf-8")
                self.assertEqual(actual, '#include "core/runtime_api.hpp"\n\n' + expected)
        self.assertEqual(sorted(covered), list(range(253, len(lines))), "Missing or duplicated source lines")

    def test_gpio_map_unchanged(self):
        header = (ROOT / "include/config/board_pins.hpp").read_text(encoding="utf-8")
        self.assertEqual(header, "#pragma once\n" + "".join(ORIGINAL.splitlines(keepends=True)[:60]))
        for name, value in {"SERVO_1": 18, "SERVO_2": 19, "SERVO_3": 21, "SERVO_4": 22,
                            "IR_RECEIVER": 25, "IR_TRANSMITTER": 26}.items():
            self.assertRegex(header, rf"#define BOARD_{name}_PIN\s+{value}\b")

    def test_state_definitions_and_initialization_order_unchanged(self):
        prefix = "".join(ORIGINAL.splitlines(keepends=True)[60:253])
        declaration = re.compile(
            r"^(?:(?:Arduino_DataBus|Arduino_GFX)\s*\*|const char\s*\*|WebServer |Preferences |Servo |"
            r"bool |int |unsigned long |uint32_t |MotionState |ColumnDispenseState )\w+[^;]*;", re.M)
        entries = [(m.start(), m.group()) for m in declaration.finditer(prefix)]
        entries += [(m.start(), m.group()) for m in re.finditer(r"^#(?:if[^\n]*|else|endif)$", prefix, re.M)]
        expected = '#include "core/runtime_state.hpp"\n\n' + "\n".join(v for _, v in sorted(entries)) + "\n"
        self.assertEqual((ROOT / "src/core/runtime_state.cpp").read_text(encoding="utf-8"), expected)
        self.assertIn('CONFIG_SCHEMA_VERSION = 6;', (ROOT / "include/core/runtime_state.hpp").read_text())

    def test_support_assets_are_byte_identical(self):
        for path, checksum in MANIFEST["copied"].items():
            with self.subTest(path=path):
                self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), checksum)

    def test_python_tools_parse_without_running_hardware(self):
        for path in list((ROOT / "tools").rglob("*.py")) + list((ROOT / "reference/project-b/scripts").glob("*.py")):
            with self.subTest(path=path.name):
                ast.parse(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
