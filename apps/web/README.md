# Web quản lý Fruit Vending Machine

Frontend quản trị sử dụng React, TypeScript và Vite. Đã có landing page, đăng nhập, dashboard admin và luồng công việc staff với dữ liệu mẫu; chưa kết nối backend.

## Yêu cầu

- Node.js 22.12+ hoặc Node.js 24 LTS (đã kiểm tra với 24.14.0).
- npm.

## Chạy local

Từ thư mục gốc repository:

```powershell
cd apps/web
npm install
npm run dev
```

Mở địa chỉ Vite hiển thị trong terminal (mặc định http://localhost:5173).

## Lệnh hỗ trợ

- `npm run build`: kiểm tra TypeScript và tạo bản build trong `dist/`.
- `npm run lint`: kiểm tra mã nguồn với Oxlint.
- `npm run preview`: xem bản build local sau khi build thành công.

## Cấu trúc

- `src/main.tsx`: điểm khởi chạy React.
- `src/App.tsx`: component gốc.
- `src/App.css`: giao diện đăng nhập.
- `src/index.css`: CSS toàn cục.
- `public/`: tài nguyên tĩnh.
- `vite.config.ts`: cấu hình Vite.

Khi triển khai API, tham chiếu hợp đồng tại `../../api-contract/api.yaml` (hiện còn trống). Không đưa secret vào frontend; các biến `VITE_*` sẽ được đưa vào ứng dụng phía trình duyệt.

## Đăng nhập

Đã triển khai màn hình đăng nhập responsive cho admin/staff: email hoặc tên đăng nhập + mật khẩu, hiện/ẩn mật khẩu, validation, loading và lỗi. Có minh họa trái cây tối ưu WebP và hỗ trợ giảm chuyển động.

API chưa có trong repository. Xem `docs/auth-integration.md` và `.env.example` để kết nối khi backend sẵn sàng. Mặc định không có tài khoản đăng nhập thử và không giả lập thành công.

`npm test` chạy kiểm thử lớp kết nối. Thiết kế và bản mẫu nằm trong `DESIGN.md` và `docs/design/`.


## Landing page công khai

Trang `/` giới thiệu Fruit Vending theo hướng A, có minh họa trái cây và lối vào `/login`. Cấu hình liên hệ hợp tác bằng `VITE_PARTNERSHIP_EMAIL`/`VITE_PARTNERSHIP_PHONE` trong `.env.local`; xem `docs/landing-page.md`. Hiện chưa có thông tin liên hệ thật nên mục liên hệ hiển thị đang cập nhật.

## Dashboard quản trị (dữ liệu mẫu)

Mở `/admin` để thử toàn bộ khu quản trị và `/staff?staff=s1` để thử luồng nhân viên. Có doanh thu ngày/tháng/năm, máy/ngăn, sản phẩm/giá theo máy, tồn kho nhiều lô, sự cố nhả hàng, phân công refill/bảo trì và hồ sơ staff. Thay đổi được lưu trên trình duyệt; nút Đặt lại mẫu khôi phục dữ liệu ban đầu sau xác nhận.

Bản này chưa kết nối backend, chưa có phân quyền server và không thực hiện thanh toán/hoàn tiền thật. Xem `docs/admin-implementation.md` để tích hợp. `npm test` chạy 29 kiểm thử gồm các quy tắc quản trị.
