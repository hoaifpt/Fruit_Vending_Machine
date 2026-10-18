# Luồng mua một sản phẩm trên kiosk

Mở `/buy` trên màn hình cảm ứng của kiosk. Khách chọn sản phẩm trực tiếp tại máy; điện thoại chỉ dùng ứng dụng ngân hàng để quét QR thanh toán, không dùng để chọn hàng. Triển khai trong `apps/web` theo phạm vi hiện tại, dùng React/TypeScript và hệ màu Fruit Vending. Tham khảo ảnh người dùng: danh sách sản phẩm theo mã ngăn, bàn phím nhập mã, chi tiết sản phẩm, QR có thời hạn và màn hình chờ. Không sao chép thương hiệu TakeBox hoặc mã QR thanh toán trong ảnh.

## Các màn hình và cách thử

1. Danh sách: 6 ngăn mẫu, hai loại sản phẩm với quy cách/giá khác nhau. Ngăn 24 hết hàng và không thể chọn. Có lọc loại, nhập mã bằng bàn phím số trên màn hình và hướng dẫn trợ giúp.
2. Một lần chạm sản phẩm (hoặc nhập mã ngăn) tạo phiên thanh toán ngay. Chi tiết và QR nằm trên cùng màn hình: ảnh bên trái, tên/quy cách/mã ngăn/giá bên phải; QR căn giữa phía dưới. Không còn trang xác nhận hoặc nút “Tiếp tục thanh toán”.
3. Trong lúc tạo phiên, vùng QR hiển thị đang tải ngay trên trang chi tiết. Sau đó QR chờ thanh toán trong 90 giây. Bộ đếm dùng thời điểm hết hạn tuyệt đối, không bắt đầu lại khi tải lại trang.
4. Mở **Thử tình huống** phía trên rồi chọn **Mô phỏng đã thanh toán** chuyển qua đã nhận thanh toán → đang nhả hàng → nhận hàng thành công. Tồn ngăn mẫu giảm đúng một hộp sau khi nhả thành công.
5. Không thanh toán trong 90 giây → hết hạn. Có đường dẫn kiểm tra nếu đã bị trừ tiền; kết quả đối chiếu được chọn thủ công trong demo.
6. Hủy cần xác nhận và giữ mã đơn trên màn hình kết quả. Không có hủy hoặc tạo đơn mới trong khi đã thanh toán/đang nhả hàng.
7. **Thử tình huống** mở các điều khiển mất kết nối, lỗi tạo thanh toán, nhả hàng thất bại. Chọn lỗi nhả hàng trước khi mô phỏng thanh toán để xem trường hợp đã trả tiền nhưng không nhận sản phẩm.
8. Mất kết nối khi chờ thanh toán giữ đơn, chặn đơn mới và yêu cầu đối chiếu sau khi kết nối lại.
9. Lỗi nhả hàng hiển thị mã đơn, máy, ngăn và hướng dẫn hỗ trợ. Có sao chép mã đơn; không giả lập hoàn tiền thành công.

Ảnh sản phẩm tận dụng minh họa đã có, có nhãn rõ ràng. Giá, máy, địa điểm và tồn kho đều là dữ liệu mẫu độc lập với dashboard quản trị.

## Giới hạn khi BE chưa hoàn thành

- Vùng QR hiện là minh họa, **không phải mã thanh toán có thể quét**. Không có tài khoản ngân hàng, API thanh toán hoặc lệnh điều khiển máy.
- Phiên lưu trong `sessionStorage` với khóa `fruit-vending-purchase-demo-v1`, theo tab. Không phải nguồn dữ liệu tin cậy hay cơ chế đồng bộ giữa các máy.
- Tải lại lúc đã thanh toán/đang nhả chuyển sang màn hình chưa xác nhận nhận hàng; không tự gửi lại lệnh nhả. BE thật cần tra cứu trạng thái để xác định kết quả.
- Không có số điện thoại hỗ trợ giả; thông tin liên hệ thực tế chưa cấu hình.
- Không có giao dịch tài chính thực, sự kiện tồn kho hay sự cố nào được ghi sang dashboard admin.

## Khi nối BE

Thay bộ điều khiển mẫu bằng API danh mục theo máy/ngăn, tạo đơn có khóa idempotency, trả về giá và thời hạn phía server cùng payload/ảnh QR thật. Poll hoặc subscribe trạng thái đơn từ BE; không coi thao tác người dùng là bằng chứng thanh toán. Chỉ xác nhận nhận hàng khi có kết quả cảm biến từ hệ thống. Các trường hợp hết hạn, hủy, mất kết nối, thanh toán đến muộn phải đối chiếu với server trước khi quyết định bước tiếp theo. Lỗi nhả hàng cần tạo sự cố trong lịch sử quản trị theo hợp đồng API được thống nhất sau.

## Kiểm tra

14 kiểm thử luồng kiosk cho chọn hàng/hết hàng, đơn một sản phẩm, khóa giá, hết hạn, hủy, đối chiếu thanh toán đến muộn, mất kết nối, lưu/khôi phục phiên và chặn nhả hàng lặp. Chạy cùng bộ kiểm thử hiện tại bằng `npm test` (tổng 43). Build bằng `npm run build`, lint bằng `npm run lint`.

Bổ sung kiểm thử: một lần chạm chuyển thẳng sang tạo QR; phiên cũ dừng ở trang xác nhận được đưa về danh sách để chọn lại an toàn. Đã kiểm tra trực tiếp bố cục dọc 900 × 1400 và luồng chọn → thanh toán → nhận hàng.

Giao diện kiosk chiếm đúng chiều cao viewport (100dvh), không cuộn dọc. Danh sách phân trang tối đa 2 sản phẩm; vuốt trái/phải, nút trước/sau hoặc phím mũi tên để chuyển trang. Đổi bộ lọc đưa về trang đầu. Chi tiết + QR và các màn hình kết quả dùng phần chiều cao còn lại. Đã kiểm tra bố cục 320 × 640, 390 × 844, 1366 × 768 và 900 × 1400.

Danh mục tự chuyển sang trang kế tiếp mỗi 30 giây và lặp lại trang đầu sau trang cuối. Sắp xếp theo số ngăn tăng dần, dữ liệu mẫu từ ngăn 1 đến 6. Bộ đếm bắt đầu lại khi đổi trang hoặc bộ lọc; tạm dừng khi mở hộp thoại, bảng mô phỏng hoặc rời danh mục để thanh toán. Mã ngăn hỗ trợ 1–3 chữ số. Phiên mẫu cũ được chuyển mã ngăn mà vẫn giữ đơn và tồn kho. Bộ kiểm thử hiện có 44 ca.

Khi QR hết 90 giây chờ thanh toán, giao diện tự đóng hộp thoại đang mở và quay về danh mục Tất cả, trang đầu (ngăn 1). Bộ tự chuyển trang 30 giây bắt đầu lại. Phiên QR đã hết hạn khi tải lại cũng quay về danh mục. Luồng đã xác nhận thanh toán/đang nhả hàng không bị bộ đếm QR đưa về danh mục.
