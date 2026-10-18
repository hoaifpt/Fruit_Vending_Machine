# Fruit Vending Machine — Web

Ứng dụng frontend cho hệ thống máy bán trái cây, gồm trang giới thiệu công khai, đăng nhập admin/staff, khu quản trị, màn hình nhân viên và màn hình mua hàng tại kiosk.

**Trạng thái:** khu quản trị ADMIN/STAFF (`/login`, `/admin/*`) đã tích hợp backend REST theo `api-contract/api.yaml`: đăng nhập JWT, phân quyền theo vai trò, người dùng, sản phẩm, máy, ngăn, khóa kiosk, lô hàng, tồn kho, đơn hàng, thanh toán và log webhook. Màn hình kiosk (`/buy`) đã nối API kiosk: danh mục, đơn một hộp, thanh toán VietQR và polling tới `PAID`. Nhả hàng qua ESP32 chưa làm (backend Milestone 3).

## Công nghệ

- React 19, TypeScript 6, Vite 8.
- CSS responsive, minh họa trái cây WebP và hỗ trợ giảm chuyển động.
- Oxlint để kiểm tra mã nguồn; Node.js Test Runner để kiểm thử.

## Khởi chạy

Khuyến nghị Node.js 24 LTS và npm. Cần backend chạy ở `http://localhost:8080` (xem [JWT authentication](../../docs/jwt-authentication.md)). Thực hiện từ thư mục gốc repository:

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
| `/login` | Đăng nhập bằng email và mật khẩu; quay lại URL đang xem sau khi đăng nhập |
| `/admin/machines`, `/admin/machines/:id` | Máy, cấu hình, ngăn chứa, tóm tắt tồn kho, khóa kiosk (ADMIN) |
| `/admin/products` | Sản phẩm, SKU, giá, trạng thái |
| `/admin/batches` | Lô hàng (tạo và xem) |
| `/admin/inventory`, `/admin/inventory/history` | Từng hộp hàng, nạp/gỡ hộp, lịch sử |
| `/admin/orders`, `/admin/orders/:id` | Đơn hàng (chỉ xem) |
| `/admin/payments`, `/admin/payments/:id` | Thanh toán và danh sách "Cần xử lý" (ADMIN, chỉ xem) |
| `/admin/webhook-logs`, `/admin/webhook-logs/:id` | Log webhook thanh toán (ADMIN, chỉ xem) |
| `/admin/users` | Tài khoản nhân viên (ADMIN) |
| `/buy` | Màn hình kiosk: chọn sản phẩm và thanh toán VietQR (cần `VITE_KIOSK_API_KEY`) |

Các đường dẫn `/admin/*` yêu cầu đăng nhập; chưa đăng nhập hoặc token hết hạn (`401`) sẽ chuyển tới `/login`. Menu và nút thao tác ẩn theo vai trò, nhưng backend mới là nơi kiểm tra quyền. Bảng quyền và quy ước chi tiết: [web quản trị tích hợp backend](docs/admin-implementation.md).

## Luồng mua hàng tại kiosk

1. Khởi động: `GET /kiosk/me` kiểm tra khóa kiosk; khóa thiếu hoặc bị thu hồi → màn hình "Máy chưa được cấu hình".
2. `GET /kiosk/catalog`: `acceptingOrders = false` → "Máy tạm ngừng phục vụ". Danh mục làm mới mỗi 45 giây khi rảnh, sau mỗi đơn kết thúc và sau lỗi `409`.
3. Khách chạm sản phẩm → `POST /kiosk/orders` với **chỉ** `{ productId }` (1 đơn = 1 hộp). Không tự gửi lại khi lỗi/timeout vì đơn có thể đã giữ hàng; giữ chỗ tự hết hạn ở backend.
4. Kiosk tự gọi `POST /kiosk/orders/{id}/payments`, vẽ QR từ chuỗi `qrCode` (VietQR) ngay trên máy và hiển thị số tiền do server trả về.
5. Polling `GET /kiosk/orders/{id}` mỗi 2,5 giây (lỗi mạng: lùi dần tới 10 giây, hiện "Đang kết nối lại"). Chỉ kết quả polling quyết định màn hình; kiosk không bao giờ tự đánh dấu đã thanh toán.
6. `PAID` → "Đã xác nhận thanh toán", tự về danh mục sau 12 giây. `CANCELLED` → "Đơn hàng đã hủy/hết hạn". QR `FAILED`/`EXPIRED` khi đơn còn hạn → nút "Tạo mã QR mới". `502` từ cổng thanh toán → nút "Thử lại".
7. Nút "Hủy và chọn lại" hoặc không chạm màn hình trong `VITE_KIOSK_PAYMENT_IDLE_SECONDS` (mặc định 120 giây) → `POST /kiosk/orders/{id}/cancel`. Nếu hủy trả `409` (khách vừa trả kịp), kiosk hiển thị màn hình đã thanh toán.

