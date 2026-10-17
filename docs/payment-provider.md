# Payment Provider — payOS (Issue #31)

Phạm vi: adapter payOS phía sau `PaymentGateway` (xem [payment-service.md](payment-service.md)). Tạo link/QR VietQR cho mỗi payment attempt, hủy link
best-effort khi attempt hết hạn, và bộ xác thực/parse chữ ký webhook ở dạng component. **Không** có endpoint webhook, không có `SUCCESS`/`PAID`,
không hoàn tiền, không job đối soát. `MOCK` vẫn là mặc định cho dev và test tự động. Không đổi schema, không thêm endpoint, không thêm dependency.

## Quyết định chọn payOS (decision record)

```text
✓ đăng ký merchant cá nhân (CCCD), không cần giấy phép kinh doanh
✓ VietQR: khách trả bằng mọi app ngân hàng
✓ tiền vào thẳng tài khoản ngân hàng của merchant
✓ API: tạo link -> qrCode, hủy link, xem link
✓ webhook ký HMAC-SHA256
✗ không có sandbox (chỉ live)
```

Hệ quả: test tự động chỉ dùng `MOCK` và HTTP stub cục bộ, không bao giờ gọi payOS thật; kiểm tra thủ công bằng một giao dịch nhỏ thật (ví dụ 2.000 VND) vào tài khoản
của chính bạn. `PaymentGateway` giữ nguyên để thêm VNPay/MoMo/SePay sau này mà không đổi tầng nghiệp vụ. Tài liệu API đã đối chiếu ngày 2026-10-15 tại
`https://payos.vn/docs/api/` (base URL, header `x-client-id`/`x-api-key`, `POST /v2/payment-requests`, `.../{id}/cancel`, chuỗi ký tạo link, mẫu webhook).

## Cấu hình

Chọn provider bằng `PAYMENT_PROVIDER=PAYOS`. Khi đó các giá trị sau là **bắt buộc**; thiếu hoặc sai định dạng thì ứng dụng không khởi động, thông báo chỉ nêu *tên*
thuộc tính, không in giá trị:

| Biến | Mặc định | Ghi chú |
| --- | --- | --- |
| `PAYOS_BASE_URL` | `https://api-merchant.payos.vn` | phải là URL http/https tuyệt đối |
| `PAYOS_CLIENT_ID` | (trống) | bí mật, từ dashboard payOS |
| `PAYOS_API_KEY` | (trống) | bí mật |
| `PAYOS_CHECKSUM_KEY` | (trống) | bí mật, ký tạo link và xác thực webhook |
| `PAYOS_RETURN_URL` | (trống) | payOS bắt buộc nhưng **không bao giờ** được tin là xác nhận thanh toán; trỏ tới trang tĩnh vô hại |
| `PAYOS_CANCEL_URL` | (trống) | như trên |
| `PAYOS_DESCRIPTION_PREFIX` | `FV` | chữ/số, tối đa 8 ký tự |
| `PAYOS_DESCRIPTION_MAX_LENGTH` | `9` | tài khoản không liên kết qua payOS giới hạn 9 ký tự (tối đa 25) |
| `PAYOS_CANCEL_TIMEOUT` | `PT3S` | timeout hủy link; tạo link dùng `PAYMENT_PROVIDER_TIMEOUT` |

Với `MOCK` các biến payOS không cần có và adapter chỉ là bean "inert". Đặt giá trị thật trong `.env` đã bị ignore; `.env.example` chỉ có placeholder. `PayOsProperties.toString()` che các
bí mật. Không bao giờ ghi `PAYOS_*` vào log, exception, response, Swagger, `api-contract/` hay fixture trong Git. Không log body request/response payOS.

## Hành vi của adapter

