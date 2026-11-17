# Test case luồng NHÂN VIÊN (STAFF) trên BE thật

Spec: `e2e-real/staff.spec.ts` (`npx playwright test -c playwright.real.config.ts e2e-real/staff.spec.ts`).
Môi trường: FE thật http://localhost:5800 (proxy `/api` → BE http://localhost:8080), máy M1 ACTIVE + OFFLINE (không firmware),
tài khoản STAFF/ADMIN từ `.env.e2e-real`. Lần chạy cuối 17/11/2026 14:23 (giờ VN): **30 đạt, 2 không đạt** (cả 2 là lỗi BE thật, giữ đỏ).
Mọi phiếu tạo ra có tiêu đề `E2E-STF-<run>-…`; afterAll hủy phiếu còn mở; đã xác nhận sau chạy: 0 phiếu E2E-STF mở, M1 = ACTIVE.

Quy ước "Mong đợi FE" chung cho mọi case có màn hình: không trắng trang, không lỗi console (`console.error` / `pageerror`,
trừ dòng "Failed to load resource" của trình duyệt cho 4xx dự kiến), chữ tiếng Việt. "Mong đợi BE" chung: thân lỗi không có
stack trace, tên class Exception, SQL (`expectCleanError`).

| ID | Luồng | Dữ liệu vào | Bước | Mong đợi FE | Mong đợi BE | Thực tế | Kết quả | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| STF-01 | Menu | Đăng nhập STAFF | Đăng nhập, đọc nav "Quản trị" | Có Tổng quan, Máy bán hàng, Tồn kho, Cảnh báo, Phiếu công việc, Lịch bảo trì, Đơn hàng; KHÔNG có Tài khoản, Vai trò & quyền, Thanh toán, Webhook thanh toán, Hoàn tiền, Báo cáo doanh thu; vào /admin/overview | — | Đúng như mong đợi | Đạt | |
| STF-02a | Chặn URL | `/admin/users` | Gõ thẳng URL | h1 "Không có quyền truy cập", "Mục này chỉ dành cho Quản trị viên", vai trò hiện tại "Nhân viên", nút "Về trang đầu của bạn"; không gọi `/api/v1/users`; không đăng xuất | (không gọi) | Đúng | Đạt | Guard chặn trước khi mount màn |
| STF-02b | Chặn URL | `/admin/roles` | như trên | như trên, không gọi `/roles` | — | Đúng | Đạt | |
| STF-02c | Chặn URL | `/admin/payments` | như trên | như trên, không gọi `/payments` | — | Đúng | Đạt | |
| STF-02d | Chặn URL | `/admin/refunds` | như trên | như trên, không gọi `/refunds` | — | Đúng | Đạt | |
| STF-02e | Chặn URL | `/admin/reports/revenue` | như trên | như trên, không gọi `/reports/sales` | — | Đúng | Đạt | |
| STF-02f | Chặn URL | `/admin/webhook-logs` | như trên | như trên | — | Đúng | Đạt | |
| STF-03 | API ADMIN-only | Token STAFF; 28 request: GET/POST users, GET roles, PUT roles/{id}/permissions, GET payments, webhook logs, refunds, refunds/summary, POST payments/{id}/refund, reports/sales/summary + export, PUT pricing, POST inventory/load, POST/PUT machines, PATCH machines/{id}/status, GET/POST kiosk-credentials, report-token/rotate, POST work-orders, assign, cancel, POST maintenance-plans, generate-now, POST machines/{id}/reset, audit-logs, restock-work-orders | Gọi từng API | — | 403 cho tất cả, trước khi validate body; message không nêu tên permission; không stack trace | Tất cả 403 `{"message":"Access denied"}` | Đạt | |
| STF-04 | 401 API | Không token / JWT sai chữ ký / `Bearer not-a-jwt` | GET /work-orders/me, /alerts, /maintenance-plans, /maintenance-commands, /users | — | 401, thân lỗi sạch | 401 `"Authentication required or access token invalid"` | Đạt | |
| STF-05 | 401 FE | (1) không phiên; (2) sessionStorage = JWT STAFF sửa chữ ký; (3) sessionStorage = "garbage" | Mở /admin/alerts?status=OPEN, /admin/tickets, /admin/maintenance-schedules | Về `/login?next=<đường dẫn gốc + query>`, form Email hiện; token giả bị xóa khỏi sessionStorage | API trả 401 cho token giả | Đúng cả 3 | Đạt | |
| STF-06 | Phiếu của tôi | ADMIN tạo INCIDENT `E2E-STF-…-mine` giao STAFF | GET /work-orders/me; mở /admin/tickets | Phiếu hiện, chú thích "Danh sách chỉ gồm phiếu được giao cho bạn.", không có "Tạo phiếu", "Phân công", "Hủy phiếu"; FE chỉ gọi /work-orders/me | 201 ASSIGNED; /me chứa phiếu, mọi phần tử có assignee = STAFF | Đúng | Đạt | |
| STF-07 | Danh sách toàn bộ | Token STAFF | GET /work-orders | — | 403 | 403 | Đạt | |
| STF-08 | Phiếu người khác | ADMIN tạo INCIDENT OPEN chưa giao | STAFF GET /{id}, /{id}/events, POST start, notes, complete; mở /admin/tickets/{id} | h1 "Không tìm thấy phiếu", nút "Về danh sách phiếu", không lộ tiêu đề phiếu | 404 cho cả 5 request; /me không chứa phiếu | Đúng | Đạt | |
| STF-09 | Bắt đầu phiếu | INCIDENT giao STAFF | FE chi tiết → "Bắt đầu" → hộp thoại (ô "Chuyển máy sang Bảo trì" mặc định bỏ chọn) → "Bắt đầu"; gọi start lần 2 qua API | Toast "Đã bắt đầu phiếu", nút "Hoàn tất" hiện | IN_PROGRESS; M1 giữ ACTIVE; start lại → 200 | Đúng | Đạt | |
| STF-10 | Ghi chú trống | `{note:""}`, `{note:"   "}`, `{}`, note 2001 ký tự | API POST /notes; FE "Thêm ghi chú" → "Lưu ghi chú" để trống | Ô "Ghi chú" `aria-invalid=true`, chữ "Nhập nội dung ghi chú.", focus vào ô, không gửi POST | 400, `fieldErrors.note` | BE 400 nhưng `fieldErrors` = `{"addNote.request.note":"must not be blank"}` (2001 ký tự: `"size must be between 0 and 2000"`); FE đạt | **Không đạt** | Lỗi BE-1. Phần FE đạt (soft assert) |
| STF-11 | Thêm ghi chú | Ghi chú "Đã kiểm tra ngăn A <run>" | FE "Thêm ghi chú" → nhập → lưu | Toast "Đã thêm ghi chú", ghi chú hiện trong lịch sử phiếu | Event có note đúng | Đúng | Đạt | |
| STF-12 | Hoàn tất thiếu kết quả | `{}`, `{resultNote:""}`, `{resultNote:"  "}`, field lạ `hack` | API POST /complete; FE "Hoàn tất" → để trống → "Hoàn tất" | Ô "Kết quả" `aria-invalid=true`, "Ghi kết quả: đã làm gì tại máy (bắt buộc).", focus vào ô | 400 `fieldErrors.resultNote`; field lạ → 400; phiếu vẫn IN_PROGRESS | BE 400 nhưng key là `complete.request.resultNote`; field lạ 400 sạch; FE đạt | **Không đạt** | Lỗi BE-1 |
| STF-13 | Hoàn tất đúng | Kết quả "Đã xử lý sự cố <run>" | FE "Hoàn tất" → nhập → "Hoàn tất" | Toast "Đã hoàn tất phiếu", hiện kết quả, hết nút Bắt đầu/Hoàn tất/Thêm ghi chú | DONE | Đúng | Đạt | |
| STF-14 | Thao tác phiếu DONE | Phiếu đã DONE | POST start, notes, complete | — | 409 cả 3 | 409 `INVALID_WORK_ORDER_TRANSITION…` | Đạt | |
| STF-15 | Hoàn tất khi chưa bắt đầu | Phiếu ASSIGNED | POST complete | — | 409 INVALID_WORK_ORDER_TRANSITION | 409 | Đạt | |
| STF-16 | Xung đột đồng thời | Phiếu ASSIGNED; ADMIN hủy khi STAFF đang mở hộp thoại "Bắt đầu" | STAFF bấm "Bắt đầu" | Toast lỗi tiếng Việt, không lộ mã/HTTP; trang tải lại, hiện lý do hủy, không còn nút Bắt đầu | 409 | Toast: "Phiếu này không còn ở trạng thái chờ bắt đầu (có thể đã được đổi người, bắt đầu hoặc hủy). Trang đã được tải lại; xem trạng thái mới nhất." | Đạt | |
| STF-17 | Danh sách + lọc cảnh báo | status OPEN / ACKNOWLEDGED / RESOLVED / NOPE | API lọc; FE /admin/alerts chọn "Trạng thái" = Đã đóng | URL `?status=RESOLVED`, request có `status=RESOLVED`, bảng hoặc trạng thái rỗng hiện | Mỗi lọc chỉ trả đúng trạng thái; `NOPE` → 400 | Đúng | Đạt | |
| STF-18 | Xác nhận cảnh báo | Cảnh báo OPEN chưa gắn phiếu (LOW_STOCK M1) | FE chi tiết → "Xác nhận" → xác nhận | Toast "Đã xác nhận cảnh báo" | ACKNOWLEDGED (hoặc RESOLVED nếu health check tự đóng); xác nhận lại 200 | Đúng | Đạt | Có dữ liệu OPEN lúc chạy |
| STF-19 | Đóng cảnh báo, note quá dài | note 501 ký tự (API), 520 ký tự (FE) | API POST /resolve; FE "Đóng cảnh báo" gõ 520 ký tự | Ô dừng ở 500 ký tự, hint "500/500 ký tự" | 400 `fieldErrors.note` | Đúng | Đạt | |
| STF-20 | Đóng cảnh báo | Cảnh báo OPEN/ACK, ghi chú "E2E STAFF đóng <run>" | FE "Đóng cảnh báo" → nhập → gửi; API resolve + acknowledge lại | Toast "Đã đóng cảnh báo", nút "Đóng cảnh báo" biến mất | RESOLVED; resolve lại 409; acknowledge 409 | Đúng | Đạt | Cảnh báo trạng thái (LOW_STOCK) sẽ mở lại ở health check sau, theo docs |
| STF-21 | Lệnh bảo trì, máy ACTIVE | M1 ACTIVE, ngăn đầu tiên, OPEN_REFILL, Idempotency-Key | API POST maintenance-commands (có/không key); FE /admin/machines/M1?tab=maintenance, Enter trên 3 nút | Khung khóa `data-lock=status` "Lệnh bảo trì chỉ gửi được khi máy ở trạng thái Bảo trì…" + "Việc cần làm:"; nút `aria-disabled=true`, Enter → focus về khung lý do, không POST | 409 `MACHINE_NOT_IN_MAINTENANCE…`; không key → 400/409 sạch | Đúng | Đạt | |
| STF-22 | RESET | STAFF | API POST /machines/M1/reset; FE tab Bảo trì | Không có danh sách "Lệnh cho cả máy", chỉ câu "Khởi động lại bộ điều khiển (xóa lỗi FAULT) chỉ dành cho Quản trị viên." | 403 | Đúng | Đạt | |
| STF-23 | Phiếu MAINTENANCE dừng máy | MAINTENANCE giao STAFF, `stopMachine:true` | STAFF start → ADMIN thử bật lại máy → STAFF gửi CLOSE_REFILL kèm workOrderId → STAFF hoàn tất → ADMIN PATCH ACTIVE | — | start 200, M1 → MAINTENANCE; bật lại khi IN_PROGRESS → 409 WORK_ORDER_IN_PROGRESS; lệnh → 409 MACHINE_OFFLINE; sau DONE máy vẫn MAINTENANCE; ADMIN PATCH ACTIVE → 200 | Đúng; M1 ở MAINTENANCE khoảng 0,2 s rồi về ACTIVE (finally) | Đạt | Ghi nhận: BE chuyển M1 sang MAINTENANCE (đúng docs); đã trả về ACTIVE ngay trong test |
| STF-24 | Lịch bảo trì chỉ xem | STAFF | API GET list, upcoming; POST create, activate, deactivate; PUT/PATCH {id}; FE /admin/maintenance-schedules | Không nút "Tạo lịch", "Sửa", "Tắt lịch", "Bật lại", "Tạo phiếu ngay", không cột "Thao tác" | GET 200; POST 403; PUT/PATCH 403 hoặc 405 | Đúng | Đạt | Không có lịch nào trong DB (bảng rỗng) |
| STF-25 | Đối chứng quyền được cấp | STAFF | GET dashboard/overview, alerts, work-orders/me, maintenance-plans, maintenance-commands, machines/M1, products, orders, pricing, notifications unread-count, customer-reports | — | 200 tất cả | 200 | Đạt | |
| STF-26 | Tổng quan không lộ tiền | STAFF | GET dashboard/overview; FE /admin/overview | Không có chuỗi tiền dạng "… ₫" | Không có trường doanh thu có giá trị | Đúng | Đạt | |
| STF-27 | Bàn phím | STAFF | Focus link "Phiếu công việc" trong nav → Enter | Sang /admin/tickets, focus chuyển vào `#admin-main` | — | Đúng | Đạt | |

