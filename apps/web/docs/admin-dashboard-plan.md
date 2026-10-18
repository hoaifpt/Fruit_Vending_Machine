# Kế hoạch khu quản trị admin

Trạng thái: người dùng đã duyệt hướng A — Tổng quan doanh thu. Đã triển khai frontend dữ liệu mẫu theo /fk build; xem `admin-implementation.md` để biết chức năng, kiểm thử và phần backend cần tích hợp.

## 1. Mục tiêu

Xây dựng toàn bộ khu quản trị gồm trang tổng quan, máy, sản phẩm, tồn kho, giao dịch, công việc và nhân viên. Trang đầu ưu tiên doanh thu/giao dịch; admin vẫn thấy những sự cố cần xử lý mà không bị quá tải cảnh báo.

Admin sử dụng trên máy tính khi theo dõi và phân công, hoặc điện thoại khi kiểm tra nhanh. Dùng nền sáng, xanh lá trầm, chữ sans-serif dễ đọc, bảng dữ liệu và thao tác nhất quán; không dùng tiêu đề serif lớn hoặc minh họa trái cây chiếm chỗ như landing page.

## 2. Yêu cầu người dùng đã xác nhận

- Mặc định doanh thu hôm nay; có xem theo tháng và theo năm.
- Chỉ tính giao dịch đã thanh toán **và** nhả hàng thành công.
- Máy và địa điểm không có giới hạn số lượng cố định do sản phẩm áp đặt.
- Admin thêm, xem, sửa, xóa/cập nhật máy và sản phẩm; quản lý thông tin sản phẩm và giá riêng trên từng máy.
- Quản lý ngăn máy, sức chứa tối đa và nhiều lô cùng sản phẩm trong một ngăn; mỗi lô có hạn sử dụng.
- Admin phân công staff refill theo máy, sản phẩm, số lượng dự kiến; staff nhập số lượng thực tế và hạn sử dụng của hàng refill.
- Tồn kho cập nhật ngay khi staff hoàn thành refill, không chờ admin duyệt.
- Phân công bảo trì có hạn hoàn thành, mô tả lỗi, ảnh trước/sau.
- Staff chỉ xử lý máy/công việc được phân công; không xem doanh thu và không sửa giá.
- Có tab lịch sử nhả hàng thất bại gồm số máy, vị trí, mã đơn và thông tin liên quan.
- Xử lý thất bại theo Chờ xử lý → Đang xử lý → Đã hoàn tiền hoặc Đã giải quyết; có ghi chú.
- Cảnh báo tồn thấp khi còn 2 hộp; cảnh báo sắp hết hạn trước 1 ngày; admin không chỉnh ngưỡng.
- Được dùng dữ liệu mẫu, phải ghi rõ khi chưa có backend.

## 3. Hướng hình ảnh và bố cục

Register: product. Chiến lược màu restrained, điểm nhấn xanh lá cho lựa chọn và hành động, vàng/đỏ cho cảnh báo kèm chữ. Tham chiếu nội bộ: DESIGN.md, trang đăng nhập đã duyệt và các token CSS hiện có; dashboard dùng sans-serif như login, không kế thừa kiểu serif của landing.

Bản so sánh: `design/admin-dashboard-directions-v1.png`.

- **A — Tổng quan doanh thu (đề xuất):** sidebar trái; thanh lọc trên; dải số liệu gọn; biểu đồ doanh thu lớn cạnh danh sách cần xử lý; bảng giao dịch gần đây phía dưới.
- **B — Giao dịch làm trung tâm:** biểu đồ thu gọn; bảng giao dịch chiếm phần lớn diện tích; bảng chi tiết bên phải để xử lý từng đơn. Hợp với admin chủ yếu tra cứu đơn hơn là xem tổng quan.

Đã chốt hướng A cho trang tổng quan: doanh thu và biểu đồ làm trọng tâm, danh sách cần xử lý bên phải và bảng giao dịch gần đây bên dưới. Hướng B chỉ giữ để tham khảo; màn hình Giao dịch vẫn có bảng và phần chi tiết theo nghiệp vụ đã ghi nhận.

