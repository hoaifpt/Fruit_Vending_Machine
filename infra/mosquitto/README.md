# Mosquitto broker

Broker MQTT giữa backend và máy bán hàng. Hợp đồng tin nhắn, topic, ACL và kết nối: [api-contract/mqtt-contract.md](../../api-contract/mqtt-contract.md).

| Môi trường | File cấu hình | Cổng | Mã hóa |
| --- | --- | --- | --- |
| Local (dev) | `mosquitto.conf` | 1883 | không — chỉ dùng trong LAN tin cậy |
| Staging (issue #59) | `mosquitto.staging.conf` + `../docker-compose.staging.yml` | 8883 | TLS 1.2+ (1883 chỉ trong container) |

File chung: `acl` (mỗi máy chỉ đọc lệnh và ghi `events`, `status`, `heartbeat`, `telemetry` của chính nó; tài khoản `backend` đọc/ghi
`vending/#`) và `passwd` (do `add-user.*` tạo, **không** đưa lên Git).

## Local

```powershell
docker compose -f infra/docker-compose.yml up -d
./infra/mosquitto/add-user.ps1 backend
./infra/mosquitto/add-user.ps1 FV-DEV-001      # username = mã máy
```

Backend: `MQTT_ENABLED=true`, `MQTT_BROKER_URL=tcp://127.0.0.1:1883`, `MQTT_USERNAME=backend`, `MQTT_PASSWORD` trong `.env` (bị Git bỏ qua).

## Staging: MQTT qua TLS

```text
ESP32 ──TLS 8883──┐
                  ├──> Mosquitto (staging) ── chứng chỉ Let's Encrypt cho mqtt.<staging-domain>
Backend ──TLS─────┘
1883 chỉ lắng nghe 127.0.0.1 bên trong container, không publish ra host
```

### Lựa chọn chứng chỉ

Đã chọn **Let's Encrypt** cho `mqtt.<staging-domain>`: JVM tin sẵn (không cần truststore), ESP32 nhúng **ISRG Root X1** (hết hạn
2035) thay vì chứng chỉ lá, nên gia hạn 90 ngày không phải nạp lại firmware. Phương án dự phòng (không có tên miền) ở cuối trang.

### 1. DNS và chứng chỉ

```bash
# DNS: bản ghi A mqtt.<staging-domain> → IP của host staging (cùng host đã có tên miền cho webhook payOS).
sudo apt install certbot
# Standalone cần cổng 80 trống trong lúc cấp; Caddy đang giữ 80 thì dừng Caddy tạm thời hoặc dùng DNS challenge (--preferred-challenges dns).
sudo certbot certonly --standalone -d mqtt.<staging-domain> --agree-tos -m <email-vận-hành> --no-eff-email

# Hook triển khai: chép fullchain.pem + privkey.pem sang /etc/fruit-mqtt/certs (uid 1883, key 0640) rồi khởi động lại broker.
sudo install -m 0755 infra/mosquitto/renew-hook.sh /etc/letsencrypt/renewal-hooks/deploy/fruit-mqtt.sh
sudo RENEWED_LINEAGE=/etc/letsencrypt/live/mqtt.<staging-domain> /etc/letsencrypt/renewal-hooks/deploy/fruit-mqtt.sh
```

