$ErrorActionPreference = 'Stop'
$firmwareRoot = Split-Path $PSScriptRoot -Parent
$pythonExe = Join-Path $firmwareRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw 'Create firmware/.venv and install tools/requirements-build.txt first; see README.md.'
}
$env:PYTHONUTF8 = '1'
& $pythonExe -m unittest discover -s (Join-Path $firmwareRoot 'tests') -v
if ($LASTEXITCODE -ne 0) { throw 'Firmware regression checks failed.' }
& $pythonExe -m platformio run -d $firmwareRoot -e esp32dev -t clean
if ($LASTEXITCODE -ne 0) { throw 'PlatformIO clean failed.' }
& $pythonExe -m platformio run -d $firmwareRoot -e esp32dev
if ($LASTEXITCODE -ne 0) { throw 'ESP32 DevKit build failed.' }
# No upload, serial connection, backend call, or actuator command here.