Ảnh thăm dò do imagegen tích hợp tạo, mọi số liệu trong đó đều là minh họa. Dataset triển khai phải nhất quán: tổng biểu đồ bằng tổng doanh thu tương ứng; số đếm lấy từ cùng tập dữ liệu, không sao chép các con số rời rạc từ ảnh.

## 4. Sơ đồ màn hình

| Mục | Nội dung chính | Thao tác admin |
| --- | --- | --- |
| Tổng quan | Doanh thu, đơn thành công, biểu đồ, giao dịch gần đây, việc cần xử lý | Lọc kỳ/máy, mở giao dịch và công việc liên quan |
| Máy | Danh sách, mã máy, vị trí, trạng thái, lần cập nhật gần nhất | Thêm, sửa, xóa/ngừng sử dụng, mở chi tiết, giao refill/bảo trì |
| Sản phẩm | Danh mục chung, thông tin, ảnh, đơn vị hộp | Thêm/sửa/xóa, gán sản phẩm và giá cho từng máy |
| Tồn kho | Máy → ngăn → lô, số lượng, sức chứa, hạn dùng | Lọc tồn thấp/hạn gần/hết hạn, xem lô, tạo phân công refill |
| Giao dịch | Tất cả giao dịch và tab Nhả hàng thất bại | Tìm mã đơn, lọc kỳ/máy/trạng thái, cập nhật xử lý và ghi chú |
| Công việc | Refill và bảo trì, người được giao, máy, trạng thái, hạn | Tạo, phân công, xem thực hiện, đổi người/hủy việc chưa hoàn thành |
| Nhân viên | Staff, thông tin tài khoản, máy/công việc được giao | Thêm/sửa, khóa/ngừng hoạt động, phân công |

Route đề xuất: `/admin`, `/admin/machines`, `/admin/machines/:id`, `/admin/products`, `/admin/inventory`, `/admin/transactions`, `/admin/tasks`, `/admin/staff`. Sidebar theo các mục trên. Route và tên trường là thiết kế frontend đề xuất, chưa phải hợp đồng backend đã tồn tại.

## 5. Trang tổng quan và doanh thu

- Bộ lọc Hôm nay / Tháng / Năm; Tháng cho chọn tháng+năm, Năm cho chọn năm. Mặc định tất cả máy, có tìm chọn máy và lọc địa điểm.
- Hôm nay: biểu đồ theo giờ; Tháng: theo ngày; Năm: theo tháng.
- Đề xuất dùng múi giờ Việt Nam, ngày lịch, để các trang không tính lệch kỳ; cần backend trả rõ timezone và thời điểm ghi nhận.
- Chỉ cộng số tiền đã thanh toán của giao dịch có kết quả nhả thành công. Đề xuất ghi nhận theo thời điểm hoàn tất nhả hàng, giữ số tiền chốt trên đơn; sửa giá hiện tại không đổi lịch sử.
- Dải số liệu: doanh thu hợp lệ, số đơn thành công, số lần nhả thất bại. Đơn thất bại được hiển thị riêng, không cộng vào doanh thu.
- Trạng thái Chờ xử lý/Đang xử lý/Đã hoàn tiền/Đã giải quyết chỉ mô tả xử lý sự cố. Đánh dấu Đã giải quyết không tự biến đơn nhả thất bại thành đơn thành công.
- Bảng giao dịch gần đây liên kết đến chi tiết cùng mã đơn; đổi bộ lọc cập nhật cả số liệu và biểu đồ.
- Doanh thu bằng 0 khác chưa có dữ liệu hoặc lỗi tải. Không tự thay lỗi bằng 0. Không thêm tỷ lệ tăng trưởng khi chưa có dữ liệu kỳ so sánh.

## 6. Máy, ngăn, sản phẩm và giá

Danh sách máy tìm theo mã/tên/vị trí, lọc trạng thái và địa điểm, có phân trang. Không tải toàn bộ máy hoặc tạo dropdown chứa mọi máy vào một lần. Không đưa giới hạn số máy vào UI; khả năng mở rộng phụ thuộc truy vấn/phân trang/backend.

Chi tiết máy gồm Thông tin / Ngăn & tồn kho / Giá bán / Công việc / Giao dịch. Các tab chứa doanh thu/giao dịch chỉ dành cho admin. Trạng thái online/offline dựa trên dữ liệu kết nối cùng thời điểm cập nhật; không cho sửa bằng tay để giả máy online.

