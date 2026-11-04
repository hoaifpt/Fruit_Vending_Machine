# Backend contract: staff maintenance operations

## Mục đích

Firmware hỗ trợ hai nghiệp vụ bảo trì độc lập:

1. `MAINTENANCE_REMOVE_ITEM`: lấy một sản phẩm hư/hết hạn trong cột, sau đó
   đưa sản phẩm kế tiếp vào vị trí bán.
2. `MAINTENANCE_EMPTY_COLUMN`: xả toàn bộ sản phẩm trong một cột để thay hàng
   hoặc xử lý nguyên cột hư.

Đây là thao tác bảo trì, không dùng command `DISPENSE`.

## Quyền và xác nhận

- Chỉ tài khoản `STAFF` hoặc `ADMIN` đang hoạt động được gọi API.
- Backend kiểm tra machine, column/slot và quan hệ tồn tại.
- Backend yêu cầu lý do: `EXPIRED`, `DAMAGED` hoặc lý do bảo trì hợp lệ.
- Với `EMPTY_COLUMN`, UI phải cảnh báo rõ toàn bộ hàng trong cột sẽ bị xả.
- Firmware không xác thực quyền staff; quyền thuộc hoàn toàn backend.

## API đề xuất

### Lấy một sản phẩm

```http
POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/remove-item
Authorization: ******
Content-Type: application/json
Idempotency-Key: <unique-operation-key>
```

```json
{
  "reason": "DAMAGED",
  "inventoryItemId": "item-123"
}
```

`inventoryItemId` chỉ phục vụ backend đối soát; firmware chỉ cần điều khiển
cột nên không cần nhận trường này.

### Xả toàn bộ cột

```http
POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/empty
Authorization: ******
Content-Type: application/json
Idempotency-Key: <unique-operation-key>
```

```json
{
  "reason": "EXPIRED"
}
```

Backend tạo `commandId` ổn định cho operation, ví dụ `MC-<operation-uuid>`.
Request gửi lại với cùng `Idempotency-Key` phải dùng lại `commandId` cũ.

## MQTT command

Topic:

```text
vending/{machineCode}/commands
```

Envelope lấy một sản phẩm:

```json
{
  "schemaVersion": 1,
  "messageId": "backend-message-uuid",
  "machineCode": "FV-DEV-001",
  "payload": {
    "type": "MAINTENANCE_REMOVE_ITEM",
    "commandId": "MC-7f6d2d7e",
    "columnCode": "A"
  }
}
```

Envelope xả toàn bộ cột:

```json
{
  "schemaVersion": 1,
  "messageId": "backend-message-uuid",
  "machineCode": "FV-DEV-001",
  "payload": {
    "type": "MAINTENANCE_EMPTY_COLUMN",
    "commandId": "MC-7f6d2d7e",
    "columnCode": "A"
  }
}
```

Firmware chỉ nhận command nếu `machineCode` trùng máy. `commandId` chỉ dùng
`[A-Za-z0-9_-]`, tối đa 39 ký tự. `columnCode` nhận `A` hoặc `B`.

Mapping phần cứng:

```text
Stack A: lower = servo 1, upper = servo 2
Stack B: lower = servo 3, upper = servo 4
```

## Chu trình firmware

### `MAINTENANCE_REMOVE_ITEM`

```text
mở cổng dưới
→ giữ mở khoảng 1.2 giây để staff lấy một item
→ đóng cổng dưới
→ mở cổng trên
→ giữ theo REFILL_HOLD_MS
→ đóng cổng trên
→ COMPLETED
```

### `MAINTENANCE_EMPTY_COLUMN`

```text
mở cổng dưới
→ giữ mở khoảng 5 giây để staff lấy toàn bộ hàng
→ đóng cổng dưới
→ COMPLETED
```

Cổng trên không mở trong chế độ `EMPTY_COLUMN`, vì cột được chủ động làm
rỗng. Thời gian giữ được cấu hình trong `app_config.h`.

## Event firmware

Event gửi trên `vending/{machineCode}/events`. Prefix event phải khớp loại
operation:

- `MAINTENANCE_REMOVE_ITEM_ACCEPTED`
- `MAINTENANCE_REMOVE_ITEM_REJECTED`
- `MAINTENANCE_REMOVE_ITEM_COMPLETED`
- `MAINTENANCE_REMOVE_ITEM_ABORTED`
- `MAINTENANCE_EMPTY_COLUMN_ACCEPTED`
- `MAINTENANCE_EMPTY_COLUMN_REJECTED`
- `MAINTENANCE_EMPTY_COLUMN_COMPLETED`
- `MAINTENANCE_EMPTY_COLUMN_ABORTED`

Payload accepted/completed/aborted có dạng:

```json
{
  "eventType": "MAINTENANCE_REMOVE_ITEM_COMPLETED",
  "details": {
    "commandId": "MC-7f6d2d7e",
    "columnCode": "A",
    "operation": "REMOVE_ITEM"
  }
}
```

Event rejected có thêm `state` để backend biết firmware đang bận hoặc fault:

```json
{
  "eventType": "MAINTENANCE_EMPTY_COLUMN_REJECTED",
  "details": {
    "commandId": "MC-7f6d2d7e",
    "state": "DISPENSING"
  }
}
```

Firmware từ chối khi đang dispense, đang xử lý maintenance khác hoặc đang
`FAULT`. Firmware hiện tại dùng một controller chung nên chỉ chạy một command
tại một thời điểm; backend phải serialize command theo machine để tránh tranh
chấp cơ khí. Hai nghiệp vụ vẫn có thể được hỗ trợ đồng thời ở tầng backend,
nhưng command thứ hai phải chờ command thứ nhất kết thúc.

## Cập nhật inventory

Không remove inventory khi mới nhận `*_ACCEPTED`.

### Sau `MAINTENANCE_REMOVE_ITEM_COMPLETED`

1. Khóa machine/column và item liên quan.
2. Chuyển đúng item staff đã chọn sang `REMOVED`.
3. Ghi một inventory transaction `REMOVE`.
4. Ghi reason từ request và actor từ JWT.
5. Đánh dấu maintenance operation `COMPLETED`.

Nếu item không còn `AVAILABLE`/`EXPIRED`, backend phải chuyển operation sang
`NEEDS_RECONCILIATION`, không tự ý remove item khác.

### Sau `MAINTENANCE_EMPTY_COLUMN_COMPLETED`

1. Khóa machine/column và inventory item trong cột.
2. Chuyển các item vật lý `AVAILABLE` hoặc `EXPIRED` sang `REMOVED`.
3. Ghi một inventory transaction `REMOVE` cho từng item.
4. Giữ nguyên lịch sử; không xóa inventory item và không giảm
   `product_batches.quantity`.
5. Đánh dấu operation `COMPLETED`.

Các item `RESERVED`, `SOLD`, `DISPENSE_FAILED` hoặc `REMOVED` không tự động
đổi trạng thái. Backend phải báo số item cần staff đối soát.

Nếu nhận `*_ABORTED` hoặc timeout, không tự động remove inventory. Chuyển
operation sang `FAILED` hoặc `NEEDS_RECONCILIATION`.

## Timeout, retry và trạng thái

- Chờ `ACCEPTED`: 30 giây.
- Chờ `COMPLETED`: 90 giây.
- Retry dùng cùng `commandId`, không tạo command mới.
- Máy offline: `PENDING` hoặc `WAITING_MACHINE`.
- Xử lý idempotent theo `messageId`, `commandId` và loại operation.

Trạng thái operation:

```text
PENDING
SENT
ACCEPTED
COMPLETED
FAILED
NEEDS_RECONCILIATION
```

Không dùng trạng thái order/dispense cho maintenance operation.

## Tiêu chí review backend

- [ ] STAFF/ADMIN gọi được API; user không có quyền nhận `403`.
- [ ] Hai API tạo đúng loại MQTT command.
- [ ] Idempotency key giữ nguyên `commandId`.
- [ ] Event prefix đúng loại operation.
- [ ] Chỉ remove inventory sau `COMPLETED`.
- [ ] `REMOVE_ITEM` chỉ remove item được chọn.
- [ ] `EMPTY_COLUMN` remove các item hợp lệ trong cột.
- [ ] Timeout/abort tạo reconciliation, không làm mất dữ liệu.
- [ ] Event trùng không tạo inventory transaction trùng.
- [ ] Test machine offline, đang dispense, cột A/B, cột rỗng và cột nhiều item.