`certbot` tự gia hạn (systemd timer) và chạy hook sau mỗi lần gia hạn thành công. Hook chỉ xử lý lineage `mqtt.*`, không in khóa.
Private key không bao giờ vào Git, log hay CI. Hết hạn chứng chỉ chưa có cảnh báo tự động: kiểm tra tay
`sudo certbot certificates` (ngoài phạm vi #59).

### 2. Tài khoản broker

```bash
./infra/mosquitto/add-user.sh backend
./infra/mosquitto/add-user.sh FV-DEV-001       # một tài khoản, một mật khẩu riêng cho mỗi máy; username = mã máy
```

Mật khẩu được hỏi không hiện chữ và truyền qua stdin (không nằm trong lịch sử shell hay danh sách tiến trình). Khi chuyển sang TLS,
đổi mật khẩu của mọi tài khoản một lần (chúng đã từng đi qua mạng ở dạng rõ).

### 3. Chạy broker

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.staging.yml up -d
# Kiểm tra nội bộ (cổng 1883 chỉ trong container):
docker exec fruit-vending-mosquitto mosquitto_sub -h 127.0.0.1 -p 1883 -u backend -P '<mật khẩu>' -t '$SYS/broker/version' -C 1
```

Override dùng `ports: !override` (Docker Compose 2.24+) để **chỉ** publish 8883. Log đi ra stderr (`docker logs`), có dòng kết nối.

### 4. Firewall

```bash
sudo ufw allow 8883/tcp
sudo ufw deny 1883/tcp
```

Nếu dùng security group / firewall của nhà cung cấp cloud (infra/terraform): mở 8883/tcp vào, không mở 1883.

### 5. Backend

```text
SPRING_PROFILES_ACTIVE=prod,staging          # application-staging.yaml: app.mqtt.require-tls=true
MQTT_ENABLED=true
MQTT_BROKER_URL=ssl://mqtt.<staging-domain>:8883
MQTT_REQUIRE_TLS=true
MQTT_USERNAME=backend
MQTT_PASSWORD=<secret, chỉ trong .env>
MQTT_TRUSTSTORE_PATH=                        # để trống với Let's Encrypt
MQTT_TRUSTSTORE_PASSWORD=
```

- `require-tls` + URL không phải `ssl://` → backend dừng ngay khi khởi động (thông báo rõ, không lộ bí mật).
- `ssl://` → TLS 1.2/1.3, **kiểm tra hostname** (URL phải là tên `mqtt.<staging-domain>`, không phải IP).
- Lỗi chứng chỉ / handshake → log WARN `MQTT TLS connection to ssl://… failed: <lý do>`, vòng thử lại (5 s) vẫn chạy.
- Kết nối thành công → log `MQTT connected to ssl://…`.

### 6. Kiểm tra tay trên staging (ghi kết quả vào PR)

```text
openssl s_client -connect mqtt.<domain>:8883 -servername mqtt.<domain>      → chuỗi hợp lệ, TLSv1.2/1.3
mosquitto_pub --cafile isrgrootx1.pem -h mqtt.<domain> -p 8883 -u <máy> -P … -t vending/<máy>/status -m '…'   → nhận; sai mật khẩu → từ chối
nc -vz <ip-staging> 1883 từ ngoài host                                        → refused / filtered
tài khoản máy publish vào topic của máy khác                                  → bị ACL chặn
log backend                                                                   → "MQTT connected to ssl://mqtt.<domain>:8883"
ESP32 (khi firmware xong) kết nối 8883; một đơn hàng nhả hàng đầu-cuối
Wireshark                                                                     → không đọc được payload hay mật khẩu
sudo certbot renew --dry-run                                                  → hook chạy, broker vẫn phục vụ chứng chỉ mới
```

## Firmware (bàn giao cho người phụ trách firmware, chưa làm trong #59)

```text
WiFiClientSecure thay WiFiClient
setCACert(<ISRG Root X1 PEM>)          — hoặc CA riêng nếu dùng phương án dự phòng
host = mqtt.<staging-domain>            (tên, không phải IP: hostname phải khớp chứng chỉ)
port = 8883
đồng bộ giờ NTP trước khi kết nối      (kiểm tra hạn chứng chỉ cần giờ hiện tại)
không bao giờ setInsecure() trong bản build staging
mật khẩu vẫn ở build flag / NVS (secrets.h bị Git bỏ qua), không commit
```

## Phương án dự phòng: CA riêng (khi không có tên miền)

```bash
# Một lần, trên máy tin cậy; giữ ca.key ngoài Git và ngoài host broker.
openssl req -x509 -newkey rsa:4096 -nodes -days 3650 -subj "/CN=Fruit Machine MQTT CA" -keyout ca.key -out ca.pem
openssl req -newkey rsa:2048 -nodes -subj "/CN=mqtt.<host>" -keyout privkey.pem -out broker.csr
printf 'subjectAltName=DNS:mqtt.<host>\nextendedKeyUsage=serverAuth\n' > broker.ext
openssl x509 -req -in broker.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 825 -extfile broker.ext -out broker.pem
cat broker.pem ca.pem > fullchain.pem      # fullchain.pem + privkey.pem → /etc/fruit-mqtt/certs (uid 1883, key 0640)
keytool -importcert -noprompt -storetype PKCS12 -keystore mqtt-truststore.p12 -alias fruit-mqtt-ca -file ca.pem
```

Backend: `MQTT_TRUSTSTORE_PATH=<đường dẫn mqtt-truststore.p12 được mount vào container>`, `MQTT_TRUSTSTORE_PASSWORD` trong `.env`.
Firmware: `setCACert(<ca.pem>)`. Chứng chỉ broker hết hạn phải tự cấp lại (không có certbot); CA đổi thì phải nạp lại firmware.
