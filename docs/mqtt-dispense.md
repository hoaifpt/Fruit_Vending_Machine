# Nhả hàng qua MQTT

Luồng mua hàng đầu-cuối: kiosk `/buy` → backend → broker MQTT → ESP32 nhả hàng → ESP32 báo kết quả → backend → kiosk.
Quyết định ngày 23/10/2026 (thay cho luồng Kiosk → USB Serial → ESP32 trước đây). USB Serial vẫn còn trong firmware để
test và hiệu chỉnh servo, cùng lệnh `DISPENSE` và cùng cơ chế chống nhả trùng.

## Luồng

```text
Webhook thanh toán hợp lệ ──> Order PAID + DispenseCommand PENDING (cùng transaction)
            │ sau commit
            ▼
Backend ── publish vending/<mãMáy>/commands {DISPENSE, commandId} ──> ESP32
            ◀── vending/<mãMáy>/events DISPENSE_ACCEPTED ── (lệnh SENT → ACKNOWLEDGED, đơn DISPENSING)
            ◀── vending/<mãMáy>/events DISPENSE_COMPLETED ── (lệnh SUCCESS, hộp SOLD, đơn COMPLETED)
            ◀── vending/<mãMáy>/events DISPENSE_ABORTED ─── (lệnh FAILED, hộp DISPENSE_FAILED, đơn DISPENSE_FAILED)
Kiosk poll GET /api/v1/kiosk/orders/{id}: PAID/DISPENSING = "Máy đang nhả hàng", COMPLETED = "Mời lấy trái cây",
DISPENSE_FAILED = "Máy chưa nhả được hàng" (khách liên hệ nhân viên kèm mã đơn).
```

- Chỉ webhook thanh toán đã xác minh mới tạo lệnh. ESP32 và kiosk không bao giờ quyết định đơn đã trả tiền.
- Mỗi hộp đã trả tiền có một lệnh với `commandId` riêng dạng `D-<16 hex>` (1–39 ký tự `[A-Za-z0-9_-]`, giới hạn của firmware).
- **Gửi lại:** lệnh `PENDING`/`SENT` chưa có phản hồi được gửi lại sau `DISPENSE_RESEND_AFTER` (5 giây), cùng `commandId`.
  Firmware nhớ 8 mã gần nhất: mã đã xong thì chỉ báo lại kết quả, mã đang chạy thì báo `DISPENSE_ACCEPTED`. Không nhả hai lần.
- **Hết giờ:** lệnh chưa xong sau `DISPENSE_TIMEOUT` (60 giây) chuyển `TIMEOUT`, đơn `DISPENSE_FAILED`, hộp `DISPENSE_FAILED`.
- **Kết quả đến muộn:** `DISPENSE_COMPLETED` đến sau khi hết giờ vẫn được ghi nhận (máy là bên chứng kiến hộp rơi): đơn chuyển `COMPLETED`.
- **Trùng lặp:** QoS 1 có thể gửi lại tin; mọi sự kiện được xử lý idempotent (`DUPLICATE`), không ghi lịch sử hai lần.
- **Sai máy:** sự kiện mà mã máy trên topic khác mã máy trong envelope, hoặc khác máy của lệnh, bị bỏ qua.
- `DISPENSE_REJECTED` (máy đang bận hoặc lỗi FAULT): lệnh giữ nguyên và sẽ được gửi lại cho tới khi hết giờ.
- Hộp `DISPENSE_FAILED` vẫn nằm trong cột và chặn bán ở ngăn đó cho tới khi nhân viên kiểm tra rồi gỡ hộp. Hoàn tiền làm thủ công.

## Topic và envelope

Gốc topic `vending` (`MQTT_TOPIC_ROOT`). Mã máy là `code` của máy trong backend và là username của máy trên broker.

| Topic | Chiều | QoS | Nội dung `payload` |
| --- | --- | --- | --- |
| `vending/<mãMáy>/commands` | backend → máy | 1 | `{"type":"DISPENSE","commandId":"D-…"}` |
| `vending/<mãMáy>/events` | máy → backend | 0/1 | `{"eventType":"DISPENSE_ACCEPTED\|DISPENSE_REJECTED\|DISPENSE_COMPLETED\|DISPENSE_ABORTED\|BOWL_SENSOR_TRIGGERED","details":{"commandId":"D-…"}}` |
| `vending/<mãMáy>/status` | máy → backend | 0/1 | `{"state":"ONLINE\|OFFLINE",…}` (OFFLINE là Last Will) |

Mọi tin dùng envelope `{"schemaVersion":1,"messageId":"…","machineCode":"<mãMáy>","payload":{…}}`.
Mỗi tin từ máy cập nhật `machines.last_seen_at` ("Lần cuối thấy máy" trên web quản trị).

## Chạy local

1. Broker: `docker compose -f infra/docker-compose.yml up -d`. Tạo tài khoản bằng `./infra/mosquitto/add-user.ps1 backend`
   và `./infra/mosquitto/add-user.ps1 <mãMáy>`. File `infra/mosquitto/passwd` không đưa lên Git. ACL `infra/mosquitto/acl`
   chỉ cho mỗi máy đọc lệnh và ghi sự kiện của chính nó.
2. Backend: trong `.env` ở gốc repo đặt `MQTT_ENABLED=true`, `MQTT_USERNAME=backend`, `MQTT_PASSWORD=<mật khẩu backend>`.
   Khi `MQTT_ENABLED=false` (mặc định), lệnh vẫn được tạo nhưng không gửi đi và sẽ hết giờ.
3. Firmware: chép `firmware/fruit/include/secrets.h.example` thành `secrets.h`, điền Wi-Fi 2.4 GHz, IP LAN của máy chạy broker,
   mã máy và mật khẩu broker của máy, rồi nạp: `pio run -t upload` (cần driver USB của board, ví dụ CP210x).
4. Kiểm tra: `pio device monitor -b 115200` phải in `# MQTT connected as <mãMáy>, listening on vending/<mãMáy>/commands`.

Cấu hình backend: `MQTT_ENABLED`, `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPIC_ROOT`,
`DISPENSE_RESEND_AFTER`, `DISPENSE_TIMEOUT`, `DISPENSE_SWEEP_ENABLED`, `DISPENSE_SWEEP_INTERVAL`. Không ghi mật khẩu MQTT vào log hay Git.

## Giới hạn hiện tại

- Firmware điều khiển **một cột** (2 cổng); lệnh chưa mang mã ngăn. Máy nhiều ngăn cần thêm tham số ngăn ở firmware.
- Bộ đếm gửi lại nằm trong bộ nhớ của một tiến trình backend (chạy một instance).
- Broker local không dùng TLS; chỉ dùng trong mạng tin cậy.
