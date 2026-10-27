# Bổ sung giao diện 48.0.0 — 27/10/2026

31 unit tests PASS; 23 checks browser cho luồng chính và 16 checks browser cho giao diện/quyền/tài khoản PASS, 0 uncaught page errors. Đã kiểm tra desktop/mobile và giữ 4 tab scanner. Chi tiết ở CAP_NHAT_GIAO_DIEN.md. Camera thật và Cloudflare production chưa được kiểm thử trong lần sửa giao diện này.

# Bổ sung kiểm thử admin 47.1.0 — 27/10/2026

- 31/31 unit/schema/crypto/QR/PDF tests PASS, bao gồm 8 ca mới cho token thiếu/rỗng/sai/trim, trạng thái DB/schema, chặn khởi tạo lặp, thông báo users trống và tạo admin bằng SQL.
- 133 API requests / 167 assertions PASS trên Worker + D1 local sau thay đổi bootstrap (201 khi tạo, 409 khi admin đã tồn tại).
- SQL được chạy trên SQLite schema thực của dự án và tài khoản sinh ra đã đăng nhập thành công qua hàm Worker; chạy lại không thêm tài khoản hoặc đổi hash hiện có.
- Kiểm thử Chromium trên database local trống: trạng thái chưa có admin → token sai báo riêng → token đúng có khoảng trắng tạo admin → xóa token/password khỏi form → đăng nhập vào trang quản trị; PASS, 0 uncaught page errors.
- Wrangler deploy --dry-run PASS.
- Không tự tạo admin trên Cloudflare thật. Cần người quản trị chạy SQL trong D1 Console hoặc thực hiện form khởi tạo với token đúng.
- Các kết quả kiểm thử bản 47.0.0 được giữ ở phần dưới, không coi là đã chạy lại browser/camera cho mọi thay đổi trong bản này.

# Báo cáo kiểm thử Kiểm kê Cloudflare 47.0.0

Ngày: 26/10/2026. Đối tượng: bản KiemKe_Cloudflare_Source.zip đã gửi trước đó, được khôi phục và sửa trong đợt rà soát này. Không thao tác lên tài khoản Cloudflare production của người dùng.

## Kết quả

| Nhóm | Kết quả | Phạm vi |
|---|---|---|
| Unit / dữ liệu / schema / QR / PDF | 23/23 PASS | Barcode có sẵn/ghép, lỗi nhập, giới hạn batch, Unicode, Excel giữ số 0, bảng OCR, thời gian VN, CSV, QR roundtrip, A4, schema idempotent và constraints |
| API trên Wrangler + D1 local | 133 requests, 167 assertions PASS | Auth, bootstrap, trang quản trị, quyền, site, import transaction, scan, sửa/xóa, lọc/xuất, retry, khóa/reset, rate limit, 10 requests đồng thời |
| Luồng trình duyệt Chromium headless | 20 checks PASS, 0 uncaught page errors | Login, tạo site, import XLSX, sửa, xuất CSV/PDF, scan page, parser cũ, cache, offline capture/replay, nhận dạng QR ảnh, OCR eng, barcode dấu nối/Unicode, ghim scope |
| PDF sau render | 24/24 QR trang 1 đọc lại đúng | PDF 25 nhãn = 2 trang A4, render 120 DPI bằng Poppler; đọc từng nhãn bằng jsQR |
| Dependency audit | 0 advisory được npm audit báo | Kết quả tại thời điểm kiểm thử, không phải chứng nhận an toàn tuyệt đối |
| Cài đặt/build | PASS | npm ci từ lockfile, npm run build, JS syntax check, Wrangler deploy --dry-run |

## Lỗi đã sửa

1. Trang /, /admin.js, /session.js và /scanner.html bị chặn bởi yêu cầu chọn site trước khi tải giao diện. Tách kiểm tra tài nguyên giao diện khỏi kiểm tra quyền dữ liệu.
2. Root / trả 404 khi assets.html_handling=none. Định tuyến rõ / đến /index.html sau xác thực.
3. jsQR và Tesseract vendor của bản trước chỉ là placeholder. Đóng gói thư viện thật, worker/WASM và ngôn ngữ eng/vie cùng ứng dụng; đã thử QR ảnh và OCR canvas trong trình duyệt.
4. Barcode chứa dấu nối/Unicode bị chuẩn hóa làm mất ký tự trong cache và queue. Thêm chỉ mục barcode nguyên văn trong IndexedDB, giữ mã nguyên văn khi chống trùng; A-B và AB không còn bị gộp. Nâng DB version lên 10 và giữ queue hiện có khi upgrade.
5. Import lỗi dữ liệu trả 500 chung chung. Kiểm tra input và trả 400; trùng unique trả 409, toàn bộ D1 batch rollback.
6. Chưa ràng buộc method cho các lệnh ghi. Bắt buộc POST cho thao tác thay đổi dữ liệu; chặn Origin khác và JSON lỗi/quá lớn.
7. Quét có thể chống trùng lệch khi lookup_key hoặc biểu diễn múi giờ thay đổi. Dùng barcode canonical của tài sản khi có; chuẩn hóa timestamp, ngày kiểm kê theo Asia/Ho_Chi_Minh.
8. Hai lần quét đồng thời có thể ghi lùi thời gian. UPDATE có điều kiện timestamp tại SQL, đã kiểm tra 10 request đồng thời giữ 1 bản và giờ mới nhất.
9. Xuất kiểm kê chưa áp dụng đủ bộ lọc và thiếu site trong điều hướng tải file của admin. Dùng chung bộ lọc với danh sách, truyền site cho URL download, giữ quyền server. Bổ sung các trường QR/máy/phòng ban/ghi chú trong CSV.
10. CSV formula protection làm mất ký tự đầu. Đổi sang thêm dấu nháy trước nội dung nguy hiểm, không cắt text gốc.
11. Sửa bảng OCR chưa cập nhật raw_text/row_count và thiếu validation. Đồng bộ các trường cùng bảng đã sửa.
12. Trang scan cho nhập lại tên dù tài khoản đã xác thực. Hiển thị tên tài khoản readonly và chỉ chỉnh phòng ban.
13. Scope gửi API có thể thay đổi khi trang scan cũ vẫn mở. Ghim site của trang, chặn gửi nếu sessionStorage bị đổi; kiểm tra identity/site trước khi chạy queue.
14. Bảng tạo thủ công trên Dashboard có thể xung đột với migration. Dùng schema idempotent, cung cấp database/CREATE_TABLES_DASHBOARD.sql; kiểm tra chạy lại không xóa dữ liệu.
15. Dependency audit báo SheetJS cũ và undici trong bộ công cụ dev. Chuyển SheetJS sang bản 0.20.3 từ CDN chính thức, khóa override undici 8.12.3 và chạy lại Wrangler/API/browser. Yêu cầu Node >=22.19; môi trường kiểm thử Node 24.

