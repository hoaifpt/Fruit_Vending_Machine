# Work order (issue #66)

Một mô hình chung cho mọi việc Staff làm tại máy: **RESTOCK** (nạp hàng), **MAINTENANCE** (bảo trì), **INCIDENT** (sự cố). Work order
do Admin, hệ thống (cảnh báo, lịch bảo trì) hoặc khách báo lỗi tạo ra, được giao cho Staff, thực hiện và đóng với kết quả.

```text
Admin (hoặc cảnh báo / lịch / khách) tạo WO-20261113-K7QF
        ↓ giao việc → Staff nhận thông báo, thấy trong "Việc của tôi"
        ↓ bắt đầu   → máy MAINTENANCE (kiosk ngừng bán)
Staff làm việc tại máy (lệnh bảo trì #64, nạp hàng 4.4)
        ↓ hoàn thành với kết quả → cảnh báo liên kết được đóng
Admin kiểm tra máy → kích hoạt lại (API trạng thái máy có sẵn)
```

Phần riêng của từng loại sẽ gắn sau: 4.4 dòng nạp hàng (qua `WorkOrderCompletionCheck`), 4.5 lịch bảo trì và 5.2 báo lỗi của khách
(qua `WorkOrderService.createBySystem`, nguồn `SCHEDULE` / `CUSTOMER_REPORT`).

## Vòng đời

```text
OPEN ──giao──> ASSIGNED ──bắt đầu──> IN_PROGRESS ──hoàn thành──> DONE
  ↑  ←─bỏ giao──┘                        │ (giao lại: vẫn IN_PROGRESS)
  └───────────── hủy (có lý do) từ mọi trạng thái chưa xong ──> CANCELLED
```

| Hành động | Từ | Sang | Ai | Ghi chú |
| --- | --- | --- | --- | --- |
| tạo | — | OPEN / ASSIGNED | `WORK_ORDER_MANAGE`, hệ thống | nguồn MANUAL qua API; có người nhận thì ASSIGNED và báo cho họ |
| giao / giao lại | OPEN, ASSIGNED, IN_PROGRESS | ASSIGNED (IN_PROGRESS giữ nguyên) | MANAGE | người nhận phải ACTIVE và có `WORK_ORDER_EXECUTE` (không thì 400) |
| bỏ giao | ASSIGNED | OPEN | MANAGE | |
| bắt đầu | ASSIGNED | IN_PROGRESS | người được giao hoặc Admin | dừng máy (bên dưới); bắt đầu lại → 200 không đổi |
| ghi chú | chưa xong | — | người được giao hoặc Admin | |
| hoàn thành | IN_PROGRESS | DONE | người được giao hoặc Admin | `resultNote` bắt buộc; không còn lệnh bảo trì chưa xong; đóng cảnh báo liên kết |
| hủy | chưa xong | CANCELLED | MANAGE | `reason` bắt buộc; trạng thái máy không đổi |
| sửa (title, description, priority, dueAt) | chưa xong | — | MANAGE | đổi `dueAt` thì thông báo quá hạn được bật lại |

- Chuyển trạng thái khác → 409 `INVALID_WORK_ORDER_TRANSITION`; DONE và CANCELLED là cuối.
- Sửa, giao, bỏ giao, hủy cần `version` (lấy từ lần đọc gần nhất); cũ → 409 `STALE_VERSION`.
- Mỗi hành động ghi đúng một dòng lịch sử `work_order_events` (người làm, trạng thái trước/sau, ghi chú, chi tiết); bảng chỉ thêm, trigger
  chặn sửa/xóa. `GET /api/v1/work-orders/{id}/events`.

## Dừng máy khi bắt đầu

`RESTOCK`, `MAINTENANCE` luôn dừng máy; `INCIDENT` chỉ khi gửi `{"stopMachine": true}` (sự cố chỉ cần hoàn tiền thì không dừng).

| Kiểm tra (khóa Machine trước WorkOrder) | Lỗi |
| --- | --- |
| máy INACTIVE | 409 `MACHINE_INACTIVE` |
| còn đơn PENDING_PAYMENT / PAID / DISPENSING (khi cần dừng máy) | 409 `MACHINE_HAS_ACTIVE_ORDERS` — chờ tối đa 5 phút giữ chỗ |
| còn lệnh dispense chưa xong (khi cần dừng máy) | 409 `MACHINE_COMMAND_IN_PROGRESS` |

Máy ACTIVE → MAINTENANCE (đã MAINTENANCE thì giữ nguyên), ghi audit `MACHINE_MAINTENANCE_AUTO` và lịch sử máy với lý do
`WORK_ORDER WO-…`. Admin kích hoạt lại máy (API trạng thái máy) bị từ chối khi máy còn work order IN_PROGRESS: 409 `WORK_ORDER_IN_PROGRESS`.

## Cảnh báo

- `POST /api/v1/alerts/{alertId}/work-orders` (`WORK_ORDER_MANAGE`, body tùy chọn): nguồn ALERT, máy của cảnh báo, liên kết cảnh báo;
  cảnh báo OPEN → ACKNOWLEDGED. Mặc định: LOW_STOCK / PRODUCT_* → RESTOCK, còn lại MAINTENANCE; tiêu đề lấy từ cảnh báo; ưu tiên
  CRITICAL → URGENT, WARNING → HIGH, INFO → NORMAL.
