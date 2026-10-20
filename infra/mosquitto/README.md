# Local Mosquitto broker

Development broker for the inbound MQTT integration (issue #43): `compose.yaml`, `config/mosquitto.conf`,
`config/acl` and `generate-passwd.sh` (writes the ignored `config/passwd`).
Setup, `mosquitto_pub` examples and troubleshooting: [docs/mqtt-integration.md](../../docs/mqtt-integration.md).
Message contract: [api-contract/mqtt-contract.md](../../api-contract/mqtt-contract.md).
