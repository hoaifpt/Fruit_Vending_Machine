# Thiết kế Web quản lý

## Hướng đã duyệt

Hiện đại, tối giản, xanh lá trầm trên nền sáng. Mẫu đăng nhập được duyệt: `docs/design/login-mock-v2-fruit.png`. Minh họa trái cây thay thế hình khối theo yêu cầu mới nhất.

## Typography

Một họ sans-serif hệ thống (Segoe UI, system-ui) hỗ trợ tiếng Việt, không tải font bên ngoài. Tiêu đề form 36px trên desktop, 32px trên mobile; nội dung 16–18px; nhãn 15px. Chữ trong ảnh mẫu được triển khai bằng HTML.

## Màu

Các token OKLCH trong `src/index.css` giữ hướng màu đã duyệt: nền trắng/xanh rất nhạt, chữ xanh đậm, xanh lá cho tương tác, đỏ đậm cho lỗi. Placeholder và nhãn phải dễ đọc; viền input đậm hơn bản mẫu để nhận biết rõ.

## Bố cục

Desktop: hai cột 45/55, nhận diện và minh họa bên trái, form tối đa 400px bên phải. Từ 760px trở xuống: một cột, wordmark và cụm cam thu gọn trên cùng, form tối đa 440px. Trường nhập cao 54px, nút hiện mật khẩu có vùng chạm 44px.

## Thành phần và trạng thái

Form có nhãn cố định, autofill username/current-password, kiểm tra rỗng khi blur/submit, hiện/ẩn mật khẩu, loading ngăn gửi lặp, thông báo lỗi được đọc và focus khi cần. Chỉ hiển thị thành công khi API trả tài khoản ADMIN/STAFF hợp lệ.

## Chuyển động

Chuyển tiếp tương tác 180ms; phản hồi lỗi 180ms; loading indicator khi chờ API. Không trì hoãn hiển thị trang. Tắt animation/transition khi thiết bị bật giảm chuyển động.

## Minh họa

Hai WebP trong `src/assets`, được tạo bằng imagegen theo bản mẫu đã duyệt. Asset nền trắng sạch, desktop hòa vào nền xanh nhạt bằng CSS multiply; không phải ảnh alpha. Không sử dụng ảnh chụp toàn bộ UI làm giao diện.

## Landing page A

Đã triển khai trang công khai theo `docs/design/landing-directions-v1.png`, hướng A. Giữ nền sáng, hero lệch trái/phải và minh họa trái cây/máy, dải quy trình xanh trầm, ảnh không gian cho phần hợp tác. Tiêu đề landing dùng Source Serif 4 self-hosted để giữ sắc thái bản mẫu và dấu tiếng Việt chính xác; trang đăng nhập giữ sans-serif hệ thống. Chi tiết tại `docs/landing-page.md`.
