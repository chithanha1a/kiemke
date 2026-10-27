> Bản 49 bổ sung xác minh version/build và chọn in QR bằng checkbox. Đọc DEPLOY_DUNG_PHIEN_BAN.md.

# Giao diện quản trị và scan — phiên bản 48.0.0

## Nội dung thay đổi

- Trang quản trị dùng thanh điều hướng bên trái trên desktop, thanh điều hướng ngang trên điện thoại, màu xanh navy/blue đồng bộ với ứng dụng scan.
- Site đang làm việc luôn hiển thị phía trên; nút mở scan rõ ràng. Tạo site bằng hộp thoại; khi chưa có site có hướng dẫn và nút tạo site đầu tiên.
- Danh mục thiết bị có bảng thực, tìm kiếm, 20/50/100 dòng/trang, phân trang, trạng thái, xuất CSV và form chỉnh sửa các trường thông dụng. Các cột ngoài template vẫn được giữ và có thể sửa trong mục JSON bổ sung.
- Import chia bước: chọn file, xem trước bảng 5 dòng, chọn barcode có sẵn hoặc ghép cột, xem mã đầu tiên rồi xác nhận import. Thông báo chỉ rõ giới hạn và site nhận dữ liệu.
- In QR có danh sách chọn nhiều, chọn tất cả/bỏ chọn, thống kê số nhãn và số trang A4, minh họa đúng 3×8 nhãn; PDF dùng engine đã kiểm thử ở bản trước.
- Tài khoản hiển thị bằng bảng tên/quyền/site/trạng thái; tạo tài khoản bằng form, chọn người dùng để khóa/mở khóa/reset mật khẩu. Không bắt người dùng nhập ID hoặc đọc JSON để quản lý tài khoản.
- Nút đang xử lý được khóa chống bấm lặp; thông báo lỗi hiện ngay trong hộp thoại; thông báo thành công chỉ hiện khi có thao tác, không hiện nếu hủy xác nhận.
- Màn hình scan tiếp tục dùng assets/css/style.css và assets/js/app.js của bản gốc: 4 tab QR, thiết bị đã scan, OCR, Setting; camera, queue, ghi chú, cache và đồng bộ giữ nguyên. Chỉ bổ sung thanh quay lại quản trị và tên site gọn phía trên; không áp CSS trang quản trị vào scanner.
- Đăng nhập được đồng bộ typography/khoảng cách và hỗ trợ màn hình nhỏ. Luồng tạo admin 47.1 được giữ.

## Cập nhật trên Cloudflare web

1. Giải nén gói mới, mở repository GitHub đã liên kết Cloudflare.
2. Upload/commit các file giao diện và source mới. Đặc biệt phải cập nhật src/admin.js vì Cloudflare build lại public/admin.js từ file này.
3. Giữ nguyên database_id thật trong wrangler.jsonc hiện tại của anh. Không thay bằng REPLACE_WITH_D1_ID từ file mẫu của ZIP.
4. Để Cloudflare Builds chạy npm run build và deploy như cấu hình hiện có.
5. Mở website bằng Visit và Ctrl+F5. Có thể kiểm tra /auth/setup-status trả data.version = 49.0.0.
6. Tài khoản, site, dữ liệu đã có tiếp tục dùng database hiện tại. Bản cập nhật giao diện không yêu cầu chạy lại script tạo admin hoặc xóa dữ liệu.

Các file chính đã thay đổi: src/admin.js; public/index.html; public/ui.css; public/admin.js (build output); public/login.html; public/scanner.html; public/session.js; public/assets/css/style.css. src/worker.js chỉ cập nhật metadata phiên bản của endpoint kiểm tra, không thay đổi SQL hay phân quyền.

## Xác minh

- 31 unit/schema/crypto/QR/PDF tests PASS.
- 23 checks trong luồng browser chính: đăng nhập, site, import XLSX, chỉnh sửa bằng form, tìm kiếm/phân trang, CSV/PDF, responsive, giữ scanner, QR/OCR, offline queue replay.
- 16 checks browser bổ sung: site trống, tự chọn site mới, ẩn/hiện ghép cột barcode, tạo và quản lý tài khoản, quyền scanner, 4 tab scan, nhãn site, khóa/mở khóa, cài đặt cá nhân.
- 0 uncaught page errors trong các suite browser trên.
- Kiểm tra bố cục nội bộ trên Chromium desktop 1280 px và điện thoại 390 px; bảng rộng cuộn trong vùng bảng, không đẩy tràn toàn trang.
- Camera vật lý, Safari/iOS/Android và Cloudflare account thật chưa được nghiệm thu trong lần sửa này.

Không có screenshot, database local hay mật khẩu test được đưa vào thư mục public hoặc gói ZIP phát hành. ADMIN_ACTIVATION.txt vẫn là thông tin khởi tạo từ bản trước: giữ riêng, không upload file này lên GitHub/public.
