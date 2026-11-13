# Thiết kế web FreshVend

Hướng đã duyệt: `docs/design/redesign-brief.md` (Tailwind CSS v4 + shadcn/ui + lucide, kiểu Stripe/Vercel, nền sáng, có dark mode). Tài liệu này mô tả hệ token và component **đang chạy**; khi code và tài liệu lệch nhau, sửa tài liệu cùng PR.

## Bề mặt

| Bề mặt | Đường dẫn | Mã nguồn | Theme |
| --- | --- | --- | --- |
| Quản trị (ADMIN/STAFF) | `/admin/*` | `src/admin` (khung `shell/AdminShell.tsx`, bộ phận chung `kit.tsx`, màn `pages/`) | Sáng/tối/theo hệ thống |
| Đăng nhập | `/login` | `src/pages/LoginPage.tsx` | Sáng/tối |
| Báo sự cố (điện thoại của khách) | `/bao-su-co` | `src/pages/IncidentReportPage.tsx` | Sáng/tối |
| Landing | `/` | `src/pages/LandingPage.tsx` | Luôn sáng |
| Kiosk | `/buy` | `src/pages/PurchasePage.tsx`, `src/kiosk` | Luôn sáng, màn 1280×800 |
| 404 và màn chờ tải route | còn lại | `src/App.tsx`, `src/lib/route-message.ts` | Sáng |

## Nguồn style

Chỉ có hai file CSS, cả hai nạp ở `src/main.tsx` (theo thứ tự này):

- `src/styles/app.css`: Tailwind v4, `tw-animate-css`, biến thể `dark` (class `.dark` trên `<html>`), token `--ui-*` sáng/tối, `@theme inline` ánh xạ token sang utility (`bg-primary`, `text-muted-foreground`, `bg-status-warning`…), lớp base `.ui-root` (font Inter, viền, vòng focus), View Transitions và quy tắc giảm chuyển động.
- `src/index.css`: reset tối thiểu (`h1, h2, p { margin: 0 }`, focus nút), token thương hiệu `--ink --muted --brand --surface --identity --border --error` cho landing/kiosk/404, `@font-face` Source Serif 4 (tiêu đề landing), thang tiêu đề khu quản trị (`.admin-app h1` 24px, `h2` 16px) và CSS riêng của kiosk (mọi class `buy-*`, chỉ `PurchasePage.tsx` dùng).

Mọi thứ khác viết bằng utility Tailwind trong TSX. Không tạo file CSS theo trang, không thêm class toàn cục mới. CSS cũ (`admin.css`, `App.css`, `LandingPage.css`, `PurchasePage.css`, class `a-*`, `.route-message`, kiểu nút/ô nhập `.admin-app button:not([data-slot])`) đã gỡ ở FE 9.4 và được khóa bởi `tests/legacy-css.test.mjs` cùng `scripts/check-dist.mjs` (chạy trong `npm run build`).

Quy tắc cascade cần nhớ: rule không có layer trong `index.css` thắng utility Tailwind. Muốn đổi lề của `<p>`/`<h1>`/`<h2>` hoặc cỡ tiêu đề trong khu quản trị thì thêm `!` (ví dụ `mb-2!`, `my-4!`).

## Token màu

OKLCH, hue xanh lá 152–163. Chiến lược màu Restrained: nền trung tính, xanh lá chỉ cho nút chính, mục đang chọn và trạng thái; đỏ/vàng/xanh dương chỉ cho lỗi, cảnh báo, thông tin.

- Bề mặt: `background`, `card`, `popover`, `muted`, `accent`, `secondary`, `sidebar`, `sidebar-accent`.
- Chữ: `foreground`, `muted-foreground`, `*-foreground` đi kèm từng nền.
- Tương tác: `primary`, `ring` (vòng focus), `input`, `border`.
- Ngữ nghĩa: `destructive`, `success`, `warning`, `info`.
- Huy hiệu trạng thái: cặp đặc `status-{success,warning,danger,info,neutral}` + `-foreground`, tương phản không phụ thuộc nền bên dưới (khóa bởi `tests/status.test.mjs`).
- Dark mode đổi giá trị trong `.dark`; `destructive-foreground` tối dùng chữ đậm vì chữ trắng trên đỏ sáng chỉ khoảng 3,6:1.
- Landing/kiosk/404 dùng token thương hiệu của `index.css`; landing thêm `--landing-line`, `--landing-dark` ở gốc trang, kiosk thêm `--buy-green`, `--buy-line` trên `.buy-app`.

Mọi cặp chữ/nền phải đạt ≥ 4,5:1 (axe trong e2e kiểm cả sáng và tối).

## Chữ

- Quản trị: Inter Variable tự host (`@fontsource-variable/inter`, nạp cùng chunk quản trị), 14px/1,5, số dạng `tabular-nums` trong bảng và số liệu. Tiêu đề trang 24px, tiêu đề mục 16px.
- Đăng nhập, báo sự cố: sans-serif hệ thống (Segoe UI, system-ui), nhãn 15px, ô nhập cao 48–54px.
- Landing: tiêu đề Source Serif 4 600 (latin + vietnamese, tự host), thân sans-serif hệ thống.
- Kiosk: Segoe UI, thân 16px, tiêu đề 26–38px, số tiền và mã đơn lớn, tabular.

## Component

