# ESP32 DevKit 38 chân — build và trạng thái HIL

Ngày: 23/10/2026, Asia/Bangkok. Báo cáo hiện hành thay cho hướng dẫn S3 cũ.

| Thuộc tính | Cấu hình đã xác nhận |
|---|---|
| Board | ESP32 DevKit 38 chân, PlatformIO `esp32dev` |
| Servo S1/S2/S3/S4 | GPIO 18/19/21/22 |
| IR RX/TX | GPIO 25/26 |
| USB Serial | COM4, 115200 baud; upload 460800 |
| Firmware nguồn | Project B commit `b6b1688717092d94895bec0cb42fac61d9d193db` |
| Logic | 4 servo, FIFO 2 cột, NVS schema 6, Serial/HTTP B nguyên gốc |

## Kiểm tra trên máy phát triển

- PASS: 14 Python regression tests, gồm source parity và kiểm tra công cụ HIL.
- PASS: clean compile/link/build binary cho `esp32dev` bằng `tools/check.ps1`.
- RAM: 45.908 / 327.680 byte (14,0%).
- Flash: 874.133 / 1.310.720 byte (66,7% application partition).
- Các thân hàm, GPIO, state initialization và support assets được đối chiếu với
  snapshot B. Kết quả máy đọc và hash binary tại `validation/verification.json`.

## HIL và triển khai thực

**Kết luận HIL: NOT RUN. Không ghi nhận PASS phần cứng cho lần tích hợp này.**

Người dùng xác nhận board không cắm USB và không cho upload/chạy chuyển động
trong phiên. Chưa kiểm chứng USB flashing, servo, IR, NVS sau reboot, rơi tô hoặc
luồng thanh toán → nhả hàng. Không gửi lệnh trên COM1/COM3/COM4.

HIL cũ của B chạy T-Display-S3/GPIO 1/COM3 được giữ nguyên dưới
`reference/project-b/docs/` chỉ để truy nguyên. Kết quả đó không áp dụng cho
DevKit hiện tại; không dùng sơ đồ LCD/nguồn/GPIO S3 để lắp DevKit.

Hướng dẫn đấu nối, upload, query-only và HIL từng cột:
[REVIEW_AND_RUN_GUIDE.md](REVIEW_AND_RUN_GUIDE.md), mục 4 và 8–11.

## Điều kiện nghiệm thu tiếp theo

- [ ] Operator kết nối đúng DevKit trên COM4 và cho phép upload.
- [ ] Boot đúng GPIO, bốn servo dừng/clamp LOW, hiệu chuẩn NVS không bị mất.
- [ ] Cột 1 và cột 2 mỗi lần chạy rơi đúng một tô, IR tăng đúng một, cửa đóng đúng.
- [ ] Không trôi servo sau STOP, không tự chạy lại khi polling hoặc reboot.
- [ ] Kiểm tra các trường hợp kẹt/mất nguồn dưới giám sát phần cứng.
- [ ] Thống nhất backend command/result API, mapping slot→cột và chống nhả trùng.
- [ ] Chạy thử xuyên suốt UI A → webhook PAID → lệnh hợp lệ → rơi tô → COMPLETED.

Các mục chưa tick cần phiên kiểm thử phần cứng hoặc hợp đồng tích hợp mới;
không thể được thay thế bằng simulation hoặc build thành công.
