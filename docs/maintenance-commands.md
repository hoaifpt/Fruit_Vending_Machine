# Lệnh bảo trì từ xa (issue #64)

Khi máy ở `MAINTENANCE` (ngừng bán, cảm biến IR rảnh), Staff/Admin điều khiển cổng của từng cột từ portal; Admin gửi `RESET` để xóa
lỗi bộ điều khiển. **Tồn kho chỉ đổi sau khi máy xác nhận đã làm** (`*_COMPLETED`) hoặc khi Staff đối soát `DONE`.

```text
Portal ── POST lệnh ──> backend: máy MAINTENANCE + online, không lệnh nào đang chạy, đầu cột hợp lệ
            ↓ maintenance_commands (PENDING), commandId MC-…
dispatcher (1 lệnh / máy) ── MQTT commands ──> ESP32
            ← ACCEPTED / REJECTED / COMPLETED / ABORTED
COMPLETED → tồn kho (REMOVE) / cờ cổng nạp; ABORTED hoặc quá giờ sau ACCEPTED → NEEDS_RECONCILIATION (Staff xác nhận)
```

Hợp đồng MQTT (payload, chu trình cổng, event): [api-contract/mqtt-contract.md](../api-contract/mqtt-contract.md) §3.2, §3.3, §4.1.

## Thao tác

| `operation` | Máy làm | Khi COMPLETED |
| --- | --- | --- |
| `REMOVE_ITEM` | mở cổng dưới ~1,2 s → đóng → mở cổng trên (hộp kế tiếp xuống) → đóng | **chỉ** hộp đầu cột lúc tạo lệnh → `REMOVED`, một lịch sử `REMOVE`; nếu đầu cột đã đổi → không bỏ gì, `NEEDS_RECONCILIATION` (`HEAD_CHANGED`) |
| `EMPTY_COLUMN` | mở cổng dưới ~5 s → đóng (cổng trên không mở) | mọi hộp `AVAILABLE`/`EXPIRED`/`DISPENSE_FAILED` của cột → `REMOVED`, `removedCount` |
| `OPEN_REFILL` | mở cổng trên và giữ mở | `refillGateOpen = true`: cột không bán, không thể đặt ACTIVE |
| `CLOSE_REFILL` | đóng cổng trên | `refillGateOpen = false` |
| `RESET` (Admin) | xóa FAULT (firmware chưa có) | không đổi gì; `FAULT_CLEARED` đóng cảnh báo CONTROLLER_FAULT; máy vẫn MAINTENANCE |

