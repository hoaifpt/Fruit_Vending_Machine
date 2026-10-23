# Review tích hợp và hướng dẫn chạy firmware

> Bản ghi import trên nhánh `feature/integrate-esp32-firmware`. Nhánh con đã bổ sung API/worker/UI; xem [hướng dẫn hiện hành](../../docs/dispense-integration.md). Các mục thiếu backend dưới đây mô tả thời điểm import.

Ngày review: 23/10/2026 (Asia/Bangkok).

## 1. Kết quả và phạm vi

- Project A: Fruit_Vending_Machine, base `dev` commit `a81f6de`.
- Nhánh triển khai: `feature/integrate-esp32-firmware`, tạo trực tiếp từ `dev`.
- Project B: `F:/project/repo-github/esp-control/esp-control`, commit
  `b6b1688717092d94895bec0cb42fac61d9d193db`, working tree sạch lúc nhập.
- Mọi thay đổi nội dung của A nằm trong `firmware/`; không sửa B.
- Không commit/push/merge; không thay đổi UI, API, database, devops hay giao thức.
- Người dùng xác nhận ESP32 DevKit 38 chân, GPIO 18/19/21/22 và IR 25/26;
  giữ COM4. Không cắm USB và không cho upload/HIL chuyển động trong phiên này.

Firmware compile được cho board DevKit, đã tách module và kiểm tra bảo toàn source.
**Chưa xác minh upload, servo thực tế hoặc rơi tô. Luồng mua hàng xuyên suốt chưa
hoàn thành vì Project A chưa có giao diện cấp lệnh/báo kết quả dispense.**

## 2. Phân tích hai project và quyết định tích hợp

| Thành phần | Project A hiện có | Project B hiện có | Cách xử lý |
|---|---|---|---|
| UI người mua | React `/buy`, chọn sản phẩm, QR, polling tới PAID | Dashboard điều khiển thử nghiệm | Giữ nguyên UI A; dashboard B chỉ là công cụ bảo trì |
| Backend | Spring Boot, giữ tồn kho, payment/webhook | Không có nghiệp vụ bán hàng đáng tin cậy | Không đưa payment xuống ESP32 |
| Hardware | `firmware/` chỉ có README | Sketch Arduino khoảng 2.461 dòng, 4 servo, FIFO 2 cột, IR | Nhập toàn bộ implementation vào các module C++ |
| Kết nối | Thiết kế Backend → Kiosk → Serial → ESP32 | USB Serial CLI và SoftAP HTTP | Giữ nguyên Serial/HTTP của B; không tự thêm MQTT |
| Hiệu chuẩn | Chưa có firmware | Preferences/NVS, schema 6 | Giữ nguyên namespace, key, default, migration/reset behavior |
| Hiển thị | UI A trên màn hình kiosk | LCD conditional cho S3 | Giữ code LCD; DevKit không bật LCD, không đổi chân |
| Kiểm thử | Test backend/frontend | HIL cũ cho S3/servo đơn và host simulation | Lưu bản cũ làm lịch sử; thêm tool HIL DevKit riêng |

Nhập `web_ui.h` vào ESP32 và toàn bộ server Python/web assets vào công cụ host,
giữ nguyên byte. Không cần copy `start_web.bat` vì dùng entrypoint Python trực tiếp.
Không nhập `.git`, cache hoặc môi trường ảo của B.

## 3. Cấu trúc firmware và ranh giới module

```text
firmware/
├── platformio.ini
├── README.md
├── .gitignore
├── include/
│   ├── config/board_pins.hpp
│   ├── core/runtime_api.hpp
│   ├── core/runtime_state.hpp
│   └── transport/web_ui.h
├── src/
│   ├── main.cpp
│   ├── core/{helpers,runtime_state}.cpp
│   ├── actuators/servo_control.cpp
│   ├── motion/motion.cpp
│   ├── dispense/column_dispense.cpp
│   ├── sensors/ir_sensor.cpp
│   ├── storage/preferences_store.cpp
│   ├── display/display.cpp
│   └── transport/{http_server,serial_cli,telemetry,wifi}.cpp
├── tools/
│   ├── check.ps1
│   ├── requirements-build.txt
│   ├── requirements.txt
│   ├── import_project_b.py
│   ├── hil_check.py
│   └── control_center/{server.py,web/}
├── tests/{test_source_parity,test_hil_check}.py
├── docs/
│   ├── REVIEW_AND_RUN_GUIDE.md
│   ├── DEPLOYMENT_AND_HIL_REPORT.md
│   └── validation/verification.json
└── reference/
    ├── import_manifest.json
    └── project-b/
        ├── ESP32_Control_Center_ServoStop_FIXED_v2.ino.txt
        ├── platformio.ini.txt
        ├── scripts/
        └── docs/  # tài liệu/bằng chứng S3 cũ, không phải hướng dẫn DevKit
```