## Lỗi tìm thấy

| Mã | Phía | Mức | Mô tả | Tái hiện | Bằng chứng / vị trí nghi ngờ |
| --- | --- | --- | --- | --- | --- |
| BE-1 | BE | Vừa | `fieldErrors` của `POST /work-orders/{id}/notes` và `/complete` dùng đường dẫn method validation (`addNote.request.note`, `complete.request.resultNote`) thay vì tên field (`note`, `resultNote`) như hợp đồng ("field-to-validation-message map") và như các endpoint khác (`/alerts/{id}/resolve` trả `fieldErrors.note`). FE không gắn được lỗi máy chủ vào ô nếu kiểm tra phía client bị vượt qua; message tiếng Anh ("must not be blank"). | STAFF: POST `/work-orders/{id}/notes` `{"note":""}` hoặc POST `/complete` `{}` trên phiếu IN_PROGRESS | STF-10, STF-12. `backend/.../common/exception/GlobalExceptionHandler.java:76` (`v.getPropertyPath().toString()` của `ConstraintViolationException`, validation ở tầng service `WorkOrderService.addNote/complete`) |

Không thấy lỗi FE trong phạm vi STAFF.

## Khác biệt so với production

- `GET /v3/api-docs` (Swagger) và `/actuator/health` trả 200 không cần xác thực trên môi trường dev; production cần tắt hoặc bảo vệ.
- Thân lỗi BE có `path`, `error`, `timestamp`; không có stack trace/SQL/Exception ở mọi request đã thử (403, 401, 404, 400, 409).
- Message 400/409 của BE là tiếng Anh có tiền tố mã (`MACHINE_OFFLINE: the machine is not online`, `WORK_ORDER_IN_PROGRESS: …`); FE tự dịch sang tiếng Việt, không hiện nguyên văn.
- M1 OFFLINE (không firmware) nên không kiểm được nhánh lệnh bảo trì thành công (MAINTENANCE + ONLINE → PENDING/SENT/…).
- Bảng lịch bảo trì rỗng: STF-24 chỉ kiểm màn rỗng và API ghi bằng UUID giả (403 do URL rule đứng trước kiểm tra tồn tại).
