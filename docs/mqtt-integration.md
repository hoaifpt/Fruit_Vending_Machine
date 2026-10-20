# MQTT integration (issue #43)

Backend nhận telemetry / status / events từ máy qua MQTT. Lớp này chỉ là **ranh giới vận chuyển**:
kiểm tra topic và envelope, tìm máy theo mã, rồi chuyển `MachineMessage` cho handler. Lớp này không lưu sensor, không cập nhật
`last_seen_at`, không tạo alert, không ghi `machine_events` (các issue sau làm). Backend **không publish** gì tới máy. Dispense
**không** đi qua MQTT. Hợp đồng tin nhắn: [api-contract/mqtt-contract.md](../api-contract/mqtt-contract.md).

## Luồng xử lý

```text
Máy publish vending/{code}/{telemetry|status|events}
  -> Mosquitto (xác thực từng máy + ACL)
  -> MqttPahoMessageDrivenChannelAdapter (Spring Integration, Paho v3, MQTT 3.1.1)
  -> MqttInboundAdapter.onMessage        (không logic nghiệp vụ, không transaction, không bao giờ ném lỗi)
  -> MachineMessageParser                (topic, kích thước, UTF-8 JSON, envelope, mã máy topic == envelope)
  -> MachineResolver                     (mã máy -> id, đọc bảng machines)
  -> MachineMessageDispatcher            (handler của channel; không có handler -> DEBUG và bỏ)
```

Điểm mở rộng: một bean `MachineMessageHandler` cho mỗi `MachineChannel` (TELEMETRY, STATUS, EVENT). Handler chạy trên thread
callback MQTT, nên phải nhanh và gọi application service (transaction nằm ở service). Handler phải chịu được tin trùng `messageId`,
vì QoS 1 là at-least-once. Hai handler cho cùng một channel làm ứng dụng dừng khi khởi động.

## Dependency mới

- `org.springframework.integration:spring-integration-mqtt` (version do Spring Boot quản lý, 6.5.x): message-driven adapter,
  reconnect và subscribe lại sau mỗi lần kết nối lại.
- `org.eclipse.paho:org.eclipse.paho.client.mqttv3:1.2.5`: client Paho v3. Từ Spring Integration 6 đây là dependency optional,
  Boot không quản lý version, nên phải khai báo tường minh. 1.2.5 là bản Paho v3 cuối cùng. Dùng MQTT 3.1.1, tương thích PubSubClient
  trên ESP32. Không thêm thư viện messaging nào khác.

## Cấu hình (`app.mqtt.*`)

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `MQTT_ENABLED` | `false` | `false`: không tạo client, không kết nối (mặc định cho test và phát triển chỉ dùng REST) |
| `MQTT_BROKER_URL` | `tcp://127.0.0.1:1883` | `tcp://` hoặc `ssl://`; profile `prod` bắt buộc `ssl://` |
| `MQTT_CLIENT_ID` | `fvm-backend` | phải khác nhau giữa các instance backend; `[A-Za-z0-9._-]{1,64}` |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | trống | bắt buộc khi bật; thiếu thì ứng dụng dừng với thông báo rõ ràng, không in secret |
| `MQTT_TOPIC_ROOT` | `vending` | một level, chữ thường |
| `MQTT_QOS` | `1` | `0` hoặc `1` |
| `MQTT_CLEAN_SESSION` | `false` | phiên bền: broker giữ tin QoS 1 trong lúc backend khởi động lại |
| `MQTT_MAX_PAYLOAD_BYTES` | `8192` | tối đa 262144 |
| `MQTT_COMPLETION_TIMEOUT` | `PT5S` | timeout cho connect/subscribe |
| `MQTT_MAX_RECONNECT_DELAY` | `PT30S` | Paho reconnect với backoff lũy thừa (1 s, 2 s, 4 s ...) tối đa giá trị này |

Giá trị sai làm ứng dụng dừng khi khởi động. `MqttProperties.toString()` che mật khẩu, và mật khẩu không bao giờ được log.

## Vòng đời kết nối

