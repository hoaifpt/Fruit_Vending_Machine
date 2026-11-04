# Tài liệu tích hợp Backend - Phần cứng (ESP32) & Nghiệp vụ Staff

> **Dành cho:** Thành viên phụ trách Backend (Spring Boot 3 / PostgreSQL 18).  
> **Mục tiêu:** Đồng bộ toàn diện hệ thống Backend với Firmware ESP32 mới nhất (hỗ trợ đa khay A/B, giám sát Heartbeat, và toàn bộ luồng Bảo trì / Nạp hàng 2 pha của Staff).

---

## 1. Tổng quan các thay đổi từ Firmware ESP32

Firmware hiện tại đã hoàn thiện các khả năng sau:
1. **Lệnh Mua hàng (`DISPENSE`):** Hỗ trợ nhận diện khay chứa qua trường `columnCode` (`"A"` hoặc `"B"`).
2. **Giám sát sức khỏe (`HEARTBEAT`):** Gửi định kỳ mỗi 30 giây lên topic `vending/{machineCode}/heartbeat`.
3. **Nghiệp vụ Nhân viên / Bảo trì (`MAINTENANCE`):**
   * `MAINTENANCE_REMOVE_ITEM`: Nhả 1 hộp hư/hết hạn ra khỏi cột và nạp hộp kế tiếp vào vị trí bán.
   * `MAINTENANCE_EMPTY_COLUMN`: Xả sạch toàn bộ hộp trong cột (mở cổng dưới 5s).
   * `MAINTENANCE_OPEN_REFILL`: Mở cổng trên (Servo 2 hoặc 4) để Staff thả 1 tô mồi đầu tiên vào vị trí bán.
   * `MAINTENANCE_CLOSE_REFILL`: Đóng cổng trên lại an toàn để Staff đổ đầy các tô còn lại vào cột.

---

## 2. Nhiệm vụ 1: Bổ sung `columnCode` vào lệnh nhả hàng `DISPENSE`

### 2.1. Vấn đề
Hiện tại trong `backend/src/main/java/com/fruitmachine/backend/mqtt/MqttMachineGateway.java` (dòng 103), Backend mới chỉ gửi:
```json
{
  "schemaVersion": 1,
  "messageId": "uuid-...",
  "machineCode": "FV-DEV-001",
  "payload": {
    "type": "DISPENSE",
    "commandId": "D-12345678"
  }
}
```

### 2.2. Yêu cầu sửa đổi
1. Trong CSDL bảng `dispense_commands` đã có `slot_id`.
2. Khi `DispenseService.java` gọi `gateway.sendDispense(...)`, hãy truy xuất mã khay từ `slot.getSlotCode()` (ví dụ `"A"` hoặc `"B"`).
3. Đóng gói thêm `"columnCode"` vào payload MQTT gửi xuống ESP32:
```json
{
  "schemaVersion": 1,
  "messageId": "uuid-...",
  "machineCode": "FV-DEV-001",
  "payload": {
    "type": "DISPENSE",
    "commandId": "D-12345678",
    "columnCode": "A"
  }
}
```

---

## 3. Nhiệm vụ 2: Subscribe Topic & Tiếp nhận Heartbeat định kỳ

### 3.1. Subscribe thêm Topic
Trong `MqttMachineGateway.java` (hàm `connectComplete`):
* Hiện tại:
  ```java
  client.subscribe(new String[] {root + "/+/events", root + "/+/status"}, new int[] {QOS, QOS});
  ```
* **Cần sửa thành:**
  ```java
  client.subscribe(new String[] {root + "/+/events", root + "/+/status", root + "/+/heartbeat"}, new int[] {QOS, QOS, QOS});
  ```

### 3.2. Bóc tách Telemetry và Phát hiện Máy Offline
Firmware gửi mỗi 30s lên topic `vending/{machineCode}/heartbeat`:
```json
{
  "schemaVersion": 1,
  "messageId": "bootId-seq",
  "machineCode": "FV-DEV-001",
  "payload": {
    "state": "ONLINE",
    "uptimeSeconds": 12345,
    "wifiRssi": -55,
    "freeHeap": 18240,
    "firmwareVersion": "0.3.0"
  }
}
```

**Yêu cầu xử lý trong `MachineMessageHandler.java`:**
1. Khi `channel.equals("heartbeat")`:
   * Cập nhật `machines.last_seen_at = now()`.
   * Bóc tách các trường: `wifiRssi`, `freeHeap`, `uptimeSeconds`, `firmwareVersion` và lưu vào bảng `machines` (hoặc bảng `sensor_readings`).
2. **Cơ chế phát hiện máy mất kết nối (Offline Scanner):**
   * Tạo 1 `@Scheduled(fixedRate = 30000)`: Kiểm tra các máy có `now - last_seen_at > 90 giây` $\rightarrow$ Tự động chuyển `health_status` sang `WARNING` hoặc `OFFLINE` trên Web quản trị.

---

## 4. Nhiệm vụ 3: Hệ thống API & Luồng MQTT cho Nghiệp vụ Staff (Maintenance & Refill)

