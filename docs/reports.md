# Dashboard và báo cáo bán hàng (issue #76)

Dashboard vận hành cho Admin / Staff và báo cáo bán hàng cho Admin: doanh thu, giảm giá, hoàn tiền, chuỗi thời gian, giờ cao điểm,
sản phẩm bán chạy; lọc theo khoảng ngày, máy và sản phẩm; xuất **CSV và PDF với cùng một bộ số liệu**. Mọi ngày và giờ theo
`Asia/Ho_Chi_Minh` (`app.business-zone`). STAFF không bao giờ thấy số tiền.

## 1. Định nghĩa (nguồn duy nhất)

Mọi số tiền là VND nguyên. **Bán hàng** = đơn đã giao.

| Chỉ số | Định nghĩa |
| --- | --- |
| `ordersSold` | đơn có `completed_at` trong khoảng (COMPLETED, hoặc REFUNDED sau khi đã giao) |
| `grossSales` | Σ `subtotal` của đơn đã bán |
| `discounts` | Σ `discount_amount` của đơn đã bán (#61) |
| `netSales` | Σ `total_amount` của đơn đã bán (= gross − discounts) |
| `deliveredRefunds` | Σ amount của payment REFUNDED thuộc đơn đã giao, lý do PRODUCT_QUALITY / OTHER, theo `refunded_at` trong khoảng |
| `netRevenue` | `netSales − deliveredRefunds` (có thể âm trong kỳ chỉ có hoàn tiền) |
| `averageOrderValue` | `netSales / ordersSold`, làm tròn xuống; 0 khi không có đơn |
| `moneyCollected` | Σ amount payment SUCCESS hoặc REFUNDED theo `paid_at` trong khoảng (góc nhìn dòng tiền) |
| `moneyRefunded` | Σ amount payment REFUNDED theo `refunded_at` trong khoảng, chia theo lý do (đủ 5 lý do) |
| `pendingRefunds` | số khoản và tổng tiền ứng viên hoàn tiền hiện tại (#72 / #74) — tại thời điểm gọi, bỏ qua khoảng ngày và bộ lọc |
| `failedDispenses` | đơn có `paid_at` trong khoảng mà nhả hàng lỗi: đang DISPENSE_FAILED, đã hoàn mà chưa từng giao (REFUNDED, không completed, không hủy) hoặc có lệnh nhả FAILED / TIMEOUT |

- Bán hàng tính theo `completed_at`, hoàn tiền theo `refunded_at` (hoàn tiền có thể rơi vào kỳ sau).
- Đơn không giao được (DISPENSE_FAILED, trả trễ / trả trùng) không bao giờ là doanh số; tiền hoàn của chúng chỉ nằm trong `moneyRefunded`.
- Nhả muộn sau khi đã hoàn (#52, 3.3): đơn giữ REFUNDED và không có `completed_at` → không phải doanh số.
- Sản phẩm: `order_items.product_id` (một dòng mỗi đơn). Máy: `orders.machine_id`.
- Mọi phép cộng làm trong PostgreSQL (`SalesReportQueries`); Java chỉ điền 0 vào kỳ / giờ trống.

## 2. Tham số chung

| Tham số | Quy tắc |
| --- | --- |
| `from`, `to` | `LocalDate` theo giờ VN, bao gồm hai đầu, bắt buộc; `to ≥ from`; tối đa 366 ngày |
| `machineId` | tùy chọn, lặp lại được (≤ 20 giá trị khác nhau) |
| `productId` | tùy chọn, lặp lại được (≤ 20) |

Khoảng được đổi một lần thành `[đầu ngày from, đầu ngày to + 1)` (Instant) bằng `BusinessCalendar`. Sai khoảng, quá dài, quá nhiều id
hoặc id không tồn tại → 400 (thông báo nêu id). Mọi response nhắc lại bộ lọc đã áp dụng (`filters` kèm `zone`) và `generatedAt`.

## 3. API báo cáo (ADMIN)

| Method | Endpoint | Quyền | Nội dung |
| --- | --- | --- | --- |
| `GET` | `/api/v1/reports/sales/summary` | `REPORT_SALES_READ` | mọi chỉ số ở §1 + hoàn tiền theo lý do |
| `GET` | `/api/v1/reports/sales/timeseries?granularity=DAY\|WEEK\|MONTH` | `REPORT_SALES_READ` | mỗi kỳ: ordersSold, grossSales, discounts, netSales, deliveredRefunds, netRevenue |
| `GET` | `/api/v1/reports/sales/peak-hours` | `REPORT_SALES_READ` | 24 giờ × {ordersSold, netSales} và ma trận 7 × 24 ordersSold (thứ Hai trước) |
| `GET` | `/api/v1/reports/sales/products?sortBy=QUANTITY\|NET_SALES&limit=10` | `REPORT_SALES_READ` | theo sản phẩm: quantity, grossSales, discounts, netSales, deliveredRefunds, sharePercent |
| `GET` | `/api/v1/reports/sales/machines` | `REPORT_SALES_READ` | theo máy: ordersSold, netSales, deliveredRefunds, netRevenue |
| `GET` | `/api/v1/reports/sales/export?format=CSV\|PDF` | `REPORT_EXPORT` | tệp CSV / PDF |

- Kỳ theo giờ VN; WEEK = tuần ISO (bắt đầu thứ Hai); MONTH = tháng dương lịch; kỳ trống = 0 (chuỗi liên tục); `start` / `end` của kỳ
  đầu và cuối được cắt theo khoảng.
- Sản phẩm: chỉ sản phẩm có doanh số hoặc hoàn tiền trong khoảng (kể cả sản phẩm INACTIVE); sắp theo chỉ số giảm dần, hòa thì theo tên
  (collation của database) rồi id; `limit` 1..100; `sharePercent` = netSales sản phẩm / tổng netSales, 1 chữ số thập phân, 0 khi tổng = 0.
- Máy: mọi máy (hoặc các máy được lọc), 0 khi không bán.
- Tổng của chuỗi thời gian, sản phẩm và máy bằng summary (đã kiểm thử).

## 4. Xuất tệp

Một `SalesReport` (summary + chuỗi DAY + giờ cao điểm + **tất cả** sản phẩm + máy) được dựng một lần rồi render:

- **CSV**: UTF-8 có BOM (Excel đọc đúng tiếng Việt), dấu phẩy, quoting RFC 4180; các mục `[Filters] [Summary] [Daily] [Products]
  [Peak hours] [Machines]` cách nhau một dòng trống, mỗi mục có dòng tiêu đề; tiền là số nguyên không phân cách nghìn; ngày ISO;
  ô **chữ** bắt đầu bằng `= + - @ tab CR` được thêm `'` phía trước (chống formula injection, ô số giữ nguyên).
- **PDF** (Apache PDFBox 3.0.4, Apache-2.0): A4, font nhúng Noto Sans Regular / Bold (`src/main/resources/fonts`, giấy phép SIL OFL
  1.1 trong `OFL.txt`); tiêu đề, bộ lọc, thời điểm tạo (giờ VN), người tạo; các bảng tổng quan, theo ngày, sản phẩm, giờ cao điểm, máy;
  tiền dạng `1.234.567 ₫`; ký tự font không có → `?`.
- Tên tệp `freshvend-sales_<from>_<to>.csv|pdf`, `Content-Disposition: attachment`, `Cache-Control: no-store`, ghi thẳng ra response.
- Mỗi lần xuất ghi một dòng `audit_logs` `REPORT_EXPORTED` (format, bộ lọc, người dùng, IP).
- Hai định dạng có đúng cùng số liệu: test đọc cả CSV và văn bản PDF rồi so với summary.

## 5. Dashboard

`GET /api/v1/dashboard/overview` — `DASHBOARD_READ` (ADMIN, STAFF), web nên gọi lại mỗi 30 giây.

| Khối | Nội dung |
| --- | --- |
| `today` | ngày làm việc (giờ VN), ordersSold, netSales hôm nay, netSales hôm qua — **chỉ khi có `REPORT_SALES_READ`** |
| `machines` | total, active, maintenance, inactive, online, warning, offline, neverSeen (quy tắc connectivity của #53) |
| `alerts` | cảnh báo chưa RESOLVED: open, critical, warning, info |
| `workOrders` | open (OPEN, ASSIGNED), inProgress, overdue (chưa xong và quá hạn), assignedToMe |
| `stock` | máy không INACTIVE, cùng SQL với health check (#58): lowStockSlots (slot ACTIVE có số tô bán được ≤ ngưỡng), blockedSlots (slot ERROR hoặc tô đầu hàng DISPENSE_FAILED), bowlsExpiringToday (tô vật lý chưa hết hạn sẽ hết hạn trước cuối ngày) |
| `refunds` | pendingCount, pendingAmount — **chỉ khi có `REPORT_SALES_READ`** |
| `machinesDetail` | mỗi máy: mã, tên, trạng thái, connectivity, lastSeenAt, nhiệt độ mới nhất, số tô bán được, số cảnh báo mở |

STAFF thấy mọi máy (dữ liệu vận hành) nhưng không có trường `today` / `refunds` (vắng mặt, không phải 0). Tối đa 7 câu SQL cho phần
dashboard (≤ 10 cho cả request, đã kiểm thử bằng bộ đếm statement), không N+1.

## 6. Quyền và chỉ mục (V25)

| Quyền | Vai trò |
| --- | --- |
| `DASHBOARD_READ` | ADMIN, STAFF |
| `REPORT_SALES_READ` | ADMIN |
| `REPORT_EXPORT` | ADMIN |

Chỉ mục mới: `ix_orders_completed_at`, `ix_orders_machine_completed` (partial `completed_at IS NOT NULL`), `ix_payments_paid_at`
(partial SUCCESS / REFUNDED). `payments(refunded_at)` có từ V23, `order_items(order_id)` từ V7. Không có bảng mới.

## 7. Hiệu năng

`SalesReportPerformanceTest` tạo 100 000 đơn hoàn tất trong năm 2025 trên 2 máy (có payment, order item, một phần hoàn tiền), đo mỗi
endpoint sau một lần khởi động (tốt nhất trong 3 lần, cả HTTP request) và ghi `target/report-performance.txt` (kèm `EXPLAIN ANALYZE`).
Kết quả trên máy dev (Testcontainers PostgreSQL 18):

| Endpoint | Thời gian | Mục tiêu |
| --- | --- | --- |
| summary (1 năm) | ~220 ms | < 500 ms |
| summary (máy + sản phẩm) | ~345 ms | < 500 ms |
| timeseries DAY / MONTH | ~100 ms | < 1 s |
| peak-hours | ~140 ms | < 1 s |
| products | ~100 ms | < 1 s |
| machines | ~50 ms | < 1 s |
| refund candidates (#72) | ~390 ms | < 1 s |
| export CSV 1 năm | ~850 ms | < 5 s |
| export PDF 1 năm | ~1.5 s | < 5 s |

Để đạt mục tiêu, điều kiện ứng viên hoàn tiền (#72 / #74) được viết lại thành tập con dạng `IN (...)` (PostgreSQL băm một lần thay vì
chạy subquery cho từng payment); kết quả lọc không đổi (RefundIntegrationTest, CustomerReportIntegrationTest vẫn qua).

## Kiểm thử

`SalesReportIntegrationTest` (định nghĩa trên bộ dữ liệu dựng tay: giảm giá, ranh giới ngày VN, hoàn tiền khác kỳ, nhả lỗi / trả trễ /
trả trùng, bộ lọc + 400, chuỗi DAY/WEEK/MONTH, giờ cao điểm, sản phẩm, tổng khớp summary, CSV + PDF cùng số liệu, audit, quyền),
`DashboardIntegrationTest` (số liệu theo fixture, STAFF không có tiền, số statement), `SalesReportPerformanceTest`,
`ReportDocumentationTest` (Swagger ↔ `api-contract/api.yaml`).
