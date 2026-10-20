# Lắp đặt máy mới (machine onboarding)

Checklist đưa một máy vật lý mới vào hoạt động với backend: đăng ký máy, cấp key kiosk, tạo tài khoản MQTT, cấu hình
firmware và kiểm tra. Tài liệu này chỉ nối các bước lại với nhau; chi tiết từng API nằm ở các tài liệu được dẫn link.
Ví dụ dùng mã máy giả `FV-HCM-001` và không chứa secret thật.

## Máy kết nối với backend thế nào

```text
ESP32 ──MQTT: telemetry / status / events──> Mosquitto ──> Backend          (chỉ chiều máy -> backend)
ESP32 <──Serial/USB── Ứng dụng kiosk ──HTTPS + X-Kiosk-Key──> Backend      (catalog, đơn hàng, thanh toán)
```

- MQTT chỉ mang telemetry, status và events. Backend không publish gì tới máy; **dispense không đi qua MQTT**
  ([mqtt-contract.md](../api-contract/mqtt-contract.md)).
- Kiosk xác thực bằng API key gắn với máy, không dùng tài khoản user ([order-management.md](order-management.md)).
- Một máy có ba loại credential độc lập, mỗi loại thu hồi riêng được:

| Credential | Ai giữ | Cấp ở đâu | Dùng cho |
| --- | --- | --- | --- |
| Kiosk API key `fvk_<prefix>_<secret>` | ứng dụng kiosk | backend, `POST .../kiosk-credentials` | `/api/v1/kiosk/**` |
| Tài khoản MQTT (username = mã máy) | firmware ESP32 | broker, `mosquitto_passwd` | publish `vending/{mã máy}/*` |
| Tài khoản MQTT `fvm-backend` | backend | broker, một lần cho cả hệ thống | subscribe |

Không commit secret nào vào Git, không dùng chung secret giữa các máy, và không gửi secret qua chat nhóm.

## Chuẩn bị (một lần cho cả hệ thống)

1. Backend đã chạy và có tài khoản ADMIN ([initial-admin-bootstrap.md](initial-admin-bootstrap.md)). Các bước bên dưới
   gọi API bằng JWT ADMIN (`POST /api/v1/auth/login`), có thể qua Swagger UI khi `API_DOCS_ENABLED=true` (chỉ dev).