Tách sản phẩm chung khỏi giá tại máy: Product chứa tên/mô tả/ảnh; MachineProduct chứa productId, machineId, giá bán VND và trạng thái bán. Thay giá một máy không ảnh hưởng máy khác. Nếu cùng sản phẩm có nhiều ngăn trên một máy, dùng cùng giá tại máy đó theo yêu cầu hiện có.

Mỗi ngăn có mã, sản phẩm, sức chứa (hộp) và các lô. Cùng ngăn chỉ chứa một loại sản phẩm tại một thời điểm, có thể nhiều lô/hạn dùng. Đề xuất chặn đổi loại sản phẩm khi ngăn còn hàng; hỗ trợ xử lý hết hàng cũ trước để không trộn loại.

Đề xuất thao tác Xóa ngừng sử dụng/ẩn bản ghi đã có lịch sử giao dịch hoặc công việc, giữ mã và dữ liệu tham chiếu; bản ghi chưa liên quan có thể xóa sau xác nhận. Hộp xác nhận ghi rõ máy/sản phẩm và ảnh hưởng. Không xóa dây chuyền lịch sử doanh thu hoặc truy vết refill.

## 7. Tồn kho theo lô và cảnh báo

Bảng tồn kho: máy/vị trí, ngăn, sản phẩm, tổng số lượng vật lý, sức chứa, hạn gần nhất và cảnh báo. Mở chi tiết để xem từng lô với số lượng, ngày nhập, hạn dùng và công việc đã bổ sung lô.

- Cảnh báo tồn thấp: số hộp còn lại ≤ 2; bằng 0 hiển thị Hết hàng. Đề xuất áp dụng theo ngăn, không cộng lẫn các máy/ngăn để bỏ sót nơi cần refill.
- Sắp hết hạn: trước hạn 1 ngày, kiểm tra từng lô. Lô đã hết hạn có nhãn Hết hạn riêng, không nằm chung nhóm Sắp hết hạn.
- Ngưỡng cố định; không có trang cài đặt hoặc trường cho admin sửa ngưỡng.
- Đề xuất hiển thị cả số lượng vật lý và số lượng còn hạn; hàng hết hạn không được ngầm coi là hàng còn bán được. Khi đánh giá thiếu hàng, ưu tiên số lượng còn bán được; sức chứa vẫn tính mọi hàng đang nằm trong ngăn.
- Hạn dùng nhập dạng ngày theo địa phương; quy ước giờ hết hạn cần thống nhất backend trước khi vận hành thật. UI không tự bịa độ chính xác theo giờ nếu dữ liệu chỉ có ngày.
- Lô hết hạn không tự bị xóa khỏi tồn kho; phải có nghiệp vụ ghi nhận lấy hàng ra để số lượng vật lý khớp thực tế.

## 8. Phân công và hoàn thành refill

Admin chọn máy, staff, ngăn/sản phẩm và số lượng dự kiến. Màn hình hiển thị số hiện có, sức chứa, số chỗ trống và cảnh báo; không giao số lượng vượt sức chứa được biết tại thời điểm lập.

Luồng trạng thái đề xuất: Đã giao → Đang thực hiện → Hoàn thành; có Hủy với lý do cho việc chưa hoàn thành. Staff chỉ thấy việc của mình và thông tin máy cần để thực hiện.

Staff nhập số lượng thực tế đã thêm cho từng ngăn. Mỗi lần bổ sung gồm một hoặc nhiều dòng lô: số hộp + hạn sử dụng bắt buộc. Tổng các dòng lô bằng số refill thực tế. Nếu thiếu so với phân công, đề xuất yêu cầu ghi chú; không tự lấy số dự kiến làm số thực tế.

Khi staff xác nhận hoàn thành: backend kiểm tra quyền, số lượng nguyên không âm, hạn dùng, sức chứa mới nhất; ghi các lô, cập nhật tồn kho và hoàn tất việc trong một giao dịch nguyên tử. Không chờ admin duyệt. Gửi lặp/retry không được cộng hàng lần hai; cần idempotency và kiểm tra phiên bản tồn kho. Nếu máy/ngăn đã thay đổi, báo xung đột, giữ dữ liệu staff vừa nhập và yêu cầu kiểm tra lại.

