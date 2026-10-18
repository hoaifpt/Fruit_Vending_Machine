# Landing page công khai — kế hoạch thiết kế

Trạng thái: hướng A đã duyệt và đã triển khai theo yêu cầu /fk build landing page. Chi tiết tại landing-page.md. Kênh liên hệ thật vẫn chờ cung cấp.

## 1. Mục tiêu và người xem

Giới thiệu công khai hệ thống máy bán trái cây tự động Fruit Vending. Phục vụ người tìm hiểu giải pháp, đối tác muốn đặt máy, và admin/staff cần vào Web quản lý. Hai mục tiêu đã xác nhận: đăng nhập quản lý và liên hệ hợp tác đặt máy.

## 2. Hành động chính

Ưu tiên “Hợp tác đặt máy” cho khách truy cập công khai; duy trì “Đăng nhập quản lý” rõ ràng trên thanh điều hướng cho admin/staff. Đây là đề xuất thứ tự ưu tiên, không loại bỏ mục tiêu nào.

## 3. Hướng thiết kế

Register của riêng landing page là brand; Web quản trị vẫn là product. Giữ nhận diện xanh lá trầm, nền sáng và minh họa trái cây đã duyệt. Người xem có thể tìm hiểu bằng điện thoại trong không gian sinh hoạt hoặc bằng máy tính tại nơi làm việc; ưu tiên nền sáng, thông tin dễ quét và CTA dễ nhận biết.

Tham chiếu nội bộ: bản đăng nhập `design/login-mock-v2-fruit.png`, bảng màu `design/login-palette-v1.png` và hai minh họa WebP đang dùng trong ứng dụng. Không tự đổi toàn bộ font/nhận diện chỉ vì ảnh sinh ra có kiểu chữ khác.

Hướng A trong `design/landing-directions-v1.png` đã được duyệt. Giữ bố cục nền sáng, nội dung bên trái và minh họa trái cây/máy bên phải; dải xanh trình bày quy trình; phần hợp tác ở cuối. Hướng B chỉ lưu làm phương án đã tham khảo.

- A: nền sáng, nội dung và minh họa trái cây/máy đặt lệch hai phía; quy trình mua hàng trên một dải xanh; kết thúc bằng lời mời hợp tác. Hướng đề xuất vì nối tiếp nhận diện hiện tại.
- B: phần mở đầu xanh đậm, hình máy ở trung tâm; nhấn mạnh giải pháp và quản lý tập trung; form liên hệ ở cuối. Phù hợp khi cần nhấn mạnh sản phẩm cho đối tác.

Ảnh là thăm dò thiết kế bằng imagegen tích hợp, không phải đặc tả phần cứng hay bằng chứng tính năng đã hoạt động. Bỏ các tuyên bố, logo mới, chữ viết tay hoặc hình chụp minh họa ngoài phạm vi đã duyệt nếu không cần thiết.

## 4. Phạm vi

Một trang công khai responsive, bản kế hoạch chi tiết kèm thăm dò hình ảnh (hiểu từ câu trả lời “Có”). Trang đăng nhập vẫn là màn hình riêng. Không xây dashboard, bản đồ máy, thương mại điện tử hoặc chức năng backend trong tác vụ plan.

## 5. Cấu trúc đề xuất

1. Header: Fruit Vending, liên kết Giải pháp/Cách hoạt động/Hợp tác; Đăng nhập quản lý và CTA hợp tác.
2. Hero: thông điệp “Trái cây tươi. Gần bạn hơn.”, đoạn giới thiệu ngắn, minh họa trái cây và máy dạng concept; CTA Hợp tác đặt máy, liên kết Khám phá giải pháp.
3. Giải pháp: mô tả hệ thống gồm kiosk, thanh toán QR, điều khiển nhả hàng và quản lý tập trung. Phân biệt tính năng dự kiến với tính năng đã triển khai.
4. Quy trình: chọn trái cây → thanh toán QR → nhận sản phẩm. Desktop theo hàng ngang; mobile thành chuỗi dọc.
5. Hợp tác đặt máy: lời mời trao đổi về không gian dự kiến, nhu cầu và cách liên hệ; không tự hứa thời gian phản hồi hay điều kiện lắp đặt.
6. Footer: nhận diện, lối vào quản lý và thông tin liên hệ thực tế khi được cung cấp. Không thêm liên kết chết hoặc chính sách giả.

