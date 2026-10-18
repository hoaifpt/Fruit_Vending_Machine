# Kết nối đăng nhập và API

Web quản trị gọi backend REST theo `api-contract/api.yaml` (nguồn chân lý). Không đoán field: thiếu gì thì mở issue backend.

## Cấu hình

| Biến | Ý nghĩa |
| --- | --- |
| `VITE_API_BASE_URL` | Địa chỉ backend (scheme + host, không có `/api/v1`). Để trống để gọi cùng origin |
| `DEV_API_PROXY_TARGET` | Chỉ dùng khi `npm run dev`: Vite proxy `/api` tới backend (mặc định `http://localhost:8080`) |

Backend chưa bật CORS, vì vậy khi phát triển nên để `VITE_API_BASE_URL` trống và dùng proxy của Vite. Khi triển khai, đặt web và API cùng origin (reverse proxy) hoặc bổ sung CORS ở backend.

## Đăng nhập

- `POST /api/v1/auth/login` với `{ email, password }`. Email được cắt khoảng trắng; mật khẩu giữ nguyên.
- Phản hồi chỉ có `accessToken`, `tokenType`, `expiresIn`. Backend **không có refresh token** và không có endpoint đăng xuất.
- Token lưu trong bộ nhớ và `sessionStorage` (mất khi đóng tab), không ghi log, không đưa vào URL.
- Vai trò (`ADMIN`, `STAFF`, có thể cả hai) được đọc từ claim `roles` của JWT **chỉ để ẩn/hiện giao diện**. Backend vẫn là nơi kiểm tra quyền; mọi lời gọi đều phải xử lý `403`.
- Đăng xuất = xóa token phía client.
- Token hết hạn hoặc bị từ chối (`401`) → xóa phiên và chuyển tới `/login?next=<URL đang xem>`; sau khi đăng nhập quay lại đúng URL. Chỉ chấp nhận đường dẫn nội bộ làm `next`.

## API client

Mọi gọi API đi qua `src/api/client.ts`:

- Thêm `Authorization: Bearer <token>`, gửi JSON, không gửi cookie.
- Bóc `data` khỏi `{ timestamp, message, data }`.
- Lỗi được chuyển thành `ApiError`:

| Mã | Hiển thị |
| --- | --- |
| 400 có `fieldErrors` | Thông báo cạnh từng ô nhập |
| 400 không có field | Thông báo cấp biểu mẫu (từ `message`) |
| 401 | Xóa phiên, chuyển tới đăng nhập |
| 403 | "Bạn không có quyền…", không đăng xuất |
| 404 | Trạng thái không tìm thấy |
| 409 | `message` nghiệp vụ của backend (trùng mã, sai trạng thái, vượt sức chứa…) |
| 5xx / mất mạng / quá 20 giây | Thông báo chung kèm nút "Thử lại"; không hiển thị stack trace hay nội dung thô |

Kiểu dữ liệu nằm ở `src/api/schema.d.ts`, sinh từ contract:

```powershell
npm run gen:api
```

Commit lại file này mỗi khi `api-contract/api.yaml` thay đổi để mọi sai lệch hiện thành lỗi biên dịch.
