#!/bin/sh
# Generates infra/mosquitto/config/passwd (ignored by Git) for the local broker from the root .env:
#   MQTT_USERNAME (default fvm-backend), MQTT_PASSWORD             -> backend account
#   MQTT_DEV_MACHINE_PASSWORD                                       -> sample machine account FV-DEV-001
# The .env file is read as data (never sourced). Passwords are hashed by mosquitto_passwd inside the official image.
# Usage (repository root, Git Bash/Linux/macOS): sh infra/mosquitto/generate-passwd.sh
set -eu

# Git Bash: use the Windows form (C:/...) because Docker Desktop cannot resolve MSYS paths such as /c/... or /tmp/....
ROOT=$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))
ENV_FILE="$ROOT/.env"
CONFIG_DIR="$ROOT/infra/mosquitto/config"
DEV_MACHINE=FV-DEV-001

value() {
    [ -f "$ENV_FILE" ] || return 0
    grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r'
}

BACKEND_USER=$(value MQTT_USERNAME)
BACKEND_USER=${BACKEND_USER:-fvm-backend}
BACKEND_PASSWORD=$(value MQTT_PASSWORD)
MACHINE_PASSWORD=$(value MQTT_DEV_MACHINE_PASSWORD)
if [ -z "$BACKEND_PASSWORD" ] || [ -z "$MACHINE_PASSWORD" ]; then
    echo "Set MQTT_PASSWORD and MQTT_DEV_MACHINE_PASSWORD in $ENV_FILE first." >&2
    exit 1
fi

# MSYS_NO_PATHCONV keeps Git Bash on Windows from rewriting the container paths.
MSYS_NO_PATHCONV=1 docker run --rm \
    -e BACKEND_USER="$BACKEND_USER" -e BACKEND_PASSWORD="$BACKEND_PASSWORD" \
    -e MACHINE_USER="$DEV_MACHINE" -e MACHINE_PASSWORD="$MACHINE_PASSWORD" \
    -v "$CONFIG_DIR:/work" eclipse-mosquitto:2 \
    sh -c 'rm -f /work/passwd && touch /work/passwd && chmod 0600 /work/passwd \
        && mosquitto_passwd -b /work/passwd "$BACKEND_USER" "$BACKEND_PASSWORD" \
        && mosquitto_passwd -b /work/passwd "$MACHINE_USER" "$MACHINE_PASSWORD" \
        && chown mosquitto:mosquitto /work/passwd'

echo "Wrote $CONFIG_DIR/passwd for accounts: $BACKEND_USER, $DEV_MACHINE (passwords not shown)."
