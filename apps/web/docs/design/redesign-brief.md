# Design brief: Thiết kế lại toàn bộ web Fruit Vending

Trạng thái: **đã duyệt 18/10/2026**; mặc định cho câu hỏi mở: chưa làm trang Tổng quan, thứ tự như mục 10. Lựa chọn đã chốt: **1C** (toàn bộ web), **2A** (Tailwind CSS v4 + shadcn/ui + lucide), **3A** (kiểu Stripe/Vercel, sáng, có dark mode).

## 1. Tóm tắt
Làm lại giao diện `apps/web` gồm 4 bề mặt: **admin** (13 trang), **đăng nhập**, **landing page** và **kiosk `/buy`**. Mục tiêu là trông và hoạt động như một dashboard SaaS production: thành phần thống nhất, đủ trạng thái, dùng tốt trên điện thoại và máy tính, có dark mode. Chỉ đổi giao diện, **không đổi API, logic hay luồng nghiệp vụ**.

## 2. Hành động chính của người dùng
- Admin/staff: nhìn một lần biết máy nào, slot nào, đơn nào cần xử lý, rồi xử lý được ngay trên trang đó.
- Khách ở kiosk: chọn một món, quét QR, biết chắc đã thanh toán.

## 3. Hướng thiết kế
- **Chiến lược màu:** Restrained. Nền trung tính (trắng, xám rất nhạt). Xanh lá trầm hiện có (`--brand` oklch 0.532 0.099 152) chỉ dùng cho nút chính, mục đang chọn và trạng thái. Đỏ, vàng, xanh dương chỉ cho lỗi, cảnh báo và thông tin.
- **Câu bối cảnh:** Nhân viên vận hành mở dashboard trên laptop ở văn phòng sáng đèn hoặc trên điện thoại khi đứng cạnh máy để nạp hàng, cần đọc nhanh, bấm chính xác. Vì vậy mặc định nền sáng, dark mode theo hệ thống và có nút chuyển.
- **Tham chiếu:** Stripe Dashboard (bảng, chi tiết thanh toán), Vercel Dashboard (sidebar sáng, độ tối giản), shadcn/ui blocks "dashboard-01" và "sidebar-07".
- **Kiosk là ngoại lệ có chủ đích:** màn hình cảm ứng đặt ở nơi công cộng nên được phép dùng màu **Committed** (xanh lá đậm hơn), chữ và nút lớn, luôn nền sáng.
- **Landing** giữ hướng A đã duyệt (Source Serif 4 cho tiêu đề, ảnh trái cây hiện có), chỉ chuyển sang token và component mới.

## 4. Phạm vi
- Độ hoàn thiện: **production-ready**, code thật, có test và lint pass.
- Độ rộng: toàn bộ 4 bề mặt, làm theo từng đợt (mục 10).
- Tương tác: component chạy thật, không phải prototype.

## 5. Nền tảng kỹ thuật
- Tailwind CSS v4 (plugin Vite), shadcn/ui (Radix UI), lucide-react, `class-variance-authority`, `tailwind-merge`.
- Token màu OKLCH trong CSS variables, có bộ cho light và dark. Giữ hue xanh lá hiện tại.
- Font: **Inter** tự host (hỗ trợ tiếng Việt đầy đủ) cho toàn bộ UI, chữ số dạng tabular trong bảng. Source Serif 4 chỉ dùng cho tiêu đề landing.
- Bảng: TanStack Table cho sắp xếp, ẩn/hiện cột và phân trang theo API.
- Dữ liệu: TanStack Query để cache, giữ dữ liệu cũ khi tải lại và biết khi nào đang tải, nhờ vậy loading và chuyển trang mượt.
- Chuyển động: View Transitions API cho chuyển trang, `tw-animate-css` (đi kèm shadcn) cho Sheet, dialog, toast. Không thêm thư viện animation nặng.
- Xoá dần `admin.css`, `App.css` và CSS của từng trang sau khi màn hình tương ứng đã chuyển xong.

## 6. Bố cục
**Admin shell**
- Sidebar sáng, thu gọn được thành dải icon. Trên mobile là drawer (Sheet).
- Nhóm menu: *Vận hành* (Máy, Tồn kho, Lô hàng, Sản phẩm), *Giao dịch* (Đơn hàng, Thanh toán, Webhook), *Hệ thống* (Tài khoản). Mục chỉ dành cho ADMIN vẫn ẩn theo vai trò như hiện tại.
- Thanh trên cùng: breadcrumb, ô tìm kiếm mở **command palette (Ctrl+K)** để nhảy trang hoặc tìm máy/đơn, nút đổi theme, menu tài khoản.
- Trang danh sách: tiêu đề và nút chính, thanh lọc (tìm kiếm, bộ lọc dạng chip, khoảng ngày), bảng, phân trang.
- Trang chi tiết: header có trạng thái dạng badge, nội dung chia tab, cột phải tóm tắt (với máy: slot và tồn kho).
- Mobile: bảng chuyển thành danh sách thẻ, các thao tác gom vào menu "…".

**Đăng nhập:** giữ bố cục hai cột và minh hoạ đã duyệt, thay input/nút bằng component mới, có dark mode.

**Kiosk `/buy`:** lưới sản phẩm thẻ lớn (vùng chạm từ 64px), màn hình QR chiếm trung tâm với số tiền và đồng hồ đếm lớn, thanh trạng thái máy ở trên.

