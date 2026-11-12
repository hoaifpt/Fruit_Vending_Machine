# Hợp đồng nháp (draft)

API mà frontend cần nhưng backend chưa có. Nguồn chính thức vẫn là `../api.yaml`.

## Quy ước

- Mỗi nhóm API một file `<nhóm>.yaml`, là OpenAPI 3.1 độc lập (tự khai báo schema nó dùng, kể cả khuôn `{ data, timestamp }` và `ApiErrorResponse`).
- Issue nào cần API mới thì thêm draft trong chính issue đó. Không vẽ trước API của milestone sau.
- Sinh type sau mỗi lần sửa: trong `apps/web` chạy `npm run gen:api:drafts`, kết quả nằm ở `apps/web/src/api/drafts/<nhóm>.d.ts` và được commit.
- Mock (`apps/web/src/api/mock`) có handler theo draft để màn hình chạy được trước khi có backend.
- Khi backend xong: đưa path vào `api.yaml`, chạy `npm run gen:api`, xóa file draft và file `.d.ts` tương ứng, chuyển code sang type trong `schema.d.ts`.

## Danh sách

| File | Endpoint | Issue | Trạng thái |
| --- | --- | --- | --- |
| `auth-me.yaml` | `GET /api/v1/auth/me` | FE 2.1 | Đề nghị BE thêm mới |
| `roles-permissions.yaml` | `GET /api/v1/permissions`, `GET /api/v1/roles`, `GET /api/v1/roles/{id}`, `PUT /api/v1/roles/{id}/permissions` | FE 3.2 | Chép nguyên từ nhánh BE #48 (`feature/48-permission-authorization`), chờ merge vào `dev` |
| `dispense-commands.yaml` | `GET /api/v1/orders/{orderId}/dispense-commands` | FE 6.1 | Đề nghị BE thêm trong BE 3.3; tên field/enum theo entity `DispenseCommand` và enum `DispenseStatus` đã có ở backend |
| `alerts.yaml` | `GET /api/v1/alerts`, `GET /api/v1/alerts/{id}`, `POST /api/v1/alerts/{id}/acknowledge`, `POST /api/v1/alerts/{id}/resolve` | FE 6.3 | Đề nghị BE thêm trong BE 3.6; tên field/enum theo entity `Alert` (bảng `alerts`, V4) và enum `AlertType`, `AlertSeverity`, `AlertStatus`. Đề nghị thêm cột `acknowledged_at`, `acknowledged_by`, `resolution_note`, `slot_id`, `order_id` và quyền `ALERT_READ`, `ALERT_WRITE` (ADMIN, STAFF) |
| `machine-telemetry.yaml` | `GET /api/v1/machines/{machineId}/heartbeat`, `GET /api/v1/machines/{machineId}/sensor-readings`, `GET /api/v1/machines/{machineId}/events` | FE 6.4 | Đề nghị BE thêm trong BE 3.4/3.5; tên theo bảng `sensor_readings` (V4), `machine_events` (V6), `machines.last_seen_at` và payload firmware. Quyền `MACHINE_READ`. Đề nghị firmware gửi heartbeat ≤ 60 s kèm `rssi`, `dispenseState`, sự kiện `FAULT` có `code` |
| `work-tickets.yaml` | `GET /api/v1/work-tickets`, `POST /api/v1/work-tickets`, `GET /api/v1/work-tickets/{id}`, `POST /api/v1/work-tickets/{id}/assign`, `POST /api/v1/work-tickets/{id}/start`, `POST /api/v1/work-tickets/{id}/complete`, `POST /api/v1/work-tickets/{id}/cancel` | FE 7.1 | Đề nghị BE thêm trong BE 4.3 (chưa có bảng). Vòng đời OPEN → ASSIGNED → IN_PROGRESS → COMPLETED, CANCELLED trước khi hoàn tất; mỗi bước ghi người và thời điểm, hủy bắt buộc lý do, không xóa. Đề nghị quyền `TICKET_READ` (ADMIN, STAFF) và `TICKET_WRITE` (ADMIN); tài khoản không có `TICKET_WRITE` chỉ nhận phiếu giao cho mình (server lọc), chỉ người được giao mới bắt đầu/hoàn tất. Dòng nạp hàng của phiếu RESTOCK để FE 7.2 |
| `maintenance-schedules.yaml` | `GET /api/v1/maintenance-schedules`, `POST /api/v1/maintenance-schedules`, `GET /api/v1/maintenance-schedules/{id}`, `PATCH /api/v1/maintenance-schedules/{id}`, `POST /api/v1/maintenance-schedules/{id}/deactivate`, `POST /api/v1/maintenance-schedules/{id}/activate` | FE 7.3 | Đề nghị BE thêm trong BE 4.5 (chưa có bảng). Chu kỳ `intervalDays` 1..365 ngày, server tính `nextDueAt` (đầu ngày đến hạn, giờ Việt Nam) theo quy tắc: ngày gốc (lần hoàn tất gần nhất, nếu chưa có thì `startDate`) + N ngày, nếu đã qua thì cộng tiếp từng chu kỳ. Đề nghị job hằng ngày mở phiếu MAINTENANCE (draft `work-tickets.yaml`) khi lịch đến hạn và chưa có phiếu mở; phiếu COMPLETED thì `lastCompletedAt` = lúc hoàn tất và chu kỳ mới bắt đầu. Không xóa, chỉ tạm dừng/bật lại. Đề nghị quyền `MAINTENANCE_SCHEDULE_READ` (ADMIN, STAFF) và `MAINTENANCE_SCHEDULE_WRITE` (ADMIN) |
