# TEST MATERIAL ONLY — MQTT TLS (issue #59)

Throw-away certificates for `MqttTlsIntegrationTest`. They protect nothing: the private keys are public in this repository on
purpose. Never use them, or the truststore password `test-only-truststore`, outside the tests.

| File | Content |
| --- | --- |
| `test-ca.pem` | test CA certificate (its key was discarded after signing) |
| `broker.pem` / `broker.key` | broker certificate chain for `localhost` / `127.0.0.1`, signed by the test CA |
| `wrong-host.pem` / `wrong-host.key` | certificate for `mqtt.wrong-host.invalid` only (hostname mismatch test), signed by the test CA |
| `untrusted-ca.pem` | an unrelated CA (untrusted CA test) |
| `truststore.p12` / `untrusted-truststore.p12` | PKCS12 truststores holding `test-ca.pem` / `untrusted-ca.pem` |

Regenerate with `./generate.sh` (openssl + JDK keytool). Validity: 100 years.
