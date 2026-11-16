# Quy trình nạp hàng (issue #68, WF-03)

Nạp hàng chạy trên work order loại **RESTOCK** (#66): Admin lập kế hoạch theo dòng (cột, sản phẩm, số tô), Staff thực hiện tại máy —
bỏ tô hết hạn/hỏng bằng lệnh bảo trì (#64), ghi lô mới, nạp tô vào từng cột — rồi hoàn thành; backend so kế hoạch với thực tế và đóng
cảnh báo tồn kho.

```text
Admin: gợi ý nạp hàng → tạo work order RESTOCK có dòng (tay hoặc từ gợi ý) → giao việc
Staff: bắt đầu (máy → MAINTENANCE)
       xả tô cũ bằng lệnh bảo trì gắn workOrderId (EMPTY_COLUMN / REMOVE_ITEM)
       ghi lô mới (API lô hàng có sẵn)
       nạp tô theo từng dòng (lịch sử LOAD trỏ về dòng)
       hoàn thành → so planned / loaded, chênh lệch phải có lý do
Hệ thống: chạy health check của máy ngay → LOW_STOCK / PRODUCT_* tự đóng; Admin kích hoạt lại máy
```

Cột là FIFO đứng: tô nạp trước bán trước (đầu cột = `loaded_at` sớm nhất) và chỉ đầu cột rời được qua cổng dưới. Lô hết hạn sớm hơn các
tô đang có trong cột mà nạp lên trên sẽ bị kẹt phía sau chúng.

## Gợi ý nạp hàng

`GET /api/v1/machines/{machineId}/restock-suggestions` (`RESTOCK_PLAN`) — mỗi cột một dòng, một câu truy vấn tổng hợp, không khóa gì.

| Trường | Ý nghĩa |
| --- | --- |
| `physicalCount` | tô trong cột (AVAILABLE, RESERVED, EXPIRED, DISPENSE_FAILED) |
| `sellableCount` | tô khách mua được ngay (0 khi đầu cột chặn cột) |
| `expiredCount`, `expiringTodayCount`, `dispenseFailedCount` | tô hết hạn (trạng thái hoặc ngày), hết hạn trong hôm nay (giờ VN), lỗi nhả |
| `headStatus` | trạng thái tô đầu cột (EXPIRED nếu lô đã hết hạn) |
| `currentProduct` | sản phẩm của tô nạp gần nhất còn trong cột; `null` khi cột trống |
| `openAlerts` | loại cảnh báo chưa đóng của cột |

```text
EMPTY_THEN_LOAD  có tô hết hạn / lỗi nhả / hết hạn hôm nay, hoặc đầu cột chặn bán → nạp = sức chứa (phải xả trước, nạp đè không sửa được)
NONE             cột INACTIVE; hoặc bán được > ngưỡng LOW_STOCK (2); hoặc đầy
LOAD             còn lại: nạp = sức chứa − số tô đang có
```

## Lập kế hoạch

- `POST /api/v1/work-orders` với `"type": "RESTOCK"` và `restockLines: [{slotId, productId, plannedQuantity}]` (cần thêm `RESTOCK_PLAN`).
  Loại khác gửi `restockLines` → 400.
- `POST /api/v1/machines/{machineId}/restock-work-orders` `{ "fromSuggestions": true, assigneeId?, dueAt?, priority?, title? }`: một dòng
  cho mỗi cột có gợi ý khác NONE và biết sản phẩm, số lượng = gợi ý; cảnh báo LOW_STOCK / PRODUCT_EXPIRING / PRODUCT_EXPIRED chưa đóng của
  các cột đó được liên kết (quy tắc #66). Không có gì cần nạp → 409 `NOTHING_TO_RESTOCK`.
- `POST /api/v1/work-orders/{id}/restock-lines`, `PATCH …/{lineId}` (plannedQuantity, productId), `DELETE …/{lineId}` — `RESTOCK_PLAN`,
  work order chưa DONE/CANCELLED; sửa/xóa chỉ khi chưa nạp gì vào dòng (409 `LINE_ALREADY_LOADED`).
- Kiểm tra: cột thuộc máy của work order (400), cột không INACTIVE (409 `SLOT_INACTIVE`), sản phẩm ACTIVE (409 `PRODUCT_INACTIVE`),
  plannedQuantity ≤ sức chứa (400), một dòng mỗi (cột, sản phẩm) (409 `DUPLICATE_LINE`).
- RESTOCK chưa có dòng thì không bắt đầu được: 409 `RESTOCK_WITHOUT_LINES`.

## Thực hiện

Work order RESTOCK, IN_PROGRESS, người làm là người được giao (hoặc Admin); máy đã MAINTENANCE từ lúc bắt đầu (#66).

**Bỏ tô cũ**: lệnh bảo trì #64 với `"workOrderId"` (trường mới, tùy chọn) và lý do RESTOCK / EXPIRED / DAMAGED. Work order phải
IN_PROGRESS (409 `WORK_ORDER_NOT_IN_PROGRESS`), cùng máy (409 `WORK_ORDER_OTHER_MACHINE`), người gọi được phép thực hiện nó (không thì 404).

**Nạp tô**: `POST /api/v1/work-orders/{id}/restock-lines/{lineId}/loads` (`RESTOCK_EXECUTE`) `{ "batchId", "quantity", "acknowledgeExpiryInversion" }`.

| Kiểm tra | Lỗi |
| --- | --- |
| lô đúng sản phẩm của dòng | 409 `BATCH_PRODUCT_MISMATCH` |
| lô chưa hết hạn và còn hạn sau thời gian giữ chỗ (5 phút) | 409 `BATCH_EXPIRED` |
| cột ACTIVE hoặc ERROR (nạp hàng là cách sửa cột bị chặn); INACTIVE không | 409 `SLOT_INACTIVE` |
| sức chứa cột | 409 `SLOT_CAPACITY_EXCEEDED` |
| số lượng khai báo của lô | 409 `BATCH_QUANTITY_EXCEEDED` |
| lô hết hạn sớm hơn tô đang có trong cột, chưa xác nhận | 409 `EXPIRY_INVERSION` (thông báo liệt kê các tô) |

Dùng chung lõi nạp với `/inventory/load` (`InventoryLoader`, cùng thứ tự khóa Product → Batch → Machine → Slot → Items, rồi
WorkOrder → dòng). Kết quả: N tô AVAILABLE với `loaded_at` tăng dần nghiêm ngặt (thứ tự FIFO đúng thứ tự nạp), N dòng LOAD
`reference_id = id dòng`, người làm, lý do `Restock WO-…`; `loaded_quantity += N`; một sự kiện NOTE trên work order.
Nạp nhầm: Admin sửa bằng gỡ tô / ADJUSTMENT có sẵn; `loaded_quantity` chỉ đếm LOAD, không bao giờ giảm (lý do chênh lệch giải thích).

> Thủ tục nạp (cổng nạp mở hay đóng khi Staff nạp từ trên) chưa được người phụ trách phần cứng xác nhận, nên việc nạp không kiểm tra
> cổng nạp; hoàn thành luôn yêu cầu mọi cổng nạp đã đóng.

`POST /api/v1/inventory/load` (nạp trực tiếp, không qua work order) nay chỉ ADMIN (`INVENTORY_LOAD_DIRECT`); STAFF → 403.

## Hoàn thành

`POST /api/v1/work-orders/{id}/complete` thêm `lineVariances: [{lineId, reason}]` (kiểm tra `RestockCompletionCheck`, điểm mở rộng #66):

- mỗi dòng: loaded = planned, hoặc có lý do (gửi lần này hoặc đã lưu) — thiếu → 409 `RESTOCK_VARIANCE_REASON_REQUIRED` (liệt kê dòng);
- không cột nào của máy còn mở cổng nạp → 409 `REFILL_GATE_OPEN`;
- không còn lệnh bảo trì chưa xong (#66).

Sau DONE: sự kiện COMPLETED có `details.restock` (từng dòng: cột, sản phẩm, planned, loaded, chênh lệch, lý do; số tô đã bỏ theo lý do
từ lệnh bảo trì liên kết); cảnh báo liên kết đóng theo #66; sau commit health check chạy ngay cho máy nên LOW_STOCK / PRODUCT_* của
các cột đã nạp tự đóng; máy vẫn MAINTENANCE cho tới khi Admin kích hoạt lại.

## Đọc

`GET /api/v1/work-orders/{id}/restock` (cùng quyền xem với work order): dòng + đã nạp (lô, số lượng, thời gian, người nạp), lệnh bảo trì
liên kết, số tô đã bỏ theo lý do. Chi tiết work order có `restockSummary` (số dòng, tổng planned, tổng loaded, số dòng chênh lệch).
Lịch sử theo dòng: `GET /api/v1/inventory/transactions?referenceId=<lineId>`.

## Quyền

| Permission | ADMIN | STAFF |
| --- | :-: | :-: |
| `RESTOCK_PLAN` (gợi ý, lập/sửa dòng) | ✓ | |
| `RESTOCK_EXECUTE` (nạp theo dòng của work order được giao) | ✓ | ✓ |
| `INVENTORY_LOAD_DIRECT` (`POST /api/v1/inventory/load`) | ✓ | |

## Database (V21)

`restock_lines` (FK ghép cột–máy, UNIQUE (work order, cột, sản phẩm), planned/loaded 0–1000, lý do chênh lệch không rỗng),
`maintenance_commands.work_order_id`, index `inventory_transactions.reference_id`, ba permission. Chi tiết:
[database-migration.md](database-migration.md).

## Kiểm thử

`RestockIntegrationTest` (schema, gợi ý, lập kế hoạch, nạp, nạp đồng thời, bỏ tô qua lệnh bảo trì, hoàn thành) và
`RestockDocumentationTest`.