## 6. Tương tác và trạng thái

- Điều hướng nội trang bằng anchor; có focus rõ ràng, không che tiêu đề bởi header.
- Đăng nhập quản lý mở route đăng nhập riêng, đề xuất `/login`; trang công khai ở `/` khi triển khai routing.
- CTA hợp tác đến phần liên hệ. Kênh gửi chưa xác định; không tạo nút gửi giả thành công.
- Nếu chọn form: tên liên hệ, email hoặc số điện thoại, địa điểm dự kiến, ghi chú tùy chọn; label cố định; kiểm tra bắt buộc/định dạng, đang gửi, ngăn gửi lặp, gửi thành công thật, lỗi mạng/server và thử lại giữ dữ liệu.
- Nếu chưa có API nhận liên hệ: dùng email/số điện thoại được chủ project cung cấp. Không thu thập dữ liệu bằng form chưa có đích gửi.
- Desktop điều hướng đầy đủ, mobile menu thu gọn vẫn có lối Đăng nhập dễ thấy.
- Chuyển tiếp 150–250ms cho thao tác; chuyển động trang có giới hạn, nội dung hiển thị sẵn, tôn trọng reduced motion.

## 7. Nội dung và tài nguyên cần có

- Tên hệ thống Fruit Vending và nội dung giới thiệu theo README.
- Xác nhận trạng thái tính năng trước khi xuất bản: repository hiện mới có frontend đăng nhập, chưa có hệ thống vận hành end-to-end.
- Minh họa máy là concept cho đến khi có hình máy thật; dùng nhãn phù hợp khi cần.
- Không bịa số máy, doanh thu, khách hàng, chứng nhận, địa điểm hoặc phản hồi đối tác.
- Thông tin liên hệ thật và cách tiếp nhận yêu cầu hợp tác cần bổ sung trước khi triển khai phần gửi.

## 8. Responsive và khả năng tiếp cận

Kiểm tra 320/390px, tablet 768px, desktop 1440px. Mobile đưa thông điệp/CTA trước minh họa; hạn chế chiều cao ảnh để không đẩy hành động chính quá xa. Không cuộn ngang. Vùng chạm tối thiểu 44px, nội dung nhập 16px trở lên, hỗ trợ bàn phím, tương phản chữ tối thiểu 4.5:1, ảnh trang trí alt rỗng và ảnh mang thông tin có mô tả.

## 9. Kiểm tra khi triển khai

Build/lint, đường dẫn đăng nhập, điều hướng và menu mobile, bố cục ở các breakpoint, tải tài nguyên, không lỗi console; kiểm tra form với thành công/lỗi thật theo backend đã chốt. Tối ưu ảnh và ưu tiên ảnh hero, lazy-load ảnh phía dưới; kiểm tra giảm chuyển động.

## 10. Chưa chốt

- Hướng hình ảnh: đã chốt A, không còn chờ chọn mẫu.
- Kênh nhận hợp tác: email/số điện thoại thật hay API nhận form. Cần trước khi triển khai gửi liên hệ, không cản trở chốt thiết kế.

## Tài liệu fk khi triển khai

`reference/brand.md`, `reference/interaction-design.md`, `reference/responsive.md`, `reference/motion.md`, `reference/copy.md`, `reference/type.md` và `reference/space.md`.

## Thăm dò hình ảnh

Công cụ: imagegen tích hợp. Prompt tóm tắt: so sánh hai landing page tiếng Việt theo màu xanh lá hiện có; A nền sáng với trái cây nổi bật, B hero xanh và máy ở trung tâm; cả hai có Đăng nhập quản lý/Hợp tác đặt máy, quy trình mua hàng hoặc giới thiệu quản trị. Asset: `design/landing-directions-v1.png`.


