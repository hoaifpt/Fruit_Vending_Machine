# Lịch sử sự kiện máy và nhật ký kiểm toán (issue #56)

Hai câu hỏi backend trả lời được sau issue này:

```text
"Máy FV-DEV-001 đã báo gì trước khi dừng?"   → GET /api/v1/machines/{id}/events
    STATUS_ONLINE → DISPENSE_ACCEPTED → DISPENSE_ABORTED (NO_BOWL_DETECTED)
    → BACKEND_DISPENSE_FAILED → BACKEND_MAINTENANCE_ENTERED
"Ai đã đổi gì, lúc nào?"                      → GET /api/v1/audit-logs
```

Lịch sử là **bằng chứng, không phải quy trình**: không phần nào của hệ thống đọc `machine_events` để ra quyết định. Cảnh báo (3.6)
sẽ dùng cùng các sự kiện miền.

## `machine_events` (V16)

| Cột | Ý nghĩa |
| --- | --- |
| `source` | `MACHINE` (tin MQTT của máy) hoặc `BACKEND` (quyết định của backend về máy) |
| `message_id` | `messageId` của envelope; bắt buộc với `MACHINE`, `NULL` với `BACKEND` |
| `event_type` | loại sự kiện (bảng dưới); từ vựng mở |
| `payload` | JSONB |
| `created_at` | giờ backend nhận tin / ra quyết định |

- `uq_machine_events_machine_message (machine_id, message_id)` một phần: MQTT gửi lại cùng tin thì chỉ có **một dòng**
  (`INSERT … ON CONFLICT DO NOTHING`). Cùng `messageId` ở máy khác là tin khác.
- `ix_machine_events_machine_type_time` cho lọc theo loại; `ix_machine_events_machine_time` (V7) cho dòng thời gian.
- Dòng có sẵn trước V16 (không có): không có `message_id` nên được đánh dấu `BACKEND` để qua CHECK; lựa chọn ghi trong PR.
- Chỉ thêm, không sửa/xóa: chỉ `MachineEventWriter` ghi (INSERT), entity `@Immutable`, repository đọc không có `save`/`delete`.

### Ghi những gì

| Nguồn | `event_type` | `payload` |
| --- | --- | --- |
| kênh `events` | `eventType` của tin (cả loại chưa biết); thiếu → `UNSPECIFIED`; dài hơn 64 ký tự → cắt còn 64 | payload của envelope |
| `status` ONLINE / OFFLINE | `STATUS_ONLINE` / `STATUS_OFFLINE` | payload của envelope |
| `heartbeat`, `telemetry` | **không ghi** (giá trị mới nhất ở `machines`, số đo ở `sensor_readings`, #53) | |
| `DispenseFailedEvent` | `BACKEND_DISPENSE_FAILED` | commandId, commandCode, orderId, slotId, slotCode, reason, bowlReturned |
| `DispenseLateSuccessEvent` | `BACKEND_DISPENSE_LATE_SUCCESS` | commandId, commandCode, orderId, slotId, slotCode |
| `DispenseMultipleBowlsEvent` | `BACKEND_DISPENSE_MULTIPLE_BOWLS` | như trên + bowlCount |
| `MachineMaintenanceEnteredEvent` | `BACKEND_MAINTENANCE_ENTERED` | reason |
| `MachineRebootDetectedEvent` | `BACKEND_REBOOT_DETECTED` | previousUptimeSeconds, newUptimeSeconds |

Tiền tố `BACKEND_` tách quyết định của backend khỏi loại do máy báo. Payload backend chỉ có id và lý do: không bí mật, không dữ liệu khách.

### Đường ghi

```text
MachineMessageHandler (sau khi envelope hợp lệ, #53)
   → MachineEventRecorder.recordMachineMessage   transaction riêng (REQUIRES_NEW), NEW hoặc DUPLICATE
   → xử lý nghiệp vụ như cũ (dispense, presence)  vẫn chạy cả khi là DUPLICATE (đã idempotent)
   lỗi ghi lịch sử → log ERROR, nghiệp vụ vẫn chạy, callback MQTT không bao giờ ném lỗi

Sự kiện miền (#52, #53)
   → @TransactionalEventListener(AFTER_COMMIT) MachineDomainEventListener
   → recordBackendEvent trong transaction mới    transaction nghiệp vụ rollback thì không có dòng nào
```

Tin không qua kiểm tra envelope (#53) không được ghi; chỉ nằm trong log ứng dụng.

## API

| Method | Endpoint | Quyền |
| --- | --- | --- |
| `GET` | `/api/v1/machines/{machineId}/events?type=&source=&from=&to=&page=&size=` | `MACHINE_READ` (ADMIN, STAFF) |
| `GET` | `/api/v1/audit-logs?action=&entityType=&entityId=&userId=&from=&to=&page=&size=` | `AUDIT_LOG_READ` (ADMIN) |
| `GET` | `/api/v1/audit-logs/{id}` | `AUDIT_LOG_READ` |

- Mọi bộ lọc đều tùy chọn; `from` (gồm) và `to` (không gồm) là ISO-8601, `to > from`; `size` 1..200 (mặc định 50); mới nhất trước
  (`createdAt DESC`, `id DESC`), lọc và phân trang trong DB. Sai tham số → 400; máy không có → 404; mục audit không có → 404.
- `payload` của sự kiện `MACHINE` là dữ liệu thiết bị không tin cậy: frontend phải hiển thị **đã escape**.
- Audit log: `userId`/`userEmail` null khi hệ thống tự đổi, `actor` = `"system"`. Không có endpoint ghi (POST/PUT/PATCH/DELETE → 405).
- Quyền mới `AUDIT_LOG_READ` (V16, UUID `20000000-0000-0000-0000-000000000016`) chỉ gán cho ADMIN.

## Kiểm chứng

`MachineEventLoggingIntegrationTest` (CHECK/index V16, ví dụ contract được ghi đúng một lần, tin gửi lại, tin sai, lỗi ghi giả lập,
sự kiện backend sau commit và khi rollback, API dòng thời gian và audit log, quyền).
