# Test case: Quản lý kho trên BE thật

Spec: `e2e-real/inventory.spec.ts`. Chạy: `npx playwright test -c playwright.real.config.ts e2e-real/inventory.spec.ts`.
Lần chạy 17/11/2026 14:30 (giờ VN), FE `http://localhost:5800` (không mock), BE `http://localhost:8080`, 1 worker.
Kết quả: 41 test, 37 đạt, 4 không đạt (cả 4 do cùng một lỗi BE: khóa `fieldErrors` sai). Test đỏ được giữ nguyên.

Dữ liệu: mỗi lần chạy tạo máy riêng `E2E-INV-<id>` (ngăn A sức chứa 4, B sức chứa 5, ACTIVE, chưa từng kết nối), máy
`E2E-INV-<id>-EMPTY` (ngăn trống), sản phẩm `E2E Táo/Cam <id>`, lô `E2E-INV-<id>-B1` (Táo, +3 ngày, 20), `-B2` (Cam, +2 ngày, 20),
`-TODAY` (Táo, hết hạn 23:00 hôm nay giờ VN, 5); ngăn A sẵn 1 hộp B1. M1 chỉ đọc. Cài đặt giảm giá là cài đặt chung: test nào đổi thì
khôi phục ngay trong `finally` (đã kiểm: sau khi chạy vẫn `enabled = true`, `percent = 50`).

Kiểm chung cho mọi phản hồi lỗi BE: không có stack trace, tên class Java, package, SQL (regex `LEAK` trong spec). Mọi test FE kiểm thêm
không có lỗi console / pageerror (bỏ qua dòng "Failed to load resource" của các phản hồi 4xx mà test cố ý gây ra).

