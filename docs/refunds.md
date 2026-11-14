# Hoàn tiền thủ công (issue #72)

Admin xem các khoản tiền **cần hoàn**, tự chuyển khoản trả khách trong app ngân hàng (ngoài hệ thống), rồi **ghi nhận** việc hoàn tiền
kèm mã giao dịch chuyển khoản. Payment (và order, khi chính order được hoàn) chuyển `REFUNDED`, có đủ dấu vết audit.

```text
Đơn ORD-20261113-… đã trả 17.500 nhưng kẹt tô → DISPENSE_FAILED
→ hiện trong "Cần hoàn tiền" kèm tài khoản người trả (nếu payOS gửi)
→ Admin chuyển 17.500 và ghi mã FT26317123456789
→ payment và order REFUNDED, có dòng audit, hiện trong báo cáo; ghi lần nữa bị từ chối
```

Quy tắc đã chốt:

- Hoàn tiền là **thủ công**: backend không gọi API hoàn tiền của payOS hay ngân hàng.
- Chỉ ADMIN (`PAYMENT_REFUND`, `REFUND_READ`); STAFF không truy cập dữ liệu thanh toán.
- Không có bảng refund riêng: payment `REFUNDED` + các cột refund + một dòng `audit_logs`.
- Luôn hoàn **toàn bộ** số tiền của payment (client không gửi số tiền); ghi trùng → 409.

## Các trường hợp