## 7. Trạng thái cần có
- **Loading (bổ sung theo yêu cầu):**
  - Lần tải đầu: skeleton đúng hình bảng/thẻ, có hiệu ứng shimmer chạy nhẹ (1,5 giây một vòng).
  - Khi đổi trang hoặc gọi API: thanh tiến trình mảnh chạy trên cùng (kiểu YouTube/GitHub). Chỉ hiện nếu chờ quá 150ms, nên tải nhanh không bị nháy.
  - Khi lọc, sắp xếp hoặc phân trang: giữ dữ liệu cũ, làm mờ nhẹ bảng kèm thanh tiến trình, không xoá trắng bảng.
  - Nút đang gửi: spinner nhỏ trong nút và khoá nút để tránh bấm lặp.
  - Kiosk: hoạt ảnh riêng, lớn hơn khi đang tạo QR và chờ xác nhận thanh toán.
- **Rỗng:** giải thích và có nút bước tiếp theo, ví dụ "Chưa có máy nào. Tạo máy đầu tiên".
- **Lỗi API:** banner trong trang kèm nút "Thử lại"; lỗi từng trường hiện ngay dưới trường.
- **Thành công:** toast (Sonner) sau tạo, sửa, nạp hàng, thu hồi khóa.
- **Thao tác nguy hiểm** (thu hồi khóa kiosk, gỡ hàng, khoá tài khoản): AlertDialog xác nhận, ghi rõ hậu quả.
- **Không có quyền / hết phiên:** trang 403 rõ ràng; 401 chuyển về đăng nhập như hiện tại.
- **Kiosk:** chưa cấu hình, tạm ngừng, đang tạo QR, chờ thanh toán, mất kết nối, QR hết hạn, đã thanh toán, đã huỷ.

## 8. Tương tác
- Form tạo/sửa ngắn dùng **Sheet trượt từ phải** thay cho modal giữa màn hình; form dài dùng trang riêng.
- Bộ lọc và trang hiện tại lưu trên URL để chia sẻ link và giữ khi tải lại.
- **Chuyển trang (bổ sung theo yêu cầu):** dùng View Transitions API của trình duyệt. Sidebar và topbar đứng yên, chỉ vùng nội dung mờ dần và trượt nhẹ 8px trong khoảng 180ms. Từ danh sách vào chi tiết, tiêu đề hoặc thẻ của mục được bấm chuyển liền mạch sang trang chi tiết. Nút Back của trình duyệt chạy ngược hiệu ứng.
- **Chuyển giữa các chức năng:** đổi tab có thanh gạch dưới trượt theo; Sheet, dialog và dropdown mở hoặc đóng với hiệu ứng mờ kèm phóng nhẹ; sidebar thu gọn hoặc mở rộng mượt; dòng mới thêm vào bảng sáng lên rồi nhạt dần; toast trượt vào từ góc; số liệu thay đổi thì chuyển số mượt; đổi light/dark mượt.
- Thời lượng 150–250ms, easing ease-out. Chuyển động luôn gắn với một thay đổi trạng thái, không chặn thao tác (bấm được ngay khi đang chạy hiệu ứng). Khi bật giảm chuyển động thì chỉ còn đổi độ mờ, tắt trượt và phóng.
- Bàn phím: dùng được toàn bộ, focus luôn thấy rõ, Ctrl+K mở command palette, Esc đóng Sheet và dialog.

## 9. Nội dung
- Giữ toàn bộ chữ tiếng Việt hiện có, chuẩn hoá cách gọi giữa các màn hình (ví dụ chỉ dùng một trong "hộp" hoặc "bát").
- Định dạng thống nhất: tiền `12.000 ₫`, ngày giờ `18/10/2026 17:30`, mã đơn rút gọn kèm nút sao chép.
- Ảnh dùng lại 4 file trong `src/assets`, icon dùng lucide.

## 10. Thứ tự triển khai đề xuất
1. **Nền tảng:** cài Tailwind và shadcn, token light/dark, font, layout admin mới (sidebar, topbar, command palette).
2. **Component chung:** DataTable, thanh lọc, badge trạng thái, form field, Sheet, empty/error/skeleton, toast.
3. **Màn hình admin:** Máy và chi tiết máy → Tồn kho → Sản phẩm, Lô hàng → Đơn, Thanh toán, Webhook → Tài khoản.
4. **Đăng nhập** và **landing**.
5. **Kiosk `/buy`.**
6. **Hoàn thiện:** `/fk check` và `/fk finish` (a11y, responsive, hiệu năng), xoá CSS cũ, cập nhật `DESIGN.md`.

Mỗi đợt là một PR riêng vào `dev`, chạy `npm run lint`, `npm test` và `npm run build`.

## 11. Reference của bộ fk sẽ dùng khi làm
`product.md`, `tokens.md`, `color.md`, `type.md`, `space.md`, `interaction-design.md`, `responsive.md`, `motion.md`, `check.md`, `finish.md`.

## 12. Câu hỏi còn mở
1. Có muốn thêm **trang Tổng quan** (dashboard số liệu) làm trang chủ admin không? Backend hiện chưa có API thống kê, nên nếu có thì cần làm thêm API.
2. Thứ tự ở mục 10 có ổn không, hay bạn muốn làm kiosk trước?