| Module | Trách nhiệm |
|---|---|
| `main.cpp` | Giữ đúng thứ tự setup và vòng lặp B |
| `board_pins.hpp` | Mapping chân nguyên gốc, macro tương thích board |
| `runtime_state.*` | Một nơi định nghĩa state/config/global objects, header dùng extern |
| `runtime_api.hpp` | Khai báo hàm tường minh thay cho auto-prototype của `.ino` |
| `servo_control.cpp` | PWM attach khi cần, write và detach/clamp LOW |
| `motion.cpp` | Open/close/manual/cycle cho 4 servo, các timer |
| `column_dispense.cpp` | FIFO hai cột, đóng/mở cửa dưới và cửa trên |
| `ir_sensor.cpp` | Đọc IR, debounce, bộ đếm và auto-trigger nguyên gốc |
| `preferences_store.cpp` | Default, load/save NVS, schema 6 |
| `display.cpp` | LCD conditional/no-op khi không có LCD |
| `transport/` | Wi-Fi, HTTP maintenance, Serial CLI và serialization |

Đây là tách module có kiểm soát, không phải viết lại state machine. Chưa chuyển
state chung thành class hay hợp nhất bốn servo bằng template/vòng lặp: việc đó
sẽ làm thay đổi lớn code đã kiểm thử. `runtime_state` vẫn là coupling có chủ đích
để giữ nguyên semantics. Các module compile thành translation unit riêng.

95 hàm được chuyển nguyên thân; 72 khai báo global được chuyển vào một file định
nghĩa, giữ thứ tự khởi tạo và nhánh `#if` LCD. Chỉ chuyển default argument sang
header và đổi đường dẫn include `web_ui.h`. Không đổi số, điều kiện, timer,
JSON, route, lệnh hoặc chuỗi trạng thái. Source gốc và SHA-256 trong manifest
cho phép review mà không cần truy cập máy chứa B.

## 4. Board và GPIO chính thức cho lần tích hợp này

| Thiết bị | GPIO | Vai trò |
|---|---:|---|
| Servo 1 | 18 | Cửa dưới cột 1 |
| Servo 2 | 19 | Cửa trên cột 1 |
| Servo 3 | 21 | Cửa dưới cột 2 |
| Servo 4 | 22 | Cửa trên cột 2 |
| IR receiver | 25 | Input pull-up, mặc định active-low |
| IR transmitter | 26 | Output, giữ trạng thái enable nguyên gốc |

Board: **ESP32 DevKit 38 chân**, environment **esp32dev**, UART USB **COM4**,
115200 baud; upload 460800. Cấp nguồn servo theo cụm phần cứng đã kiểm thử và nối
chung GND với ESP32; không cấp cả cụm servo từ chân 3.3V của board.

Tài liệu B cũ ghi T-Display-S3, servo GPIO 1, LCD ST7789 và COM3 là bằng chứng
của cấu hình lịch sử, không phù hợp cấu hình hiện tại. Không dùng nó để đấu dây,
chọn environment hoặc kết luận bản DevKit này đã qua HIL. Bản nguyên gốc nằm
trong `reference/project-b/docs/`; hướng dẫn hiện hành là tài liệu này.

Phần code LCD/S3 vẫn giữ để không sửa hành vi gốc, nhưng không cung cấp build
environment S3 trong bản tích hợp: bản đồ chân DevKit hiện tại không phải mapping
S3 đã được xác nhận. Không tự ý thay mapping.

## 5. Hành vi phần cứng được giữ nguyên

- Servo continuous: default stop=90, forward=110, reverse=70; NVS có thể chứa
  hiệu chuẩn khác. Không áp lại default khi upload và không erase NVS.
- Default forward/reverse=1000 ms, pause=500 ms, cycles=1; phạm vi và validation
  theo B. Servo dùng 50 Hz, pulse 500–2500 µs.
