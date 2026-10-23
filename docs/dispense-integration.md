# Tích hợp mua hàng → thanh toán → nhả tô

## Phạm vi và nhánh

```text
dev (a81f6de)
└── feature/integrate-esp32-firmware (03bec8a)
    └── feature/connect-purchase-dispensing
```

Yêu cầu trực tiếp của người dùng, chưa gắn số GitHub issue. Nhánh này mở rộng
phạm vi sang backend, API contract, frontend, worker host và tests. Không đổi
GPIO, state machine, NVS hay giao thức CLI trong source ESP32 đã nhập từ B.
Không upload, mở USB hoặc chạy servo thật trong phiên triển khai.

## Luồng hoạt động

1. UI `/buy` tạo đơn một tô và QR như trước.
2. Backend chỉ chuyển đơn thành PAID sau webhook đã xác minh.
3. UI gọi POST idempotent để backend lưu đúng một dispense command cho đơn,
   lấy slot và inventory item từ allocation đã giữ; không nhận slot/giá từ client.
4. Worker chạy trên máy kiosk đọc danh sách PENDING cho chính máy đó, kiểm tra
   trạng thái controller và tra mapping slot UUID → cột 1/2 do operator cấu hình.
5. Worker ghi SQLite journal trước claim, nhận token độc quyền từ backend,
   ghi journal trước UART, gửi đúng một `DISPENSE 1` hoặc `DISPENSE 2`.
6. Backend claim chuyển command thành SENT, đơn thành DISPENSING; mỗi máy chỉ có
   một command đang chạy để tránh nhầm kết quả từ IR dùng chung hai cột.
7. Worker báo ACK; chỉ báo SUCCESS khi đã thấy cột chạy rồi dừng, cả hai cửa ở
   trạng thái `Da dong`, IR hết bị che và counter tăng đúng một.
8. Backend kiểm tra machine/token/state/evidence, transaction cập nhật command
   SUCCESS, allocation DISPENSED, item SOLD, đơn COMPLETED và append SALE history.
9. UI tiếp tục polling trong PAID/DISPENSING, chỉ hiển thị nhận tô khi COMPLETED.

Trình duyệt không claim và không mở Serial. Đường điều khiển vẫn là backend →
station trên máy kiosk → Serial/USB → ESP32. MQTT không được thêm vào luồng nhả.
ID tương quan nằm ở backend và journal của station; không thêm cú pháp commandId
vào CLI ESP32 B một cách ngầm định.

## REST API

Tất cả endpoint cần header `X-Kiosk-Key` của máy; JWT ADMIN/STAFF không thay thế
credential này. Tất cả trả common `ApiResponse`, thành công 200 và `Cache-Control:
no-store`. UUID sai/body sai → 400; thiếu key → 401; sai loại quyền → 403;
tài nguyên không thuộc máy → 404; trạng thái/claim không hợp lệ → 409.

| Method | Path dưới `/api/v1/kiosk` | Chức năng |
|---|---|---|
| POST | `/orders/{orderId}/dispense-command` | Tạo hoặc trả lại command của đơn PAID, không có request body |
| GET | `/orders/{orderId}/dispense-command` | Đọc trạng thái, không trả dispatchToken |
| GET | `/dispense-commands` | Tối đa 20 PENDING, thứ tự createdAt/id, chỉ máy hiện tại |
| POST | `/dispense-commands/{commandId}/claim` | Claim đúng một lần, trả command + dispatchToken |
| POST | `/dispense-commands/{commandId}/results` | Báo ACKNOWLEDGED, SUCCESS, FAILED hoặc TIMEOUT |

Ví dụ báo SUCCESS, dùng token thực từ claim; giá trị dưới đây hoàn toàn giả:

```json
{
  "dispatchToken": "00000000-0000-4000-8000-000000000099",
  "status": "SUCCESS",
  "bowlCountBefore": 7,
  "bowlCountAfter": 8
}
```

ACKNOWLEDGED/FAILED/TIMEOUT có thể bỏ cả hai counter; nếu truyền counter, phải
truyền cặp đầy đủ với số nguyên từ 0 tới 4294967295. SUCCESS phải tăng đúng một.
Kết quả terminal giống nhau được retry idempotent; kết quả xung đột hoặc SUCCESS
đến sau TIMEOUT bị từ chối, không tự đảo ngược trạng thái.

Hợp đồng: `api-contract/api.yaml`. Types frontend được sinh bằng `npm run gen:api`.
Swagger development: `http://localhost:8080/swagger-ui/index.html`;
OpenAPI: `http://localhost:8080/v3/api-docs`. Đặt `API_DOCS_ENABLED=true` ở môi
trường local; profile production vẫn tắt Swagger/OpenAPI.

