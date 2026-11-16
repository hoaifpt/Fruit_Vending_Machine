# Tài liệu tích hợp Backend - Phần cứng (ESP32) & Nghiệp vụ Staff

> **Dành cho:** thành viên phụ trách Backend (Spring Boot 3 / PostgreSQL 18).
> **Mục tiêu:** danh sách việc để backend theo kịp firmware ESP32 hiện tại (khay A/B, heartbeat, bảo trì / nạp hàng 2 pha).
> **Định dạng message:** chỉ có trong [api-contract/mqtt-contract.md](../api-contract/mqtt-contract.md) và
> `api-contract/mqtt/examples/`. Tài liệu này không chép lại payload; trạng thái từng message xem cột Status của contract.

---

## 1. Firmware hiện có những gì

Firmware trên `dev` mới có `DISPENSE` (đọc `column` 1/2 hoặc `slot`), `status` và `BOWL_SENSOR_TRIGGERED`. Ba khả năng dưới đây
đã có ở nhánh firmware `feature/firmware-staff-refill-and-maintenance` nhưng **chưa merge vào `dev`** (contract ghi `PLANNED`):

1. **`DISPENSE`** nhận `columnCode` `"A"`/`"B"` (contract §3.1). Thiếu `columnCode` thì firmware dùng `"A"`.
2. **Heartbeat** mỗi 30 giây trên kênh `heartbeat` (contract §5.2).
3. **Bảo trì** (contract §3.2): `MAINTENANCE_REMOVE_ITEM`, `MAINTENANCE_EMPTY_COLUMN`, `MAINTENANCE_OPEN_REFILL`,
   `MAINTENANCE_CLOSE_REFILL`, trả lời bằng event `MAINTENANCE_<thao tác>_<phase>` (contract §4.1).

Hằng số phía backend (kênh, loại lệnh, loại event, mã lỗi) nằm ở `backend/.../mqtt/contract/`; dùng chúng, không viết lại chuỗi.

---

## 2. Việc 1 — gửi `columnCode` trong `DISPENSE` (backlog 3.3)

- `dispense_commands` đã có `slot_id`; khi gửi lệnh, lấy `slot_code` của ngăn (giới hạn A/B trong 3.3) làm `columnCode`.
- Thêm trường vào `MachineCommands.dispense(...)`; test `MqttContractDocumentationTest` khi đó phải bỏ ngoại lệ "columnCode pending".
- Đổi trạng thái `columnCode` trong contract từ `BACKEND_PENDING` sang `IMPLEMENTED` (minor version).

---

## 3. Việc 2 — nhận heartbeat (backlog 3.4)

- Thêm `MachineChannel.HEARTBEAT` vào danh sách subscribe (`MachineChannel.SUBSCRIBED`).
- Xử lý theo [backend-machine-health-implementation.md](backend-machine-health-implementation.md): cập nhật `last_seen_at`,
  lưu `wifiRssi`, `freeHeap`, `uptimeSeconds`, `firmwareVersion` (thiếu thì `null`).
- Job phát hiện offline: ngưỡng **180 giây** không có tin (contract §7), không dùng ngưỡng khác.

---

## 4. Việc 3 — API và luồng MQTT cho bảo trì / nạp hàng (backlog 4.2)

Chi tiết nghiệp vụ, API đề xuất và quy tắc tồn kho: [backend-maintenance-clear-column.md](backend-maintenance-clear-column.md).

| API đề xuất | Lệnh MQTT |
|---|---|
| `POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/open-refill` | `MAINTENANCE_OPEN_REFILL` |
| `POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/close-refill` | `MAINTENANCE_CLOSE_REFILL` |
| `POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/remove-item` | `MAINTENANCE_REMOVE_ITEM` |
| `POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/empty` | `MAINTENANCE_EMPTY_COLUMN` |

Quyền theo permission (issue #48), không theo role. Endpoint không được mở cho kiosk.

---

## 5. Việc 4 — định tuyến event bảo trì trong `MachineMessageHandler`

Hiện handler chỉ chuyển event có prefix `MachineEventType.DISPENSE_PREFIX` cho `DispenseService`; event khác được bỏ qua.
Trong 4.2 thêm nhánh cho các event `MAINTENANCE_*` (danh sách đầy đủ: `MachineEventType.ALL`) chuyển cho service bảo trì,
truyền cả `details` (`commandId`, `columnCode`, `operation`, `state`).

---

## 6. Checklist nghiệm thu

- [ ] Lệnh `DISPENSE` gửi kèm `columnCode` `"A"` hoặc `"B"`.
- [ ] Backend subscribe `heartbeat` và cập nhật `last_seen_at` cùng `wifiRssi`, `freeHeap`.
- [ ] Nạp 2 pha: mở cổng trên → thả 1 hộp → đóng cổng trên → đổ đầy cột → ghi nhận qua `/api/v1/inventory/load`.
- [ ] Gỡ hộp hư hoặc xả ngăn cập nhật đúng `inventory_items` và ghi `inventory_transactions`.
- [ ] Endpoint bảo trì trả `401`/`403` cho kiosk và người không có permission.