`src/components/ui` (shadcn/Radix, mỗi phần tử gốc có `data-slot`): `Button` (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`; cỡ `default`, `sm`, `lg`, `icon`, `icon-sm`), `Input`, `NativeSelect`, `Textarea`, `PasswordInput`, `FormField` (nhãn, gợi ý, lỗi gắn ARIA), `FilterBar`, `DataTable` (sắp xếp phía server, thẻ trên màn hẹp qua container query 680px), `StatusBadge`, `PriceTag`, `Tabs`, `Dialog`, `AlertDialog`, `Sheet`, `Popover`, `DropdownMenu`, `Command` (Ctrl+K), `Tooltip`, `Skeleton`, `Separator`, `Kbd`, `Toaster` (Sonner).

`src/admin/kit.tsx` ghép các component trên thành bộ phận màn quản trị: `PageHead`, `Field`, `Notice`, `Loading`, `TableSkeleton`, `PageSkeleton`, `ErrorState`, `Forbidden`, `DataTable`, `Pagination`, `SelectFilter`, `SearchFilter`, `DateFilter`, `Toolbar`, `FormDialog`, `FormSheet`, `ConfirmDialog`, `StatusDialog`, `Badge`, `Link`. Xem mẫu sống ở `/admin/_kit` (chỉ chế độ dev và mock, không có trong bản build thật).

Tab điều hướng giữa hai route (ví dụ Tồn kho: Hộp hàng / Lịch sử) là `<nav>` liên kết dạng segmented (nền `muted`, mục hiện tại nền `card`); tab trong cùng màn dùng `Tabs`.

## Quy ước trạng thái

Mỗi màn có đủ:

- **Đang tải:** lần đầu là skeleton đúng hình (`TableSkeleton`, `PageSkeleton`, shimmer 1,5s); tải lại giữ dữ liệu cũ, thanh tiến trình mảnh trên cùng bảng; nút đang gửi có spinner và bị khóa.
- **Rỗng:** câu giải thích và bước tiếp theo.
- **Lỗi API:** `ErrorState`/`Notice tone="error"` kèm "Thử lại"; tải lại lỗi thì giữ dữ liệu cũ và nói rõ.
- **400:** lỗi dưới từng ô (`FormField`), focus ô lỗi đầu tiên.
- **409:** giải thích trạng thái vừa đổi, tải lại, báo bằng toast hoặc trong hộp thoại.
- **403:** `Forbidden` (nêu quyền thiếu); **401:** chuyển về đăng nhập và quay lại URL cũ.
- **Thành công:** toast Sonner. Thao tác nguy hiểm (thu hồi khóa, gỡ hộp, khóa tài khoản) qua hộp xác nhận ghi rõ hậu quả. Không có thao tác xóa.
- Nút bị khóa có lý do dùng `aria-disabled` (vẫn focus được) và chỉ tới khối lý do.

Định dạng: tiền `35.000 ₫`, giờ `Asia/Ho_Chi_Minh` dạng `09/11/2026 13:05` (`src/lib/format.ts`); thuật ngữ "hộp", "ngăn"; nhãn trạng thái tiếng Việt từ `src/lib/status.ts`.

## Bố cục

- Quản trị: sidebar thu gọn được (drawer `Sheet` trên điện thoại), thanh trên có breadcrumb, Ctrl+K, chuông cảnh báo, đổi theme, tài khoản. Nội dung `max-w-[1400px]`, lề 16/24/32px. Danh sách: tiêu đề + nút chính, thanh lọc, bảng, phân trang; bộ lọc lưu trên URL. Bảng thành thẻ dưới 680px.
- Đăng nhập: hai cột 45/55 từ 761px, một cột ở dưới; minh họa trái cây WebP trong `src/assets`.
- Báo sự cố: một cột cho điện thoại (390px), ô nhập cao 48px.
- Không vỡ bố cục ở 390/768/1440px; kiosk thiết kế cho 1280×800 và vẫn dùng được ở màn hẹp.

## Kiosk `/buy`

Ngoại lệ có chủ đích: màu Committed (xanh `--buy-green` đậm hơn), luôn nền sáng, mọi điều khiển ≥ 64px, toàn màn hình không cuộn (`.buy-screen`), sản phẩm phân trang 2 cột. Màn thanh toán hai cột (tóm tắt + QR lớn, đồng hồ đếm), màn kết quả/trạng thái máy có biểu tượng, câu giải thích, bước tiếp theo và nút báo sự cố. Tiêu đề nhận focus bằng script khi đổi màn (không vẽ vòng focus); điều khiển có vòng focus 3–4px. Chi tiết luồng: `docs/purchase-flow.md`.

## Landing

Hướng A (`docs/design/landing-directions-v1.png`): hero lệch, dải quy trình xanh trầm, ảnh không gian cho phần hợp tác, tiêu đề Source Serif 4. Utility Tailwind + `Button`, token thương hiệu; cuộn mượt theo neo khi không giảm chuyển động. Chi tiết: `docs/landing-page.md`.

## Chuyển động

150–250ms, ease-out, luôn gắn với thay đổi trạng thái và không chặn thao tác. Chuyển trang khu quản trị bằng View Transitions (chỉ vùng nội dung mờ và trượt 8px, Back chạy ngược). Sheet/dialog/menu mờ kèm phóng nhẹ (`tw-animate-css`). Khi bật giảm chuyển động: chỉ còn đổi độ mờ, tắt trượt, phóng, shimmer và cuộn mượt.

## Truy cập

Dùng được toàn bộ bằng bàn phím, focus luôn thấy rõ (`ring` 2px trong `.ui-root`, 3px trên landing/kiosk), Esc đóng Sheet/dialog, vùng chạm ≥ 44px trên điện thoại (≥ 64px ở kiosk), thông báo động qua `role="status"`/`aria-live`. Payload webhook chỉ hiện dạng text đã escape trong `<pre>`.