- STOP: detach PWM, chuyển chân OUTPUT, ghi LOW. Không đổi thành chỉ write(90).
- FIFO từng cột: mở cửa dưới → giữ 600 ms → đóng cửa dưới → nghỉ 300 ms → mở
  cửa trên → giữ 600 ms → đóng cửa trên → idle.
- Hai cột giữ nguyên state machine riêng; master start/stop/open/close không đổi.
- IR debounce 60 ms, counter và các chế độ auto-trigger được giữ nguyên.
- NVS namespace `servo-config`, schema 6 và toàn bộ key không đổi.
- Wi-Fi `WIFI_AP_STA`, SoftAP `ESP32-Servo-Quad`, mật khẩu mặc định `12345678`,
  HTTP port 80, AP IP do B dùng là `192.168.4.1`; không bổ sung kết nối STA/backend.
- Loop: HTTP → motion (4 servo rồi FIFO) → IR → Serial → delay(2).

## 6. Giao thức hiện có và giới hạn với backend

### Serial B (115200 baud, newline)

| Lệnh | Ý nghĩa |
|---|---|
| `PING` | `[RES] PONG` |
| `CONFIG` | `[RES]` + JSON cấu hình, có `s1`..`s4` |
| `STATUS` | `[RES]` + JSON trạng thái, `col1`, `col2`, `ir` |
| `DISPENSE 1` / `DISPENSE 2` | Bắt đầu FIFO tương ứng, một lần gửi |
| `COL1_DISPENSE` / `COL2_DISPENSE` | Alias giữ nguyên |
| `STOP` / `ALL_STOP` | Dừng và clamp cả bốn servo; reset state FIFO |
| `S1_*`..`S4_*`, `CONFIG_SET ...`, `IR_*` | Bộ lệnh bảo trì nguyên gốc; xem `serial_cli.cpp` |

HTTP trên ESP32 có `GET /api/status`, `GET /api/config`, POST
`/api/col1/dispense`, `/api/col2/dispense`, `/api/dispense/1`, `/api/dispense/2`
và các route bảo trì khác. Không phải REST `/api/v1` của Spring Boot.
HTTP/Serial vẫn giữ nguyên khác biệt validation của B.

### Vì sao chọn → thanh toán → rơi tô chưa chạy xuyên suốt

1. A đã tạo đơn, giữ hộp và xác nhận PAID bằng webhook.
2. `KioskOrderResponse` của A hiện không trả `commandId`, `slotId` hoặc cột được
   backend chỉ định; item chỉ có product/SKU/quantity/price.
3. A chưa có API lấy/nhận dispense command và báo kết quả để chuyển inventory
   thành SOLD, allocation DISPENSED, order COMPLETED.
4. `/buy` hiện không gửi Serial sau PAID. Firmware không thể tự điều khiển browser
   hoặc truy cập transaction database của backend để tạo quyền nhả hàng.
5. B nhận `DISPENSE 1/2`, không hỗ trợ `DISPENSE <commandId> <slot=...>` được
   mô tả trong README A; không lưu lịch sử commandId để chống nhả trùng.

Chỉ thêm code trong firmware không thể tạo các API/field/UI behavior bị thiếu
mà vẫn giữ giao thức A và logic B. Vì vậy không thêm polling PAID rồi tự đoán
cột từ tên sản phẩm, không hardcode "Táo = slot A2", không dùng quyền ADMIN trên
controller và không tự báo thanh toán thành công.

**Đề xuất trong phạm vi firmware, chờ hợp đồng được cấp:** đặt adapter host trong
`firmware/tools/` để nhận command đã được backend cấp và mapping slot→cột rõ ràng,
dịch sang CLI B đúng một lần, theo dõi ACK/motion/IR rồi gửi kết quả theo API
được thống nhất. Adapter cần journal bền vững; crash sau gửi lệnh phải UNKNOWN và
đối soát, không retry nhả mù quáng. Đây là thiết kế đề xuất, chưa bật hay giả lập
thành tích hợp thật vì API cấp lệnh/báo kết quả chưa tồn tại. Backend/kiosk sẽ
cần một phạm vi công việc riêng để cung cấp hợp đồng đó.

Không thể cam kết exactly-once vật lý chỉ nhờ adapter: controller B không có
commandId/dedup bền vững. Bổ sung tính năng đó sẽ là thay đổi giao thức/logic,
cần được thống nhất và kiểm thử riêng.

## 7. Review các điểm kế thừa cần biết trước vận hành

