# Yêu cầu backend: theo dõi tình trạng máy

Tài liệu này mô tả phần việc của backend để theo dõi sức khỏe máy (backlog 3.4 heartbeat/telemetry, 3.6 cảnh báo).
**Định dạng message không nằm ở đây**: topic, envelope, payload `status` / `heartbeat` / `telemetry`, mã lỗi và thời gian
được định nghĩa duy nhất trong [api-contract/mqtt-contract.md](../api-contract/mqtt-contract.md)
(§1 Topics, §2 Envelope, §5 Status/Heartbeat/Telemetry, §6 Error Code Catalog, §7 Delivery Semantics).
Các topic cũ dạng `<prefix>/{machineId}/...` và payload có `timestamp` của bản nháp trước đã bị bỏ.

## 1. Nhận message

- Máy được nhận diện bằng **mã máy** (`machines.code`) trong topic; mã máy trong envelope phải trùng, nếu không thì bỏ tin.
- Backend sẽ subscribe thêm `heartbeat` và `telemetry` cho mọi máy (hiện chỉ có `events` và `status`).
- Thời điểm dùng cho mọi phép tính là **thời điểm backend nhận tin**; contract không có timestamp của thiết bị.
- Mã máy chưa đăng ký: ghi log và bỏ tin, không tự tạo máy.
- JSON sai, thiếu trường bắt buộc hoặc sai kiểu: ghi log, bỏ tin, không làm consumer MQTT dừng.

## 2. Dữ liệu cần lưu

Tối thiểu cho mỗi máy (mở rộng bảng `machines` hoặc bảng riêng, thiết kế trong 3.4):

| Trường | Ý nghĩa |
|---|---|
| `last_seen_at` | lần cuối nhận tin hợp lệ bất kỳ (đã có, cập nhật cho mọi tin) |
| `last_status_at`, `last_heartbeat_at` | lần cuối nhận `status` / `heartbeat` |
| `health_status` | `ONLINE`, `WARNING`, `OFFLINE`, tách khỏi trạng thái vận hành `MachineStatus` |
| `uptime_seconds`, `wifi_rssi`, `free_heap`, `firmware_version` | từ heartbeat gần nhất; thiếu thì `null`, không bao giờ `0` |
| `temperature`, `humidity` | từ telemetry gần nhất (khi firmware có cảm biến) |
| `last_error` | mã lỗi gần nhất theo catalog của contract |

Lịch sử event (`machine_events`) thuộc backlog 3.5.

## 3. Phát hiện offline

Job định kỳ (30 hoặc 60 giây, cấu hình được):

```text
now - last_seen_at <= 60 s           → ONLINE
60 s < now - last_seen_at <= 180 s   → WARNING (nếu UI cần)
now - last_seen_at > 180 s           → OFFLINE (ngưỡng offline của contract §7)
```

- Chỉ ghi log khi trạng thái thật sự đổi; khi tin mới đến sau OFFLINE thì chuyển về ONLINE và ghi thời điểm khôi phục.
- Last Will `OFFLINE` là tín hiệu bổ sung; timeout vẫn bắt buộc vì Last Will có thể đến trễ hoặc không đến.

## 4. Nhiệt độ và độ ẩm

- Giá trị lấy từ `telemetry` (contract §5.3). Cảm biến lỗi được báo bằng `FAULT` `TEMP_SENSOR_ERROR`, không có telemetry giả.
- Không biến giá trị thiếu, `null`, NaN hoặc vô cực thành `0`; giá trị ngoài miền đo hợp lý bị từ chối.
- So sánh với ngưỡng của máy (`min/max_temperature`, `min/max_humidity` đã có trong `machines`); ngưỡng không hard-code ở frontend.
- Nhiệt độ bất thường là cảnh báo sức khỏe (3.6), không tự chuyển máy sang `OFFLINE`.

## 5. REST API cho web quản trị

Bổ sung thông tin health vào API máy hiện có (`/api/v1/machines`), cập nhật `api-contract/api.yaml` trong cùng issue:
`healthStatus`, `lastSeenAt`, `lastHeartbeatAt`, `uptimeSeconds`, `wifiRssi`, `freeHeap`, `firmwareVersion`, nhiệt độ/độ ẩm gần nhất.
Máy chưa từng gửi heartbeat vẫn trả `200`, các trường đó là `null`. Quyền xem theo permission `MACHINE_READ`.

## 6. An toàn và độ tin cậy

- Mã máy trên topic chỉ đáng tin vì ACL của broker (contract §8); envelope phải khớp.
- Không để một tin hỏng làm mất subscription; consumer tự kết nối lại khi mất broker.
- Nhận được tin MQTT không phải bằng chứng đã nhả hàng; kết quả nhả hàng chỉ theo event của lệnh.
- Không ghi mật khẩu MQTT, token hay thông tin nhạy cảm vào log.

## 7. Tiêu chí nghiệm thu (3.4)

- [ ] Nhận `status` và `heartbeat` từ nhiều máy cùng lúc.
- [ ] Heartbeat cập nhật `last_seen_at` và thông tin chẩn đoán; trường thiếu lưu `null`.
- [ ] Máy tự chuyển `OFFLINE` sau ngưỡng, kể cả khi không có Last Will; tự về `ONLINE` khi có tin mới.
- [ ] Tin sai schema hoặc sai máy bị log và bỏ qua, consumer không dừng.
- [ ] API máy trả đúng thông tin health; `api-contract/api.yaml` được cập nhật.
- [ ] Test: heartbeat bình thường, mất heartbeat, kết nối lại, Last Will, JSON sai, nhiều máy.