## Schema, transaction và khóa

V13 là migration mới, không sửa V1–V12:

- UNIQUE trên `dispense_commands.order_id`: mỗi đơn tối đa một command.
- Thêm `dispatch_token UUID`, `bowl_count_before/after BIGINT`, nullable để giữ
  lịch sử cũ; CHECK cặp counter và miền uint32.
- Index queue theo machine/status/createdAt.
- Không tạo bảng giao dịch tổng số lượng, không sửa trigger append-only history.

Đã đọc V3/V5/V6/V7/V9 trước khi triển khai: inventory history là từng item,
`reference_id` UUID, `type` có SALE/ADJUSTMENT, các snapshot reason/status do V9
bổ sung; không có quantity hoặc batch aggregate column để cập nhật.

Order row là mutex cho tạo/claim/result. Claim/terminal lấy Machine trước Slot
(khi claim) và InventoryItem. Không gọi Serial/HTTP provider trong DB transaction.
Tại prepare và claim, hạn sử dụng phải vượt cửa sổ `DISPENSE_TIMEOUT`; success
đến khi bowl đã hết hạn không được chuyển thành SOLD tự động.

Upgrade từ V12 giữ nguyên command/lịch sử. Nếu database đã có nhiều command cho
một order, UNIQUE migration sẽ từ chối thay vì tự xóa hoặc gom dữ liệu: phải
review dữ liệu lịch sử trước khi triển khai, không sửa migration đã áp dụng.

## Cấu hình và chạy local

### Backend và UI

Yêu cầu Java 21, Maven và PostgreSQL 18. Dùng `.env` và hướng dẫn database hiện
có của dự án; không dùng database thật làm dữ liệu test. Cấu hình thêm:

```properties
DISPENSE_TIMEOUT=PT2M
DISPENSE_SWEEP_ENABLED=true
DISPENSE_SWEEP_INTERVAL=PT15S
```

```powershell
cd backend
mvn spring-boot:run
```

Trong terminal khác:

```powershell
cd apps/web
npm ci
npm run dev
```

Đặt `VITE_KIOSK_API_KEY` vào `.env.local` của riêng máy kiosk như trước, mở `/buy`.
Key VITE nằm trong browser bundle; không phục vụ bản kiosk có key ra hosting công
khai. UI chỉ lưu UUID đơn đang theo dõi vào sessionStorage để phục hồi khi reload,
không lưu lệnh motor, token dispatch hoặc kết quả thanh toán tự tạo.

### Station worker tại máy kiosk

Từ repository root, cài Python/tools theo `firmware/README.md`. Copy
`firmware/tools/bridge.example.json` thành `firmware/tools/bridge.local.json` rồi
điền backendUrl, machineId và **UUID slot thật** ứng với cột 1/2. Không suy ra
mapping từ tên sản phẩm hoặc code A1/A2. Mỗi cột chỉ map tới một slot của máy.

Giữ board DevKit 38 chân, COM4, servo 18/19/21/22, IR 25/26. Đóng dashboard bảo
trì/serial monitor và tắt IR auto-trigger trước khi chạy station.

```powershell
$env:KIOSK_API_KEY = '<key-cua-may-kiosk>'
# Chỉ kiểm tra cấu hình và identity backend; KHÔNG mở USB:
firmware/.venv/Scripts/python.exe firmware/tools/dispense_bridge.py --config firmware/tools/bridge.local.json
```

Chỉ khi operator cho phép phần cứng chuyển động:

```powershell
firmware/.venv/Scripts/python.exe firmware/tools/dispense_bridge.py --config firmware/tools/bridge.local.json --enable-motion
```

Lệnh có `--enable-motion` **chưa được thực thi trong phiên này**. Không tự startup
worker chỉ vì UI đã mở. Timeout station mặc định 90 giây, phải thấp hơn deadline
backend 120 giây và đủ cho hiệu chuẩn đang lưu + biên mạng. Nếu thay timing, phải
điều chỉnh deadline ở cả hai phía; không đổi hướng servo để làm test pass.

Journal mặc định: `firmware/.local/dispense-journal.sqlite3` (WAL/FULL sync), chứa
dispatch token nên chỉ tài khoản kiosk/operator được đọc. Journal phải tồn tại
qua restart; không xóa để thử gửi lại. Đây là bằng chứng dispatch, không phải
hàng đợi đồng bộ thanh toán hay cơ sở dữ liệu nghiệp vụ thay backend.

## Mất kết nối, lỗi và đối soát

- Claim mất phản hồi, crash ở CLAIMING/CLAIMED/DISPATCHING: UNKNOWN, không takeover,
  không nhả lại; backend timeout đưa giao dịch sang lỗi để operator đối soát.
