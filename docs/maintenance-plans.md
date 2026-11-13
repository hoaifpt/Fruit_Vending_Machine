# Lịch bảo trì định kỳ (issue #70, WF-04)

Admin lập **kế hoạch bảo trì** cho từng máy (làm gì, mỗi N ngày, giao cho ai); khi tới hạn hệ thống tự tạo **work order MAINTENANCE**
nguồn `SCHEDULE`, báo cho đúng người, và khi việc xong thì tính hạn kế tiếp. Bảo trì đột xuất vẫn dùng work order MAINTENANCE nguồn
MANUAL / ALERT (#66) và không bao giờ ảnh hưởng tới kế hoạch.

```text
Admin: "Vệ sinh khoang lạnh FV-01, mỗi 7 ngày, giao Bình", hạn đầu 20/11, báo trước 1 ngày
19/11: hệ thống tạo WO-… MAINTENANCE (SCHEDULE), hạn 17:00 ngày 20/11 → Bình nhận thông báo
Bình: bắt đầu (máy MAINTENANCE) → hoàn thành 20/11 → hạn kế tiếp 27/11
Admin: xem bảo trì sắp tới 30 ngày; toàn bộ lịch sử nằm dưới kế hoạch
```

Mọi ngày (`nextDueDate`, `scheduledFor`, `firstDueDate`) là ngày theo giờ Việt Nam (`app.business-zone`); `dueTime` là giờ địa phương.

## Kế hoạch

| Method | Endpoint | Quyền |
| --- | --- | --- |
| `POST` | `/api/v1/maintenance-plans` | `MAINTENANCE_PLAN_MANAGE` (ADMIN) |
| `GET` | `/api/v1/maintenance-plans` (machineId, active) | `MAINTENANCE_PLAN_READ` (ADMIN, STAFF) |
| `GET` | `/api/v1/maintenance-plans/{id}` | `MAINTENANCE_PLAN_READ` |
| `PATCH` | `/api/v1/maintenance-plans/{id}` | `MAINTENANCE_PLAN_MANAGE` |
| `POST` | `/api/v1/maintenance-plans/{id}/activate`, `/deactivate` | `MAINTENANCE_PLAN_MANAGE` |
| `POST` | `/api/v1/maintenance-plans/{id}/generate-now` | `MAINTENANCE_PLAN_MANAGE` |
| `GET` | `/api/v1/maintenance-plans/{id}/work-orders` | `MAINTENANCE_PLAN_READ` |
| `GET` | `/api/v1/maintenance-plans/upcoming?days=30&machineId=` | `MAINTENANCE_PLAN_READ` |

```json
{ "machineId": "…", "title": "Vệ sinh khoang lạnh", "instructions": "Lau khay, kiểm tra gioăng…",
  "intervalDays": 7, "leadDays": 1, "dueTime": "17:00", "priority": "NORMAL",
  "defaultAssigneeId": "…", "firstDueDate": "2026-11-20" }
```

- Máy tồn tại (404) và không INACTIVE (409 `MACHINE_INACTIVE`); `intervalDays` 1–365, `leadDays` 0–30 và nhỏ hơn interval (400);
  `firstDueDate` từ hôm nay (mặc định hôm nay + interval); người nhận mặc định ACTIVE và có `WORK_ORDER_EXECUTE` (400).
- `PATCH` cần `version` (cũ → 409 `STALE_VERSION`): title, instructions (`""` xóa), intervalDays, leadDays, dueTime, priority,
  defaultAssigneeId (`clearDefaultAssignee: true` để bỏ), nextDueDate (từ hôm nay). Đổi interval không dời nextDueDate.
- Không xóa: vô hiệu hóa (`deactivate`), lịch sử work order vẫn gắn với kế hoạch.
- Mỗi lần tạo / sửa / kích hoạt / vô hiệu hóa ghi một dòng `audit_logs` (`MAINTENANCE_PLAN_*`, old/new JSON); không đổi gì thì không ghi.
- Response: máy (mã, tên), người nhận mặc định, hạn kế tiếp, `overdue` (hạn đã qua mà không có work order chưa xong), work order chưa
  xong hiện tại (id, mã, trạng thái), lần hoàn thành gần nhất, `version`.
- `upcoming`: kế hoạch đang hoạt động có hạn trong `days` ngày tới (1–90, kể cả đã quá hạn), kèm work order chưa xong, theo ngày.

## Tạo work order tự động

```yaml
app.maintenance-schedule.enabled: ${MAINTENANCE_SCHEDULE_ENABLED:true}
app.maintenance-schedule.interval: ${MAINTENANCE_SCHEDULE_INTERVAL:PT1H}   # và một lần 30 giây sau khi khởi động
```

Mỗi lần chạy: hôm nay = ngày giờ VN; với mỗi kế hoạch đang hoạt động có `nextDueDate − leadDays ≤ hôm nay`, máy không INACTIVE và
không có work order chưa xong của kế hoạch → trong transaction riêng tạo work order MAINTENANCE, nguồn SCHEDULE, tiêu đề / mô tả /
ưu tiên của kế hoạch, hạn = `nextDueDate` lúc `dueTime` (giờ VN), giao cho người nhận mặc định nếu họ còn ACTIVE và có
`WORK_ORDER_EXECUTE` (không thì để trống), `maintenancePlanId`, `scheduledFor = nextDueDate`.

- Không trùng: unique (kế hoạch, scheduledFor) và một work order chưa xong mỗi kế hoạch; advisory lock tránh hai lần chạy chồng nhau.
- Một kế hoạch lỗi không chặn các kế hoạch khác.
- Backend tắt nhiều ngày: chỉ một work order cho `nextDueDate` hiện tại (không dồn hàng loạt); hạn có thể đã qua → thông báo quá hạn #66.
- Thông báo theo #66: đã giao → người nhận; chưa giao → mọi người có `WORK_ORDER_MANAGE`.
- `generate-now`: tạo ngay cho lần hiện tại bất kể leadDays; 409 `MAINTENANCE_PLAN_INACTIVE`, `PLAN_HAS_OPEN_WORK_ORDER`,
  `OCCURRENCE_ALREADY_GENERATED` hoặc `MACHINE_INACTIVE`.

## Hạn kế tiếp

Sau khi work order của kế hoạch commit (sự kiện `WorkOrderCompletedEvent` / `WorkOrderCancelledEvent`), trong transaction riêng, khóa
dòng kế hoạch, lỗi không bao giờ ảnh hưởng work order:

| Work order | Kế hoạch |
| --- | --- |
| DONE | `last_completed_at = completed_at`; hạn kế = ngày hoàn thành (giờ VN) + interval (hoàn thành muộn 25/11, mỗi 7 ngày → 02/12) |
| CANCELLED | bỏ lần này: hạn kế = `scheduledFor` + interval |

Nếu Admin đã dời hạn kế xa hơn giá trị tính được thì giữ ngày của Admin. Kế hoạch đã vô hiệu hóa vẫn được cập nhật (lịch sử nhất quán)
nhưng không sinh việc mới.

## Work order

Response work order có `maintenancePlan { id, title }` và `scheduledFor`; danh sách có filter `maintenancePlanId`. Work order SCHEDULE
không đổi được máy hay loại (API sửa vốn không cho), vẫn hủy được (→ bỏ lần đó). `createBySystem` không nhận nguồn SCHEDULE: work order
SCHEDULE chỉ đến từ kế hoạch (`createScheduled`).

## Database (V22)

`maintenance_plans` (title không rỗng, interval 1–365, lead 0–30 và < interval, `due_time TIME` mặc định 17:00, `next_due_date DATE`,
`version`), `work_orders.maintenance_plan_id` + `scheduled_for` (CHECK: nguồn SCHEDULE ⇔ có cả hai; chỉ loại MAINTENANCE; unique theo lần
và một work order chưa xong mỗi kế hoạch), quyền `MAINTENANCE_PLAN_READ` (ADMIN, STAFF), `MAINTENANCE_PLAN_MANAGE` (ADMIN).
Chi tiết: [database-migration.md](database-migration.md).

## Kiểm thử

`MaintenancePlanDatesTest` (ranh giới ngày giờ VN, giờ hạn), `MaintenancePlanIntegrationTest` (schema, quản lý + audit + quyền, upcoming,
sinh việc, chạy lặp / đồng thời, nghỉ 3 tuần, kế hoạch lỗi, generate-now, hạn kế tiếp), `MaintenancePlanDocumentationTest`.