Hàng expired không hợp lệ để refill; số thực tế bằng 0 phải có lý do nếu hoàn thành việc không bổ sung được. Không cho hoàn thành ở chế độ offline rồi tuyên bố đã cập nhật kho thật.

## 9. Bảo trì

Admin chọn máy, staff, mô tả lỗi và hạn hoàn thành. Danh sách làm rõ việc quá hạn bằng chữ cùng màu. Chi tiết có lịch sử cập nhật, ghi chú, ảnh trước và sau.

Staff cập nhật tiến độ, ảnh trước, mô tả công việc đã thực hiện, ảnh sau và kết quả. Đề xuất các trường này bắt buộc khi hoàn thành; tình huống không xử lý được có trạng thái Cần hỗ trợ và ghi chú, không ép chọn Hoàn thành.

Ảnh có preview, xóa ảnh chưa gửi, trạng thái tải lên, lỗi/thử lại; giữ form khi lỗi. File hợp lệ, kích thước và quyền tải phải được kiểm tra ở backend; giới hạn cụ thể thống nhất với storage. Không thay ảnh thật bằng ảnh demo mà không ghi nhãn.

## 10. Giao dịch nhả hàng thất bại

Tab riêng trong Giao dịch. Lọc theo máy/vị trí, thời gian và trạng thái xử lý; tìm mã đơn. Bảng gồm mã đơn, mã máy, vị trí, sản phẩm/số lượng, số tiền đã thanh toán, thời điểm, mã lỗi nếu có, trạng thái xử lý.

Chi tiết lưu ảnh chụp thông tin máy/vị trí/sản phẩm tại thời điểm giao dịch nếu cần, không mất ngữ cảnh khi admin đổi tên hay di chuyển máy.

Luồng: Chờ xử lý → Đang xử lý → Đã hoàn tiền hoặc Đã giải quyết. Mỗi cập nhật có người thực hiện, thời điểm, trạng thái cũ/mới và ghi chú; đề xuất bắt buộc ghi chú khi kết thúc.

**Đánh dấu đã hoàn tiền là ghi nhận trạng thái**, không phải lệnh chuyển tiền qua cổng thanh toán. Tích hợp hoàn tiền thật cần backend/payment API riêng và không thuộc UI mô phỏng. Không tự hoàn tiền hoặc sửa số tiền trong lịch sử. Trường tham chiếu hoàn tiền có thể bổ sung khi backend hỗ trợ.

## 11. Nhân viên và phân quyền

Admin xem/thêm/sửa/ngừng hoạt động staff, xem công việc và phân công. Không có chức năng xem mật khẩu nhân viên. Cách cấp tài khoản và reset mật khẩu sẽ theo API xác thực khi được thống nhất.

Staff chỉ nhận dữ liệu máy/công việc được phân công và tồn kho cần xử lý. Không thấy doanh thu, bảng giao dịch tài chính, giá vốn/giá bán hoặc thao tác đổi giá. Không chỉ ẩn menu: backend phải kiểm tra role và assignment theo từng tài nguyên; response cho staff không chứa dữ liệu tài chính không được phép.

UI có route cho admin, kiểm tra phiên và màn hình Không có quyền. Cần khôi phục phiên, xử lý hết phiên và đăng xuất khi kết nối API. Trong chế độ mẫu, có nhãn rõ ràng và không xem lựa chọn role demo là xác thực thật.

Phạm vi thiết kế này bao phủ toàn bộ admin cùng luồng staff cần để hoàn thành phân công; khu dashboard riêng đầy đủ cho staff không tự mở rộng trong tác vụ này.

## 12. Trạng thái và tương tác dùng chung

Mọi danh sách có tải/skeleton, rỗng lần đầu, không có kết quả lọc, lỗi/thử lại, phân trang và đang làm mới. Form có nhãn, validation, lưu/đang lưu/thành công/lỗi, cảnh báo bỏ thay đổi chưa lưu khi cần. Chi tiết có không tìm thấy, không có quyền và dữ liệu đã đổi.

