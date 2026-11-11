# Web quản trị tích hợp backend (issue #39)

Phạm vi: `apps/web` cho ADMIN/STAFF, gọi API thật theo `api-contract/api.yaml`. Giao diện giữ ngôn ngữ thiết kế hiện có. Ngoài phạm vi: dashboard/báo cáo, telemetry, lệnh nhả hàng, ứng dụng kiosk, refresh token, hoàn tiền hay đổi trạng thái thanh toán thủ công, tạo/hủy đơn (chỉ kiosk).

## Màn hình và phân quyền

| Đường dẫn | ADMIN | STAFF |
| --- | --- | --- |
| `/admin/users` | Danh sách, tạo STAFF, sửa hồ sơ, đổi trạng thái | Ẩn |
| `/admin/roles` | Ma trận quyền × vai trò, lưu một lần (cần `PERMISSION_MANAGE`; API #48, đang dùng hợp đồng nháp `api-contract/drafts/roles-permissions.yaml`) | Ẩn |
| `/admin/products` | Xem, tạo, sửa, đổi trạng thái | Chỉ xem |
| `/admin/machines`, `/admin/machines/:id` | Xem, đăng ký, cấu hình, đổi trạng thái; ngăn chứa; khóa kiosk | Chỉ xem (máy và ngăn) |
| `/admin/batches` | Tạo và xem (lô không sửa/xóa) | Tạo và xem |
| `/admin/inventory`, `/admin/inventory/history` | Sơ đồ ngăn theo máy (`?machineId=`, hộp đáy bán tiếp theo, hộp chặn ngăn và nút Rút hộp), danh sách hộp (`?view=list`), nạp hộp, rút hộp, tóm tắt ngăn; lịch sử chỉ đọc (lọc máy, ngăn, loại, mã hộp, phiếu nạp/đơn và trang trên URL, mỗi lần lọc là một mục Back/Forward; mã không phải UUID bị bỏ qua kèm giải thích; tên máy, ngăn, sản phẩm (qua lô) và người thực hiện chỉ tra trong 100 bản ghi đầu của mỗi danh sách, ngoài đó hiện mã rút gọn; STAFF không xem được danh sách tài khoản nên thấy "Tài khoản …xxxxxxxx" hoặc "Bạn"; sơ đồ có link "Lịch sử ngăn" và "Lịch sử hộp" ở hộp đáy chặn ngăn) | Như ADMIN |
| `/admin/orders`, `/admin/orders/:id` | Chỉ xem; danh sách có lọc nhanh "Cần xử lý: nhả hàng thất bại" (`?status=DISPENSE_FAILED`). Chi tiết (FE 6.1): dòng thời gian đơn, khối "Cần xử lý" (nhả lỗi, thanh toán thành công trên đơn đã hủy, thanh toán trùng), link một cú bấm sang thanh toán (`/admin/payments/:id`), sang ngăn trên sơ đồ (`/admin/inventory?machineId=&slotId=`, slotId lấy từ lệnh nhả hàng hoặc tra mã ngăn trong 100 ngăn đầu của máy; không tra được thì mở sơ đồ cả máy) và sang lịch sử hộp (`/admin/inventory/history?inventoryItemId=`); lệnh nhả hàng; đơn đang xử lý tự làm mới mỗi 5 giây | Như ADMIN, nhưng thanh toán không có link (kèm giải thích) |
| `/admin/payments`, `/admin/payments/:id` | Chỉ xem (FE 6.2, **bị chặn bởi BE** ở phần lệch số tiền, xem bên dưới). Lọc nhanh "Cần xử lý: thanh toán muộn, trùng" (`?requiresAttention=true`, lọc phía server: PAYMENT_LATE và PAYMENT_DUPLICATE). Cột "Bất thường": hai khoản SUCCESS cùng đơn trên trang là "Trùng khoản" (khoản thanh toán sau là khoản cần hoàn), mọi dòng khác là "Cần đối soát" (mở chi tiết để biết loại). Bị lỗi 403 thì ẩn ô giải thích và thanh lọc. Chi tiết: mục "Cần xử lý" theo đúng quy tắc BE (muộn = SUCCESS trên đơn CANCELLED; trùng = đơn có hơn một khoản SUCCESS, đọc từ `GET /orders/{id}`; lệch số tiền theo webhook), số tiền so với tổng đơn, mã tham chiếu, mã giao dịch nhà cung cấp, các lần thanh toán của đơn (một cú bấm), "Đối chiếu webhook" (`GET /payment-webhook-logs?reference=<paymentReference>`, rồi chỉ đọc chi tiết các log đã xác thực có sự kiện PAYMENT_SUCCESS/PAYMENT_FAILED để lấy số tiền; quy tắc lệch như `PaymentConfirmationService`: SUCCESS không có số tiền hoặc khác số tiền, FAILED có số tiền khác) | Ẩn |
| `/admin/webhook-logs`, `/admin/webhook-logs/:id` | Chỉ xem; bộ lọc trên URL (`reference` là đích link từ thanh toán). Chi tiết: "Nội dung (payload) đã lưu" là JSON máy chủ lưu (jsonb, đã phân tích rồi ghi lại nên thứ tự khóa và khoảng trắng có thể khác bản gốc); chỉ thân không phải JSON (`rawBody`) mới là nguyên văn từng ký tự. Có tùy chọn xuống dòng cho dễ đọc, `<pre>` cuộn được bằng bàn phím, nút "Sao chép nội dung" (thông báo tự xóa sau 4 giây), số tiền đọc từ payload (MOCK `amount`, payOS `data.amount`). Lần gọi đã xác thực chỉ ghi "chữ ký hợp lệ; kết quả xử lý xem ở thanh toán tương ứng" | Ẩn |

Điều hướng và nút thao tác bị ẩn theo vai trò; truy cập thẳng URL không đủ quyền hiện "Không có quyền truy cập". `/admin` và `/staff` chuyển tới màn hình đầu tiên mà vai trò được xem.

Giới hạn hiện tại của màn Vai trò & quyền (`/admin/roles`, FE 3.2): máy chủ (#48) áp dụng thay đổi quyền ngay từ yêu cầu kế tiếp của mọi tài khoản thuộc vai trò, nhưng web vẫn suy menu/route/nút từ vai trò qua bảng tĩnh `ROLE_PERMISSIONS`. Vì vậy cấp thêm quyền cho STAFF chưa làm hiện menu mới, còn quyền bị thu hồi thì menu vẫn hiện và API trả 403 kèm lời giải thích. Hết giới hạn khi có API thông tin phiên (`GET /auth/me`, hợp đồng nháp `auth-me.yaml`); mock `/auth/me` đã đọc quyền từ bảng vai trò trong bộ nhớ nên phản ánh ngay thay đổi trên màn A3. Màn có cảnh báo khi rời trang còn thay đổi chưa lưu (link trong app, Back, Đăng xuất, đóng tab); hết phiên thì chuyển thẳng về đăng nhập, không hỏi.

Quy tắc quyền nằm ở một chỗ: `src/admin/permissions.ts` (`can(subject, permission)`, tên quyền theo `api-contract/drafts/auth-me.yaml`); route, mục điều hướng và nút chỉ hỏi `can`. Hiện quyền suy ra từ vai trò trong JWT; khi backend có `GET /auth/me` (BE 3.1) thì truyền `permissions` của API vào `Subject.permissions`. Truy cập thẳng URL không đủ quyền bị chặn trước khi màn hình gọi API. API trả 403 thì màn hiện cùng khối giải thích (vai trò hiện tại, liên hệ quản trị viên, về trang đầu), không đăng xuất. API trả 401 hoặc token hết hạn: xóa phiên, chuyển một lần tới `/login?next=<trang + query hiện tại>`; `next` chỉ nhận đường dẫn nội bộ bắt đầu bằng `/admin`.

`useApi(loader, key, { pollMs })` làm mới định kỳ: một request mỗi lúc, dừng khi tab ẩn và làm mới ngay khi hiện lại, giữ dữ liệu cũ (`refreshing` thay vì `loading`), dừng hẳn khi gặp 401/403.

## Lệnh nhả hàng (chờ API thật BE 3.3)

Chi tiết đơn đọc lệnh nhả hàng từ `GET /api/v1/orders/{orderId}/dispense-commands`, **hợp đồng nháp** `api-contract/drafts/dispense-commands.yaml` (tên field và enum theo entity `DispenseCommand`, enum `DispenseStatus` đã có ở backend; ngữ nghĩa theo `docs/mqtt-dispense.md`). Hiện chỉ mock có endpoint này (nhóm `dispense-commands`). Trên backend thật chưa có endpoint, lời gọi trả 404 và mục "Lệnh nhả hàng" hiện "Chưa có dữ liệu lệnh nhả hàng", các phần khác của đơn không bị ảnh hưởng (`dispenseAvailability` trong `src/admin/order-detail.ts`). Chỉ gọi khi đơn đã thanh toán. Khi BE 3.3 xong: chuyển path vào `api.yaml`, chạy `npm run gen:api`, đổi type `DispenseCommand` trong `src/api/resources.ts` sang `schema.d.ts`, xóa file nháp và `src/api/drafts/dispense-commands.d.ts`. Cần báo BE 3.3: đơn nhiều hộp mà một hộp nhả lỗi (lệnh FAILED/TIMEOUT, hộp DISPENSE_FAILED) rồi hộp sau nhả thành công sẽ thành COMPLETED (`DispenseService.completed`), nên trạng thái đơn không cho biết còn hộp lỗi chặn ngăn; web suy ra từ lệnh (bước nhả hàng "Nhả hàng có hộp lỗi", mục "Cần xử lý"), nhưng khi chưa có API lệnh thì không thấy được. Đơn chuyển DISPENSING ngay khi lệnh được gửi (`markSent`), trước khi máy xác nhận, nên web chỉ nói "máy đã nhận lệnh" khi có `acknowledgedAt`. Lệnh FAILED/TIMEOUT chưa từng gửi được không có `completedAt`: web hiện `updatedAt` kèm chú thích. Đơn CANCELLED/PAYMENT_FAILED không gọi API lệnh, kể cả khi có `paidAt`. Khi API trả 404 thì ngừng làm mới mục lệnh. Bộ đếm gửi lại của backend nằm trong bộ nhớ nên web không hiển thị số lần gửi lại; "kết quả đến muộn" được suy ra khi lệnh SUCCESS kết thúc quá 60 giây sau lúc tạo.

## Quy ước chung

- **Phân trang, sắp xếp, lọc phía server.** Trang bắt đầu từ 0; bộ lọc nằm trong query string URL (chia sẻ được, nút Back hoạt động). Chỉ dùng các trường `sort` được contract liệt kê.
- **Chỉ gửi field có trong contract.** Backend từ chối field lạ nên biểu mẫu không gửi id, thời gian hay trạng thái (trừ endpoint đổi trạng thái riêng). SKU, mã máy, mã ngăn bị khóa khi sửa.
- **Tiền:** hiển thị VND (`35.000 ₫`), không tự tính tổng; giá nhập > 0, tối đa 2 chữ số thập phân.
- **Thời gian:** API dùng UTC; giao diện hiển thị giờ `Asia/Ho_Chi_Minh`. Bộ lọc ngày được đổi thành khoảng `[từ, đến)` theo UTC.
- **Không có thao tác xóa.** Dùng đổi trạng thái hoặc thu hồi.
- **Khóa kiosk:** `apiKey` chỉ hiện một lần trong hộp thoại, có cảnh báo và nút sao chép; không lưu vào storage. Cấp khóa mới khi đang có khóa hoạt động cần xác nhận vì khóa cũ bị vô hiệu ngay.
- **Webhook:** nội dung thô là dữ liệu không tin cậy, chỉ hiển thị dạng văn bản đã escape (`<pre>`), không bao giờ là HTML.
- **Lệch số tiền: 6.2 bị chặn bởi BE.** PAYMENT_AMOUNT_MISMATCH (và PAYMENT_TRANSACTION_CONFLICT) giữ nguyên thanh toán và chỉ ghi `audit_logs`, chưa có API; danh sách webhook không có số tiền và không lọc được. Vì vậy "Cần xử lý" chỉ liệt kê muộn/trùng và nói rõ lệch số tiền chỉ xem được ở chi tiết từng thanh toán. **Đề nghị BE:** mở rộng `GET /payments?requiresAttention=true` để trả cả các payment có anomaly PAYMENT_AMOUNT_MISMATCH và PAYMENT_TRANSACTION_CONFLICT (các nhánh ở `PaymentConfirmationService.process`/`applySuccess`, ví dụ suy ra từ `audit_logs` với `entity_type = Payment`). FE không cần sửa khi BE làm xong: cột "Bất thường" chỉ ghép "Trùng khoản" cho các khoản SUCCESS cùng đơn, mọi dòng khác (kể cả loại mới) hiện "Cần đối soát" và trang chi tiết nói rõ loại. Nên thêm lọc `paymentReference` cho `GET /payments` để từ webhook sang thanh toán bằng một cú bấm.
- **Schema `rawPayload` sai ở contract:** BE trả `rawPayload` là giá trị JSON (entity `JsonNode` jsonb, DTO `type = "object"`, ví dụ trong api.yaml là object) nhưng schema `PaymentWebhookLogDetailResponse.rawPayload` ghi `string | null`. Cần BE sửa schema thành `object | null` rồi chạy `npm run gen:api`. FE không sửa api.yaml/schema.d.ts: mọi chỗ đọc đi qua `payloadText`/`payloadValue` trong `src/admin/payload.ts` (chuỗi giữ nguyên, null là rỗng, giá trị khác thì `JSON.stringify`), có ép kiểu cục bộ kèm chú thích; mock trả object như BE, thân không phải JSON thì `rawPayload: null` và chuỗi gốc ở `rawBody`.
- Danh sách chọn (sản phẩm, máy, ngăn, lô) tải tối đa 100 bản ghi đầu theo tên.

## Mã nguồn

```text
src/api/        client, session (JWT), resources (hàm theo endpoint), schema.d.ts (sinh từ contract)
src/lib/        format (tiền, giờ, parse), router (History API + query string)
src/admin/      AdminApp (khung, điều hướng), routes (ma trận quyền), kit (bảng, biểu mẫu, hộp thoại), pages/
```

## Kiểm thử

`npm test` kiểm tra client (bóc `data`, ánh xạ lỗi, query), phiên/JWT và chặn open-redirect, ma trận quyền, định dạng tiền/giờ/khoảng ngày và hiển thị payload an toàn.

Đã chạy smoke test thủ công với backend thật (PostgreSQL 18 + `PAYMENT_PROVIDER=MOCK`) cho: đăng nhập/đăng xuất, chuyển về URL cũ sau `401`, ADMIN và STAFF, sản phẩm (kiểm tra biểu mẫu), máy, ngăn, tóm tắt tồn kho, khóa kiosk (hiện một lần), lô, hộp tồn kho, lịch sử, đơn hàng, thanh toán, danh sách người dùng. Chưa có dữ liệu webhook thật để xem màn hình chi tiết webhook; cần thử lại khi có provider gọi về.
