# Xử lý ảnh giao diện cũ, ô chọn trống và cảnh báo trình duyệt — 49.0.0

## Kết luận từ ảnh người dùng

Ảnh vẫn có tài khoản dạng JSON, tiêu đề in QR và form nhập dữ liệu dàn trên một trang, cùng link scan “Quản trị / Chọn site” dạng mặc định. Đây là dấu hiệu của giao diện trước bản quản trị 48/49; không phải bố cục sidebar/bảng/form của gói mới. Không xác định được nguyên nhân cụ thể là source đặt sai thư mục, bản chưa được activate hay tài nguyên cũ chỉ từ ảnh. Truy cập đọc website bằng công cụ của phiên kiểm tra nhận HTTP 403, nên chưa kiểm chứng được nội dung Production hoặc dữ liệu thật.

Gói 49 thêm dấu phiên bản ở HTML, kiểm tra build và 2 đường dẫn công khai chỉ đọc để phân biệt những tình huống này.

## 1. Cập nhật đúng source bằng GitHub web

1. Giải nén ZIP mới. Tìm thư mục có **package.json, wrangler.jsonc, src/, scripts/, public/**.
2. Mở GitHub repository đang được Worker **kiemke-cloudflare** sử dụng. Kiểm tra nơi package.json đang nằm, rồi thay đúng các file/thư mục mới tại nơi đó. Không chỉ upload ZIP hoặc tạo thêm một thư mục lồng mà vẫn để source cũ ở thư mục Cloudflare đang build.
3. Giữ nguyên **database_id thật** trong wrangler.jsonc của anh. Không thay bằng REPLACE_WITH_D1_ID từ gói mẫu.
4. Không upload ADMIN_ACTIVATION.txt, .dev.vars, node_modules, .wrangler, database local hoặc screenshots.
5. Kiểm tra public/index.html trên GitHub có **data-console-version="49.0.0"** và scripts/build.mjs có thông báo “Release”. src/version.js phải khai báo APP_VERSION = '49.0.0'.
6. Commit thay đổi lên nhánh main (hoặc nhánh Production đã cấu hình).

## 2. Cấu hình Cloudflare Builds

Worker → Settings → Builds:

| Mục | Giá trị |
|---|---|
| Repository | Repository thực sự có source vừa cập nhật |
| Production branch | main hoặc nhánh Production anh đang dùng |
| Root directory | Gốc nếu package.json nằm ở gốc; cloudflare nếu package.json nằm trong thư mục cloudflare |
| Build command | npm run build |
| Deploy command | npx wrangler d1 migrations apply kiemke --remote && npx wrangler deploy |

Build log phải có: **Release 49.0.0 • build ...**. Nếu không thấy dòng này, kiểm tra lại root directory, source trên nhánh được build hoặc build command. Bản build mới cũng kiểm tra marker trong HTML và dừng khi public/index.html/scanner.html không đồng bộ.

Sau build thành công, mở **Deployments** và bảo đảm version vừa phát hành là **Active Deployment** phục vụ Production. Upload một version hoặc tạo preview chưa chắc đã đưa version đó vào Production; deploy command cần thực hiện deploy.

## 3. Xác minh ngay bằng trình duyệt

Mở URL từ nút Visit, rồi thêm các đường dẫn sau:

```
/version.json
/health/version
```

Cả hai phải trả JSON có **version = 49.0.0** và **build_id giống nhau**. Hai URL chỉ trả thông tin bản phát hành, không trả token, password, danh sách tài khoản hoặc dữ liệu thiết bị.

- Cả hai đều lỗi/không có 49.0.0: chưa chạy source mới hoặc đang dùng sai URL Worker/preview.
- version.json mới nhưng health/version cũ: tài nguyên và backend chưa đồng bộ, phải deploy cùng Worker + assets.
- Hai đường dẫn đúng mà giao diện cũ: đóng tab cũ, Ctrl+F5, kiểm tra Cache Storage/Service Worker cũ. Chỉ unregister service worker của chính website nếu có, không xóa IndexedDB/localStorage khi còn bản scan chưa đồng bộ.
- Giao diện mới kiểm tra phiên bản backend lúc khởi động, khóa thao tác khi không khớp và hiển thị thông báo tải lại/cập nhật.

Trang quản trị có nhãn **v49.0.0** ở phần tài khoản; Cài đặt cá nhân hiển thị build đang chạy.

## 4. Những gì đã hoàn thiện trong giao diện

- Quản trị theo từng mục, tài khoản hiển thị bằng bảng và quản lý theo tên, không phải JSON.
- Import có preview, trạng thái tải dữ liệu, thông báo rõ site và barcode; không có ô chọn co hẹp khi chưa có dữ liệu.
- In QR dùng danh sách checkbox có tìm kiếm và chọn tất cả/bỏ chọn, thuận tiện trên điện thoại. Khi danh mục trống, hiển thị hướng dẫn đi đến import thay vì một select rỗng. Hiển thị số nhãn và số trang A4 dự kiến.
- Thanh quản trị được cố định gọn trên desktop; biểu tượng, khoảng cách, trạng thái lỗi và hành động nhất quán.
- Scan giữ 4 tab, camera, ghi chú, queue offline, OCR và đồng bộ gốc; thanh quay về quản trị và site được định dạng cùng font/màu. Không đưa CSS quản trị vào scanner.
- HTML, script khởi động và đường dẫn phiên bản không cache để giảm nguy cơ dùng nhầm file giao diện cũ.

## 5. Nhãn “Dangerous” trên thanh địa chỉ

Ảnh có cảnh báo an toàn của trình duyệt. Không có bằng chứng từ ảnh để khẳng định nguyên nhân là malware, phishing, file CSS hay false positive. Đổi giao diện, thêm HTTPS hoặc thêm security headers không tự xóa cảnh báo này.

Người quản trị nên:
1. Kiểm tra URL được cảnh báo bằng Google Safe Browsing/Google Search Console và phần Security Issues nếu trình duyệt dùng Safe Browsing.
2. Kiểm tra source thực trên repository, bản Active Deployment, nội dung chuyển hướng/tài nguyên bị chèn và các URL cụ thể mà báo cáo nêu. Đánh giá cả nội dung website đang phục vụ, không chỉ source trong ZIP.
3. Xử lý các vấn đề phát hiện, sau đó gửi Request Review trong Security Issues; nếu bị đánh dấu nhầm, sử dụng kênh báo cáo nhầm của nhà cung cấp cảnh báo.
4. Giữ tính năng bảo vệ trình duyệt hoạt động. Không yêu cầu người dùng bỏ qua cảnh báo hoặc nhập mật khẩu khi chưa xác minh an toàn.

Bản sửa đặt X-Content-Type-Options, X-Frame-Options và Referrer-Policy phù hợp, nhưng không tuyên bố website Production đã được gỡ cảnh báo hoặc đã qua kiểm toán bảo mật độc lập.

Tài liệu chính thức:
- https://developers.cloudflare.com/workers/versions-and-deployments/
- https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/
- https://support.google.com/webmasters/answer/9044101
- https://support.google.com/chrome/answer/99020

## 6. Dữ liệu hiện có

Tiếp tục sử dụng database/account/site hiện tại. Bản 49 không cần chạy lại CREATE_FIRST_ADMIN.sql, không đổi mật khẩu hiện có và không xóa bảng/dữ liệu. Cache chưa đồng bộ cần giữ nguyên khi xử lý cache trang cũ.
