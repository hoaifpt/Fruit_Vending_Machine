# Fruit Vending Machine — Web

Ứng dụng frontend cho hệ thống máy bán trái cây, gồm trang giới thiệu công khai, đăng nhập admin/staff, khu quản trị, màn hình nhân viên và màn hình mua hàng tại kiosk.

**Trạng thái:** giao diện và các luồng tương tác đã có. Quản trị, nhân viên và kiosk hiện dùng dữ liệu mẫu trên trình duyệt; chưa kết nối backend, cổng thanh toán hoặc phần cứng máy.

## Công nghệ

- React 19, TypeScript 6, Vite 8.
- CSS responsive, minh họa trái cây WebP và hỗ trợ giảm chuyển động.
- Oxlint để kiểm tra mã nguồn; Node.js Test Runner để kiểm thử.

## Khởi chạy

Khuyến nghị Node.js 24 LTS và npm. Thực hiện từ thư mục gốc repository:

```powershell
cd apps/web
npm ci
npm run dev
```

Mở địa chỉ Vite in trong terminal, thường là `http://localhost:5173`. Nếu đang ở `apps/web`, bỏ qua lệnh `cd`.

## Các màn hình

| Đường dẫn | Nội dung |
| --- | --- |
| `/` | Giới thiệu hệ thống, đăng nhập quản lý và liên hệ hợp tác đặt máy |
| `/login` | Đăng nhập bằng email hoặc tên đăng nhập và mật khẩu |
| `/admin` | Tổng quan doanh thu, giao dịch và tình trạng vận hành |
| `/admin/machines` | Máy, vị trí, ngăn máy và thông tin vận hành |
| `/admin/products` | Sản phẩm và giá bán riêng theo máy |
| `/admin/inventory` | Tồn kho, sức chứa, lô hàng và hạn sử dụng |
| `/admin/transactions` | Giao dịch và lịch sử nhả hàng thất bại |
| `/admin/tasks` | Phân công refill và bảo trì |
| `/admin/staff` | Nhân viên và phạm vi máy được giao |
| `/staff?staff=s1` | Thử luồng công việc của nhân viên mẫu |
| `/buy` | Chọn sản phẩm và thanh toán tại màn hình kiosk |

Các đường dẫn admin/staff hiện mở trực tiếp để thử giao diện. Đây chưa phải các trang được bảo vệ bằng phiên đăng nhập và phân quyền server.

## Luồng mua hàng tại kiosk

1. Khách chọn sản phẩm trực tiếp trên màn hình máy hoặc nhập mã ngăn.
2. Màn hình hiển thị ngay chi tiết sản phẩm và vùng QR thanh toán. Mỗi đơn chỉ mua **1 hộp**.
3. Khách dùng điện thoại quét QR để thanh toán; điện thoại không dùng để chọn sản phẩm.
4. Khi nhận xác nhận thanh toán, kiosk chuyển sang trạng thái chuẩn bị và đang nhả hàng, sau đó hiển thị kết quả nhận hàng.
5. Nếu hết **90 giây** chờ thanh toán, kiosk tự quay về trang danh sách đầu tiên, bắt đầu từ ngăn 1.

### Cách hiển thị danh sách

- Giao diện nằm gọn trong một màn hình, không cuộn dọc.
- Mỗi trang hiển thị tối đa **2 sản phẩm**, sắp xếp theo số ngăn tăng dần. Dữ liệu mẫu hiện gồm ngăn 1–6.
- Tự chuyển sang trang tiếp theo sau **30 giây**; hết trang cuối sẽ quay lại trang đầu.
- Có thể vuốt trái/phải, dùng nút trước/sau hoặc phím mũi tên để chuyển trang.
- Không có bộ lọc loại sản phẩm. Sản phẩm hết hàng vẫn hiển thị nhưng không thể chọn.
- Tự chuyển trang tạm dừng khi mở hộp thoại, bảng mô phỏng hoặc rời danh sách để thanh toán.

### Thử thanh toán khi chưa có backend

Vùng QR hiện là **hình minh họa, không thể quét để chuyển tiền**. Mở **Thử tình huống** để mô phỏng đã thanh toán, lỗi tạo thanh toán, mất kết nối hoặc nhả hàng thất bại. Bộ đếm hết hạn chạy theo thời gian thực.

Luồng đã xác nhận thanh toán/đang nhả hàng không bị bộ đếm QR đưa về danh sách. Tải lại khi đang nhả hàng sẽ chuyển sang trạng thái chưa xác nhận nhận hàng, tránh tự động nhả lại.

Xem thêm [luồng mua hàng và hướng tích hợp](docs/purchase-flow.md).

## Chức năng quản trị và nhân viên

### Admin

- Xem doanh thu mặc định hôm nay, có lựa chọn tháng/năm và máy. Chỉ tính giao dịch **đã thanh toán và nhả hàng thành công**.
- Thêm, sửa và ngừng sử dụng máy/sản phẩm để giữ lịch sử; quản lý nhiều máy, nhiều vị trí và giá riêng theo máy.
- Quản lý ngăn, sức chứa và nhiều lô cùng sản phẩm với hạn sử dụng khác nhau.
- Cảnh báo khi còn tối đa **2 hộp** có thể bán; cảnh báo hạn dùng hôm nay/ngày mai.
- Giao refill kèm số lượng; giao bảo trì kèm hạn hoàn thành và mô tả lỗi.
- Xử lý sự cố nhả hàng theo trạng thái **Chờ xử lý → Đang xử lý → Đã hoàn tiền/Đã giải quyết**, kèm ghi chú. Việc đánh dấu hoàn tiền chỉ cập nhật dữ liệu mẫu.

### Staff