| ID | Luồng | Dữ liệu vào | Bước | Mong đợi FE | Mong đợi BE | Thực tế | Kết quả | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INV-01 | Lô: tạo đúng | STAFF, mã `␠␠e2e-inv-…-ok1␠␠`, SX hôm qua, HSD +2 ngày, 3 hộp | POST /product-batches | — | 201, mã đã bỏ khoảng trắng và in hoa, có `createdBy`, `Cache-Control: no-store`, không có trường tồn kho | Đúng như mong đợi | Đạt | |
| INV-02 | Lô: hạn dùng quá khứ / hạn trước ngày SX | HSD hôm qua; SX +3 ngày, HSD +2 ngày | POST | — | 400 | 400 "Batch must not already be expired" / "...after..." | Đạt | Lỗi chỉ có `message`, không có `fieldErrors.expiresAt` (FE phải so chuỗi tiếng Anh để đặt dưới ô Hạn dùng) |
| INV-03 | Lô: số lượng sai | 0, -1, 2147483648, `"5"`, 1.5 | POST | — | 400; 0/-1 có `fieldErrors.quantity` | 0/-1: `quantity` "must be greater than 0"; còn lại 400 "Request body is missing or malformed" | Đạt | Không có giới hạn trên ngoài int32 |
| INV-04 | Lô: mã trùng | Mã của B1 viết thường | POST | — | 409 | 409 "Batch code is already in use" | Đạt | Không phân biệt hoa thường đúng tài liệu |
| INV-05 | Lô: sản phẩm INACTIVE / không tồn tại | sản phẩm vừa chuyển INACTIVE; UUID 0 | POST | — | 409; 404 | 409 "Product must be ACTIVE to create a batch"; 404 | Đạt | |
| INV-06 | Lô: field lạ, giờ thiếu offset, JSON hỏng, DELETE | `createdBy`, `2026-11-10T08:00:00`, `{"batchCode":` | POST, DELETE | — | 400 ×3; DELETE không được | 400 ×3; DELETE 405 | Đạt | 400 field lạ không nêu tên field |
| INV-30 | FE tạo lô (STAFF) | Táo, mã `e2e-inv-…-ui1`, 16/11/2026 08:00 → 20/12/2026 09:30, 12 | Mở "Tạo lô hàng", điền, "Tạo lô" | Toast "Đã tạo lô hàng"; dòng mới mã in hoa, `16/11/2026 08:00`, `20/12/2026 09:30`, "0 / 12 hộp", "Chưa nạp hộp nào vào ngăn." | 201 | Đúng | Đạt | |
| INV-31 | FE tạo lô: hạn quá khứ, số lượng 0 / -3 | HSD 05/10/2026, SL 0 rồi -3 | Gõ, bấm "Tạo lô" | Câu "Hạn dùng đã qua…" ngay khi gõ, "Số lượng khai báo phải là số nguyên từ 1 đến 2.147.483.647 hộp." cạnh ô, ô `aria-invalid`; không gửi POST | — | Đúng; 0 request POST | Đạt | |
| INV-32 | FE tạo lô: mã trùng | Mã B1 viết thường | Bấm "Tạo lô" | 409 → "Mã lô này đã tồn tại (không phân biệt hoa thường)…" dưới ô Mã lô | 409 | Đúng | Đạt | |
| INV-33 | FE tạo lô: sản phẩm vừa bị ngừng bán | Chọn sản phẩm, rồi API chuyển INACTIVE | Bấm "Tạo lô" | "Sản phẩm này đang ngừng bán nên không tạo lô được…" dưới ô Sản phẩm | 409 | Đúng | Đạt | |
| INV-07 | Nạp trực tiếp đúng | ADMIN, B1 → ngăn A, 2 | POST /inventory/load | — | 201, 2 hộp AVAILABLE, 2 dòng LOAD cùng `referenceId = operationId`, `statusAfter` AVAILABLE | Đúng | Đạt | |
| INV-08 | Nạp trực tiếp: STAFF / chưa đăng nhập | | POST | — | 403 / 401, không lộ tên quyền | 403 "Access denied" / 401 | Đạt | |
| INV-09 | Nạp: số lượng / body sai | 0, 1001, `"1"`, thêm `machineId`, `batchId: "abc"` | POST | — | 400; 0/1001 `fieldErrors.quantity` | Đúng | Đạt | |
| INV-10 | Nạp: vượt sức chứa / vượt số khai báo lô | trống+1 vào A; lô 1 hộp nạp 2 | POST | — | 409 `SLOT_CAPACITY_EXCEEDED`, 409 `BATCH_QUANTITY_EXCEEDED`, không ghi hộp nào | Đúng, số hộp không đổi | Đạt | |
| INV-11 | Nạp lô hết hạn | Lô hết hạn có sẵn trong DB | POST | — | 409 | 409 "Batch is expired" | Đạt | Thông báo không có mã `BATCH_EXPIRED:` như đường nạp theo phiếu |
| INV-12 | Nạp vào ngăn INACTIVE / ERROR | Đổi ngăn B rồi khôi phục ACTIVE | POST | — | 409 | 409 "Slot must be ACTIVE for loading" cả hai | Đạt | Nạp theo phiếu cho phép ngăn ERROR, nạp trực tiếp thì không (đúng tài liệu) |
| INV-13 | Nạp lô khác sản phẩm vào ngăn đang có Táo | B2 (Cam) → ngăn A | POST | — | Chặn nếu BE có quy tắc | 201: BE KHÔNG chặn, cột có 2 sản phẩm (test rút lại hộp) | Đạt (ghi nhận) | Xem lỗi L-04 |
| INV-14 | Nạp lô của sản phẩm INACTIVE | | POST | — | 409 | 409 "Product must be ACTIVE" | Đạt | |
| INV-15 | Rút hộp | lý do `␠␠␠`, 501 ký tự, thêm `status`, đúng `␠␠E2E hộp dập␠␠`, rút lại, UUID 0, `abc`, không token | POST /inventory/{id}/remove | — | 400 `reason` ×2, 400, 200 REMOVED + dòng REMOVE lý do đã trim, AVAILABLE→REMOVED, 409, 404, 400, 401 | Đúng | Đạt | |
| INV-16 | Lịch sử / đọc tồn kho | lọc máy+ngăn+LOAD; `type=FOO`; `size=101`; `sort=foo,asc`; ngăn của máy khác | GET | — | 200 đúng lọc; 400 ×3; 404 | Đúng | Đạt | Không có lọc theo khoảng ngày / lô trong `/inventory/transactions` (không có trong contract) |
| INV-34 | FE sơ đồ máy E2E | Máy E2E, nạp 1 hộp lô TODAY vào B | Mở `/admin/inventory?machineId=…` | Cột A/B, "n/4 hộp", `HSD dd/MM/yyyy HH:mm` giờ VN, nhãn "Giảm giá hôm nay" chỉ trên hộp lô TODAY, "Máy chưa từng kết nối.", câu "Đang bật/tắt" | `discountEligibleToday` khớp nhãn | Đúng | Đạt | |
| INV-35 | FE nạp hộp (ADMIN) | Nút "Nạp hộp vào ngăn B", B2, 1 | Bấm "Nạp hộp" | Dòng "Ngăn B: còn trống x/5 chỗ"; toast "Đã nạp 1 hộp"; cột B tăng 1 | 201; body chỉ `batchId, slotId, quantity` | Đúng | Đạt | |
| INV-36 | FE nạp: số hộp sai | trống+1, 1001, `1,5`, 0 | Gõ / bấm | Câu tiếng Việt cạnh ô tương ứng ("chỉ còn trống…", "tối đa 1.000…", "không dùng dấu chấm hay dấu phẩy…", "từ 1 trở lên"); không gửi | — | Đúng; 0 POST | Đạt | |
| INV-37 | FE nạp: người khác vừa nạp đầy | Điền đủ chỗ trống, API nạp thêm 1, bấm | | "Ngăn B chỉ còn trống n chỗ (vừa tải lại), không đủ cho m hộp…" dưới ô số hộp, không hiện chuỗi tiếng Anh | 409 `SLOT_CAPACITY_EXCEEDED` | Đúng | Đạt | |
| INV-38 | FE nạp: ngăn vừa INACTIVE | API đổi ngăn B rồi bấm | | Câu "Ngăn B … nên không nạp được" dưới ô Ngăn, không có "Slot must be ACTIVE" | 409 | Đúng | Đạt | Ngăn được khôi phục ACTIVE |
| INV-39 | FE STAFF không nạp trực tiếp | STAFF mở sơ đồ máy E2E | | Không có nút "Nạp hộp"; câu "Nạp hộp làm qua phiếu nạp hàng được giao…" | (403 ở INV-08) | Đúng | Đạt | |
| INV-40 | FE rút hộp (STAFF) | Danh sách hộp ngăn B; lý do trống; "Hộp dập, hỏng"; rồi hộp bị rút ở nơi khác | | "Vui lòng nhập lý do rút hộp." không gửi; `maxlength=500`; toast "Đã rút hộp" body `{reason}`; lần sau 409 → "Hộp vừa đổi trạng thái… Dữ liệu đã tải lại." | 200; 409 | Đúng | Đạt | |
| INV-41 | FE lịch sử kho | máy E2E + ngăn A + LOAD; tải lại; `machineId=not-a-uuid&type=FOO` | | Bộ lọc nằm trên URL, tải lại giữ nguyên; bảng chỉ "Nạp hàng", giờ `dd/MM/yyyy HH:mm`; URL sai → ghi chú "Đường dẫn có bộ lọc không dùng được nên đã bỏ qua", không trắng trang | 200 | Đúng | Đạt | Màn không có lọc khoảng ngày / lô (đúng phạm vi issue 4.4 và contract) |
| INV-42 | FE sơ đồ M1 (chỉ đọc, STAFF) | Lọc ngăn A, tải lại | | "Máy mất kết nối (OFFLINE)…", chỉ còn cột A, không có `undefined/NaN/null` | 200 | Đúng | Đạt | Không ghi gì vào M1 |
| INV-17 | Gợi ý nạp hàng | ADMIN; STAFF; UUID 0 | GET restock-suggestions | — | 200 đủ trường; 403; 404 | Đúng | Đạt | |
| INV-18 | Tạo phiếu từ gợi ý | máy trống; máy E2E (ngăn B 1 hộp); thêm field `foo` | POST restock-work-orders | — | 409 `NOTHING_TO_RESTOCK`; 201 có dòng; 400 | Đúng | Đạt | |
| INV-19 | Dòng nạp: dữ liệu sai | -1; 6 (> sức chứa 5); sản phẩm lạ; INACTIVE; ngăn máy khác; trùng (A, Táo); thêm `loadedQuantity`; STAFF | POST restock-lines | — | 400 `fieldErrors.plannedQuantity`; 400 `plannedQuantity`; 404; 409 `PRODUCT_INACTIVE`; 400; 409 `DUPLICATE_LINE`; 400; 403 | Mã HTTP đúng hết, nhưng -1 trả khóa `addLine.input.plannedQuantity`; 6 trả 400 chỉ có message "plannedQuantity 6 exceeds the capacity 5 of slot B", không có `fieldErrors` | **Không đạt** | L-01, L-03 |
| INV-20 | Dòng nạp số lượng 0 | plannedQuantity 0 | POST restock-lines | FE chặn < 1 (INV-44) | Tài liệu cho 0–1000 | 201 (dòng 0 hộp được tạo) | Đạt (ghi nhận) | FE chặt hơn BE; dòng 0 hộp không có ý nghĩa nạp |
| INV-21 | Nạp theo dòng khi phiếu OPEN | | POST …/loads | — | 409 `WORK_ORDER_NOT_IN_PROGRESS` | Đúng | Đạt | |
| INV-22 | Nạp theo dòng khi IN_PROGRESS | lô Cam cho dòng Táo; lô hết hạn sau 3 phút; lô Táo hết hạn sớm hơn hộp trong cột (có/không xác nhận); sửa dòng đã nạp; số lượng 0 | POST …/loads, PATCH | — | 409 `BATCH_PRODUCT_MISMATCH`, 409 `BATCH_EXPIRED`, 409 `EXPIRY_INVERSION` rồi 201, 409 `LINE_ALREADY_LOADED`, 400 `fieldErrors.quantity` | Tất cả đúng, trừ số lượng 0 trả khóa `load.request.quantity` | **Không đạt** | L-01 |
| INV-23 | Hoàn tất phiếu lệch kế hoạch | planned 2, loaded 1; không lý do; lý do `␠␠␠`; thêm `version`; có lý do | POST /complete | — | 409 `RESTOCK_VARIANCE_REASON_REQUIRED` (tài liệu ghi 409, không phải 400); 400 `fieldErrors.lineVariances[0].reason`; 400; 200 DONE | Đúng, trừ khóa lỗi là `complete.request.lineVariances[0].reason` | **Không đạt** | L-01 |
| INV-24 | Lệnh bảo trì khi máy offline | Phiếu IN_PROGRESS (máy MAINTENANCE), OPEN_REFILL / REMOVE_ITEM / EMPTY_COLUMN | POST maintenance-commands | — | 409 `MACHINE_OFFLINE` | 409 "MACHINE_OFFLINE: the machine is not online" ×3 | Đạt | Khi máy chưa MAINTENANCE trả 409 `MACHINE_NOT_IN_MAINTENANCE` trước |
| INV-43 | FE tạo phiếu từ gợi ý | Loại "Nạp hàng", máy trống rồi máy E2E | "Tạo phiếu" | Máy trống: xem trước "Không có ngăn nào cần nạp…" và câu tiếng Việt cho 409, không có mã `NOTHING_TO_RESTOCK`; máy E2E: "Gợi ý nạp hàng của máy …", toast "Đã tạo phiếu công việc" | 409; 201 | Đúng | Đạt | Phiếu tạo ra được hủy |
| INV-44 | FE thực hiện phiếu nạp | Phiếu IN_PROGRESS dòng A/Táo/1 | Thêm dòng B/Cam/0; thêm dòng trùng A/Táo; xem bước Rút hộp cũ; đi tới Đối chiếu; Hoàn tất không lý do rồi có lý do | "Số hộp phải là số nguyên từ 1 trở lên." không gửi; 409 → "Ngăn này đã có dòng cho sản phẩm đó…"; khóa "Chưa gửi lệnh được / Máy chưa từng kết nối nên lệnh không tới được máy."; "Dòng này nạp khác kế hoạch: ghi lý do…" không gửi; hoàn tất → "Phiếu đã hoàn tất" | 409 `DUPLICATE_LINE`; 200 | Đúng | Đạt | |
| INV-25 | Giảm giá cận hạn (API) | GET STAFF/không token; PUT STAFF; percent 0, 91, `"50"`, 50.5, field lạ, thiếu version; version cũ; không đổi | GET/PUT | — | 200, 401, 403, 400 `fieldErrors.percent` ×2, 400 ×4, 409, 200 giữ version | Mã HTTP đúng hết; 0 và 91 trả khóa `update.request.percent`; thiếu version trả `update.request.version` | **Không đạt** | L-01 |
| INV-45 | FE sửa giảm giá | 0, 91, "abc"; người khác lưu xen giữa; STAFF | "Sửa cài đặt", "Lưu cài đặt" | "Nhập số nguyên từ 1 đến 90." không gửi PUT; 409 → "Cài đặt giảm giá vừa được người khác thay đổi…"; body chỉ `enabled, percent, version`; STAFF thấy cài đặt, không có nút sửa | 409 | Đúng | Đạt | Giá trị được khôi phục ngay (version tăng, `percent` vẫn 50) |

