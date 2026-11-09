# Hợp đồng nháp (draft)

API mà frontend cần nhưng backend chưa có. Nguồn chính thức vẫn là `../api.yaml`.

## Quy ước

- Mỗi nhóm API một file `<nhóm>.yaml`, là OpenAPI 3.1 độc lập (tự khai báo schema nó dùng, kể cả khuôn `{ data, timestamp }` và `ApiErrorResponse`).
- Issue nào cần API mới thì thêm draft trong chính issue đó. Không vẽ trước API của milestone sau.
- Sinh type sau mỗi lần sửa: trong `apps/web` chạy `npm run gen:api:drafts`, kết quả nằm ở `apps/web/src/api/drafts/<nhóm>.d.ts` và được commit.
- Mock (`apps/web/src/api/mock`) có handler theo draft để màn hình chạy được trước khi có backend.
- Khi backend xong: đưa path vào `api.yaml`, chạy `npm run gen:api`, xóa file draft và file `.d.ts` tương ứng, chuyển code sang type trong `schema.d.ts`.

## Danh sách

| File | Endpoint | Issue | Trạng thái |
| --- | --- | --- | --- |
| `auth-me.yaml` | `GET /api/v1/auth/me` | FE 2.1 | Đề nghị BE thêm mới |
