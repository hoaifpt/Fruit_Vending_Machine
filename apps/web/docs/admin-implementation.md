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
| `/admin/orders`, `/admin/orders/:id` | Chỉ xem | Chỉ xem |
| `/admin/payments`, `/admin/payments/:id` | Chỉ xem, chế độ "Cần xử lý" | Ẩn |
| `/admin/webhook-logs`, `/admin/webhook-logs/:id` | Chỉ xem | Ẩn |

Điều hướng và nút thao tác bị ẩn theo vai trò; truy cập thẳng URL không đủ quyền hiện "Không có quyền truy cập". `/admin` và `/staff` chuyển tới màn hình đầu tiên mà vai trò được xem.

Giới hạn hiện tại của màn Vai trò & quyền (`/admin/roles`, FE 3.2): máy chủ (#48) áp dụng thay đổi quyền ngay từ yêu cầu kế tiếp của mọi tài khoản thuộc vai trò, nhưng web vẫn suy menu/route/nút từ vai trò qua bảng tĩnh `ROLE_PERMISSIONS`. Vì vậy cấp thêm quyền cho STAFF chưa làm hiện menu mới, còn quyền bị thu hồi thì menu vẫn hiện và API trả 403 kèm lời giải thích. Hết giới hạn khi có API thông tin phiên (`GET /auth/me`, hợp đồng nháp `auth-me.yaml`); mock `/auth/me` đã đọc quyền từ bảng vai trò trong bộ nhớ nên phản ánh ngay thay đổi trên màn A3. Màn có cảnh báo khi rời trang còn thay đổi chưa lưu (link trong app, Back, Đăng xuất, đóng tab); hết phiên thì chuyển thẳng về đăng nhập, không hỏi.

Quy tắc quyền nằm ở một chỗ: `src/admin/permissions.ts` (`can(subject, permission)`, tên quyền theo `api-contract/drafts/auth-me.yaml`); route, mục điều hướng và nút chỉ hỏi `can`. Hiện quyền suy ra từ vai trò trong JWT; khi backend có `GET /auth/me` (BE 3.1) thì truyền `permissions` của API vào `Subject.permissions`. Truy cập thẳng URL không đủ quyền bị chặn trước khi màn hình gọi API. API trả 403 thì màn hiện cùng khối giải thích (vai trò hiện tại, liên hệ quản trị viên, về trang đầu), không đăng xuất. API trả 401 hoặc token hết hạn: xóa phiên, chuyển một lần tới `/login?next=<trang + query hiện tại>`; `next` chỉ nhận đường dẫn nội bộ bắt đầu bằng `/admin`.

`useApi(loader, key, { pollMs })` làm mới định kỳ: một request mỗi lúc, dừng khi tab ẩn và làm mới ngay khi hiện lại, giữ dữ liệu cũ (`refreshing` thay vì `loading`), dừng hẳn khi gặp 401/403.

## Quy ước chung

- **Phân trang, sắp xếp, lọc phía server.** Trang bắt đầu từ 0; bộ lọc nằm trong query string URL (chia sẻ được, nút Back hoạt động). Chỉ dùng các trường `sort` được contract liệt kê.
- **Chỉ gửi field có trong contract.** Backend từ chối field lạ nên biểu mẫu không gửi id, thời gian hay trạng thái (trừ endpoint đổi trạng thái riêng). SKU, mã máy, mã ngăn bị khóa khi sửa.
- **Tiền:** hiển thị VND (`35.000 ₫`), không tự tính tổng; giá nhập > 0, tối đa 2 chữ số thập phân.
- **Thời gian:** API dùng UTC; giao diện hiển thị giờ `Asia/Ho_Chi_Minh`. Bộ lọc ngày được đổi thành khoảng `[từ, đến)` theo UTC.
- **Không có thao tác xóa.** Dùng đổi trạng thái hoặc thu hồi.
- **Khóa kiosk:** `apiKey` chỉ hiện một lần trong hộp thoại, có cảnh báo và nút sao chép; không lưu vào storage. Cấp khóa mới khi đang có khóa hoạt động cần xác nhận vì khóa cũ bị vô hiệu ngay.
- **Webhook:** nội dung thô là dữ liệu không tin cậy, chỉ hiển thị dạng văn bản đã escape (`<pre>`), không bao giờ là HTML.
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
