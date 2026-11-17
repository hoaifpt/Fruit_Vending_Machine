# Test case luồng KHÁCH HÀNG trên BE thật (kiosk mua hàng, báo sự cố công khai)

Spec: `e2e-real/customer.spec.ts`. Lệnh: `npx playwright test -c playwright.real.config.ts e2e-real/customer.spec.ts`.
Lần chạy 17/11/2026 14:2x (giờ VN), BE `http://localhost:8080`, FE quản trị 5800. Spec tự bật Vite kiosk 5810 (khóa máy E2E), 5811 (khóa sai), 5812 (khóa M1) rồi tắt khi xong.
Kết quả: **29 đạt, 0 không đạt, 5 chặn (skip)** trên 34 case.

Môi trường lúc chạy (khác với đề bài):

- BE chạy `PAYMENT_PROVIDER=PAYOS` (cổng thật), không phải MOCK. **Không case nào gọi `POST /kiosk/orders/{id}/payments`**: test API không gọi; trong trình duyệt, URL này luôn bị chặn và trả lời tại chỗ bằng stub (đếm số lần, không chuyển tới BE). Không có payment nào được tạo.
- M1 ACTIVE nhưng catalog rỗng: toàn bộ hộp trong M1 thuộc lô hết hạn 24/10/2026, nên M1 không bán được. Vì vậy các case tạo đơn dùng một **máy E2E mới** (`E2E-CUS-<mã>`: cột A, 1 sản phẩm 2.000 ₫, lô hạn +3 ngày, 3 hộp, khóa kiosk riêng). Cuối mỗi lần chạy: mọi đơn được hủy, máy E2E chuyển INACTIVE. M1 chỉ được đọc.
- `PUBLIC_REPORT_BASE_URL` chưa đặt: `GET /kiosk/incident-report-link` và `POST /machines/{id}/report-token/rotate` đều 409 `REPORT_LINK_NOT_CONFIGURED`, nên không có cách hợp lệ (không đọc DB) để có report token thật.
- Thời gian giữ hàng (`ORDER_RESERVATION_TTL`) của BE local là 600 s (tài liệu ghi mặc định PT5M).