## Lỗi

| Mã | Phía | Mức | Mô tả | Tái hiện | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| L-01 | BE | Vừa | Lỗi validate tham số phương thức (method validation) trả khóa `fieldErrors` là đường dẫn Java `<method>.<param>.<field>` thay vì tên field của request: `addLine.input.plannedQuantity`, `updateLine.request.plannedQuantity`, `load.request.quantity`, `complete.request.lineVariances[0].reason`, `update.request.percent`, `update.request.version`. Lộ tên method/tham số nội bộ (không đúng chuẩn production) và FE không đặt được lỗi dưới đúng ô. Endpoint dùng `@Valid @RequestBody` (`/inventory/load`, `/inventory/{id}/remove`, `/product-batches`) trả đúng `quantity`/`reason`. | `PUT /api/v1/pricing/near-expiry-discount {"enabled":true,"percent":0,"version":0}` → `fieldErrors: {"update.request.percent": …}` | INV-19, INV-22, INV-23, INV-25 đỏ |
| L-02 | FE | Thấp | Hệ quả của L-01: `AddLine` gọi `form.setErrors(error.fieldErrors)` với khóa lạ nên không đánh dấu ô nào; `describeLineLoadError`/`describeCompleteError` tìm `fieldErrors.quantity` / `resultNote` nên rơi về thông báo chung tiếng Anh "Request validation failed" từ `client.ts`. Hiện không gặp vì FE chặn trước khi gửi (INV-44, INV-45). | Chỉ xảy ra khi kiểm tra phía client lệch với BE | `src/admin/pages/TicketRestockPage.tsx` (AddLine), `src/admin/restock.ts` (describeLineLoadError, describeCompleteError) |
| L-03 | BE | Thấp | `plannedQuantity` vượt sức chứa ngăn trả 400 chỉ có `message` "plannedQuantity 6 exceeds the capacity 5 of slot B", không có `fieldErrors.plannedQuantity`; tương tự lô hết hạn khi tạo lô (`Batch must not already be expired`) không có `fieldErrors.expiresAt`. FE phải so chuỗi tiếng Anh. | `POST /work-orders/{id}/restock-lines {"slotId":B,"productId":…,"plannedQuantity":6}` | INV-19, INV-02 |
| L-04 | BE | Thấp (cần xác nhận nghiệp vụ) | Nạp trực tiếp `/inventory/load` cho phép nạp lô sản phẩm khác vào ngăn đang có sản phẩm khác (cột trộn 2 sản phẩm); đường nạp theo phiếu thì chặn theo dòng (`BATCH_PRODUCT_MISMATCH`). FE sheet nạp cũng không cảnh báo. | Ngăn A có Táo, `POST /inventory/load {batchId: lô Cam, slotId: A, quantity: 1}` → 201 | INV-13 |
| L-05 | BE | Thấp | Thông báo 409 của nạp trực tiếp không có tiền tố mã (`Batch is expired`, `Slot must be ACTIVE for loading`, `Product must be ACTIVE`) trong khi nạp theo phiếu có (`BATCH_EXPIRED: …`, `SLOT_INACTIVE: …`). FE phải giữ hai bộ so khớp. 400 cho field lạ chỉ nói "Request body is missing or malformed", không nêu field. | | INV-06, INV-11, INV-12, INV-14 |

## Khác biệt so với production

- BE local trả `error`, `path`, `timestamp` trong mọi lỗi; không thấy stack trace, tên class hay SQL trong bất kỳ phản hồi lỗi nào đã gọi.
- Máy E2E và M1 không có firmware nên mọi lệnh bảo trì dừng ở 409 `MACHINE_OFFLINE`; luồng mở/đóng cổng nạp và rút hộp bằng lệnh chưa
  kiểm được tới trạng thái COMPLETED.
- Lô hết hạn chỉ thử được bằng lô cũ có sẵn trong DB (BE không cho tạo lô hết hạn); "lô hết hạn trong 5 phút" thử bằng lô hết hạn sau 3 phút.
- Cài đặt giảm giá là chung cho cả hệ thống; INV-45 đổi rồi khôi phục trong vài trăm ms (version tăng 2 mỗi lần chạy).
