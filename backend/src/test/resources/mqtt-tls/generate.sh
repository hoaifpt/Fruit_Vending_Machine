#!/usr/bin/env bash
# TEST MATERIAL ONLY (issue #59). Regenerates the throw-away CAs, broker certificates and truststores used by MqttTlsIntegrationTest.
# Nothing here is used outside the tests; never reuse these keys or passwords anywhere else.
# Usage (from this directory, needs openssl and a JDK keytool): ./generate.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")"
DAYS=36500
PASS=test-only-truststore
work=.work-$$
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT

ca() { # name subject
    openssl req -x509 -newkey rsa:2048 -nodes -days "$DAYS" -subj "/CN=$2" -keyout "$work/$1.key" -out "$1.pem" \
        -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
}
server() { # name san
    openssl req -newkey rsa:2048 -nodes -subj "/CN=test-broker" -keyout "$1.key" -out "$work/$1.csr"
    printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$2" > "$work/$1.ext"
    openssl x509 -req -in "$work/$1.csr" -CA test-ca.pem -CAkey "$work/test-ca.key" -CAcreateserial -days "$DAYS" -extfile "$work/$1.ext" -out "$work/$1.crt"
    cat "$work/$1.crt" test-ca.pem > "$1.pem"
}

ca test-ca "Fruit Machine TEST-ONLY MQTT CA"
ca untrusted-ca "Fruit Machine TEST-ONLY untrusted CA"
server broker "DNS:localhost,IP:127.0.0.1"
server wrong-host "DNS:mqtt.wrong-host.invalid"
rm -f truststore.p12 untrusted-truststore.p12
keytool -importcert -noprompt -storetype PKCS12 -keystore truststore.p12 -storepass "$PASS" -alias test-ca -file test-ca.pem
keytool -importcert -noprompt -storetype PKCS12 -keystore untrusted-truststore.p12 -storepass "$PASS" -alias untrusted-ca -file untrusted-ca.pem
rm -f test-ca.srl
echo "done"
