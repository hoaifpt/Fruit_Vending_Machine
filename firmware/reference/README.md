# Snapshot Project B — chỉ để truy nguyên

Các file trong `project-b/` là bản sao nguyên gốc, không được PlatformIO compile
và không phải hướng dẫn vận hành board hiện tại. Hash nằm trong `import_manifest.json`.

Đặc biệt, HIL cũ ghi PASS cho **T-Display-S3/GPIO 1/COM3**, không phải chứng nhận
cho firmware DevKit bốn servo mới nhập. Các script cũ có thể ghi NVS, reset board
và chạy servo, không dùng chúng làm entrypoint kiểm thử hiện hành.

Board đã xác nhận là **ESP32 DevKit 38 chân**, servo GPIO **18/19/21/22**, IR
GPIO **25/26**, **COM4**. Hướng dẫn đã hiệu chỉnh và trạng thái chưa upload/HIL:

- [Review và hướng dẫn chạy](../docs/REVIEW_AND_RUN_GUIDE.md).
- [Báo cáo DevKit hiện hành](../docs/DEPLOYMENT_AND_HIL_REPORT.md).

`tools/import_project_b.py` chỉ nhận đúng snapshot sketch đã ghi hash, không phải
công cụ đồng bộ tùy ý cho phiên bản B mới. Re-import sẽ ghi đè module: chỉ dùng
trong lần migration có review, không chạy lại sau khi sửa firmware riêng ở A.