Chỉ tài khoản có vai trò **`ROLE_STAFF`** hoặc **`ROLE_ADMIN`** mới được phép gọi các API này.

### 4.1. Danh sách 4 API REST cần xây dựng

Tạo Controller mới: `com.fruitmachine.backend.machine.maintenance.controller.StaffMaintenanceController`

#### API 1: Mở cổng trên để nạp mồi (`OPEN_REFILL`)
* **Endpoint:** `POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/open-refill`
* **Mô tả:** Mở cổng trên của khay để Staff thả tô mồi đầu tiên xuống cổng dưới.
* **Hành vi Backend:**
  1. Kiểm tra quyền STAFF/ADMIN.
  2. Tạo mã `commandId` (ví dụ `REF-<uuid ngắn>`).
  3. Bắn MQTT command `MAINTENANCE_OPEN_REFILL`:
     ```json
     {
       "schemaVersion": 1,
       "messageId": "msg-...",
       "machineCode": "FV-DEV-001",
       "payload": {
         "type": "MAINTENANCE_OPEN_REFILL",
         "commandId": "REF-001",
         "columnCode": "A"
       }
     }
     ```
  4. Trả về HTTP 200 kèm `commandId`.

#### API 2: Đóng cổng trên sau khi nạp mồi (`CLOSE_REFILL`)
* **Endpoint:** `POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/close-refill`
* **Mô tả:** Đóng cổng trên lại an toàn trước khi Staff đổ đầy các tô còn lại vào cột.
* **Hành vi Backend:** Bắn MQTT command `MAINTENANCE_CLOSE_REFILL` kèm `columnCode` tương ứng.

#### API 3: Xả bỏ 1 tô trái cây bị hư / hết hạn (`REMOVE_ITEM`)
* **Endpoint:** `POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/remove-item`
* **Request Body:**
  ```json
  {
    "reason": "DAMAGED",
    "inventoryItemId": "uuid-cua-hop-hu"
  }
  ```
* **Hành vi Backend:** 
  1. Gửi MQTT command: `MAINTENANCE_REMOVE_ITEM` kèm `columnCode`.
  2. Khi nhận event `MAINTENANCE_REMOVE_ITEM_COMPLETED`: Chuyển hộp đó sang `status = REMOVED`, ghi lịch sử vào `inventory_transactions` với `type = REMOVE`, `reason = DAMAGED`, và `actor` là Staff đang đăng nhập.

#### API 4: Xả sạch toàn bộ cột (`EMPTY_COLUMN`)
* **Endpoint:** `POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/empty`
* **Request Body:** `{ "reason": "EXPIRED" }`
* **Hành vi Backend:**
  1. Gửi MQTT command: `MAINTENANCE_EMPTY_COLUMN` kèm `columnCode`.
  2. Khi nhận event `MAINTENANCE_EMPTY_COLUMN_COMPLETED`: Chuyển tất cả hộp `AVAILABLE` hoặc `EXPIRED` trong khay đó thành `REMOVED`.

---

## 5. Xử lý Event phản hồi từ Firmware trong `MachineMessageHandler.java`

Hiện tại file `MachineMessageHandler.java` đang chặn cứng:
```java
if (eventType.startsWith("DISPENSE_")) { ... }
```
**Cần mở rộng:**
```java
if (eventType.startsWith("DISPENSE_")) {
    dispense.handleMachineEvent(topicMachineCode, eventType, commandId);
} else if (eventType.startsWith("MAINTENANCE_")) {
    maintenanceService.handleMaintenanceEvent(topicMachineCode, eventType, commandId, payload);
}
```

Các event Firmware gửi về trên topic `vending/{machineCode}/events`:
* `MAINTENANCE_OPEN_REFILL_COMPLETED`
* `MAINTENANCE_CLOSE_REFILL_COMPLETED`
* `MAINTENANCE_REMOVE_ITEM_COMPLETED`
* `MAINTENANCE_EMPTY_COLUMN_COMPLETED`
* `MAINTENANCE_*_REJECTED` (khi máy đang bận hoặc đang lỗi)
* `MAINTENANCE_*_ABORTED` (khi gặp sự cố cơ khí)

---

## 6. Checklist nghiệm thu (Acceptance Criteria)

- [ ] Lệnh `DISPENSE` gửi kèm trường `"columnCode": "A"` hoặc `"B"`.
- [ ] Backend subscribe được `vending/+/heartbeat` và cập nhật `last_seen_at` cùng các chỉ số `wifiRssi`, `freeHeap`.
- [ ] Nhân viên có thể thực hiện quy trình nạp 2 pha: Mở cổng trên $\rightarrow$ Thả 1 tô $\rightarrow$ Đóng cổng trên $\rightarrow$ Thả hết các tô còn lại $\rightarrow$ Xác nhận lưu kho qua API `/api/v1/inventory/load`.
- [ ] Thao tác gỡ hộp hư hoặc xả khay cập nhật chính xác CSDL `inventory_items` và ghi nhật ký kiểm toán `inventory_transactions`.
- [ ] Không có endpoint bảo trì nào bị rò rỉ quyền ra Kiosk (`401`/`403` khi thiếu token STAFF/ADMIN).
