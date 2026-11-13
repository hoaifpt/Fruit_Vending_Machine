#!/usr/bin/env bash
# Adds or updates a broker account in infra/mosquitto/passwd (ignored by Git). Linux equivalent of add-user.ps1.
# Usage: ./infra/mosquitto/add-user.sh backend   or   ./infra/mosquitto/add-user.sh FV-DEV-001   (machine code)
# The password is read without echo and passed on stdin, so it never appears in the shell history or the process list.
set -euo pipefail
user="${1:?usage: add-user.sh <user>}"
[[ "$user" =~ ^[A-Za-z0-9_-]{1,64}$ ]] || { echo "User must be letters, digits, _ or - (machine code or backend)" >&2; exit 1; }
dir="$(cd "$(dirname "$0")" && pwd)"
read -r -s -p "Password for $user: " password; echo
read -r -s -p "Repeat: " again; echo
[ "$password" = "$again" ] || { echo "Passwords differ" >&2; exit 1; }
[ -n "$password" ] || { echo "Empty password" >&2; exit 1; }
touch "$dir/passwd"
# mosquitto_passwd without -b prompts twice on the terminal; feed both answers on stdin.
printf '%s\n%s\n' "$password" "$password" | docker run --rm -i -v "$dir:/work" eclipse-mosquitto:2.0.20 \
    sh -c "chmod 0600 /work/passwd && mosquitto_passwd /work/passwd '$user' >/dev/null && chown 1883:1883 /work/passwd"
unset password again
docker restart fruit-vending-mosquitto >/dev/null 2>&1 || true
echo "Account $user saved."