| Điểm phát hiện trong B | Hệ quả | Xử lý trong lần tích hợp |
|---|---|---|
| `STATUS.ir.pin/txPin` hardcode 10/11, một số log cũng ghi 10/11 | Không phản ánh chân thực tế 25/26 | Giữ nguyên wire output; hướng dẫn GPIO chuẩn tại mục 4, không dùng telemetry này để đấu dây |
| FIFO in "SUCCESSFUL" khi hết chu trình thời gian | Không chứng minh tô thật đã rơi | Không map thông báo này thành backend COMPLETED; HIL mới kiểm tra thêm IR và yêu cầu quan sát |
| Chỉ một bộ IR cho hai cột, không có command correlation | Khó gán lần rơi vào đơn/cột khi chạy đồng thời | HIL kiểm từng cột; không kết luận nhiều đơn đồng thời an toàn |
| HTTP có thể start lại FIFO, không cùng busy guard như Serial | Bấm/gửi lệnh lặp có thể khởi động lại trình tự | Giữ hành vi B, không tự retry và không trộn nhiều nguồn điều khiển |
| IR auto mode có thể tự khởi động servo/FIFO | Có thể chạy ngoài payment flow nếu operator bật | HIL từ chối exercise khi autoTrigger != 0; không tự đổi NVS |
| Không có journal commandId hoặc trạng thái hoàn tất bền vững | Reset/mất điện làm kết quả giao dịch không rõ | Chưa đạt yêu cầu phục hồi giao dịch sản xuất; cần hợp đồng/thiết kế tiếp theo |
| SoftAP/HTTP maintenance không xác thực người mua | Có thể điều khiển motor ngoài luồng payment nếu truy cập mạng bảo trì | Chỉ dùng mạng bảo trì do operator kiểm soát; không đưa route này vào UI mua hàng |
| Server Python tự chuyển simulation khi không có serial | UI trông hoạt động nhưng không có phần cứng | Chỉ chấp nhận quan sát hardware khi `is_hardware=true`; simulator không là HIL |
| `Serial.readStringUntil` có timeout 50 ms | CLI có thể chặn loop tạm thời khi nhận dòng thiếu newline | Giữ nguyên, không đổi transport parser trong migration |

Những điểm trên là review code đang có, không phải thay đổi GPIO/logic được đưa
vào lần này. Chưa coi firmware là production-ready cho giao dịch tự động.

## 8. Thiết lập môi trường và build

Từ root Project A trong PowerShell, Python 3.10+; lần tích hợp dùng Python 3.14.

```powershell
python -m venv firmware/.venv
firmware/.venv/Scripts/python.exe -m pip install -r firmware/tools/requirements-build.txt -r firmware/tools/requirements.txt
$env:PYTHONUTF8 = '1'
firmware/.venv/Scripts/python.exe -m platformio run -d firmware -e esp32dev
```

Pinned: PlatformIO 6.2.0, espressif32 7.1.3, framework package
`4.20017.260907+sha.dcc1105b` (Arduino Core 2.0.17), ESP32Servo 1.2.1, GFX 1.4.9.
Không đổi sang thư viện latest. `intelhex==2.3.0` trong môi trường build xử lý
dependency còn thiếu của esptool; không cần sửa Python global.

Lần đầu cần Internet tải platform/toolchain/library. `.pio/` và `.venv/` nằm
trong firmware và đã ignore. PlatformIO còn dùng cache mặc định tại user profile,
không thay file source bên ngoài firmware.

