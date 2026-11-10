# Backend contract: staff maintenance operations

Hướng dẫn cho backlog 4.2. Lệnh MQTT (`MAINTENANCE_REMOVE_ITEM`, `MAINTENANCE_EMPTY_COLUMN`, `MAINTENANCE_OPEN_REFILL`,
`MAINTENANCE_CLOSE_REFILL`), chu trình cơ khí và thời gian giữ cổng, event `MAINTENANCE_<thao tác>_<ACCEPTED|REJECTED|COMPLETED|ABORTED>`
cùng `details`, timeout và quy tắc tồn kho được định nghĩa duy nhất trong
[api-contract/mqtt-contract.md](../api-contract/mqtt-contract.md) §3.2, §4.1 và §7.
Ví dụ lệnh: `api-contract/mqtt/examples/command-maintenance-remove-item.json`. Trạng thái: `PLANNED` — firmware đã làm ở nhánh `feature/firmware-staff-refill-and-maintenance` (chưa merge vào `dev`), backend chưa làm.

## Mục đích

1. `REMOVE_ITEM`: bỏ **hộp ở đáy cột** (hộp đang ở vị trí bán, hư hoặc hết hạn), rồi đưa hộp kế tiếp xuống vị trí bán.
2. `EMPTY_COLUMN`: xả toàn bộ hộp của một cột để thay hàng hoặc xử lý nguyên cột hư.
3. `OPEN_REFILL` / `CLOSE_REFILL`: nạp hàng 2 pha (mở cổng trên để thả hộp đầu tiên vào vị trí bán, đóng lại rồi đổ đầy cột).

Đây là thao tác bảo trì, không dùng lệnh `DISPENSE` và không dùng trạng thái order/dispense.

## Quyền và điều kiện

- Quyền kiểm tra bằng permission ở backend (issue #48); permission cụ thể được thêm cùng 4.2. Firmware không xác thực staff.
- Chỉ khi máy ở trạng thái `MAINTENANCE`; mỗi máy một lệnh tại một thời điểm (firmware từ chối lệnh thứ hai).
- Backend kiểm tra máy, ngăn (`slot_code` A/B = `columnCode`) và quan hệ tồn tại; yêu cầu lý do (`EXPIRED`, `DAMAGED`, …).
- Với `EMPTY_COLUMN`, UI cảnh báo rõ toàn bộ hàng trong cột sẽ bị xả.

## API đề xuất

```http
POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/remove-item   { "reason": "DAMAGED" }
POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/empty         { "reason": "EXPIRED" }
POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/open-refill
POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance/close-refill
Idempotency-Key: <unique-operation-key>
```

- `remove-item` **không** nhận `inventoryItemId`: cơ khí chỉ nhả được hộp ở đáy, nên backend gỡ đầu ngăn (slot head),
  không bao giờ gỡ hộp do staff chọn.
- Backend tạo `commandId` ổn định cho operation (`MC-…`, theo giới hạn `commandId` của contract); cùng `Idempotency-Key`
  thì dùng lại `commandId` cũ. Gửi lại luôn cùng `commandId`.
- Endpoint mới phải có Swagger và `api-contract/api.yaml` trong cùng issue.

## Cập nhật inventory

Không đổi tồn kho khi mới nhận `*_ACCEPTED`.

### Sau `MAINTENANCE_REMOVE_ITEM_COMPLETED`

1. Khóa máy/ngăn và hộp đầu ngăn.
2. Chuyển hộp đầu ngăn sang `REMOVED`, ghi một inventory transaction `REMOVE` với lý do của request và actor từ JWT.
3. Đánh dấu operation `COMPLETED`.

Nếu đầu ngăn không còn là hộp vật lý hợp lệ (ví dụ đang `RESERVED`), chuyển operation sang `NEEDS_RECONCILIATION`, không tự gỡ hộp khác.

### Sau `MAINTENANCE_EMPTY_COLUMN_COMPLETED`

1. Khóa máy/ngăn và các hộp trong ngăn.
2. Chuyển các hộp `AVAILABLE`, `EXPIRED` và `DISPENSE_FAILED` sang `REMOVED`, mỗi hộp một transaction `REMOVE`.
3. Giữ nguyên lịch sử; không xóa inventory item, không giảm `product_batches.quantity`.
4. Hộp `RESERVED` không tự đổi trạng thái; backend báo số hộp cần staff đối soát. Đánh dấu operation `COMPLETED`.

`OPEN_REFILL` / `CLOSE_REFILL` không đổi tồn kho; hàng được ghi nhận qua `POST /api/v1/inventory/load` như hiện nay.

Nhận `*_ABORTED` hoặc hết giờ: không tự đổi tồn kho, chuyển operation sang `FAILED` hoặc `NEEDS_RECONCILIATION`.

## Trạng thái operation

```text
PENDING → SENT → ACCEPTED → COMPLETED
                         ↘ FAILED | NEEDS_RECONCILIATION
```

Máy offline: giữ `PENDING`. Xử lý event idempotent theo `commandId` và loại operation (event trùng không tạo transaction trùng).

## Tiêu chí review backend

- [ ] Người có permission gọi được API; người không có quyền nhận `403`.
- [ ] Mỗi API tạo đúng loại lệnh MQTT, kèm `columnCode`.
- [ ] Idempotency key giữ nguyên `commandId`.
- [ ] Event được nhận theo đúng prefix của thao tác.
- [ ] Chỉ đổi tồn kho sau `COMPLETED`.
- [ ] `REMOVE_ITEM` chỉ gỡ hộp đầu ngăn.
- [ ] `EMPTY_COLUMN` gỡ các hộp `AVAILABLE`, `EXPIRED`, `DISPENSE_FAILED` của ngăn.
- [ ] Timeout/abort tạo reconciliation, không mất dữ liệu.
- [ ] Event trùng không tạo inventory transaction trùng.
- [ ] Test: máy offline, đang dispense, ngăn A/B, ngăn rỗng, ngăn nhiều hộp.
