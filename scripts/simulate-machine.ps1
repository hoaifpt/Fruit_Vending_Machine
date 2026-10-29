# Simulated ESP32 for testing the purchase flow without hardware (docs/mqtt-dispense.md).
# Listens on vending/<code>/commands through the local broker container and answers every DISPENSE with
# DISPENSE_ACCEPTED, then DISPENSE_COMPLETED (or DISPENSE_ABORTED with -Fail) after the cycle time.
# Usage: ./scripts/simulate-machine.ps1 -MachineCode M1        (asks for the machine's broker password)
param(
    [Parameter(Mandatory = $true)][string]$MachineCode,
    [int]$CycleSeconds = 3,
    [switch]$Fail
)
$secure = Read-Host "Broker password for $MachineCode" -AsSecureString
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$result = if ($Fail) { 'DISPENSE_ABORTED' } else { 'DISPENSE_COMPLETED' }
$script = @'
event() {
  mosquitto_pub -u "$CODE" -P "$PW" -q 1 -t "vending/$CODE/events" \
    -m "{\"schemaVersion\":1,\"messageId\":\"sim-$(date +%s%N)\",\"machineCode\":\"$CODE\",\"payload\":{\"eventType\":\"$1\",\"details\":{\"commandId\":\"$2\"}}}"
}
echo "Simulated machine $CODE listening on vending/$CODE/commands"
mosquitto_sub -u "$CODE" -P "$PW" -q 1 -t "vending/$CODE/commands" | while read -r msg; do
  id=$(echo "$msg" | sed -n 's/.*"commandId":"\([A-Za-z0-9_-]*\)".*/\1/p')
  [ -z "$id" ] && continue
  if grep -qx "$id" /tmp/done-$CODE 2>/dev/null; then echo "repeat $id: answer again"; event "$RESULT" "$id"; continue; fi
  echo "DISPENSE $id"; event DISPENSE_ACCEPTED "$id"
  sleep "$CYCLE"; echo "$id" >> /tmp/done-$CODE; event "$RESULT" "$id"; echo "$RESULT $id"
done
'@
docker exec -i -e CODE=$MachineCode -e PW=$password -e CYCLE=$CycleSeconds -e RESULT=$result fruit-vending-mosquitto sh -c $script