Clean build + tests, không mở serial:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File firmware/tools/check.ps1
```

Output trong `firmware/.pio/build/esp32dev/`: `firmware.bin`, `firmware.elf`,
`bootloader.bin`, `partitions.bin`. Dùng PlatformIO upload để chọn đúng offsets;
không ghi `firmware.bin` vào offset bootloader.

## 9. Upload và kiểm thử thiết bị khi được operator cho phép

**Các bước tại mục này chưa thực hiện. Người dùng yêu cầu không upload/chạy motor
trong phiên tích hợp 23/10/2026.** Giữ COM4, không suy ra từ COM3 trong HIL cũ.

1. Kiểm tra board đúng DevKit, nguồn/GND, cơ cấu không kẹt, sơ đồ mục 4.
2. Cắm USB data; kiểm tra cổng. Nếu COM4 không xuất hiện, xác nhận lại với operator,
   không tự chọn COM1 hay đổi cấu hình chân.
3. Đóng dashboard/serial monitor khác đang giữ COM4.

```powershell
firmware/.venv/Scripts/python.exe -m platformio device list
firmware/.venv/Scripts/python.exe -m platformio run -d firmware -e esp32dev -t upload
firmware/.venv/Scripts/python.exe -m platformio device monitor -d firmware -p COM4 -b 115200
```

Boot mong đợi có log servo 18/19/21/22, IR RX25/TX26, config loaded, bốn chân
clamped LOW và `[SYSTEM] READY`. Banner B vẫn nhắc cả S3/DevKit vì giữ nguyên
chuỗi code; không dùng banner đó để chọn board. Không erase flash/NVS.

Đóng monitor rồi chạy query smoke:

```powershell
firmware/.venv/Scripts/python.exe firmware/tools/hil_check.py --port COM4
```

Tool gửi PING, CONFIG và STATUS, yêu cầu cả 4 servo/2 cột rảnh, autoTrigger=0.
Tool không gửi reset, CONFIG_SET, CALIB hoặc START. Driver USB vẫn có thể reset
board khi mở cổng nên chỉ chạy trong thời gian bảo trì.

Chỉ sau khi bố trí tô và đồng ý chạy cơ cấu, kiểm từng cột:

```powershell
firmware/.venv/Scripts/python.exe firmware/tools/hil_check.py --port COM4 --exercise --column 1 --output firmware/docs/validation/local-col1.json
firmware/.venv/Scripts/python.exe firmware/tools/hil_check.py --port COM4 --exercise --column 2 --output firmware/docs/validation/local-col2.json
```

Mỗi lần tool gửi đúng một DISPENSE, quan sát cột chạy rồi rảnh và IR counter tăng
đúng 1. Nếu timing NVS dài, tăng `--timeout`, không thay hiệu chuẩn để ép pass.
Nếu lỗi hoặc mất ACK sau gửi lệnh, tool thử STOP, không gửi lại DISPENSE.
Operator cần kiểm tô rơi thật, cửa đóng đúng, không rơi hai tô, không trôi servo
sau dừng. `PASS_MOTION_AND_IR_OBSERVATION` chỉ là quan sát motion/IR;
`physical_drop_verified=false` cho đến khi operator xác nhận bằng quan sát thực.

Test persistence NVS trên DevKit: ghi lại CONFIG hiện hành, operator reset trong
thời gian bảo trì rồi đọc CONFIG so sánh. Tool mới không tự ghi thông số, thay
hướng servo hoặc factory reset như HIL cũ. Báo cáo JSON local được ignore để
không nhầm với bằng chứng đã review/đã commit.

## 10. Dashboard bảo trì B (tùy chọn)

Không phải UI mua hàng A; không xác nhận payment. Cách chạy tại loopback bằng app
nguyên gốc B và background worker của nó:

```powershell
firmware/.venv/Scripts/python.exe firmware/tools/control_center/server.py --port COM4
```

Mở `http://localhost:8000`. Entrypoint B giữ nguyên bind `0.0.0.0` và tự mở browser;
chỉ chạy trong mạng bảo trì kiểm soát, không expose ra Internet. Nếu thiếu ESP32,
dashboard dùng simulation. Không ghi nhận PASS phần cứng dựa trên simulation.
Không chạy dashboard cùng serial monitor/HIL trên COM4.

Ngoài dashboard host, SoftAP ESP32 vẫn phục vụ trang nhúng tại `http://192.168.4.1`.
Không có thay đổi port, Wi-Fi, quyền hay REST route của B.

## 11. Kiểm tra đã thực hiện và chưa thực hiện

| Kiểm tra | Kết quả |
|---|---|
| Source parity: toàn bộ code body sau tách module | PASS |
| GPIO, thứ tự khởi tạo state, conditional LCD, snapshot/asset hash | PASS |
| Test tool HIL: query-only, 2 cột, busy, sai GPIO, IR auto, timeout, mất ACK, không thấy IR | PASS |
| Python tools parse | PASS |
| ESP32 DevKit compile/link/bin | PASS; xem `validation/verification.json` |
| USB upload | CHƯA CHẠY — thiết bị không kết nối, người dùng không cho phép |
| NVS persistence sau reset thực | CHƯA CHẠY — chờ phiên phần cứng |
| Servo/IR và tô rơi thật | CHƯA CHẠY — chờ phiên phần cứng |
| Wi-Fi và dashboard qua hardware | CHƯA CHẠY — chờ phiên phần cứng |
| Mua hàng A → payment → dispense → COMPLETED | CHƯA ĐẠT — thiếu bridge/API và command correlation |
| Frontend/backend regression | Không chạy lại: không thay các thành phần này |

