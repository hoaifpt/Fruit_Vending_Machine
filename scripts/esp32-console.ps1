# Minimal serial console for the ESP32 firmware (no Python/PlatformIO needed).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\esp32-console.ps1 [-Port COM5]
# Type a command (PING, STATUS, SERVO 1 2000 2000, GATE LOWER OPEN, DISPENSE test-001, STOP, RESET) and press Enter.
# Type EXIT to quit.
param([string]$Port = 'COM5', [int]$Baud = 115200)

$serial = New-Object System.IO.Ports.SerialPort $Port, $Baud, 'None', 8, 'One'
$serial.NewLine = "`n"
$serial.ReadTimeout = 200
$serial.DtrEnable = $false
$serial.RtsEnable = $false
try {
    $serial.Open()
} catch {
    Write-Host "Cannot open $Port. Close any other program using it (serial monitor, Arduino IDE) and try again." -ForegroundColor Red
    exit 1
}
Write-Host "Connected to $Port at $Baud baud. Type a command, or EXIT to quit." -ForegroundColor Green

function Show-Replies([int]$Milliseconds) {
    $end = (Get-Date).AddMilliseconds($Milliseconds)
    while ((Get-Date) -lt $end) {
        try { $line = $serial.ReadLine().Trim(); if ($line) { Write-Host "< $line" -ForegroundColor Cyan } } catch [System.TimeoutException] { }
    }
}

try {
    Show-Replies 500
    while ($true) {
        $command = Read-Host '>'
        if ($command -eq 'EXIT') { break }
        if ($command.Trim()) { $serial.WriteLine($command.Trim()) }
        # DISPENSE takes about 3 seconds; wait long enough to see ACK and DONE.
        Show-Replies $(if ($command -match '^(DISPENSE|SERVO|GATE)') { 4000 } else { 1000 })
    }
} finally {
    $serial.Close()
}
