# Landing page

Trang công khai `/` dùng mẫu A đã duyệt, gồm hero minh họa trái cây/máy, quy trình mua hàng, giải pháp, hợp tác, liên hệ và hỏi đáp. Trang đăng nhập ở `/login`; URL không tồn tại có màn hình 404.

## Chạy và triển khai

- `npm run dev`: xem local.
- `npm run build`, `npm run lint`, `npm test`: kiểm tra.
- Hosting khi triển khai phải rewrite các đường dẫn ứng dụng về `index.html` để `/login` hoạt động khi mở trực tiếp/tải lại. Chưa triển khai hosting trong tác vụ này.

## Liên hệ hợp tác

Cấu hình trong `.env.local` từ `.env.example`:

- `VITE_PARTNERSHIP_EMAIL`: email nhận liên hệ.
- `VITE_PARTNERSHIP_PHONE`: số điện thoại liên hệ.

Để trống khi chưa xác nhận. Giao diện sẽ ghi kênh liên hệ đang cập nhật; không hiển thị địa chỉ giả hoặc form gửi không có đích. Khi có email, liên kết mở bản nháp trong ứng dụng email của khách; khi có số điện thoại, liên kết mở ứng dụng gọi điện. Trang không tự gửi thông tin.

Khởi động lại Vite hoặc build lại sau khi đổi biến môi trường. Các giá trị này là thông tin công khai, không chứa secret.

## Tài nguyên và thiết kế

Ảnh `landing-hero.webp` và `partnership-space.webp` tạo bằng imagegen theo mẫu A, lần lượt khoảng 150 KB và 141 KB. Đây là minh họa ý tưởng; không chứng thực máy đã lắp đặt hoặc địa điểm đang vận hành. Prompt: máy concept cùng đu đủ/dưa hấu/cam/kiwi trên nền trắng; không gian sinh hoạt chung sáng thoáng với bàn ghế, cây xanh.

Tiêu đề dùng Source Serif 4 để giữ hướng chữ serif của mẫu A và hiển thị tiếng Việt đồng nhất; chỉ self-host subset latin/vietnamese, weight 600, WOFF2 khoảng 28 KB. Nội dung và form vẫn dùng sans-serif hệ thống. Font nguồn Google Fonts qua gói @fontsource/source-serif-4, giấy phép OFL-1.1.

Màu OKLCH và giao diện login được giữ riêng. Các mục tiêu đề/CTA/ảnh chính bám hướng A; phần giải pháp, hỏi đáp và trạng thái liên hệ bổ sung theo kế hoạch đã duyệt. Hỗ trợ reduced motion; menu có Escape, nhấp bên ngoài và tự đóng khi chuyển sang desktop; hỏi đáp dùng details/summary native.
