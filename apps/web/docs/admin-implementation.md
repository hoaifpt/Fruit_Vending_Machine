# Dashboard admin — triển khai frontend

Đã triển khai theo hướng A trong `apps/web`. Đây là bản frontend tương tác với dữ liệu mẫu, không phải khu quản trị đã kết nối hệ thống thật.

## Mở bản thử

- `/admin`: tổng quan doanh thu, mặc định hôm nay theo giờ Việt Nam; chọn tháng, năm và máy. Biểu đồ và số tổng dùng cùng tập giao dịch đã thanh toán và nhả hàng thành công.
- `/admin/machines`: tìm kiếm, lọc vị trí/trạng thái, thêm/sửa/ngừng sử dụng máy. Mở từng máy để quản lý ngăn, giá, công việc và lịch sử giao dịch.
- `/admin/products`: thêm/sửa/ngừng sản phẩm, ảnh tùy chọn, giá riêng cho từng máy.
- `/admin/inventory`: ngăn/sức chứa, lô/hạn dùng, cảnh báo, ghi nhận lấy hàng ra và giao refill.
- `/admin/transactions`: giao dịch theo thời gian; tab nhả hàng thất bại chứa toàn bộ lịch sử và có ghi chú xử lý theo trạng thái.
- `/admin/tasks`: giao refill nhiều ngăn hoặc bảo trì có hạn và mô tả lỗi; sửa phân công chưa bắt đầu, hủy kèm lý do, đọc lịch sử/kết quả.
- `/admin/staff`: hồ sơ nhân viên mẫu, phạm vi máy và trạng thái hoạt động.
- `/staff?staff=s1`: mô phỏng staff nhận việc, báo cần hỗ trợ, nhập thực tế nhiều lô/hạn dùng hoặc ảnh trước/sau bảo trì. Có bộ chọn nhân viên mẫu rõ ràng.

Chạy `npm run dev` từ `apps/web`. Các đường dẫn dùng fallback của Vite; hosting sau này cần rewrite SPA về `index.html`.

## Quy tắc đã triển khai

- Doanh thu chỉ tính `paid && status === SUCCESS`. Việc giải quyết/đánh dấu đã hoàn tiền cho đơn lỗi không cộng doanh thu và không thay đổi số tiền lịch sử.
- Sự cố: chờ xử lý → đang xử lý → đã hoàn tiền hoặc đã giải quyết; mỗi lần chuyển cần ghi chú. Đây chỉ là ghi nhận mẫu, không có giao dịch chuyển tiền.
- Một ngăn chứa một sản phẩm và nhiều lô. Hàng hết hạn bị loại khỏi số có thể bán nhưng vẫn chiếm sức chứa đến khi lấy ra.
- Cảnh báo khi còn tối đa 2 hộp có thể bán; cảnh báo hạn dùng hôm nay/ngày mai. Ngưỡng cố định theo yêu cầu.
- Refill yêu cầu hạn hợp lệ, số nguyên dương theo lô, không vượt sức chứa. Chênh lệch so với phân công cần ghi chú. Hoàn thành cập nhật kho ngay và không thể hoàn thành lại.
- Bảo trì cần kết quả và hai ảnh trước/sau; ảnh PNG/JPG/WebP tối đa 400 KB mỗi ảnh.
- Staff chỉ thao tác công việc của mình trong phạm vi máy được giao. Màn hình staff không hiển thị doanh thu, giao dịch hay giá bán.
- Không giới hạn cố định số máy/vị trí. Danh sách có tìm kiếm và phân trang. Xóa máy/sản phẩm được thực hiện bằng ngừng sử dụng để giữ lịch sử; chặn khi còn hàng hoặc việc đang mở. Khóa nhân viên cũng kiểm tra công việc đang mở.

## Lưu trữ và giới hạn tích hợp

Dữ liệu lưu trong localStorage với khóa `fruit-vending-admin-demo-v1`. Làm mới trang giữ lại thay đổi; các tab cùng trình duyệt nhận sự kiện cập nhật. Có kiểm tra revision trước khi lưu và báo lỗi khi dữ liệu cũ/hỏng hoặc hết bộ nhớ. Nút Đặt lại mẫu cần xác nhận và thay dữ liệu trên trình duyệt bằng bộ mẫu ban đầu.

Đây không phải cơ chế đồng bộ nhiều người dùng hoặc giao dịch nguyên tử phía máy chủ. Phân quyền giao diện và `staffView` chỉ phục vụ bản demo; toàn bộ dữ liệu mẫu vẫn nằm trong trình duyệt và người xem có thể chọn cả hai vai trò. Không đưa dữ liệu thật vào bản này.

Backend cần bổ sung trước khi dùng thật:

1. Session đăng nhập và kiểm tra vai trò ở server cho từng API; giới hạn payload staff, không trả dữ liệu tài chính.
2. Database, API phân trang/lọc, xác thực dữ liệu và nhật ký người thao tác thực tế. Dùng transaction + idempotency key/optimistic locking cho hoàn thành refill và cập nhật lô.
3. Đồng bộ thanh toán, kết quả nhả hàng, tồn kho và trạng thái kết nối máy; xác nhận hoàn tiền qua nhà cung cấp thanh toán.
4. Lưu ảnh qua dịch vụ upload, xác thực ảnh phía server và phân quyền truy cập.
5. Cấp/khóa tài khoản staff thật; không dùng bộ chọn vai trò mẫu như cơ chế đăng nhập.

Màn hình đăng nhập hiện có vẫn dùng hợp đồng API trong `docs/auth-integration.md`; dashboard mẫu không giả lập đăng nhập thành công.

## Kiểm tra

- 29 kiểm thử tự động gồm 12 kiểm thử nghiệp vụ quản trị và 17 kiểm thử đăng nhập/landing.
- Build TypeScript/Vite và lint.
- Thử trong trình duyệt: tạo máy, cập nhật giá tại máy, phân công refill, hoàn thành hai lô (2 → 12 hộp), chuyển trạng thái sự cố kèm ghi chú, màn hình staff không có nội dung tài chính.
- Kiểm tra giao diện máy tính 1440 px, tablet và điện thoại 390/320 px. Trên điện thoại, bảng chuyển thành bản ghi có nhãn, toàn bộ nút thao tác nằm trong chiều rộng màn hình. Có hỗ trợ giảm chuyển động, focus và dialog bàn phím.