Sidebar desktop; điện thoại dùng menu đóng/mở, vẫn giữ tiêu đề và tác vụ chính. Lọc chuyển thành panel phù hợp mobile. Bảng rút gọn các cột thiết yếu, mở trang chi tiết cho phần còn lại; không thu nhỏ toàn bộ bảng xuống chữ khó đọc. Ngăn/lô dùng danh sách mở rộng.

Có nhãn trạng thái bằng chữ, focus hiển thị, điều khiển bàn phím, bảng với tiêu đề cột, biểu đồ có phần tóm tắt/bảng số liệu tương đương, vùng chạm tối thiểu 44px. Tôn trọng reduced motion; chuyển tiếp 150–250ms, không animation trang trí cản trở công việc.

## 13. Dữ liệu mẫu và chuẩn bị API

Tạo một dataset chung liên kết machine/product/slot/lot/task/transaction/staff theo ID. Tiền lưu dạng số nguyên VND; thời gian có timezone. Sinh tổng doanh thu/cảnh báo từ dataset, không hardcode từng widget độc lập.

Nhãn Dữ liệu mẫu luôn nhìn thấy. Chế độ mẫu có thể thử CRUD/phân công/hoàn thành và reset dataset, tách khỏi chế độ API thật. Không gửi email, điều khiển máy, chuyển tiền hay tuyên bố cập nhật kho thật trong demo. Không trộn nguồn demo và API thật trên một màn hình.

Các API cần thống nhất sau: session/login/logout; machines/slots; products/machine-prices; inventory/lots/alerts; transactions/dispense-incidents/history; staff/assignments; refill-completion; maintenance/uploads. Contract hiện còn trống: đây là đề xuất tích hợp, không phải API đã tồn tại.

## 14. Trình tự triển khai đề xuất

1. Khung admin, routing, dataset có liên kết, tổng quan hôm nay/tháng/năm và giao dịch/nhả thất bại.
2. CRUD máy và sản phẩm, giá theo máy, ngăn/sức chứa, kho theo lô và cảnh báo cố định.
3. Staff, phân công refill, nhập số thực tế/hạn dùng, cập nhật tức thời trong chế độ mẫu; bảo trì và ảnh trước/sau.
4. Kiểm tra chéo luồng, responsive, khả năng tiếp cận và adapter API; giữ toàn bộ phạm vi đã yêu cầu, không xem một trang tổng quan là hoàn thành cả khu quản trị.

## 15. Tiêu chí nghiệm thu khi build

- Hôm nay là mặc định; đổi tháng/năm và máy cập nhật đúng mọi số liệu.
- Đã thanh toán nhưng nhả thất bại không tăng doanh thu; đổi trạng thái xử lý sự cố không biến thành doanh thu.
- Sửa giá máy A không sửa máy B hoặc lịch sử đơn.
- Một ngăn nhiều lô/hạn vẫn tính tổng đúng; tồn 2/1/0 hộp đều cảnh báo phù hợp; hết hạn khác sắp hết hạn; không có chỉnh ngưỡng.
- Hoàn thành refill bằng số thực tế cập nhật ngay một lần; thiếu hạn dùng/vượt sức chứa bị chặn.
- Bảo trì có deadline, mô tả lỗi, ảnh trước/sau và lịch sử; lỗi upload không làm mất form.
- Staff không nhận dữ liệu doanh thu/giá và không truy cập máy ngoài phân công khi có backend thật.
- Xóa/ngừng sử dụng không mất lịch sử; hành động sai quyền/xung đột/lỗi mạng có phản hồi rõ.
- Kiểm tra 320/390/768/1440px, bàn phím, reduced motion, build/lint và kiểm thử nghiệp vụ.

## 16. Kết quả duyệt

Người dùng đã chọn A. Bước /fk plan hoàn tất. Các quy ước kỹ thuật được ghi rõ là đề xuất để chốt cùng backend lúc tích hợp; không cần hỏi lại những nghiệp vụ người dùng đã xác nhận.

Tài liệu fk khi build: product.md, interaction-design.md, responsive.md, motion.md, space.md, type.md, copy.md. Bản ảnh là thăm dò bố cục; code, dữ liệu và quyền truy cập phải được triển khai riêng.