- Cảnh báo đã RESOLVED → 409 `ALERT_RESOLVED`; đã có work order chưa xong xử lý → 409 `ALERT_ALREADY_HANDLED` (thông báo nêu mã WO).
- `POST /api/v1/work-orders/{id}/alerts` liên kết thêm cảnh báo cùng máy (máy khác → 400); `DELETE …/alerts/{alertId}` bỏ liên kết
  (không được khi đã DONE / CANCELLED).
- Hoàn thành với `resolveLinkedAlerts` (mặc định true): cảnh báo OPEN/ACKNOWLEDGED → RESOLVED bởi người hoàn thành, ghi chú
  `Resolved by WO-…`. Cảnh báo theo trạng thái mà điều kiện vẫn còn sẽ mở lại ở lần health check sau (#58).
- Response cảnh báo có `workOrderId` / `workOrderCode` của work order chưa xong đang xử lý nó.

## Thông báo và quá hạn

Bảng `notifications` (#58) có thêm `work_order_id`; response thông báo có `workOrderId`. Tạo sau khi commit, lỗi không làm hỏng work order.

| Sự kiện | Người nhận |
| --- | --- |
| giao việc | người được giao |
| hệ thống tạo, chưa giao | mọi user ACTIVE có `WORK_ORDER_MANAGE` |
| hoàn thành / hủy | người tạo (nếu là user) và người được giao, trừ người vừa làm |
| quá hạn (job 5 phút, mỗi lần hẹn một lần) | người được giao, hoặc người quản lý nếu chưa giao; ghi sự kiện OVERDUE |

## Quyền

| Permission | ADMIN | STAFF | Dùng cho |
| --- | :-: | :-: | --- |
| `WORK_ORDER_READ_ALL` | ✓ | | `GET /api/v1/work-orders` (lọc status lặp lại, type, source, machineId, assigneeId, priority, overdue, from/to) |
| `WORK_ORDER_READ_ASSIGNED` | ✓ | ✓ | `GET /me`, `GET /{id}`, `GET /{id}/events` — không có READ_ALL thì việc của người khác là 404 |
| `WORK_ORDER_MANAGE` | ✓ | | tạo, sửa, giao, bỏ giao, hủy, liên kết cảnh báo, tạo từ cảnh báo |
| `WORK_ORDER_EXECUTE` | ✓ | ✓ | bắt đầu, ghi chú, hoàn thành (STAFF chỉ việc của mình) |

ADMIN có cả `WORK_ORDER_READ_ASSIGNED` (khác bản phác thảo của issue): mỗi endpoint chỉ cần một permission, nên "việc của tôi" và
chi tiết dùng chung một quyền cho mọi người có thể được giao việc; READ_ALL mở rộng thêm toàn bộ danh sách.

Danh sách sắp theo ưu tiên (URGENT trước), rồi hạn (không có hạn cuối cùng), rồi cũ trước; phân trang trong DB (size 1–100).

## Database (V20)

`work_orders` (CHECK: OPEN không có người nhận, ASSIGNED/IN_PROGRESS/DONE phải có; DONE cần completed_at/by và result_note;
CANCELLED cần cancelled_at và cancel_reason; mã `WO-yyyyMMdd-XXXX` theo ngày kinh doanh), `work_order_alerts`, `work_order_events`
(chỉ thêm), `notifications.work_order_id`, bốn permission. Chi tiết: [database-migration.md](database-migration.md).

## Kiểm thử

`WorkOrderIntegrationTest` (schema, vòng đời, dừng máy, cảnh báo, thông báo, quá hạn, quyền) và `WorkOrderDocumentationTest`.

## Nạp hàng (issue #68)

RESTOCK dùng các điểm mở rộng: dòng nạp gửi khi tạo (`WorkOrderCreationExtension`), không bắt đầu khi chưa có dòng (`WorkOrderStartCheck`),
hoàn thành cần planned = loaded hoặc lý do và cổng nạp đóng (`WorkOrderCompletionCheck`, request thêm `lineVariances`), chi tiết có
`restockSummary` (`WorkOrderSummaryProvider`). Xem [restock.md](restock.md).

## Bảo trì định kỳ (issue #70)

Work order nguồn `SCHEDULE` chỉ được tạo từ kế hoạch bảo trì (`createScheduled`, có `maintenancePlan` và `scheduledFor`); `createBySystem`
dùng cho `ALERT` / `CUSTOMER_REPORT`. Hoàn thành / hủy phát `WorkOrderCompletedEvent` / `WorkOrderCancelledEvent` để kế hoạch tính hạn kế.
Xem [maintenance-plans.md](maintenance-plans.md).

## Phản ánh của khách (issue #74)

Work order INCIDENT nguồn `CUSTOMER_REPORT` được tạo từ phản ánh công khai (`createBySystem`), hoặc nhận thêm phản ánh qua sự kiện NOTE
hệ thống (`recordSystemNote`, actor null). Response có `linkedReports` (mã, loại, verdict, trạng thái; không có liên hệ).
Xem [customer-reports.md](customer-reports.md).
