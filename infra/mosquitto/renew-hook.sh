#!/usr/bin/env bash
# certbot deploy hook (issue #59): copies the renewed certificate for the broker and restarts it.
# Install: sudo install -m 0755 infra/mosquitto/renew-hook.sh /etc/letsencrypt/renewal-hooks/deploy/fruit-mqtt.sh
# certbot sets RENEWED_LINEAGE (e.g. /etc/letsencrypt/live/mqtt.<staging-domain>). Never print the key.
set -euo pipefail
lineage="${RENEWED_LINEAGE:?run by certbot as a deploy hook}"
target="${MQTT_CERT_DIR:-/etc/fruit-mqtt/certs}"
container="${MQTT_CONTAINER:-fruit-vending-mosquitto}"
# Only the broker's certificate; other certificates on the host (Caddy manages its own) are ignored.
case "$(basename "$lineage")" in mqtt.*) ;; *) exit 0 ;; esac

install -d -m 0750 -o 1883 -g 1883 "$target"
# uid/gid 1883 = the mosquitto user inside eclipse-mosquitto; the key is readable by it only.
install -m 0644 -o 1883 -g 1883 "$lineage/fullchain.pem" "$target/fullchain.pem.new"
install -m 0640 -o 1883 -g 1883 "$lineage/privkey.pem" "$target/privkey.pem.new"
mv -f "$target/fullchain.pem.new" "$target/fullchain.pem"
mv -f "$target/privkey.pem.new" "$target/privkey.pem"

# A restart reloads the listener certificate for sure; machines and the backend reconnect on their own within seconds.
docker restart "$container" >/dev/null
echo "Broker certificate for $(basename "$lineage") deployed; $container restarted."