Báo cáo HIL S3 trong reference là kết quả lịch sử của B; không tái sử dụng làm
PASS cho firmware mới. Source parity và build không thay thế kiểm thử điện/cơ.
Kết quả build DevKit: RAM 45.908 byte, flash 874.133 byte. Tổng 14 test pass,
0 lỗi. Báo cáo hiện hành tại `DEPLOYMENT_AND_HIL_REPORT.md` đã sửa board/GPIO/COM
so với hướng dẫn S3 cũ và ghi rõ HIL chưa chạy.

## 12. Các việc cần xác nhận cho tích hợp bán hàng tiếp theo

- Backend cấp command có commandId, machineId và slotId qua API nào; kết quả trả
  qua endpoint nào, hợp đồng retry/idempotency ra sao.
- Mapping slot trong database sang cột 1/2 phải do cấu hình máy/backend chỉ định,
  không suy ra từ product name hoặc comment "Táo/Dưa lưới" trong B.
- Một IR hiện tại xác nhận rơi cho cột nào và xử lý nhiều đơn đồng thời ra sao.
- Tiêu chí SUCCESS vật lý, timeout, jam, partial completion và đối soát khi mất điện.
- Khi cần commandId/dedup trên controller, thống nhất thay đổi protocol riêng;
  không đổi ngầm trong lần import này.

Board/GPIO/COM và việc không chạy motor đã được người dùng xác nhận, không còn
là giả định. Những phần còn thiếu ở trên không thể tự đoán từ source hiện tại.

## 13. Danh sách file thay đổi

Danh sách dưới đây được tạo từ cây firmware, loại trừ cache/build/venv. Chỉ README
là file tracked đã tồn tại trước tích hợp; các file còn lại được thêm mới.

<!-- FILE_LIST -->

- `.gitignore`
- `README.md`
- `docs/DEPLOYMENT_AND_HIL_REPORT.md`
- `docs/REVIEW_AND_RUN_GUIDE.md`
- `docs/validation/verification.json`
- `include/config/board_pins.hpp`
- `include/core/runtime_api.hpp`
- `include/core/runtime_state.hpp`
- `include/transport/web_ui.h`
- `platformio.ini`
- `reference/README.md`
- `reference/import_manifest.json`
- `reference/project-b/ESP32_Control_Center_ServoStop_FIXED_v2.ino.txt`
- `reference/project-b/docs/DEPLOYMENT_AND_HIL_REPORT.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/README.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/display.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/firmware-architecture.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/hardware-specification.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/peripherals.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/pinout.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/platformio.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/power.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/protocol.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/testing.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/troubleshooting.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/usb-debugging.md`
- `reference/project-b/docs/hardware/lilygo-t-display-s3/wifi.md`
- `reference/project-b/docs/traces/boot_log.txt`
- `reference/project-b/docs/traces/hil_execution_trace.txt`
- `reference/project-b/docs/validation/hil_test_results.json`
- `reference/project-b/platformio.ini.txt`
- `reference/project-b/scripts/capture_serial.py`
- `reference/project-b/scripts/hil_test_suite.py`
- `src/actuators/servo_control.cpp`
- `src/core/helpers.cpp`
- `src/core/runtime_state.cpp`
- `src/dispense/column_dispense.cpp`
- `src/display/display.cpp`
- `src/main.cpp`
- `src/motion/motion.cpp`
- `src/sensors/ir_sensor.cpp`
- `src/storage/preferences_store.cpp`
- `src/transport/http_server.cpp`
- `src/transport/serial_cli.cpp`
- `src/transport/telemetry.cpp`
- `src/transport/wifi.cpp`
- `tests/test_hil_check.py`
- `tests/test_source_parity.py`
- `tools/check.ps1`
- `tools/control_center/server.py`
- `tools/control_center/web/app.js`
- `tools/control_center/web/index.html`
- `tools/control_center/web/style.css`
- `tools/hil_check.py`
- `tools/import_project_b.py`
- `tools/requirements-build.txt`
- `tools/requirements.txt`