- **HTTP:** Spring `RestClient` (không dùng SDK payOS, không thêm thư viện). Lỗi chỉ trả mã HTTP hoặc mã kết quả payOS (`code`), không kèm body/header/bí mật; `code != "00"`, HTTP không 2xx,
  `qrCode` rỗng, phản hồi không đọc được hoặc timeout đều thành `PaymentProviderException`, nên attempt thành `FAILED` và API trả `502`.
- **`payment_reference` = `orderCode` payOS:** `yyMMddHHmmss` (UTC) + 3 chữ số ngẫu nhiên = 15 chữ số, dương, nhỏ hơn 2^53. Khác với `orders.order_code` (`ORD-...`). Mỗi attempt một `orderCode`.
  Va chạm được chặn bởi `uq_payments_provider_reference` (V12); bước 1 sinh lại tối đa 3 lần.
- **Số tiền:** payOS chỉ nhận VND nguyên. `supportsAmount` yêu cầu `> 0`, không có phần thập phân (35000.00 ổn, 35000.50 bị từ chối) và không quá 2.147.483.647. Kiểm tra ở bước 1 của luồng #29: số tiền
  không hỗ trợ thì `409`, **không** tạo attempt, không làm tròn. Chuyển đổi bằng `setScale(0, UNNECESSARY).longValueExact()`.
- **Mô tả:** `FV` + phần đầu của đuôi ngẫu nhiên mã đơn (`ORD-20261015-7K3QF9XA` -> `FV7K3QF9X`), chỉ chữ/số ASCII, không dữ liệu khách hàng. Mô tả chỉ để hiển thị; việc đối chiếu luôn dựa vào `orderCode` đã ký.
- **Chữ ký tạo link:** `HMAC_SHA256(checksumKey, "amount=..&cancelUrl=..&description=..&orderCode=..&returnUrl=..")`, khóa theo thứ tự chữ cái, giá trị thô, hex chữ thường (`PayOsSignature`).
- **`expiredAt`:** hạn của attempt, epoch giây (làm tròn xuống, Int32). Kết quả trả về dùng đúng hạn này nên QR không sống lâu hơn phần giữ chỗ hàng.
- **Không lưu** `checkoutUrl`/`paymentLinkId` (không có cột; không thêm).

## Hủy link (best effort, sau commit)

Khi một attempt payOS chuyển `PENDING -> EXPIRED` (kiosk hủy đơn: `ORDER_CANCELLED`, sweep hết hạn: `RESERVATION_EXPIRED`, thay attempt cũ: `ATTEMPT_EXPIRED`) backend gọi
`POST /v2/payment-requests/{orderCode}/cancel` với `cancellationReason`. Gọi **sau khi transaction commit** (`@TransactionalEventListener(AFTER_COMMIT)`), không bao giờ trong transaction;
rollback thì không gọi. Có `cancel-timeout`, thất bại chỉ ghi WARN (chỉ `orderCode`), không retry, không đổi trạng thái: `EXPIRED` ở backend luôn là chuẩn. Nếu đơn bị hủy trong lúc backend đang gọi tạo link,
link vừa tạo cũng được hủy ngay khi bước 3 phát hiện attempt đã bị thay thế. Hủy chỉ giảm rủi ro, **không** đảm bảo không có chuyển khoản muộn; xử lý thanh toán muộn thuộc issue webhook.
Attempt của provider khác (ví dụ `MOCK` trước khi đổi cấu hình) không bao giờ bị hủy qua gateway đang hoạt động.

## Webhook: verifier/parser (đã nối vào endpoint ở issue #33)

`PayOsWebhookVerifier.verify(rawBody)` và `PayOsWebhookParser.parse(rawBody)` có unit test và được `PayOsPaymentGateway.verifyWebhook` dùng cho endpoint `POST /api/v1/webhooks/payments/payos` (xem [payment-webhook.md](payment-webhook.md)).

