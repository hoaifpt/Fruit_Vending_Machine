# Firmware máy bán trái cây tô — ESP32 DevKit 38 chân

Firmware chính được chuyển từ Project B, commit
`b6b1688717092d94895bec0cb42fac61d9d193db`, sang các module C++ độc lập.
Giữ nguyên GPIO, hiệu chuẩn, NVS schema 6, chu trình FIFO hai cột,
Serial CLI và HTTP maintenance API. Không có MQTT hoặc logic xác nhận thanh toán.

**Board được người dùng xác nhận:** ESP32 DevKit 38 chân, PlatformIO `esp32dev`.
Servo S1/S2/S3/S4: **GPIO 18/19/21/22**; IR RX/TX: **GPIO 25/26**.
COM4, baud 115200; upload 460800. Không dùng sơ đồ S3/GPIO 1 trong báo cáo cũ.

**Trạng thái:** đã build offline và kiểm tra hồi quy trên máy phát triển.
Nhánh `feature/connect-purchase-dispensing` bổ sung API backend, UI trạng thái
giao hàng và station worker `tools/dispense_bridge.py`; xem
[hướng dẫn tích hợp](../docs/dispense-integration.md). Chưa upload/HIL: người dùng
xác nhận không cắm ESP32 và không cho chạy chuyển động trong phiên tích hợp.

## Thiết lập và build (PowerShell, từ repository root)

```powershell
python -m venv firmware/.venv
firmware/.venv/Scripts/python.exe -m pip install -r firmware/tools/requirements-build.txt -r firmware/tools/requirements.txt
$env:PYTHONUTF8 = '1'
firmware/.venv/Scripts/python.exe -m platformio run -d firmware -e esp32dev
```

Chạy kiểm tra source và clean build, không mở USB hoặc chạy motor:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File firmware/tools/check.ps1
```

Binary: `firmware/.pio/build/esp32dev/firmware.bin`. Không copy binary này lên
board S3. Cấu hình platform/framework/library đã pin trong `platformio.ini`.

## Upload và kiểm thử sau khi kết nối phần cứng

Các lệnh dưới đây dành cho lần kiểm thử được người vận hành cho phép; chúng chưa
được thực thi trong phiên tích hợp này. Upload khởi động lại board.

```powershell
firmware/.venv/Scripts/python.exe -m platformio device list
firmware/.venv/Scripts/python.exe -m platformio run -d firmware -e esp32dev -t upload
firmware/.venv/Scripts/python.exe -m platformio device monitor -d firmware -p COM4 -b 115200
```

Đóng serial monitor trước khi chạy công cụ khác trên COM4.
Smoke test chỉ gửi PING/CONFIG/STATUS (một số board vẫn reset khi mở cổng):

```powershell
firmware/.venv/Scripts/python.exe firmware/tools/hil_check.py --port COM4
```

HIL **có chuyển động**, chỉ dùng khi đã sẵn sàng nạp/nhả tô thật:

```powershell
firmware/.venv/Scripts/python.exe firmware/tools/hil_check.py --port COM4 --exercise --column 1
firmware/.venv/Scripts/python.exe firmware/tools/hil_check.py --port COM4 --exercise --column 2
```

Tool giữ nguyên hiệu chuẩn/NVS, không retry DISPENSE, yêu cầu máy đang rảnh và
IR auto-trigger tắt. Có lỗi sau lệnh nhả thì gửi STOP; kết quả rơi tô không rõ phải
kiểm tra vật lý. Xem hướng dẫn đầy đủ và các giới hạn trước khi chạy.

## Tài liệu và công cụ

- [Review, kiến trúc, cấu trúc file và hướng dẫn vận hành](docs/REVIEW_AND_RUN_GUIDE.md).
- [Báo cáo build/HIL hiện hành cho ESP32 DevKit](docs/DEPLOYMENT_AND_HIL_REPORT.md).
- [API, station worker, journal và kiểm thử luồng mua hàng](../docs/dispense-integration.md).
- `include/`, `src/`: firmware được compile; `reference/` không được compile.
- `tools/control_center/`: dashboard bảo trì nguyên gốc B, không phải UI mua hàng.
- `tools/hil_check.py`: kiểm tra thiết bị thực, có opt-in rõ ràng cho chuyển động.
- `tests/`: kiểm tra giữ nguyên code và hành vi lỗi của công cụ HIL, không mở USB.
- `reference/project-b/`: snapshot và bằng chứng lịch sử; báo cáo S3 không phải
  chứng nhận cho board DevKit hoặc bản build mới này.
