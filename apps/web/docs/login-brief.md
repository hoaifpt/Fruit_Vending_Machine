# Đăng nhập — phạm vi đã xác nhận

Trạng thái: người dùng đã xác nhận định danh tài khoản, phạm vi và bố cục; đang chọn hướng hình ảnh.

## Mục tiêu đã xác nhận

Admin và staff đăng nhập Web quản lý. Giao diện hiện đại, tối giản, đủ thông tin, có animation và chuyển tiếp ổn định; hỗ trợ điện thoại và máy tính.

## Phạm vi đã xác nhận

- Một màn hình đăng nhập dùng chung. Vai trò lấy từ kết quả xác thực của backend, không phải quyền do người dùng tự chọn.
- Một trường “Email hoặc tên đăng nhập” nhận cả hai loại định danh, cùng một trường mật khẩu. Không bắt buộc định dạng email khi người dùng nhập tên đăng nhập.
- Hiện/ẩn mật khẩu, kiểm tra trường bắt buộc, phản hồi lỗi tại trường, trạng thái đang gửi và ngăn gửi lặp.
- Máy tính: bố cục lệch hai phần, nhận diện ngắn gọn bên trái và form bên phải; không dùng một thẻ đăng nhập nổi giữa nền gradient.
- Điện thoại: một cột, nhận diện thu gọn, form được ưu tiên; bàn phím không che nút thao tác.
- Chuyển tiếp ngắn cho focus và phản hồi trạng thái; giảm hoặc tắt chuyển động theo thiết lập thiết bị.
- Không thêm đăng ký công khai, đăng nhập mạng xã hội hoặc quên mật khẩu khi chưa xác định luồng hỗ trợ.

## Tình trạng tích hợp

Backend và hợp đồng API hiện chưa có triển khai đăng nhập. Cần cung cấp API có sẵn hoặc thống nhất làm frontend với lớp kết nối chờ backend. Không trình bày đăng nhập mô phỏng như xác thực thật.

## Tiếp theo

Chốt hướng màu và hình ảnh, sau đó duyệt bảng màu và bản mẫu theo quy trình fk trước khi triển khai.


## Hướng hình ảnh đã xác nhận

- Nền sáng, chữ đậm, xanh lá trầm làm điểm nhấn theo màu hiện có.
- Phần nhận diện dùng chữ và hình khối tối giản, không dùng hình minh họa máy bán hàng.
- Bảng màu và mẫu chữ được tạo bằng công cụ imagegen tích hợp, lưu tại `design/login-palette-v1.png`. Đây là bản xem trước đang chờ duyệt, chưa phải màn hình đăng nhập.
- Prompt tóm tắt: bảng màu nền #F5F8F5, bề mặt #FFFFFF, chữ #19392B, nhấn #387D52, chữ phụ #51665A; một họ sans-serif dễ đọc, chữ tiếng Việt và hình khối phẳng bất đối xứng.

## Bảng màu được duyệt và bản mẫu

Người dùng đã duyệt bảng màu. Bản mẫu desktop/mobile tại `design/login-mock-v1.png` đang chờ duyệt.

Bản mẫu tạo bằng imagegen tích hợp. Prompt: màn hình đăng nhập tiếng Việt cho admin/staff, cùng bảng màu đã duyệt; desktop chia 45/55 với nhận diện chữ và hình khối bên trái, form bên phải; mobile một cột ưu tiên form; định danh email hoặc tên đăng nhập, mật khẩu, nút hiện/ẩn và nút đăng nhập. Không đăng ký, đăng nhập mạng xã hội hoặc chọn vai trò.

Khi triển khai: toàn bộ chữ, trường nhập, nút và hình khối là HTML/CSS/SVG, không dùng ảnh mẫu làm giao diện. Giữ phân cấp và bố cục bản mẫu, nhưng dùng màu phẳng và placeholder đủ tương phản; không sao chép bóng hoặc chuyển sắc do ảnh sinh ra.

## Điều chỉnh theo yêu cầu mới: minh họa trái cây

Người dùng yêu cầu thêm minh họa trái cây để giao diện sinh động, tươi mới; yêu cầu này thay thế lựa chọn chỉ dùng hình khối trước đó. Bảng màu UI và bố cục vẫn giữ nguyên.

Bản mẫu mới: `design/login-mock-v2-fruit.png`, chờ duyệt. Tạo bằng imagegen tích hợp, chỉnh từ bản v1. Prompt: thay hình khối desktop bằng minh họa đu đủ, dưa hấu, cam, kiwi và lá; mobile thêm cụm cam nhỏ cạnh nhận diện, giữ nguyên form và nội dung. Khi triển khai cần asset minh họa riêng, không dùng ảnh toàn bộ giao diện.

## Triển khai sau khi duyệt

Người dùng đã duyệt bản v2 có trái cây. Đã triển khai form và lớp kết nối API, responsive, reduced motion và trạng thái lỗi. Minh họa được tạo riêng từ mẫu; do công cụ không tạo alpha hợp lệ, asset nền trắng dùng CSS multiply trên panel xanh. Tăng tương phản placeholder/viền input so với ảnh mẫu. Chi tiết contract đề xuất tại `auth-integration.md`.