## Các kịch bản API cụ thể

- Không đăng nhập: API trả 401, trang chính chuyển đến login. Đăng nhập xong tải được trang quản trị khi chưa có site.
- Setup token sai/ mật khẩu ngắn bị chặn; bootstrap lần hai không tạo admin thứ hai.
- Admin tạo được site, user; scanner không tạo site/user/import/khóa user.
- Scanner giả X-Site vẫn bị ràng buộc site của tài khoản. Manager site B không xem/sửa/xóa dữ liệu site A.
- Scanner không sửa/xóa bản scan của tài khoản khác dù cùng site.
- Cùng barcode/serial có thể tồn tại trong hai site và không đọc lẫn.
- Import cập nhật theo barcode; trùng serial với barcode khác hủy toàn batch. Các trường bổ sung giữ nguyên.
- Quét lại cùng client_scan_id giữ ID; quét lại trong ngày giữ ID và cập nhật giờ gần nhất. Payload giả scan_user không thay đổi người ghi thực tế.
- JSON lỗi, bảng quá kích thước, barcode lỗi, cột ghép thiếu, date lỗi, method sai và cross-origin đều bị chặn.
- Khóa user hủy phiên; mở lại + reset mật khẩu chỉ đăng nhập bằng mật khẩu mới. Logout hủy phiên; 10 lần đăng nhập sai dẫn đến rate limit.
- Kiểm tra xuất kiểm kê theo ngày/source và tìm kiếm.

## Cách tái chạy trên local

Các test API/browser chỉ dành database test local. Không đổi TEST_URL sang production; test có guard localhost/127.0.0.1.

1. Cài Node 24, npm ci; tạo .dev.vars chứa SETUP_TOKEN="local-test-only-setup-token".
2. npm run build
3. npm test
4. npx wrangler d1 migrations apply kiemke --local
5. npm run dev
6. Terminal khác: npm run test:api
7. Cài browser test: npx playwright install chromium
8. npm run test:browser
9. Nếu đã cài Poppler: node tests/pdf-render.mjs
10. npx wrangler deploy --dry-run

API test tạo admin local tên admin / test-password-123 nếu database trống, cùng dữ liệu synthetic có hậu tố timestamp. Browser test dùng admin local này. Database, .dev.vars, test artifacts và screenshots không nằm trong ZIP phát hành.

Môi trường chạy tại đây có hạn chế networkInterfaces và lưu trạng thái process khi dùng Wrangler. Đã dùng shim network interface local và khởi tạo schema SQLite local để tiếp tục kiểm thử runtime D1 thực; shim không nằm trong source phát hành. Kiểm thử schema riêng chạy trực tiếp SQLite in-memory, bao gồm tạo mới/chạy lại. Chưa xác nhận migration trên D1 remote.

## Giới hạn của kết luận

- Chưa deploy/chạy test trên Cloudflare account thật; chưa kiểm tra hạn mức, token, DNS/custom domain hoặc billing của người dùng.
- Camera thật, Safari/iOS/Android, độ bền dữ liệu khi OS xóa browser storage và thao tác máy in thật chưa được kiểm thử.
- OCR đã thử ảnh canvas tiếng Anh sạch; mô hình vie đã đóng gói nhưng chưa đánh giá độ chính xác tiếng Việt/ảnh thực tế. QR dài và điều kiện ánh sáng cần nghiệm thu.
- Kiểm thử đồng thời là 10 yêu cầu trên local, không phải chứng nhận tải production hay pentest độc lập.
- Chưa chuyển lịch sử/ảnh hoặc kết nối LAN từ bản PHP; không lưu ảnh lên cloud. Không hỗ trợ mở lại/đăng nhập mới khi hoàn toàn offline.
- Data site là cách ly ở tầng ứng dụng trong cùng D1. Admin được phép truy cập mọi site; cache máy người dùng vẫn cần quản lý thiết bị.

Kết luận: các kịch bản đã thực thi nêu trên đạt sau sửa lỗi. Cần nghiệm thu các mục chưa kiểm thử trước khi đưa vào sử dụng chính thức. Hướng dẫn triển khai web và tạo D1 nằm trong HUONG_DAN.md.