Bộ đếm dùng `min(currentPayment.expiresAt, order.expiresAt)` và hiệu chỉnh lệch đồng hồ bằng `timestamp` của phản hồi. Hết giờ vẫn tiếp tục polling vì backend mới là nơi quyết định hết hạn.

### Cách hiển thị danh sách

- Giao diện nằm gọn trong một màn hình, không cuộn dọc.
- Mỗi trang tối đa **2 sản phẩm**; tự chuyển trang sau **30 giây**; vuốt trái/phải, nút trước/sau hoặc phím mũi tên.
- Chỉ hiển thị sản phẩm backend cho là bán được ngay. `availableQuantity` chỉ để tham khảo ("Còn ít"), không giữ hàng.

### Thử với backend local (MOCK)

Đặt `PAYMENT_PROVIDER=MOCK` và `PAYMENT_MOCK_WEBHOOK_SECRET` ở backend. Mã `MOCK-QR|…` không thanh toán được bằng app ngân hàng; giả lập thanh toán bằng webhook MOCK đã ký hoặc `python scripts/payment_test_data.py mock-pay` (xem [payment webhook](../../docs/payment-webhook.md)). Chi tiết: [luồng kiosk và thanh toán](docs/purchase-flow.md).

## Chức năng quản trị và nhân viên

- **ADMIN:** toàn quyền quản lý người dùng, sản phẩm, máy, ngăn, khóa kiosk; xem thanh toán và log webhook.
- **STAFF:** chỉ xem sản phẩm, máy, ngăn; tạo/xem lô hàng; nạp/gỡ hộp và xem tồn kho; xem đơn hàng.
- Danh sách phân trang, sắp xếp, lọc phía server; bộ lọc nằm trong URL.
- Khóa API kiosk chỉ hiện một lần khi cấp; web không lưu lại.
- Dữ liệu thanh toán/đơn hàng chỉ đọc: không có thao tác hoàn tiền, đánh dấu đã thanh toán, hủy hay sửa đơn.

## Cấu hình môi trường

Từ `apps/web`, tạo file cấu hình local nếu chưa có:

```powershell
Copy-Item .env.example .env.local
```

| Biến | Mục đích |
| --- | --- |
| `VITE_API_BASE_URL` | Địa chỉ backend (không kèm `/api/v1`). Để trống để gọi cùng origin |
| `DEV_API_PROXY_TARGET` | Chỉ cho `npm run dev`: Vite proxy `/api` tới backend, mặc định `http://localhost:8080` |
| `VITE_KIOSK_API_KEY` | Khóa API của máy (ADMIN cấp ở Máy bán hàng → Khóa API kiosk). Chỉ đặt trong `.env.local` của máy kiosk |
| `VITE_KIOSK_PAYMENT_IDLE_SECONDS` | Số giây không chạm màn hình thanh toán trước khi tự hủy đơn (mặc định 120) |
| `VITE_PARTNERSHIP_EMAIL` | Email liên hệ hợp tác công khai |
| `VITE_PARTNERSHIP_PHONE` | Số điện thoại liên hệ hợp tác công khai |

Khởi động lại Vite sau khi thay đổi cấu hình. Các biến `VITE_*` được đưa vào mã phía trình duyệt; không đặt secret trong các biến này. Backend chưa bật CORS nên khi phát triển hãy để `VITE_API_BASE_URL` trống và dùng proxy.

