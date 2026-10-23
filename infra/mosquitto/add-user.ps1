# Adds or updates a broker account in infra/mosquitto/passwd (ignored by Git).
# Usage: ./infra/mosquitto/add-user.ps1 backend   or   ./infra/mosquitto/add-user.ps1 M1   (machine code)
param([Parameter(Mandatory = $true)][string]$User)
$dir = $PSScriptRoot
$secure = Read-Host "Password for $User" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not (Test-Path "$dir/passwd")) { New-Item -ItemType File "$dir/passwd" | Out-Null }
docker run --rm -v "${dir}:/work" eclipse-mosquitto:2.0.20 mosquitto_passwd -b /work/passwd $User $plain
docker restart fruit-vending-mosquitto 2>$null | Out-Null
Write-Host "Account $User saved."
