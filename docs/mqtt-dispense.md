# Nhả hàng qua MQTT

Luồng mua hàng đầu-cuối: kiosk `/buy` → backend → broker MQTT → ESP32 nhả hàng → ESP32 báo kết quả → backend → kiosk.
Quyết định ngày 23/10/2026 (thay cho luồng Kiosk → USB Serial → ESP32 trước đây). USB Serial vẫn còn trong firmware để
test và hiệu chỉnh servo, cùng lệnh `DISPENSE` và cùng cơ chế chống nhả trùng.

Định dạng message (topic, envelope, lệnh, event, mã lỗi, QoS, thời gian) nằm duy nhất trong
[api-contract/mqtt-contract.md](../api-contract/mqtt-contract.md); tài liệu này chỉ giải thích luồng và cách chạy.

## Luồng

```text
Webhook thanh toán hợp lệ ──> Order PAID + DispenseCommand PENDING (cùng transaction)
            │ sau commit
            ▼
Backend ── publish vending/<mãMáy>/commands {DISPENSE, commandId, columnCode} ──> ESP32
            ◀── vending/<mãMáy>/events DISPENSE_ACCEPTED ── (lệnh SENT → ACKNOWLEDGED, đơn DISPENSING)
            ◀── vending/<mãMáy>/events DISPENSE_COMPLETED ── (lệnh SUCCESS, hộp SOLD, đơn COMPLETED)
            ◀── vending/<mãMáy>/events DISPENSE_ABORTED ─── (lệnh FAILED, hộp DISPENSE_FAILED, đơn DISPENSE_FAILED, máy MAINTENANCE)
Kiosk poll GET /api/v1/kiosk/orders/{id}: PAID/DISPENSING = "Máy đang nhả hàng", COMPLETED = "Mời lấy trái cây",
DISPENSE_FAILED = "Máy chưa nhả được hàng" (khách liên hệ nhân viên kèm mã đơn).
```