| Lý do (`reason`) | Điều kiện | Order sau | Tô |
| --- | --- | --- | --- |
| `DISPENSE_FAILED` | order `DISPENSE_FAILED`, payment là payment trả đơn | `REFUNDED` | giữ nguyên (`DISPENSE_FAILED`, gỡ qua #68 / bảo trì) |
| `LATE_PAYMENT` | order `CANCELLED` (tiền về sau khi hủy) | giữ `CANCELLED` | giữ nguyên |
| `DUPLICATE_PAYMENT` | đã có payment khác của order có tiền về trước | giữ nguyên | giữ nguyên |
| `PRODUCT_QUALITY` | order `COMPLETED`, payment trả đơn (khách phản ánh) | `REFUNDED` | giữ `SOLD` |
| `OTHER` | order `COMPLETED` / `DISPENSE_FAILED`, payment trả đơn, **bắt buộc note** | `REFUNDED` | giữ nguyên |

**Payment trả đơn** = payment `SUCCESS`/`REFUNDED` có `paid_at` sớm nhất của order (hòa thì theo id). Order chỉ thành `REFUNDED` khi
hoàn đúng payment này và order đang `DISPENSE_FAILED` hoặc `COMPLETED`; hoàn tiền trễ / trùng không bao giờ đổi order.
`REFUNDED` là trạng thái cuối của cả payment và order. Hoàn tiền không đổi tồn kho.

## Ghi nhận hoàn tiền

`POST /api/v1/payments/{paymentId}/refund` — `PAYMENT_REFUND` (ADMIN)

```json
{ "reason": "DISPENSE_FAILED", "transferReference": "FT26317123456789",
  "note": "Chuyển khoản lại qua Vietcombank", "workOrderId": null }
```

Một transaction, thứ tự khóa như `PaymentConfirmationService`: Order → Payments (→ đọc DispenseCommand → WorkOrder):

1. khóa order và mọi payment của order; kiểm tra quy tắc;
2. payment `SUCCESS → REFUNDED`, `refunded_at` (không sớm hơn `paid_at`), `refunded_by` = người gọi, lý do, mã chuyển khoản
   (đã bỏ khoảng trắng hai đầu), note;
3. order `→ REFUNDED` + `refunded_at` khi đúng điều kiện ở trên;
4. một dòng `audit_logs`: action `PAYMENT_REFUNDED`, entity `Payment/{id}`, user, `ip_address`,
   old `{paymentStatus, orderStatus}`, new `{paymentStatus, orderStatus, reason, transferReference, amount, orderCode}`;
5. có `workOrderId` → phải là work order `INCIDENT` chưa `CANCELLED` (sai / không tồn tại → 400), thêm sự kiện `NOTE`
   "Refunded … for order … (lý do, ref …)".

| Kết quả | Khi nào |
| --- | --- |
| 200 | chi tiết payment kèm khối `refund` |
| 400 | `transferReference` không khớp `^[A-Za-z0-9._/-]{4,64}$`, thiếu `reason`, `OTHER` không có note, note > 500, field lạ (vd `amount`), `workOrderId` không hợp lệ |
| 404 | payment không tồn tại |
| 409 `PAYMENT_ALREADY_REFUNDED` | payment đã hoàn (lặp lại với bất kỳ body nào) |
| 409 `REFUND_TRANSFER_REF_USED` | mã chuyển khoản đã dùng cho lần hoàn khác (kiểm tra trước + unique index khi ghi đồng thời) |
| 409 `DISPENSE_IN_PROGRESS` | order `PENDING_PAYMENT` / `PAID` / `DISPENSING` hoặc còn lệnh nhả chưa xong — chờ kết quả cuối (sau TIMEOUT order thành `DISPENSE_FAILED` và hoàn được) |
| 409 `REFUND_REASON_MISMATCH` | lý do không khớp trạng thái (vd `DISPENSE_FAILED` cho order `COMPLETED`, `DUPLICATE_PAYMENT` cho payment trả đơn) |
| 409 `PAYMENT_NOT_REFUNDABLE` | payment `PENDING` / `FAILED` / `EXPIRED` |

Hai yêu cầu đồng thời cho cùng payment: khóa order tuần tự hóa, đúng một yêu cầu thành công. Mã chuyển khoản và tài khoản người trả
không bao giờ được ghi vào log ứng dụng (log chỉ có payment id, mã đơn, lý do).

## Danh sách cần hoàn

`GET /api/v1/refunds/candidates?type=&machineId=&from=&to=&page=&size=` — `REFUND_READ` (ADMIN)

Payment `SUCCESS` của order đã có kết quả cuối (không `PENDING_PAYMENT` / `PAID` / `DISPENSING`):

| `type` | Điều kiện |
| --- | --- |
| `LATE_PAYMENT` | order `CANCELLED` |
| `DUPLICATE_PAYMENT` | có payment khác của order có tiền về trước (order không hủy) |
| `DISPENSE_FAILED` | order `DISPENSE_FAILED`, payment trả đơn |
| `CUSTOMER_REPORT` | dành cho issue phản ánh khách hàng; hiện luôn rỗng |

Mỗi dòng: `paymentId`, `type`, `amount`, `paidAt`, `order {id, orderCode, status, machineCode}`, `payer`, `waitingSince` (= `paidAt`),
`relatedWorkOrder` (hiện `null`). Cũ nhất trước. `from` / `to` là ngày giờ VN của `paidAt` (bao gồm hai đầu).

- `payer {accountName, accountNumber, bankId, bankName}` lấy từ webhook **đã xác thực** của payment (`raw_payload.data.counterAccount*`
  của payOS; webhook chưa xác thực bị bỏ qua); `null` khi payOS không gửi. Chỉ trả cho người có `REFUND_READ`, không ghi log.
- Một trang = 1 truy vấn đếm + 1 truy vấn trang (fetch order, máy) + 1 truy vấn trùng + 1 truy vấn webhook log theo chỉ mục
  `ix_payment_webhook_logs_order_time`: không N+1.
- Đã hoàn thì biến mất khỏi danh sách. `GET /payments?requiresAttention=true` vẫn giữ nguyên (góc nhìn bất thường).

## Xem lại và báo cáo

| Endpoint | Nội dung |
| --- | --- |
| `GET /api/v1/refunds?from=&to=&reason=&machineId=&refundedBy=` | payment `REFUNDED`, mới nhất trước: số tiền, `paidAt`, `refundedAt`, người hoàn, lý do, mã chuyển khoản, note, order |
| `GET /api/v1/refunds/summary?from=&to=&machineId=` | số lần, tổng tiền, theo từng lý do (đủ 5 lý do, 0 khi không có) |
| `GET /api/v1/payments/{id}` | thêm khối `refund {refundedAt, refundedBy, reason, transferReference, note}` (null khi chưa hoàn) |
| `GET /api/v1/orders/{id}` | thêm `refundedAt` và `refunds[]` (mỗi payment đã hoàn của order); `refunds` chỉ có dữ liệu cho người có `REFUND_READ` — STAFF đọc order nhưng nhận danh sách rỗng |

`from` / `to` của refund là ngày giờ VN của `refundedAt` (`app.business-zone`). Báo cáo doanh thu dùng `payments.refunded_at` và
`amount` để tách tiền hoàn khỏi doanh thu. Lọc order theo `status=REFUNDED` dùng filter sẵn có.

## Tương tác

- Webhook thành công đã xác thực cho payment `REFUNDED` → bỏ qua + WARN (đã có từ issue thanh toán).
- `DISPENSE_COMPLETED` đến muộn cho order `REFUNDED` → tô `SOLD`, order giữ `REFUNDED`, audit `DISPENSE_SUCCESS_AFTER_REFUND` (3.3).
- Quyền: `POST /api/v1/payments/*/refund` → `PAYMENT_REFUND` (đặt trước rule đọc payments); `/api/v1/refunds/**` → `REFUND_READ`.

## Database (V23)

`payments`: `refunded_at`, `refunded_by → users`, `refund_reason`, `refund_transfer_ref`, `refund_note` với CHECK: `REFUNDED` ⇔ đủ
refunded_at / refunded_by / reason / transfer_ref; reason trong 5 giá trị; mã khớp `^[A-Za-z0-9._/-]{4,64}$`; `OTHER` cần note không rỗng
(NULL-safe); `refunded_at ≥ paid_at`. Unique `uq_payments_refund_transfer_ref` (partial), chỉ mục `ix_payments_refunded_at` (partial
REFUNDED). `orders.refunded_at` với CHECK `REFUNDED ⇔ refunded_at`. Quyền `PAYMENT_REFUND`, `REFUND_READ` → ADMIN.
Chi tiết: [database-migration.md](database-migration.md).

## Kiểm thử

`RefundIntegrationTest` (schema, các trường hợp hoàn, từ chối, đồng thời, work order INCIDENT, webhook / nhả muộn sau hoàn, danh sách
cần hoàn + payer, danh sách / tổng hợp khớp DB và theo ngày VN, số truy vấn cố định, quyền, không lộ mã trong log),
`RefundDocumentationTest` (Swagger ↔ `api-contract/api.yaml`).

## Phản ánh của khách (issue #74)

Loại ứng viên `CUSTOMER_REPORT` đã có dữ liệu: payment SUCCESS của đơn có phản ánh đang mở với verdict `REFUND_ELIGIBLE` hoặc
`DELIVERED_PER_MACHINE`; mỗi ứng viên có `customerReport` (liên hệ đã che) và `relatedWorkOrder`. Ghi nhận hoàn tiền tự đóng các phản
ánh đang mở của đơn (`RESOLVED` / `REFUNDED`). Xem [customer-reports.md](customer-reports.md).
