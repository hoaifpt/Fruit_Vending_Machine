# Fruit_Vending_Machine

## Local development broker

From the repository root, start Mosquitto:

```powershell
docker compose -f infra/docker-compose.yml up -d mosquitto
```

The broker listens on TCP port `1883` and allows anonymous connections for local development only. Keep this setup on a trusted network; add authentication and TLS before exposing it to an untrusted network.

- Backend on this PC: `tcp://localhost:1883`
- ESP32 on the same Wi-Fi/LAN: `APP_MQTT_HOST` must be this PC's LAN IPv4 address, found with `ipconfig`.

Stop the broker with:

```powershell
docker compose -f infra/docker-compose.yml down
```