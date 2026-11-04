# Yêu cầu backend: theo dõi tình trạng máy

Tài liệu này mô tả phần việc dành cho thành viên backend. Firmware ESP32 sẽ
gửi trạng thái kết nối và heartbeat qua MQTT; backend chịu trách nhiệm lưu
trạng thái, phát hiện máy mất kết nối và cung cấp dữ liệu cho web quản trị.

## 1. MQTT topics

Mỗi máy có `machineId`, hiện tại firmware đang dùng `machine001`.

```text
fruit-vending/{machineId}/status
fruit-vending/{machineId}/heartbeat
fruit-vending/{machineId}/event
```

Backend cần subscribe các topic bằng wildcard:

```text
fruit-vending/+/status
fruit-vending/+/heartbeat
fruit-vending/+/event
```

## 2. Payload từ firmware

### 2.1. Trạng thái kết nối

Topic:

```text
fruit-vending/{machineId}/status
```

Payload đề xuất:

```json
{
  "machineId": "machine001",
  "status": "ONLINE",
  "timestamp": "2026-11-04T00:00:00Z"
}
```

Firmware sử dụng MQTT Last Will để gửi `OFFLINE` nếu kết nối bị mất đột
ngột. Backend vẫn phải có timeout riêng, không chỉ phụ thuộc vào Last Will.

Các giá trị `status`:

```text
ONLINE
OFFLINE
ERROR
MAINTENANCE
```

### 2.2. Heartbeat

Topic:

```text
fruit-vending/{machineId}/heartbeat
```

Payload đề xuất:

```json
{
  "machineId": "machine001",
  "status": "ONLINE",
  "uptimeSeconds": 12345,
  "wifiRssi": -55,
  "freeHeap": 18240,
  "temperatureC": 24.6,
  "firmwareVersion": "1.0.0",
  "timestamp": "2026-11-04T00:00:00Z"
}
```

Firmware gửi heartbeat mỗi 30 giây. Ở phiên bản firmware hiện tại,
`temperatureC` và `temperatureStatus` được gửi là `null` và `SENSOR_ERROR`
cho đến khi nối thêm driver/cảm biến nhiệt độ thật. Backend phải lấy thời điểm
server nhận được message làm `lastSeenAt`; không dùng `timestamp` từ thiết bị
để tính timeout vì đồng hồ ESP32 có thể sai.

### 2.3. Event vận hành

Topic:

```text
fruit-vending/{machineId}/event
```

Payload đề xuất:

```json
{
  "machineId": "machine001",
  "event": "DISPENSE_COMPLETED",
  "success": true,
  "slot": 2,
  "timestamp": "2026-11-04T00:00:00Z"
}
```

Các event tối thiểu:

```text
BOOT
DISPENSE_STARTED
DISPENSE_COMPLETED
DISPENSE_FAILED
ERROR
```

## 3. Dữ liệu cần lưu

Tạo bảng/entity quản lý tình trạng máy, tối thiểu gồm:

| Trường | Kiểu đề xuất | Ý nghĩa |
|---|---|---|
| `machineId` | string, unique | Mã máy |
| `status` | enum | Trạng thái hiện tại |
| `lastSeenAt` | timestamp | Lần cuối nhận status/heartbeat |
| `lastStatusAt` | timestamp | Lần cuối nhận status |
| `lastHeartbeatAt` | timestamp | Lần cuối nhận heartbeat |
| `uptimeSeconds` | long | Uptime từ heartbeat gần nhất |
| `wifiRssi` | integer | Cường độ Wi-Fi |
| `freeHeap` | long | Bộ nhớ còn trống trên ESP32 |
| `temperatureC` | decimal nullable | Nhiệt độ máy theo độ C |
| `temperatureStatus` | enum nullable | Trạng thái nhiệt độ |
| `firmwareVersion` | string | Phiên bản firmware |
| `lastError` | string nullable | Lỗi gần nhất |
| `updatedAt` | timestamp | Thời điểm backend cập nhật bản ghi |

Nên lưu lịch sử event riêng nếu cần xem lịch sử hoạt động hoặc điều tra lỗi:

```text
machine_events
- id
- machine_id
- event_type
- success
- payload
- received_at
```

## 4. Quy tắc cập nhật trạng thái

Khi nhận message hợp lệ:

1. Kiểm tra `machineId` trong topic và payload phải trùng nhau.
2. Tìm máy theo `machineId`; nếu chưa có thì tạo mới hoặc ghi log rõ ràng
   theo chính sách của hệ thống.
3. Ghi `lastSeenAt` bằng thời gian server nhận message.
4. Với heartbeat, cập nhật thông tin chẩn đoán (`wifiRssi`, `freeHeap`,
   `uptimeSeconds`, `temperatureC`, `firmwareVersion`).
5. Với `ERROR` hoặc `DISPENSE_FAILED`, cập nhật `lastError`.
6. Message JSON sai hoặc thiếu trường bắt buộc phải bị từ chối và ghi log;
   không được làm backend MQTT consumer dừng.

## 5. Phát hiện offline

Chạy scheduled job ở backend mỗi 30 hoặc 60 giây:

```text
Nếu now - lastSeenAt <= 60 giây:
    ONLINE

Nếu 60 giây < now - lastSeenAt <= 180 giây:
    WARNING (chỉ dùng khi UI cần cảnh báo)

Nếu now - lastSeenAt > 180 giây:
    OFFLINE
```