2. Broker Mosquitto chạy ở nơi máy kết nối tới được (mục [Broker cho máy thật](#broker-cho-máy-thật)).
3. Backend bật MQTT: `MQTT_ENABLED=true`, `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`
   ([mqtt-integration.md](mqtt-integration.md)). Log phải có "MQTT connected and subscribed".

## Bước 1. Chọn mã máy

Mã máy là định danh dùng chung cho backend, topic MQTT, username broker và cấu hình firmware, **không đổi được sau khi tạo**.

- Dạng `[A-Z0-9][A-Z0-9._-]{0,63}`: chữ hoa, số, `.`, `_`, `-`. Backend tự chuyển mã sang chữ hoa, nhưng mã có ký tự ngoài
  pattern này sẽ **không dùng được MQTT**.
- Gợi ý quy ước: `FV-<khu vực>-<số thứ tự>`, ví dụ `FV-HCM-001`.
- Ghi mã máy, vị trí và số seri bo mạch vào sổ lắp đặt của nhóm.

## Bước 2. Đăng ký máy trên backend (ADMIN)

1. Tạo máy ([machine-management.md](machine-management.md)):
   ```http
   POST /api/v1/machines
   {"code":"FV-HCM-001","name":"Máy sảnh A","location":"Tòa A, tầng 1",
    "minTemperature":2.00,"maxTemperature":8.00,"minHumidity":40.00,"maxHumidity":85.00}
   ```
   Lưu lại `id` trả về. Máy mới luôn ở trạng thái `INACTIVE`.
2. Tạo slot theo đúng vị trí vật lý, mã slot trùng nhãn trên máy ([machine-slot-management.md](machine-slot-management.md)):
   ```http
   POST /api/v1/machines/{machineId}/slots
   {"slotCode":"A1","capacity":6}
   ```
3. Bảo đảm sản phẩm và lô hàng đã có ([product-management.md](product-management.md),
   [product-batch-management.md](product-batch-management.md)), rồi nạp hàng vào slot bằng `POST /api/v1/inventory/load`
   ([inventory-management.md](inventory-management.md)). Số hộp không được vượt `capacity` của slot.
4. Chuyển máy sang `ACTIVE` khi đã sẵn sàng bán:
   ```http
   PATCH /api/v1/machines/{machineId}/status
   {"status":"ACTIVE"}
   ```
   Trong lúc lắp đặt có thể để `INACTIVE` hoặc `MAINTENANCE`; tin MQTT của máy ở các trạng thái này vẫn được nhận (để chẩn đoán).

## Bước 3. Cấp key cho kiosk (ADMIN)

```http
POST /api/v1/machines/{machineId}/kiosk-credentials
```

- `apiKey` trong response **chỉ hiện một lần**. Nhập thẳng vào cấu hình của ứng dụng kiosk trên máy (file cấu hình hoặc
  biến môi trường ngoài Git), không lưu vào ghi chú hay ảnh chụp màn hình.
- Mỗi máy chỉ có một key ACTIVE; gọi lại POST là xoay key (key cũ hết hiệu lực). Thu hồi:
  `POST /api/v1/machines/{machineId}/kiosk-credentials/{credentialId}/revoke`.
- Kiểm tra: kiosk gọi `GET /api/v1/kiosk/me` với header `X-Kiosk-Key` phải nhận 200 và đúng mã máy.

## Bước 4. Tạo tài khoản MQTT cho máy (trên broker)

Username là **mã máy**, password là secret riêng của máy. ACL `pattern write vending/%u/...` trong
`infra/mosquitto/config/acl` đã giới hạn mỗi máy chỉ publish được topic của chính nó, nên **không cần sửa ACL** khi thêm máy.

1. Sinh secret ngẫu nhiên (ví dụ `openssl rand -base64 24`) và đặt vào biến môi trường để không lộ trong lệnh:
   ```bash
   export MACHINE_PW='<secret>'
   ```
2. Thêm tài khoản vào password file. Broker mount thư mục `config` chỉ đọc (`:ro`), nên chạy `mosquitto_passwd` trong một
   container tạm, giống `generate-passwd.sh` (tại thư mục gốc repo; Git Bash cần `MSYS_NO_PATHCONV=1`):
   ```bash
   MSYS_NO_PATHCONV=1 docker run --rm -e MACHINE_PW -v "$(pwd -W 2>/dev/null || pwd)/infra/mosquitto/config:/work" \
     eclipse-mosquitto:2 sh -c 'mosquitto_passwd -b /work/passwd FV-HCM-001 "$MACHINE_PW" && chown mosquitto:mosquitto /work/passwd'
   ```
   Không chạy lại `generate-passwd.sh` sau bước này: script đó tạo lại file từ đầu và xóa tài khoản các máy đã thêm.
3. Nạp lại cấu hình broker:
   ```bash
   docker compose -f infra/mosquitto/compose.yaml restart
   ```
4. Đổi mật khẩu: chạy lại bước 2 với secret mới, rồi cập nhật firmware. Thu hồi: thay `-b /work/passwd FV-HCM-001 ...`
   bằng `-D /work/passwd FV-HCM-001`, rồi restart.

Nếu broker production dùng thư mục hoặc tên file khác, đổi đường dẫn mount cho phù hợp; nguyên tắc vẫn như trên.

## Bước 5. Cấu hình firmware ESP32

Các giá trị cấu hình riêng từng máy nên nằm trong NVS hoặc file cấu hình nạp lúc lắp đặt, không hard-code trong mã nguồn:

| Khóa | Ví dụ |
| --- | --- |
| WiFi SSID / password | mạng tại điểm đặt máy |
| Broker host / port | `mqtt.example.com` / `8883` (TLS) |
| CA certificate | CA của chứng chỉ broker |
| MQTT username / password | `FV-HCM-001` / secret ở bước 4 |
| Client id | `FV-HCM-001` (phải khác nhau giữa các máy) |

Hành vi bắt buộc theo [mqtt-contract.md](../api-contract/mqtt-contract.md):

- MQTT 3.1.1, keep-alive 30–60 s, tự kết nối lại khi mất mạng.
- **Last Will**: topic `vending/FV-HCM-001/status`, QoS 1, retain false, payload
  `{"schemaVersion":1,"messageId":"lwt-<boot counter>","machineCode":"FV-HCM-001","payload":{"state":"OFFLINE"}}`.
- Mỗi lần (re)connect: publish `status` với `{"state":"ONLINE","firmwareVersion":"1.0.3","uptimeSeconds":...}`.
- Khoảng 60 s một lần: publish `telemetry` với `{"temperature":4.7,"humidity":68.2}`.
- Khi có sự kiện: publish `events` với `{"eventType":"DOOR_OPENED","details":{}}`.
- Envelope: `schemaVersion` = 1, `messageId` duy nhất cho mỗi máy (gửi lại thì giữ nguyên), `machineCode` đúng bằng mã trên
  topic, tối đa 8192 byte, không đặt retain. `sentAt` chỉ gửi khi đồng hồ đã đồng bộ NTP; không có thì bỏ trường này.

Lưu ý thư viện:

- **PubSubClient** chỉ publish được QoS 0 (QoS 1 chỉ có ở subscribe và Last Will), và buffer mặc định 256 byte nhỏ hơn một
  envelope thông thường. Nếu dùng thì phải gọi `setBufferSize(1024)` trở lên và chấp nhận telemetry/events là QoS 0.
- Muốn publish QoS 1 đúng hợp đồng thì dùng `esp-mqtt` (ESP-IDF) hoặc `arduino-mqtt` (256dpi).
- TLS trên Arduino: `WiFiClientSecure` + `setCACert(...)`. Không dùng `setInsecure()` ngoài lúc thử nghiệm trên bàn.

## Bước 6. Cấu hình ứng dụng kiosk

- URL backend (HTTPS ở production) và kiosk API key từ bước 3.
- Cổng Serial/USB nối tới ESP32. Giao thức lệnh giữa kiosk và ESP32 (dispense, kết quả) **chưa được định nghĩa** trong repo;
  firmware và kiosk phải dùng cùng một phiên bản giao thức khi thống nhất xong.
- Đồng hồ hệ thống của kiosk nên đồng bộ NTP (kiosk dùng `expiresAt` của đơn để đếm ngược).

## Bước 7. Kiểm tra trước khi bàn giao

| # | Kiểm tra | Kết quả mong đợi |
| --- | --- | --- |
| 1 | Log broker khi bật máy | `New client connected ... as FV-HCM-001 ... u'FV-HCM-001'` |
| 2 | Log backend với `logging.level.com.fruitmachine.backend.mqtt=DEBUG` | Không có WARN rejected; tin hợp lệ hiện "No MQTT handler for channel" khi chưa có handler |
| 3 | Rút điện hoặc ngắt WiFi của máy | Sau khoảng 1,5 × keep-alive, broker gửi Last Will `OFFLINE` |
| 4 | Kiosk gọi `GET /api/v1/kiosk/me` | 200, đúng mã máy |
| 5 | Kiosk gọi `GET /api/v1/kiosk/catalog` | Có các sản phẩm vừa nạp |
| 6 | Tạo một đơn thử rồi hủy (`POST /api/v1/kiosk/orders`, `.../cancel`) | Đơn `CANCELLED`, hộp quay lại `AVAILABLE` |

Lỗi thường gặp:

| Triệu chứng | Nguyên nhân |
| --- | --- |
| Broker từ chối, reason 4/5 | sai username/password, hoặc chưa restart broker sau bước 4 |
| Kết nối được nhưng backend không thấy tin | topic sai (mã viết thường, sai root `vending`, sai channel) hoặc publish nhầm topic máy khác (ACL chặn) |
| `reason=UNKNOWN_MACHINE` | chưa làm bước 2, hoặc mã trên firmware khác mã đã đăng ký |
| `reason=MACHINE_CODE_MISMATCH` | `machineCode` trong JSON khác mã trên topic |
| `reason=PAYLOAD_TOO_LARGE` / tin bị cắt | envelope quá 8192 byte, hoặc buffer client quá nhỏ (PubSubClient) |
| Máy kết nối lại liên tục | hai máy cùng client id |
| Kiosk nhận 401 | key sai, đã xoay hoặc thu hồi; kiosk gửi cả JWT lẫn key |

Bảng đầy đủ: [mqtt-integration.md](mqtt-integration.md#xử-lý-sự-cố) và [mqtt-contract.md](../api-contract/mqtt-contract.md#6-validation-and-rejection).

## Broker cho máy thật

Cấu hình trong `infra/mosquitto/` là broker dev: chỉ nghe `127.0.0.1:1883` và không có TLS, nên ESP32 ở mạng khác không kết
nối được. Khi triển khai cho máy thật:

1. Chạy broker trên server có địa chỉ hoặc domain cố định mà máy tới được.
2. Thêm listener TLS trong `mosquitto.conf` (`listener 8883` kèm `cafile`, `certfile`, `keyfile`), map cổng `8883:8883`,
   giữ `allow_anonymous false`, cùng password file và ACL như bản dev.
3. Firewall chỉ mở 8883; không mở 1883 ra internet.
4. Backend dùng `MQTT_BROKER_URL=ssl://<host>:8883`; profile `prod` từ chối khởi động nếu không phải `ssl://`. Paho dùng
   truststore của JVM: chứng chỉ từ CA công khai (ví dụ Let's Encrypt) dùng được ngay, chứng chỉ tự ký phải import CA vào truststore.
5. Thử nhanh trong LAN có thể tạm map `0.0.0.0:1883:1883` với `tcp://`, nhưng không dùng cách này cho máy đặt ở nơi công cộng.

## Gỡ máy hoặc thay bo mạch

- **Thay ESP32**: nạp cấu hình cũ vào bo mới, hoặc đổi mật khẩu MQTT (bước 4) nếu bo cũ bị mất.
- **Thay máy tính kiosk**: xoay kiosk key (bước 3) để key trên thiết bị cũ hết hiệu lực.
- **Ngừng máy**: `PATCH .../status` sang `INACTIVE`, thu hồi kiosk key, xóa tài khoản MQTT (`mosquitto_passwd -D`).
  Mã máy không đổi và không tái sử dụng cho máy khác.

## Giới hạn hiện tại

- Chưa có handler cho telemetry/status/events: tin hợp lệ được nhận rồi bỏ, chưa lưu sensor, chưa cập nhật `last_seen_at`,
  chưa tạo alert ([mqtt-integration.md](mqtt-integration.md)).
- Chưa có luồng dispense và giao thức Serial kiosk ↔ ESP32; mã nguồn `firmware/` và `apps/kiosk/` chưa có.
- Chưa có cấu hình broker production (TLS) trong repo; tài khoản MQTT của máy được quản lý thủ công trên broker, không có API backend.