Chuẩn hóa dữ liệu để ký: lấy đối tượng `data` từ **chuỗi JSON thô nhận được**, sắp khóa theo thứ tự chữ cái, nối `key=value` bằng `&`; `null`/thiếu/`"null"`/`"undefined"` -> chuỗi rỗng; số -> số thập phân nguyên văn (giữ `12.50`);
chuỗi -> nguyên văn; object/array -> JSON gọn với khóa sắp xếp. Chữ ký kỳ vọng là hex chữ thường của HMAC-SHA256 với checksum key, so sánh bằng `MessageDigest.isEqual` (hằng thời gian). JSON lỗi, thiếu `data`/`signature` hoặc
checksum key trống thì chỉ trả `false`, không ném lỗi parser ra ngoài. Sau khi xác thực, `parse` cho: `success` (`code` ngoài cùng và `data.code` đều `"00"`), `paymentReference` (= `data.orderCode` dạng chuỗi thập phân),
`transactionId` (= `data.reference`), `amount` (VND nguyên -> `BigDecimal` scale 2), `transactionTime` (`data.transactionDateTime` theo `Asia/Ho_Chi_Minh` -> `Instant`), `paymentLinkId` (chỉ để tham khảo). Body lỗi -> `PayOsWebhookException` có thông báo an toàn.

> **Chưa đối chiếu với webhook thật.** Trang tài liệu payOS không nêu quy tắc chuẩn hóa chi tiết; cách làm trên theo mô tả của issue và `data` mẫu trong tài liệu. Phải kiểm tra bằng một webhook thật bắt được khi thử thủ công (mục dưới). Các số
> trong webhook thật là số nguyên nên chi tiết số thập phân không ảnh hưởng thực tế.

## Đăng ký webhook (vận hành)

payOS cần biết URL webhook của backend: dashboard payOS hoặc `POST https://api-merchant.payos.vn/confirm-webhook` với `{"webhookUrl":"https://<host-công-khai>/api/v1/webhooks/payments/payos"}`. Cần URL **HTTPS công khai**; khi phát triển cục bộ dùng
tunnel (ngrok/cloudflared) và đăng ký lại mỗi khi URL tunnel đổi. payOS gửi một payload thử để xác nhận URL, endpoint (issue webhook) phải trả `2xx`. Issue này **không** thêm endpoint gọi `confirm-webhook` và chưa có endpoint nhận webhook.

## Kiểm thử thủ công với payOS thật (không chạy trong CI)

1. Đăng ký kênh thanh toán payOS, lấy `client-id`/`api-key`/`checksum-key`, đặt vào `.env` (không commit) cùng `PAYMENT_PROVIDER=PAYOS` và hai URL return/cancel.
2. Chạy backend, cấp kiosk key, tạo đơn có tổng nhỏ (ví dụ 2.000 VND) rồi `POST /api/v1/kiosk/orders/{orderId}/payments`; quét QR bằng app ngân hàng.
3. Bắt webhook (từ dashboard payOS hoặc tunnel), lưu **ngoại tuyến** và kiểm tra bằng `PayOsWebhookVerifier`.
4. Hủy đơn, xác nhận link đã hủy không thể thanh toán ở trang checkout payOS.

Các mục thủ công trong checklist issue #31 được để trống nếu chưa có quyền truy cập payOS thật.

## Kiểm thử tự động

`PayOsSignatureTest` (vector RFC 4231, thứ tự khóa, chuẩn hóa), `PayOsWebhookTest` (verify/parse), `PayOsGatewayTest` (HTTP stub loopback `StubPayOsServer`: đường dẫn, header, body, chữ ký, `expiredAt`, mô tả, lỗi, timeout,
hủy), `PayOsIntegrationTest` (`PAYMENT_PROVIDER=PAYOS`, PostgreSQL thật: QR, lỗi provider, hủy sau commit, rollback không hủy, sweep, thay attempt, số tiền lẻ, log không lộ bí mật), `PayOsConfigurationTest` (thiếu cấu hình, MOCK không cần payOS,
`toString`). Test bổ sung trên `ControllableGateway`: hủy theo từng lý do, va chạm reference, số tiền không hỗ trợ.