- Adapter có `autoStartup=false` và được start trên thread riêng `mqtt-inbound-start` sau `ApplicationReadyEvent`.
  Vì vậy broker không tới được thì ứng dụng vẫn khởi động bình thường và REST vẫn chạy.
- Lần đầu không kết nối được: một dòng WARN "not reachable or refused the connection; retrying in the background", rồi Paho tự thử lại.
- Mất kết nối: WARN "MQTT connection lost"; kết nối lại: INFO "MQTT connected and subscribed (reconnected)".
  Log chỉ có loại lỗi và reason code của Paho, không có credentials.
- `MqttConnectionState` (DISABLED, CONNECTING, CONNECTED, DISCONNECTED) cho phần còn lại của ứng dụng biết trạng thái.
  MQTT **không** nằm trong `/actuator/health` công khai (show-details `never`) và không làm ứng dụng DOWN.
- Counter Micrometer (đọc trong ứng dụng, actuator chỉ mở `health`): `fvm.mqtt.messages.received`, `.accepted{channel}`,
  `.rejected{reason}`, `.unhandled{channel}`, `fvm.mqtt.handler.errors{channel}`.
- Giả định chỉ có một instance backend. Nhiều instance cần shared subscription (`$share/...`, MQTT 5 hoặc tính năng riêng của broker);
  việc này để sau.

## Chính sách loại bỏ tin

Tin sai bị bỏ (không lưu) và không chặn các tin sau. Log WARN gồm reason, topic (đã lọc ký tự in được, tối đa 128 ký tự),
machineCode, messageId và mô tả cố định; **không bao giờ log payload**. Cùng một (máy, reason) chỉ log tối đa một lần mỗi phút,
lần log tiếp theo kèm số cảnh báo đã bị nén. Handler ném lỗi: ERROR kèm machine code, messageId và tên loại exception, rồi xử lý tiếp tin sau.
Nếu database lỗi khi tìm máy: ERROR, tin bị bỏ. Adapter không ném lỗi ngược lại Paho, vì làm vậy sẽ ngắt client;
do đó tin QoS 1 vẫn được ack và không được gửi lại.

## Broker local (Mosquitto)

File trong `infra/mosquitto/`: `compose.yaml` (`eclipse-mosquitto:2`, chỉ `127.0.0.1:1883`), `config/mosquitto.conf`
(`allow_anonymous false`, password file, ACL, persistence), `config/acl` và `generate-passwd.sh`. File `config/passwd` sinh ra
được Git bỏ qua. Script `chown` file đó cho user `mosquitto` (uid 1883), vì Mosquitto 2.1 không đọc được file `0600` của root.
Mosquitto 2.1 cảnh báo `File /mosquitto/config/acl group is not mosquitto` vì ACL được mount read-only từ Git; với broker local có thể bỏ qua cảnh báo này.

1. Trong `.env` ở thư mục gốc (không commit), đặt `MQTT_USERNAME=fvm-backend`, `MQTT_PASSWORD=<mật khẩu backend>`,
   `MQTT_DEV_MACHINE_PASSWORD=<mật khẩu máy mẫu FV-DEV-001>`.
2. Sinh password file (Git Bash / Linux / macOS, tại thư mục gốc):
   ```bash
   sh infra/mosquitto/generate-passwd.sh
   ```
3. Chạy broker:
   ```bash
   docker compose -f infra/mosquitto/compose.yaml up -d
   ```
4. Tạo máy có mã `FV-DEV-001` qua `POST /api/v1/machines` (ADMIN), đặt `MQTT_ENABLED=true` rồi chạy backend.
   Log phải có "MQTT connected and subscribed".

Thêm hoặc đổi mật khẩu cho một máy thật: thêm vào password file một tài khoản có username = mã máy, rồi restart broker.
Thư mục `config` được mount chỉ đọc, nên chạy `mosquitto_passwd` trong container tạm; lệnh đầy đủ và toàn bộ quy trình lắp đặt
máy ở [machine-onboarding.md](machine-onboarding.md). ACL dạng `pattern write vending/%u/...` đã giới hạn mỗi máy chỉ publish
vào topic của chính nó.

### Thử bằng `mosquitto_pub`

