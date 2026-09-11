# Kết nối đăng nhập

Hiện frontend đã có giao diện và lớp gọi API; backend của repository chưa triển khai xác thực. Khi chưa cấu hình endpoint, nút Đăng nhập báo chưa kết nối và không gửi mật khẩu đi đâu. Không có tài khoản demo hoặc xác thực giả.

## Cấu hình dự kiến

Sao chép `.env.example` thành `.env.local`, đặt `VITE_AUTH_LOGIN_URL` thành URL đăng nhập thực tế rồi khởi động lại Vite. Ưu tiên URL cùng origin. Đây là **hợp đồng đề xuất**, chưa phải API đã thống nhất với backend.

- POST endpoint đã cấu hình; JSON `{ "identifier": "email hoặc tên đăng nhập", "password": "mật khẩu" }`.
- HTTP 200 trả `{ "user": { "id": "string", "displayName": "string", "role": "ADMIN hoặc STAFF" } }`.
- Backend tạo phiên bằng cookie HttpOnly/Secure với SameSite phù hợp. Client gửi `credentials: include` và không lưu mật khẩu/token vào localStorage.
- Backend chịu trách nhiệm kiểm tra thông tin, phân quyền, chống CSRF/login-CSRF, giới hạn số lần thử. Cần thống nhất cơ chế CSRF và bổ sung token/header trước khi dùng thật nếu backend yêu cầu.
- Nếu khác origin, backend phải cho phép CORS đúng origin và credentials; không dùng wildcard.
- Các lỗi 401/403, 429, 5xx, mất mạng, timeout 15 giây và phản hồi không hợp lệ đều có thông báo.

Sau khi API xác thực thành công, frontend hiện thông tin tài khoản. Dashboard, tự khôi phục phiên sau tải lại, bảo vệ route và đăng xuất chưa thuộc phần triển khai này. Backend phải kiểm tra quyền trên mọi API; vai trò hiển thị ở frontend không phải cơ chế bảo mật.

Chỉnh contract tại `src/features/auth/auth.ts` khi backend chính thức có API. Không đặt secret trong biến VITE_*.