| ID | Luồng | Dữ liệu vào | Bước | Mong đợi FE | Mong đợi BE | Thực tế | Kết quả | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CUS-01 | Kiosk API danh tính | Khóa máy E2E | GET /kiosk/me | – | 200, đúng machineId/code, ACTIVE, không lộ key/token | 200 đúng máy, không có apiKey/reportToken | Đạt | |
| CUS-02 | Kiosk API danh tính + catalog M1 | Khóa M1 (REAL_KIOSK_KEY) | GET /kiosk/me, /kiosk/catalog; đối chiếu tồn kho M1 qua ADMIN | – | me = M1; catalog acceptingOrders=true; sản phẩm = sản phẩm có head bán được | me = M1, acceptingOrders=true, **0 sản phẩm**; tồn kho M1: không hộp nào còn hạn | Đạt | BE nhất quán (hộp hết hạn không bán). Lệch dữ liệu so với đề bài "2 sản phẩm 2.000 ₫" |
| CUS-03 | Catalog | Khóa máy E2E | GET /kiosk/catalog | – | 1 sản phẩm, price 2000, availableQuantity 3, không lộ slot/batch/item id | Đúng | Đạt | |
| CUS-04 | Xác thực kiosk | Không header; `not-a-key`; key đúng dạng nhưng lạ; key bị cắt 2 ký tự | GET /kiosk/catalog, /kiosk/me | – | 401, cùng một nội dung, không stack trace | 401 cả 4, message giống nhau | Đạt | Không phân biệt được key sai dạng / thu hồi / sai secret (đúng thiết kế) |
| CUS-05 | Phân tách kiosk/user | JWT ADMIN; JWT + kiosk key; kiosk key trên /machines, /orders | GET | – | 403; 401; 401 | 403; 401; 401 | Đạt | |
| CUS-06 | Tạo đơn + hủy | `{productId}` sản phẩm E2E | POST /kiosk/orders → catalog → cancel → catalog | – | 201 PENDING_PAYMENT, 1 item qty 1, total 2000, mã `ORD-yyyyMMdd-XXXXXXXX`, currentPayment null; sản phẩm biến khỏi catalog khi cột bị giữ; hủy → CANCELLED, catalog lại 3 | Đúng; giữ hàng 600 s | Đạt | TTL local 600 s ≠ mặc định tài liệu 300 s |
| CUS-07 | Hủy 2 lần | Đơn mới | cancel, cancel | – | 200 CANCELLED cả hai (idempotent), không trả hộp 2 lần | Đúng, catalog vẫn 3 | Đạt | |
| CUS-08 | Body sai | `{}`, `{productId:null}`, JSON hỏng, text/plain | POST /kiosk/orders | – | 400 (fieldErrors.productId), 415/400 cho text/plain; không giữ hộp | 400 (có fieldErrors.productId); text/plain 400/415; catalog vẫn 3 | Đạt | |
| CUS-09 | productId sai | `tao-123`, số 12345, UUID lạ, sản phẩm ACTIVE không có trên máy, sản phẩm E2E gửi từ M1 | POST /kiosk/orders | – | 400, 400, 404, 409, 409 | Đúng | Đạt | |
| CUS-10 | Field lạ | `quantity`, `price`, `machineId`, `status`, dạng cũ `items[]` | POST /kiosk/orders | – | 400, không giữ hộp | 400 cả 5; catalog vẫn 3 | Đạt | |
| CUS-11 | Đọc/hủy đơn máy khác | Đơn của máy E2E đọc bằng khóa M1; UUID lạ; `not-a-uuid` | GET, POST cancel | – | Máy khác 404 = giống đơn không tồn tại; cancel máy khác 404 và đơn không đổi | Đúng; `not-a-uuid` 400/404 không lộ chi tiết | Đạt | |
| CUS-12 | Tạo thanh toán 201, gọi lại 200 dùng lại QR | – | – | – | – | – | Chặn | BE dùng payOS thật, không test để tránh tạo giao dịch thật |
| CUS-13 | Thanh toán đơn đã hủy → 409 | – | – | – | – | – | Chặn | như trên (lệnh vẫn đi qua endpoint payments) |
| CUS-14 | Giới hạn 5 lần tạo thanh toán | – | – | – | – | – | Chặn | như trên |
| CUS-15 | Trả tiền → PAID → máy OFFLINE nhả lỗi/timeout | – | – | Màn "Đang gửi lệnh nhả hàng" → "Máy chưa báo kết quả…" sau 150 s | PAID → DISPENSE_FAILED | – | Chặn | payOS thật + `.env.e2e-real` không có `REAL_MOCK_WEBHOOK_SECRET` + provider không phải MOCK |
| CUS-16 | Webhook giả | `/webhooks/payments/mock` chữ ký sai; `/payos` chữ ký giả, thiếu chữ ký, JSON hỏng, text/plain, body 70 KB, GET | POST/GET, rồi đọc lại đơn | – | /mock 404 (provider không hoạt động); payos 401/401/401, 415, 413; GET 401/405; đơn vẫn PENDING_PAYMENT, không có payment | 404; 401,401,401,415,413; GET 401; đơn không đổi | Đạt | Không dùng khóa payOS nào. Mỗi lần 401 ghi một dòng `payment_webhook_logs` (đúng thiết kế) |
| CUS-17 | Link QR báo sự cố | Khóa máy E2E | GET /kiosk/incident-report-link | – | 200 URL tuyệt đối, hoặc 409 REPORT_LINK_NOT_CONFIGURED | 409 REPORT_LINK_NOT_CONFIGURED, không stack | Đạt | Message có tên biến `PUBLIC_REPORT_BASE_URL` (chỉ kiosk thấy, FE không hiện) |
| CUS-18 | Xoay report token | STAFF, khóa kiosk, ADMIN trên máy E2E, máy không tồn tại | POST /machines/{id}/report-token/rotate | – | 403, 401, 200 hoặc 409, 404 | 403, 401, **409**, 404 | Đạt | Không rotate M1. 409 chặn CUS-22 |
| CUS-19 | Form công khai, token sai | Token lạ; token chứa ký tự lạ/SQL; token lạ kèm JWT ADMIN | GET /public/report-forms/{token} | – | 404 không cần xác thực, JWT cũ không chặn | 404; 400/404 không lộ; JWT → 404 | Đạt | |
| CUS-20 | Gửi phản ánh token sai | Body hợp lệ + ảnh PNG 1 px; body sai (type lạ, mô tả 1200 ký tự, SĐT `123`, consent false, field lạ) | POST multipart | – | 404; body sai 400 hoặc 404 | 404; body sai **400** (kiểm tra body trước token) | Đạt | Không tiết lộ token có tồn tại hay không |
| CUS-21 | Gửi > 7 MB | Ảnh 7,2 MB | POST multipart | – | 413 | 413 | Đạt | |
| CUS-22 | Gửi phản ánh hợp lệ 201 RPT-…; thiếu loại / mô tả > 1000 / SĐT sai / ảnh > 2 MB / sai định dạng → 400 | – | – | – | – | – | Chặn | `PUBLIC_REPORT_BASE_URL` chưa cấu hình → rotate 409, không lấy được token hợp lệ nếu không đọc DB |
| CUS-23 | Gửi dồn | 8 lần POST liên tiếp | POST multipart | – | 429 + Retry-After > 0, không lộ chi tiết | 404,404,404,**429**, Retry-After 60 (tính cả 3 lần gửi ở CUS-20/21 → lần thứ 6 bị chặn) | Đạt | Giới hạn theo nguồn: mọi client localhost dùng chung một bộ đếm |
| CUS-30 | Kiosk UI danh mục | Vite 5810, khóa máy E2E | Mở /buy | "Chạm để chọn sản phẩm", thẻ sản phẩm `2.000 ₫`, "Máy E2E-CUS-…", nút "Báo sự cố"; không lỗi console | GET /kiosk/me, /catalog 200 | Đúng | Đạt | Ảnh mặc định là quả cam cho sản phẩm "Táo" (xem lỗi L-03) |
| CUS-31 | Kiosk UI chọn → giữ hàng → cổng thanh toán lỗi → hủy | Chọn sản phẩm; URL payments trả 502 tại chỗ | Chọn, chờ, Hủy → Xác nhận → Về danh sách | Màn thanh toán: tên, `2.000 ₫`, mã đơn, đồng hồ đếm ngược khớp expiresAt (±10 s) và chạy; "Cổng thanh toán đang bận / Bạn chưa bị trừ tiền. Hộp vẫn được giữ cho bạn." + "Thử lại"; hủy → "Đơn hàng đã hủy", "Bạn chưa bị trừ tiền.", "Hộp trái cây đã được trả lại máy."; về danh mục | Đơn thật PENDING_PAYMENT → CANCELLED, catalog lại 3 | Đúng | Đạt | Thanh toán là stub (không gọi payOS) |
| CUS-32 | Kiosk UI màn QR | Như CUS-31 nhưng payments trả 201 giả (QR `E2E-STUB-QR-NOT-PAYABLE`); poll đơn thật được ghép currentPayment giả | Chọn → QR → Hủy | Ảnh QR "Mã QR thanh toán 2.000 ₫", "Số tiền: 2.000 ₫", timer `Còn N phút S giây` khớp expiresAt, "Đang chờ xác nhận thanh toán"; hủy → "Bạn chưa bị trừ tiền." → danh mục | Đơn thật hủy được | Đúng | Đạt | Một phần là stub. Đồng hồ hiện 10:01 với hạn 600 s (L-04) |
| CUS-33 | Kiosk UI khóa sai | Vite 5811, khóa giả đúng dạng | Mở /buy | "Máy chưa được cấu hình", không thẻ sản phẩm, không hiện 401/khóa | 401 | Đúng; console chỉ có 2 dòng "Failed to load resource 401" của trình duyệt | Đạt | |
| CUS-34 | Kiosk UI mất mạng | Chặn mọi /api/v1 (connection refused), rồi mở lại; sau đó chặn riêng POST /kiosk/orders | Mở /buy; chờ tự kết nối lại; chọn sản phẩm | "Máy đang mất kết nối… Bạn chưa bị trừ tiền."; tự về danh mục trong ≤ 25 s; chọn khi mất mạng → "Chưa tạo được đơn hàng do lỗi kết nối. Bạn chưa bị trừ tiền…" và vẫn ở danh mục | – | Đúng | Đạt | |
| CUS-35 | Kiosk UI nút Báo sự cố | Máy E2E | Bấm "Báo sự cố" ở chân trang | Hộp thoại "Báo sự cố với máy"; 409 → "Máy này chưa bật trang báo sự cố. Vui lòng báo nhân viên vận hành theo số điện thoại dán trên máy." + "Thử lại", không lộ mã/biến; đóng được | GET /kiosk/incident-report-link 409 | Đúng | Đạt | |
| CUS-36 | Kiosk UI trên M1 | Vite 5812, khóa M1 | Mở /buy | Có sản phẩm thì giá `2.000 ₫`; catalog rỗng → "Máy đã hết hàng" | catalog rỗng | "Máy M1", "Máy đã hết hàng / Hiện không còn hộp trái cây nào bán được trong máy." | Đạt | |
| CUS-37 | Trang /report | `/report`, `/report/<token lạ>` | Mở trang | "Hãy quét mã QR trên máy"; "Mã QR không còn dùng được" (hoặc "Hệ thống đang bận" nếu 429), không form, không 404/Exception | GET form 404 | Đúng | Đạt | |
| CUS-38 | Form báo sự cố: lỗi phía khách + trả lời của BE | GET form được stub (máy giả); POST đi BE thật với token lạ | Gửi trống; chọn "Đã trả tiền…", SĐT `12345`, mã `ORD-1`; ảnh 2 MB + 10 byte; sửa đúng rồi gửi | "Chọn loại sự cố."; lỗi mã đơn, SĐT, đồng ý ngay dưới trường, focus vào Mã đơn; ảnh quá 2 MB báo lỗi trước khi gửi; BE 404 → "Mã QR này không còn dùng được…", BE 429 → "Bạn gửi quá nhiều báo cáo… sau N giây" | POST 404 hoặc 429 | Lần chạy cuối: 429 (cửa sổ từ CUS-23) → thông báo chờ đúng; lần chạy trước: 404 → thông báo "Mã QR…" đúng | Đạt | Một phần là stub (GET form) |
| CUS-39 | Form báo sự cố: 429 thật | 7 POST từ cùng trình duyệt qua proxy Vite, rồi gửi từ form | Gửi form "Máy lỗi" | "Bạn gửi quá nhiều báo cáo. Vui lòng thử lại sau 29 giây. Thông tin bạn đã nhập vẫn được giữ."; nút "Gửi lại sau 29 giây" bị khóa; mô tả vẫn giữ | 429, Retry-After 29 | Đúng | Đạt | Màu chữ thông báo lỗi nhạt trên nền hồng (L-05) |