Ngưỡng `180 giây` tương đương khoảng 6 lần heartbeat 30 giây và có thể cấu
hình bằng environment variable. Job phải có log khi trạng thái chuyển từ
`ONLINE` sang `OFFLINE`, tránh ghi log lặp lại ở mọi lần chạy.

Khi nhận heartbeat/status mới sau khi offline, chuyển máy về `ONLINE` và ghi
log thời điểm khôi phục.

## 6. Theo dõi nhiệt độ

Firmware gửi nhiệt độ trong mỗi heartbeat bằng field `temperatureC`, đơn vị
độ C, kiểu số thực. Ví dụ:

```json
{
  "machineId": "machine001",
  "status": "ONLINE",
  "temperatureC": 24.6,
  "timestamp": "2026-11-04T00:00:00Z"
}
```

Nếu cảm biến chưa sẵn sàng hoặc đọc lỗi, gửi `null` và có thể thêm:

```json
{
  "temperatureC": null,
  "temperatureStatus": "SENSOR_ERROR"
}
```

Backend không được tự biến giá trị thiếu hoặc `null` thành `0`. Các trạng thái
nhiệt độ đề xuất:

```text
NORMAL
WARNING
CRITICAL
SENSOR_ERROR
```

Ngưỡng cảnh báo phải cấu hình được, không hard-code trong frontend. Giá trị
khởi đầu đề xuất:

```text
NORMAL:   temperatureC < 35
WARNING:  35 <= temperatureC < 45
CRITICAL: temperatureC >= 45
```

Khi nhiệt độ đạt `WARNING` hoặc `CRITICAL`, backend nên ghi nhận cảnh báo và
cho phép web quản trị hiển thị. Không tự chuyển máy thành `OFFLINE` chỉ vì
nhiệt độ cao; đây là trạng thái sức khỏe riêng. Nếu firmware phát hiện điều
kiện nguy hiểm và dừng máy, nó phải gửi event `ERROR` hoặc
`TEMPERATURE_CRITICAL`.

## 7. REST API cho web quản trị

Backend cần bổ sung vào API contract:

### Danh sách máy

```http
GET /api/machines
```

Response tối thiểu:

```json
[
  {
    "machineId": "machine001",
    "status": "ONLINE",
    "lastSeenAt": "2026-11-04T00:00:00Z",
    "wifiRssi": -55,
    "temperatureC": 24.6,
    "temperatureStatus": "NORMAL",
    "uptimeSeconds": 12345,
    "firmwareVersion": "1.0.0",
    "lastError": null
  }
]
```

### Chi tiết tình trạng máy

```http
GET /api/machines/{machineId}/health
```

Nếu không tìm thấy máy, trả `404`. Nếu máy đã tồn tại nhưng không có
heartbeat gần đây, vẫn trả `200` với `status: "OFFLINE"` và `lastSeenAt` gần
nhất.

## 8. Yêu cầu an toàn và độ tin cậy

- Không tin `machineId` chỉ từ payload; phải đối chiếu với machineId trong
  MQTT topic.
- Không để một message malformed làm mất MQTT subscription.
- MQTT consumer phải tự reconnect khi broker mất kết nối.
- Không coi việc nhận được MQTT message là bằng chứng máy nhả hàng thành công.
  Kết quả nhả hàng chỉ cập nhật khi nhận event tương ứng.
- Không ghi password, token hoặc thông tin nhạy cảm vào log.
- Kiểm tra nhiệt độ nằm trong miền hợp lý của cảm biến; giá trị NaN,
  infinity hoặc sai kiểu phải bị từ chối.
- Các thay đổi endpoint phải cập nhật `api-contract/api.yaml`.

## 9. Tiêu chí nghiệm thu

- [ ] Backend nhận được status và heartbeat từ nhiều máy cùng lúc.
- [ ] Heartbeat cập nhật đúng `lastSeenAt` và thông tin chẩn đoán.
- [ ] Backend lưu và trả đúng `temperatureC` cùng `temperatureStatus`.
- [ ] Giá trị `null`, thiếu field, sai kiểu, NaN và infinity được xử lý an
      toàn.
- [ ] Nhiệt độ chuyển đúng các mức `NORMAL`, `WARNING`, `CRITICAL`.
- [ ] Máy tự chuyển `OFFLINE` sau khi quá timeout, kể cả khi không nhận
      Last Will.
- [ ] Máy tự chuyển lại `ONLINE` khi heartbeat quay trở lại.
- [ ] Message sai schema bị log và không làm consumer dừng.
- [ ] API danh sách và API health trả đúng dữ liệu.
- [ ] Có test cho các trường hợp: heartbeat bình thường, mất heartbeat,
      reconnect, Last Will `OFFLINE`, JSON sai và nhiều `machineId`.
- [ ] API contract và README backend được cập nhật.

## 10. Phụ thuộc với firmware

Backend và firmware cần thống nhất trước khi merge:

1. Chu kỳ heartbeat thực tế.
2. Tên field và kiểu dữ liệu trong JSON.
3. Firmware có gửi timestamp hay không.
4. Loại cảm biến nhiệt độ, đơn vị đo và độ chính xác.
5. Giá trị `temperatureC` khi cảm biến lỗi (`null` được khuyến nghị).
6. Danh sách event vận hành.
7. Chính sách tạo máy mới khi backend nhận `machineId` chưa đăng ký.