- Chỉ webhook thanh toán đã xác minh mới tạo lệnh. ESP32 và kiosk không bao giờ quyết định đơn đã trả tiền.
- Mỗi hộp đã trả tiền có một lệnh với `commandId` riêng dạng `D-<16 hex>` (1–39 ký tự `[A-Za-z0-9_-]`, giới hạn của firmware).
- **Ngăn = cột (issue #52):** mã ngăn chỉ là `A` hoặc `B` (V14); lệnh mang `columnCode` = mã ngăn của hộp đã giữ, nên máy nhả đúng cột.
- **Chỉ gửi khi được phép:** máy `ACTIVE`, ngăn `ACTIVE` và máy không có lệnh nào khác đang `SENT`/`ACKNOWLEDGED`
  (firmware chạy một lệnh mỗi lúc). Không thỏa thì lệnh nằm `PENDING`, sweep thử lại; mọi lần gửi giữ advisory lock theo máy.
- **Gửi lại:** lệnh `PENDING`/`SENT` chưa có phản hồi được gửi lại sau `DISPENSE_RESEND_AFTER` (5 giây), cùng `commandId`.
  Firmware nhớ 8 mã gần nhất: mã đã xong thì chỉ báo lại kết quả, mã đang chạy thì báo `DISPENSE_ACCEPTED`. Không nhả hai lần.
- **Hai loại hết giờ:**
  - Đã gửi mà không có kết quả sau `DISPENSE_TIMEOUT` (60 giây, tính từ **lần gửi đầu**, gửi lại không dời mốc) → `TIMEOUT`
    `RESULT_TIMEOUT`: không biết máy đã nhả chưa, nên hộp `DISPENSE_FAILED` (chặn cột), đơn `DISPENSE_FAILED`, máy `MAINTENANCE`.
  - Chưa gửi được lần nào sau `DISPENSE_PENDING_TIMEOUT` (120 giây từ lúc tạo) → `FAILED` `NOT_DELIVERED`: máy chắc chắn chưa
    chạy, nên hộp trả về `AVAILABLE` (vẫn là đầu cột, bán lại được), đơn `DISPENSE_FAILED` (thanh toán giữ `SUCCESS`, chờ hoàn tiền).
- **Lý do (`details.reason`):** `REJECTED` không lý do / `BUSY` / lý do lạ → gửi lại như cũ. `CONTROLLER_FAULT`, `INVALID_COMMAND_ID`,
  `INVALID_COLUMN`, `UNSUPPORTED_SCHEMA` → hỏng **an toàn** (trả hộp; `CONTROLLER_FAULT` đưa máy về `MAINTENANCE`, các lý do còn lại
  ghi log ERROR vì là lỗi backend). `ABORTED` với bất kỳ lý do nào → hỏng **không an toàn** (hộp `DISPENSE_FAILED`, máy `MAINTENANCE`,
  không bao giờ gửi lại). Lý do lưu ở `dispense_commands.failure_reason`.
- **Nhiều hộp:** `COMPLETED` kèm `bowlCount > 1` hoặc `MULTIPLE_BOWLS_DETECTED` → đơn vẫn `COMPLETED`, máy `MAINTENANCE`, nhân viên
  đối soát cột (backend không đoán hộp nào đã rơi).
- **Kết quả đến muộn:** `DISPENSE_COMPLETED` sau `FAILED`/`TIMEOUT` chỉ được áp dụng khi hộp còn `DISPENSE_FAILED`. Trước khi hoàn
  tiền: đơn chuyển `COMPLETED`, hộp `SOLD`, máy vẫn `MAINTENANCE` (Admin quyết định). Sau khi hoàn tiền: hộp `SOLD`, đơn giữ
  `REFUNDED`, ghi `audit_logs` `DISPENSE_SUCCESS_AFTER_REFUND` để Admin xử lý. Hộp đã trả lại/gỡ/bán: không đổi gì, ghi
  `DISPENSE_LATE_RESULT_CONFLICT`.
- **Máy về MAINTENANCE do hệ thống:** ghi `audit_logs` `MACHINE_MAINTENANCE_AUTO` (user NULL, kèm lý do); kiosk thấy
  `acceptingOrders=false`, đơn mới bị `409`; chỉ người có `MACHINE_WRITE` (ADMIN) đặt lại `ACTIVE`.
- **Sự kiện miền** (`DispenseFailedEvent`, `DispenseLateSuccessEvent`, `DispenseMultipleBowlsEvent`, `MachineMaintenanceEnteredEvent`)
  phát sau commit; hiện chỉ ghi log, cảnh báo (3.6) và lịch sử sự kiện (3.5) sẽ lắng nghe.
- **Trùng lặp:** QoS 1 có thể gửi lại tin; mọi sự kiện được xử lý idempotent (`DUPLICATE`), không ghi lịch sử hai lần.
- **Sai máy:** sự kiện mà mã máy trên topic khác mã máy trong envelope, hoặc khác máy của lệnh, bị bỏ qua.
- BM04 F-03 (cách diễn đạt mới): *"Kết quả thành công đến muộn sau khi hết giờ được ghi nhận; trước khi hoàn tiền thì hoàn tất
  đơn, sau khi hoàn tiền thì đánh dấu để Admin xem xét."*
- Hộp `DISPENSE_FAILED` vẫn nằm trong cột và chặn bán ở ngăn đó cho tới khi nhân viên kiểm tra rồi gỡ hộp. Hoàn tiền làm thủ công.

## Topic và envelope

Xem [contract](../api-contract/mqtt-contract.md) §1 (topic), §2 (envelope), §3.1 (`DISPENSE`), §4.1 (event của lệnh) và
ví dụ `api-contract/mqtt/examples/`. Hằng số phía backend: `com.fruitmachine.backend.mqtt.contract`.
Mỗi tin hợp lệ từ máy cập nhật `machines.last_seen_at` ("Lần cuối thấy máy" trên web quản trị).

## Chạy local

1. Broker: `docker compose -f infra/docker-compose.yml up -d`. Tạo tài khoản bằng `./infra/mosquitto/add-user.ps1 backend`
   và `./infra/mosquitto/add-user.ps1 <mãMáy>`. File `infra/mosquitto/passwd` không đưa lên Git. ACL `infra/mosquitto/acl`
   chỉ cho mỗi máy đọc lệnh và ghi `events`, `status`, `heartbeat`, `telemetry` của chính nó (contract §8).
2. Backend: trong `.env` ở gốc repo đặt `MQTT_ENABLED=true`, `MQTT_USERNAME=backend`, `MQTT_PASSWORD=<mật khẩu backend>`.
   Khi `MQTT_ENABLED=false` (mặc định), lệnh vẫn được tạo nhưng không gửi đi và sẽ hết giờ.
3. Firmware: chép `firmware/fruit/include/secrets.h.example` thành `secrets.h`, điền Wi-Fi 2.4 GHz, IP LAN của máy chạy broker,
   mã máy và mật khẩu broker của máy, rồi nạp: `pio run -t upload` (cần driver USB của board, ví dụ CP210x).
4. Kiểm tra: `pio device monitor -b 115200` phải in `# MQTT connected as <mãMáy>, listening on vending/<mãMáy>/commands`.

Cấu hình backend: `MQTT_ENABLED`, `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPIC_ROOT`,
`DISPENSE_RESEND_AFTER`, `DISPENSE_TIMEOUT`, `DISPENSE_PENDING_TIMEOUT`, `DISPENSE_SWEEP_ENABLED`, `DISPENSE_SWEEP_INTERVAL`. Không ghi mật khẩu MQTT vào log hay Git.

## Giới hạn hiện tại

- Backend gửi `columnCode` (#52), nhưng firmware trên `dev` vẫn đọc `column`/`slot` nên đang nhả cột A cho mọi lệnh cho tới khi
  firmware đọc `columnCode` (contract §3.1, FIRMWARE_PENDING).
- Bộ đếm gửi lại nằm trong bộ nhớ của một tiến trình backend (chạy một instance).
- Broker local không dùng TLS; chỉ dùng trong mạng tin cậy.