## Lỗi và ghi nhận

| Mã | Phía | Mức | Mô tả | Tái hiện / bằng chứng |
| --- | --- | --- | --- | --- |
| L-01 | FE | Vừa | `src/kiosk/mock-pay.ts` dòng 13 có secret HMAC webhook MOCK viết cứng trong mã nguồn (32 ký tự, có trong git từ b301fd1/134df09). Chỉ chạy khi `import.meta.env.DEV` và QR bắt đầu bằng `MOCK-QR|`; đã build thử: **không** có trong bundle production. Nhưng dev server phục vụ file này cho mọi trình duyệt và bất kỳ ai đọc repo đều ký được webhook MOCK cho môi trường dev/staging dùng cùng secret. Cùng file còn gọi `/bridge/dispense` (cầu phần cứng) từ trình duyệt. | `grep -n "const secret" src/kiosk/mock-pay.ts`; build `npx vite build --outDir <tmp>` rồi tìm chuỗi secret: không thấy |
| L-02 | BE/cấu hình | Vừa (môi trường) | `PUBLIC_REPORT_BASE_URL` chưa đặt nên kiosk không có QR báo sự cố và ADMIN không xoay được token (409). Toàn bộ luồng gửi phản ánh hợp lệ không kiểm được. | CUS-17, CUS-18, CUS-35 |
| L-03 | FE | Thấp | Sản phẩm không có `imageUrl` dùng ảnh mặc định theo vị trí (quả cam) dù tên là "Táo": khách có thể hiểu nhầm sản phẩm. | Ảnh `cus-30-catalog.png`, `cus-31-payment-busy.png`; `fallbackImage(productIndex(...))` trong `PurchasePage.tsx` |
| L-04 | FE | Thấp | Đồng hồ đếm ngược hiện `10:01` với hạn giữ 600 s (vượt 1 s do làm tròn lên + lệch đồng hồ server). | Ảnh `cus-32-qr.png`; `secondsLeft` dùng `Math.ceil` |
| L-05 | FE | Thấp (cần đo) | Thông báo lỗi cấp form (429) chữ đỏ nhạt trên nền hồng, có thể dưới 4.5:1. | Ảnh `cus-39-rate-limited.png` |
| N-01 | Dữ liệu | – | M1 không bán được gì (mọi hộp thuộc lô hết hạn 24/10/2026); kiosk M1 hiện "Máy đã hết hàng". Đề bài nói M1 có 2 sản phẩm. | CUS-02, CUS-36 |
| N-02 | Cấu hình | – | Giữ hàng 600 s ở BE local; tài liệu `order-management.md` ghi mặc định PT5M. | CUS-06 |
| N-03 | BE/triển khai | – | Giới hạn 5 phản ánh/phút tính theo IP nguồn. Sau reverse proxy mà không đặt `REPORT_TRUSTED_PROXIES`, mọi khách dùng chung một bộ đếm (5/phút cho cả hệ thống). | CUS-23, CUS-39 |

## Khác biệt so với production

- `PAYMENT_PROVIDER=MOCK` bị cấm ở profile `prod`; ở đây BE chạy PAYOS thật nên mọi case thanh toán bị chặn có chủ ý. Webhook `/mock` trả 404 vì provider không hoạt động (prod cũng vậy).
- Nút "Giả lập thanh toán thành công (Mock Pay)" chỉ có ở dev (`import.meta.env.DEV`) và với QR `MOCK-QR|`; không xuất hiện trong lần chạy này.
- Production cần: `PUBLIC_REPORT_BASE_URL`, `PUBLIC_REPORT_ALLOWED_ORIGINS`, `REPORT_IP_HASH_SECRET`, `REPORT_TRUSTED_PROXIES`.
- Thông báo lỗi BE (401/403/404/409/413/415/429) không có stack trace, tên lớp, SQL; riêng 409 `REPORT_LINK_NOT_CONFIGURED` nêu tên biến môi trường (chỉ kiosk nhận, FE không hiện).
- Test chạy trên DB dev local; tạo máy/sản phẩm/lô `E2E-CUS-*` (để INACTIVE), đơn đều đã hủy, phản ánh không có bản ghi nào (token lạ).