- SUCCESS đã quan sát nhưng HTTP lỗi: lưu REPORT_PENDING; retry **HTTP evidence**,
  không gửi lại Serial. Nếu backend đã timeout và trả 409, giữ outbox để đối soát.
- Không thấy một tô, cửa chưa đóng, controller mất phản hồi: STOP best effort,
  báo FAILED/TIMEOUT. Không có tự hoàn tiền hoặc tự bù một tô khác.
- Scheduler xử lý cả PENDING bị bỏ quên và SENT/ACKNOWLEDGED quá hạn. Lỗi giữ item
  DISPENSE_FAILED, allocation RESERVED, order DISPENSE_FAILED, máy MAINTENANCE.
- Nhánh này chưa có API đối soát thủ công/hoàn tiền hoặc sửa tồn kho failed. Sau
  lỗi phải kiểm tra vật lý và xử lý nghiệp vụ có kiểm soát trước khi kích hoạt lại
  máy; không chỉ đổi máy ACTIVE hoặc xóa journal để tiếp tục bán.
- B vẫn có maintenance HTTP không xác thực và một IR dùng chung, không có dedup
  commandId trong MCU. Station serialize/journal tránh tự gửi trùng, nhưng không
  chứng minh exactly-once vật lý khi có người điều khiển maintenance đồng thời.

## Kiểm thử và giới hạn xác minh

```powershell
cd backend
mvn --batch-mode --no-transfer-progress clean verify
cd ../apps/web
npm test
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e
cd ../..
firmware/.venv/Scripts/python.exe -m unittest discover -s firmware/tests -v
```

- Backend tests dùng PostgreSQL thật qua Testcontainers; provider TESTPAY/MOCK,
  không đọc developer `.env`, không gọi payOS thật.
- Test migration từ V12 bảo toàn dữ liệu và CHECK/UNIQUE; test lỗi ghi history
  xác nhận rollback toàn bộ sale rồi retry evidence thành công.
- `DispenseStationFlowIntegrationTest` chạy Spring HTTP thật + Python worker thật
  + SQLite + parser Serial thật, với UART giả lập trong
  `firmware/tools/simulate_paid_dispense.py`. Script này **không mở USB**.
- Browser E2E kiểm tra PAID không tự về catalog sau 12 giây, DISPENSING không bị
  hiển thị thành công, COMPLETED/FAILED và reload không tạo đơn khác. Tất cả API
  browser được mock, không gọi provider/ESP32.
- CI backend bao gồm test station và firmware parity; CI frontend mới chạy type
  generation consistency, unit/build/lint và Chromium E2E. Workflow hỗ trợ PR base
  là nhánh firmware cha. Kết quả CI remote chưa được xác minh tại thời điểm bàn giao.
- Firmware parity tests kiểm tra GPIO và thân hàm ESP32 vẫn nguyên gốc B.
  `.gitattributes` giữ byte CRLF của snapshot/assets B trên cả Linux và Windows.
- Swagger index và exposed document đã được kiểm tra. Chromium thực thi Try it out
  GET pending commands trên backend/database tách biệt, trả 401 đúng khi không có key;
  không mở USB hoặc thực hiện mutation. Evidence tại backend/target/swagger-smoke.json.
- HIL, tô rơi thật, kẹt cơ khí và power-loss vật lý vẫn chờ phiên phần cứng được
  người dùng cho phép. Không dùng simulation làm bằng chứng đã giao tô thật.

Kết quả cuối cùng và số lượng test được ghi trong `backend/.ai/HANDOFF.md` sau
khi hoàn tất full regression trên code cuối cùng. Người dùng đã yêu cầu chia commit và push ngày 23/10/2026; lịch sử Git ghi
nhận các commit bàn giao. Yêu cầu này không bao gồm tạo PR hoặc merge.

## Kết quả xác minh cuối — 23/10/2026

Backend `mvn clean verify`: **639/639 pass**, không lỗi/skip; V13/Flyway/Hibernate,
upgrade, rollback và station HTTP/simulated UART đều pass. Frontend **37 unit + 3
Chromium E2E** pass; build pass, lint 0 error và 15 warning cũ. Firmware/host **22
test** pass; ESP32 build pass. Swagger Try it out read-only trả 401 đúng khi thiếu
key. HIL và tô rơi thật chưa chạy; kết quả CI remote chưa được xác minh.

Lưu ý phục hồi: UUID trong sessionStorage bảo vệ reload, không sống qua việc đóng
tab mất session. Nếu tab đóng trước khi yêu cầu command, đơn PAID vẫn ở backend
và cần nhân viên hỗ trợ; không tự đoán hoặc phát lệnh nhả khi chưa có command.