- Xem và xử lý công việc trong phạm vi máy được phân công.
- Nhập số lượng thực tế và hạn dùng theo từng lô khi refill; hoàn thành cập nhật ngay kho mẫu.
- Ghi nhận kết quả bảo trì và ảnh trước/sau.
- Giao diện không hiển thị doanh thu và không cho sửa giá bán.

Xem [chi tiết triển khai quản trị](docs/admin-implementation.md) để biết quy tắc dữ liệu và các phần cần bổ sung phía backend.

## Cấu hình môi trường

Từ `apps/web`, tạo file cấu hình local nếu chưa có:

```powershell
Copy-Item .env.example .env.local
```

| Biến | Mục đích |
| --- | --- |
| `VITE_AUTH_LOGIN_URL` | URL API đăng nhập |
| `VITE_PARTNERSHIP_EMAIL` | Email liên hệ hợp tác công khai |
| `VITE_PARTNERSHIP_PHONE` | Số điện thoại liên hệ hợp tác công khai |

Khởi động lại Vite sau khi thay đổi cấu hình. Các biến `VITE_*` được đưa vào mã phía trình duyệt; không đặt secret trong các biến này.

Khi chưa cấu hình API đăng nhập, ứng dụng báo chưa kết nối và không gửi mật khẩu. **Không có tài khoản đăng nhập demo hoặc đăng nhập giả thành công.** Hợp đồng API đăng nhập hiện là đề xuất; xem [hướng dẫn kết nối xác thực](docs/auth-integration.md).

Nếu chưa cấu hình email/số điện thoại, phần liên hệ trên landing page hiển thị thông tin đang cập nhật.

## Dữ liệu mẫu và lưu trữ

| Phần | Nơi lưu | Khóa |
| --- | --- | --- |
| Admin/staff | `localStorage` | `fruit-vending-admin-demo-v1` |
| Kiosk | `sessionStorage`, riêng từng tab | `fruit-vending-purchase-demo-v1` |

- Tải lại trang giữ dữ liệu đã lưu trong phạm vi lưu trữ tương ứng.
- Nút **Đặt lại mẫu** trong khu quản trị khôi phục dữ liệu mẫu sau xác nhận.
- Dữ liệu kiosk độc lập với dữ liệu admin/staff; giao dịch mua hàng mẫu chưa cập nhật sang dashboard.
- Lưu trữ trình duyệt không thay thế database hoặc cơ chế đồng bộ nhiều người dùng. Bộ chọn nhân viên mẫu không phải cơ chế phân quyền thật.

## Lệnh phát triển

Chạy các lệnh trong `apps/web`:

| Lệnh | Tác dụng |
| --- | --- |
| `npm run dev` | Khởi chạy máy chủ phát triển Vite |
| `npm run build` | Kiểm tra TypeScript và tạo bản build trong `dist/` |
| `npm run preview` | Xem bản build local sau khi build |
| `npm run lint` | Kiểm tra mã nguồn với Oxlint |
| `npm test` | Chạy kiểm thử đăng nhập, landing, quản trị và kiosk |

Bộ kiểm thử hiện có **44 trường hợp**, bao gồm quy tắc doanh thu, tồn kho, xác thực, thời hạn QR, khôi phục phiên và ngăn nhả hàng lặp. Các tương tác vuốt, bố cục responsive và tự chuyển trang cần kiểm tra thêm trên trình duyệt.

## Cấu trúc thư mục

```text
apps/web/
├── src/
│   ├── assets/             # Ảnh và minh họa
│   ├── components/         # Thành phần dùng chung
│   ├── features/
│   │   ├── admin/          # Quy tắc quản trị, dữ liệu và lưu trữ mẫu
│   │   ├── auth/           # Lớp kết nối API đăng nhập
│   │   ├── landing/        # Xử lý thông tin liên hệ
│   │   └── purchase/       # Trạng thái đơn và luồng kiosk
│   ├── pages/              # Các màn hình và CSS tương ứng
│   ├── App.tsx             # Component ứng dụng
│   ├── routing.ts          # Ánh xạ đường dẫn
│   ├── main.tsx            # Điểm khởi chạy React
│   └── index.css           # Kiểu toàn cục
├── tests/                  # Kiểm thử tự động
├── docs/                   # Thiết kế, nghiệp vụ và tích hợp
├── public/                 # Tài nguyên tĩnh
├── .env.example            # Mẫu biến môi trường
└── vite.config.ts          # Cấu hình Vite
```

## Build và triển khai

```powershell
npm run build
npm run preview
```

Triển khai nội dung `dist/` lên hosting tĩnh. Hosting cần rewrite các đường dẫn ứng dụng như `/buy`, `/login`, `/admin/*` và `/staff` về `index.html` để truy cập trực tiếp hoặc tải lại không gặp lỗi 404. `npm run preview` chỉ dùng kiểm tra bản build local.

Trước khi vận hành thật, cần kết nối phiên đăng nhập và phân quyền server, API quản trị, lưu ảnh, thanh toán, xác nhận nhả hàng và đồng bộ tồn kho. Backend phải đối chiếu trạng thái đơn, bao gồm thanh toán đến muộn sau khi màn hình QR đã hết hạn; thao tác mô phỏng trên frontend không phải bằng chứng thanh toán.

## Tài liệu liên quan

- [Thiết kế giao diện](DESIGN.md)
- [Kết nối đăng nhập](docs/auth-integration.md)
- [Landing page và liên hệ](docs/landing-page.md)
- [Triển khai dashboard admin/staff](docs/admin-implementation.md)
- [Luồng kiosk và thanh toán](docs/purchase-flow.md)
- [Ảnh giao diện và bản thiết kế](docs/design/)