Không có tài khoản demo: dùng tài khoản ADMIN do backend tạo (xem [Initial Admin Bootstrap](../../docs/initial-admin-bootstrap.md)). Chi tiết phiên, token và xử lý lỗi: [kết nối đăng nhập và API](docs/auth-integration.md). Nếu chưa cấu hình email/số điện thoại, landing page hiển thị thông tin đang cập nhật.

## Dữ liệu mẫu và lưu trữ

| Phần | Nơi lưu | Khóa |
| --- | --- | --- |
| Phiên quản trị | `sessionStorage` (mất khi đóng tab) | `fruit-vending-session-v1` |

- Khu quản trị không lưu dữ liệu nghiệp vụ trong trình duyệt; mọi dữ liệu lấy từ API.
- Token truy cập không có refresh token; hết hạn thì đăng nhập lại.
- Kiosk không lưu đơn hàng hay khóa API vào storage; khởi động lại giữa chừng thì giữ chỗ tự hết hạn ở backend.

## Lệnh phát triển

Chạy các lệnh trong `apps/web`:

| Lệnh | Tác dụng |
| --- | --- |
| `npm run dev` | Khởi chạy máy chủ phát triển Vite (proxy `/api`) |
| `npm run build` | Kiểm tra TypeScript và tạo bản build trong `dist/` |
| `npm run preview` | Xem bản build local sau khi build |
| `npm run lint` | Kiểm tra mã nguồn với Oxlint |
| `npm test` | Chạy kiểm thử API client, phiên, phân quyền, định dạng và kiosk |
| `npm run gen:api` | Sinh lại `src/api/schema.d.ts` từ `../../api-contract/api.yaml` |

Chạy `npm run gen:api` mỗi khi contract thay đổi và commit file kết quả. Các tương tác vuốt, bố cục responsive và tự chuyển trang của kiosk cần kiểm tra thêm trên trình duyệt.

## Cấu trúc thư mục

```text
apps/web/
├── src/
│   ├── api/                # client, phiên JWT, hàm theo endpoint, schema.d.ts (sinh từ contract)
│   ├── kiosk/              # API kiosk (X-Kiosk-Key) và quy tắc trạng thái đơn/QR
│   ├── lib/                # định dạng tiền/giờ, router History API
│   ├── admin/              # khung quản trị, ma trận quyền, thành phần dùng chung, pages/
│   ├── assets/             # Ảnh và minh họa
│   ├── components/         # Thành phần dùng chung
│   ├── features/
│   │   ├── auth/           # Đăng nhập
│   │   ├── landing/        # Xử lý thông tin liên hệ
│   ├── pages/              # Landing, đăng nhập, kiosk
│   ├── App.tsx
│   ├── routing.ts
│   ├── main.tsx
│   └── index.css
├── tests/                  # Kiểm thử tự động
├── docs/                   # Thiết kế, nghiệp vụ và tích hợp
├── public/                 # Tài nguyên tĩnh
├── .env.example            # Mẫu biến môi trường
└── vite.config.ts          # Cấu hình Vite và proxy dev
```

## Build và triển khai

```powershell
npm run build
npm run preview
```

Triển khai nội dung `dist/` lên hosting tĩnh. Hosting cần rewrite các đường dẫn ứng dụng như `/buy`, `/login`, `/admin/*` và `/staff` về `index.html` để truy cập trực tiếp hoặc tải lại không gặp lỗi 404. `npm run preview` chỉ dùng kiểm tra bản build local.

Hosting cũng cần phục vụ API cùng origin (reverse proxy) hoặc backend phải bật CORS. `VITE_KIOSK_API_KEY` được nhúng vào bundle JavaScript khi build, nên chỉ build bản kiosk trên chính máy kiosk và không phục vụ bản build đó công khai. Trước khi vận hành thật còn cần luồng nhả hàng (Serial/USB tới ESP32).

## Tài liệu liên quan

- [Thiết kế giao diện](DESIGN.md)
- [Kết nối đăng nhập và API](docs/auth-integration.md)
- [Landing page và liên hệ](docs/landing-page.md)
- [Web quản trị tích hợp backend](docs/admin-implementation.md)
- [Hợp đồng API](../../api-contract/api.yaml)
- [Luồng kiosk và thanh toán](docs/purchase-flow.md)
- [Ảnh giao diện và bản thiết kế](docs/design/)