Không bao giờ: xóa hộp, giảm số lượng lô, đổi trạng thái máy/cột, đổi đơn hàng hay hoàn tiền (bỏ hộp `DISPENSE_FAILED` không động
vào đơn). LOW_STOCK / PRODUCT_EXPIRED được health check (#58) tính lại ở lần chạy sau.

> Cần firmware xác nhận: `EMPTY_COLUMN` không mở cổng trên, nên các hộp nằm trên cổng trên có thể không rơi. Khi cần xả cả cột,
> Staff chạy `OPEN_REFILL` trước.

## Điều kiện tạo lệnh (kiểm tra dưới khóa)

Thứ tự khóa: khóa lệnh của máy (chung với dispense) → Machine → Slot → hộp đầu cột.

| Điều kiện | Lỗi |
| --- | --- |
| Máy tồn tại, cột thuộc máy | 404 |
| Máy `MAINTENANCE` | 409 `MACHINE_NOT_IN_MAINTENANCE` |
| Không có lệnh bảo trì chưa xong / lệnh dispense đang chạy (SENT, ACKNOWLEDGED) | 409 `MACHINE_COMMAND_IN_PROGRESS` |
| Máy ONLINE (#53) | 409 `MACHINE_OFFLINE` |
| Cột không có hộp `RESERVED` | 409 `SLOT_HAS_RESERVED_ITEM` |
| `REMOVE_ITEM`: có đầu cột; đầu cột là `AVAILABLE`/`EXPIRED`/`DISPENSE_FAILED`; `inventoryItemId` (nếu gửi) = đầu cột; cổng nạp đóng | 409 `SLOT_EMPTY` / `HEAD_NOT_REMOVABLE` / `NOT_HEAD_ITEM` / `REFILL_GATE_OPEN` |
| `EMPTY_COLUMN`: cột có hộp; cổng nạp đóng | 409 `SLOT_EMPTY` / `REFILL_GATE_OPEN` |
| `OPEN_REFILL`: cổng nạp đang đóng | 409 `REFILL_GATE_OPEN` |
| `CLOSE_REFILL`: luôn được (để khôi phục) | — |

Thông báo 409 bắt đầu bằng mã (`MACHINE_OFFLINE: …`). `reason` bắt buộc khi bỏ hộp (`EXPIRED`, `DAMAGED`, `DISPENSE_FAILED`,
`RESTOCK`, `INSPECTION`, `OTHER` + `note`), không dùng cho thao tác khác.

Header `Idempotency-Key` bắt buộc (8–64 ký tự `[A-Za-z0-9_-]`): cùng key + cùng body → 200 với lệnh cũ; cùng key, body khác → 409
`IDEMPOTENCY_KEY_REUSED`.

Dispense cũng chờ khi máy có lệnh bảo trì chưa xong, nên hai loại lệnh không bao giờ chạy chồng nhau.

## Vòng đời

```text
PENDING ──gửi──> SENT ──ACCEPTED──> ACCEPTED ──COMPLETED──> COMPLETED
   │               │                   └─ ABORTED / quá 90 s ──> NEEDS_RECONCILIATION ──đối soát──> RECONCILED
   │               ├─ REJECTED BUSY / trạng thái bận ──> vẫn SENT, gửi lại cùng mã mỗi 5 s
   │               ├─ REJECTED CONTROLLER_FAULT / state FAULT ──> FAILED
   │               ├─ REJECTED INVALID_* / UNSUPPORTED_SCHEMA ──> FAILED + log ERROR (lỗi backend)
   │               └─ không ACCEPTED trong 30 s từ lúc tạo ──> FAILED (ACCEPT_TIMEOUT)
   └─ máy offline / broker mất kết nối ──> vẫn PENDING cho tới ACCEPT_TIMEOUT
```

- `RESET`: `RESET_ACCEPTED` → `COMPLETED` ngay (RESET không có COMPLETED).
- ACCEPTED sau khi đã FAILED vì ACCEPT_TIMEOUT → `NEEDS_RECONCILIATION` (máy có thể đang chạy).
- COMPLETED muộn (sau FAILED / NEEDS_RECONCILIATION) → áp dụng một lần, `COMPLETED`.
- COMPLETED lặp lại, event sai loại lệnh (ví dụ `EMPTY_COLUMN_COMPLETED` cho lệnh REMOVE_ITEM), mã lạ, máy khác → bỏ qua (vẫn
  ghi lịch sử máy #56).
- Cấu hình: `MAINT_CMD_RESEND` (PT5S), `MAINT_CMD_ACCEPT_TIMEOUT` (PT30S), `MAINT_CMD_COMPLETE_TIMEOUT` (PT90S); dispatcher 1 s.

## Đối soát

`POST /api/v1/maintenance-commands/{id}/reconcile` `{ "outcome": "DONE" | "NOT_DONE", "note": "…" }` — chỉ cho lệnh
`NEEDS_RECONCILIATION` (không áp dụng cho RESET).

- `DONE`: áp dụng hiệu ứng như COMPLETED (cùng kiểm tra; 409 `EFFECT_NOT_POSSIBLE` nếu đầu cột không còn là hộp mục tiêu).
- `NOT_DONE`: không đổi tồn kho.
- Cả hai: `RECONCILED`, người/giờ đối soát, một dòng `audit_logs` `MAINTENANCE_COMMAND_RECONCILED`; lần thứ hai → 409 `NOT_RECONCILABLE`.

## API

| Method | Endpoint | Quyền |
| --- | --- | --- |
| `POST` | `/api/v1/machines/{machineId}/slots/{slotId}/maintenance-commands` | `MAINTENANCE_COMMAND_EXECUTE` (ADMIN, STAFF) |
| `POST` | `/api/v1/machines/{machineId}/reset` | `MACHINE_RESET` (ADMIN) |
| `GET` | `/api/v1/maintenance-commands` (machineId, slotId, operation, status, from, to; mới nhất trước) | `MAINTENANCE_COMMAND_READ` (ADMIN, STAFF) |
| `GET` | `/api/v1/maintenance-commands/{id}` | `MAINTENANCE_COMMAND_READ` |
| `POST` | `/api/v1/maintenance-commands/{id}/reconcile` | `MAINTENANCE_COMMAND_EXECUTE` |

Response 201 trả lệnh ở `PENDING`; lệnh được gửi ngay sau commit (theo dõi `status` qua GET). Response của slot có thêm
`refillGateOpen`. Swagger tag `Maintenance Commands`, hợp đồng `api-contract/api.yaml`.

## Database (V19)

`maintenance_commands` (một lệnh chưa xong mỗi máy bằng partial unique index), `machine_slots.refill_gate_open`, quyền
`MAINTENANCE_COMMAND_READ`, `MAINTENANCE_COMMAND_EXECUTE`, `MACHINE_RESET`. Chi tiết: [database-migration.md](database-migration.md).

## Kiểm thử

`MaintenanceCommandIntegrationTest` (transport ghi lại lệnh, clock điều khiển được, PostgreSQL thật: schema, điều kiện tạo,
idempotency, quyền, vòng đời, hết giờ, hiệu ứng, dispense chờ, đối soát, RESET) và `MaintenanceCommandDocumentationTest`.

## Gắn với work order (issue #68)

Lệnh bảo trì có thể gửi kèm `"workOrderId"`: work order IN_PROGRESS của cùng máy mà người gọi được phép thực hiện (khác máy → 409
`WORK_ORDER_OTHER_MACHINE`, chưa bắt đầu → 409 `WORK_ORDER_NOT_IN_PROGRESS`, của người khác → 404). Dùng khi xả tô cũ trong lúc nạp hàng;
số tô đã bỏ hiện trong `GET /api/v1/work-orders/{id}/restock` ([restock.md](restock.md)).