Chạy bên trong container broker. Đặt mật khẩu của máy mẫu vào biến `MACHINE_PW` thay vì gõ thẳng vào lệnh:

```bash
docker compose -f infra/mosquitto/compose.yaml exec -e MACHINE_PW mosquitto sh -c 'mosquitto_pub -h localhost -u FV-DEV-001 -P "$MACHINE_PW" -q 1 -t vending/FV-DEV-001/telemetry -m "{\"schemaVersion\":1,\"messageId\":\"t-001\",\"machineCode\":\"FV-DEV-001\",\"sentAt\":\"2026-10-20T00:05:00Z\",\"payload\":{\"temperature\":4.7,\"humidity\":68.2}}"'
```

```bash
docker compose -f infra/mosquitto/compose.yaml exec -e MACHINE_PW mosquitto sh -c 'mosquitto_pub -h localhost -u FV-DEV-001 -P "$MACHINE_PW" -q 1 -t vending/FV-DEV-001/status -m "{\"schemaVersion\":1,\"messageId\":\"s-001\",\"machineCode\":\"FV-DEV-001\",\"payload\":{\"state\":\"ONLINE\",\"firmwareVersion\":\"1.0.3\",\"uptimeSeconds\":3600}}"'
```

```bash
docker compose -f infra/mosquitto/compose.yaml exec -e MACHINE_PW mosquitto sh -c 'mosquitto_pub -h localhost -u FV-DEV-001 -P "$MACHINE_PW" -q 1 -t vending/FV-DEV-001/events -m "{\"schemaVersion\":1,\"messageId\":\"e-001\",\"machineCode\":\"FV-DEV-001\",\"payload\":{\"eventType\":\"DOOR_OPENED\",\"details\":{}}}"'
```

Khi chưa có handler (trước #18/#22), tin hợp lệ được nhận rồi bỏ ở mức DEBUG. Bật
`logging.level.com.fruitmachine.backend.mqtt=DEBUG` để thấy dòng "No MQTT handler for channel".

### Kiểm tra bảo mật thủ công

```bash
docker compose -f infra/mosquitto/compose.yaml exec mosquitto mosquitto_pub -h localhost -t vending/FV-DEV-001/telemetry -m x
```

Lệnh trên (không có user) phải bị từ chối (`Error: The connection was refused`). Khi máy FV-DEV-001 publish vào
`vending/FV-HCM-002/telemetry`, broker phải bỏ tin; muốn thấy dòng `Denied PUBLISH` trong log broker thì tạm thêm `log_type debug` vào `mosquitto.conf`. Cả hai kiểm tra này cũng được tự động hóa
trong `MqttBrokerIntegrationTest`, test này chạy với đúng `mosquitto.conf` và `acl` đã commit.

## Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp |
| --- | --- |
| Ứng dụng dừng: "MQTT_USERNAME / MQTT_PASSWORD are not set" | `MQTT_ENABLED=true` nhưng thiếu credentials |
| WARN "not reachable or refused the connection" | broker chưa chạy, sai URL/port, sai mật khẩu (reason 4/5); client vẫn đang tự thử lại |
| Kết nối được nhưng không nhận tin | ACL hoặc topic sai (root, mã máy viết hoa, channel); bật `log_type debug` trên broker để thấy `Denied PUBLISH` |
| `reason=UNKNOWN_MACHINE` | chưa tạo máy với mã đó trong backend |
| `reason=MACHINE_CODE_MISMATCH` | `machineCode` trong JSON khác mã trên topic |
| Hai backend cùng `MQTT_CLIENT_ID` | broker ngắt luân phiên hai client; mỗi instance phải có client-id riêng |

## Test

- Unit: `MachineMessageParserTest`, `MachineMessageDispatchTest`, `MqttConfigurationTest`, `MqttContractDocumentationTest`.
- Integration (Testcontainers Mosquitto + PostgreSQL): `MqttBrokerIntegrationTest` (kết nối, ba channel, tin sai, máy lạ,
  anonymous/ACL, broker khởi động lại), `MqttUnavailableBrokerIntegrationTest` (không có broker), `MqttDisabledIntegrationTest`.
  Các test khác không cần broker (`app.mqtt.enabled=false` trong profile test).
