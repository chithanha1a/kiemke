# Kiểm kê Cloudflare — hướng dẫn triển khai bằng trình duyệt

Bản rà soát: 26/10/2026, phiên bản 47.0.0. Đọc BAO_CAO_KIEM_THU.md để biết phạm vi kiểm thử và các phần cần nghiệm thu thực tế.

## A. Chuẩn bị

Anh chỉ cần trình duyệt, tài khoản Cloudflare và GitHub. Các lệnh build/deploy chạy trên Cloudflare, không cần cài Node.js hay mở PowerShell trên máy cá nhân.

Giải nén ZIP. Thư mục cloudflare chứa package.json, package-lock.json, wrangler.jsonc, src/, scripts/, public/, migrations/, database/ và tests/. Giữ ADMIN_ACTIVATION.txt trên máy cá nhân, không đưa file này lên GitHub hay public/. Không upload ZIP vào Pages Direct Upload vì bản này cần cả Worker backend và D1.

## B. Tạo database D1 trên Cloudflare web

1. Mở https://dash.cloudflare.com/ và chọn đúng tài khoản.
2. Tìm D1 SQL Database (thường trong Storage & databases).
3. Chọn Create Database, nhập tên **kiemke**, xác nhận Create. Có thể dùng tên khác, nhưng phải đổi đồng bộ database_name và lệnh migration; hướng dẫn này dùng kiemke.
4. Mở database vừa tạo, sao chép **Database ID** ở Overview/Settings.
5. Đây là database rỗng; anh chọn một trong hai cách tạo bảng bên dưới.

### Cách 1 — tự tạo bảng khi Cloudflare build, khuyến nghị

Không nhập SQL bằng tay. Ở mục D đặt Deploy command:

```
npx wrangler d1 migrations apply kiemke --remote && npx wrangler deploy
```

Cloudflare áp dụng migrations/0001.sql, rồi deploy. Lần sau chỉ áp dụng migration chưa chạy. Nếu database chưa có, migration không tự tạo D1; cần hoàn thành các bước tạo database trên Dashboard trước.

### Cách 2 — tạo bảng ngay trong Console web

1. Trong D1 → kiemke, mở Console.
2. Mở file database/CREATE_TABLES_DASHBOARD.sql trong gói, copy toàn bộ nội dung.
3. Dán vào Console và bấm Execute. Nếu giao diện chỉ nhận một câu lệnh, chạy lần lượt từng câu kết thúc bằng dấu chấm phẩy.
4. File dùng CREATE TABLE/INDEX IF NOT EXISTS, không DROP hoặc xóa dữ liệu. Khi triển khai bằng lệnh migration như cách 1, schema có sẵn vẫn không bị xóa.
5. Chạy truy vấn kiểm tra:

```sql
SELECT name FROM sqlite_master
WHERE type = 'table'
ORDER BY name;
```

Phải có 7 bảng nghiệp vụ: sites, users, sessions, login_attempts, assets, scans, imports. SQLite/Cloudflare có thể thêm bảng hệ thống và d1_migrations. Không tạo admin bằng SQL thủ công vì ứng dụng cần hash mật khẩu đúng định dạng.

## C. Điền Database ID và đưa source lên GitHub web

1. Mở wrangler.jsonc bằng Notepad.
2. Thay REPLACE_WITH_D1_ID bằng ID vừa copy. Giữ:

```json
{
  "name": "kiemke-cloudflare",
  "d1_databases": [{
    "binding": "DB",
    "database_name": "kiemke",
    "database_id": "DATABASE_ID_THAT_CUA_ANH",
    "migrations_dir": "migrations"
  }]
}
```

Đây chỉ là đoạn minh họa phần cần kiểm tra: không thay toàn bộ file cấu hình bằng đoạn này; phải giữ main, compatibility_date và assets hiện có.

3. Vào GitHub → New repository → đặt tên kiemke-cloudflare → chọn Private → Create repository.
4. Chọn Add file → Upload files. Kéo **nội dung bên trong thư mục cloudflare** vào trang upload, giữ đúng cấu trúc thư mục. Không tải ADMIN_ACTIVATION.txt, .dev.vars, backup.sql, node_modules hoặc .wrangler lên repository. Upload bằng web có thể cần chia thành nhiều lượt để giữ số file mỗi lượt phù hợp.
5. Commit changes. Ngay tại gốc repository phải thấy package.json và wrangler.jsonc. Nếu chúng nằm trong thư mục cloudflare bao ngoài, đặt Root directory = cloudflare ở bước tiếp theo.

## D. Deploy bằng Cloudflare Workers Builds

1. Cloudflare Dashboard → Workers & Pages → Create application.
2. Chọn kết nối/import Git repository, kết nối GitHub và cấp quyền đúng repository private vừa tạo.
3. Chọn repository kiemke-cloudflare, nhánh main.
4. Cấu hình:

| Trường | Giá trị |
|---|---|
| Worker name | kiemke-cloudflare, trùng name trong wrangler.jsonc |
| Root directory | Mặc định nếu package.json ở gốc; cloudflare nếu còn thư mục bao ngoài |
| Build command | npm run build |
| Deploy command | npx wrangler d1 migrations apply kiemke --remote && npx wrangler deploy |
| Build variable | NODE_VERSION = 24 nếu tài khoản đang dùng Node cũ |

Cloudflare cài dependencies từ package-lock.json. Bản này yêu cầu Node >=22.19, đã kiểm thử bằng Node 24. Build command đóng gói giao diện và sao chép jsQR, Tesseract worker/WASM, mô hình OCR eng/vie vào public/assets/vendor. Không cần mạng CDN khi sử dụng QR/OCR sau khi các asset ứng dụng đã tải.

5. Bấm Deploy. Đợi log migration và deploy hoàn tất. Nếu lỗi quyền D1, kiểm tra build API token có quyền D1 Edit/Write và Workers Scripts Edit trên đúng tài khoản. Token build dùng để Cloudflare phát hành, không phải SETUP_TOKEN của ứng dụng.
6. Ghi lại URL workers.dev mà Cloudflare hiển thị. Lần sau commit source trên GitHub để Cloudflare build lại.
7. Trong Worker → Bindings phải thấy D1 binding **DB** trỏ tới **kiemke**. wrangler.jsonc là cấu hình nguồn; nếu thay đổi binding trên Dashboard, cập nhật file tương ứng trước lần deploy tiếp theo.

## E. Khởi tạo admin trên web

1. Worker → Settings → Variables and Secrets → Add → Type Secret.
2. Name = SETUP_TOKEN; Value = chuỗi bí mật ngẫu nhiên riêng dài ít nhất 32 ký tự. Lưu và Deploy thay đổi.
3. Đây phải là secret runtime của Worker. Không chỉ nhập ở mục Build variables, vì build variables không được truyền cho Worker khi chạy.
4. Mở URL website → /login.html → “Khởi tạo admin lần đầu”. Nhập SETUP_TOKEN, username admin và mật khẩu đề nghị trong ADMIN_ACTIVATION.txt hoặc mật khẩu riêng từ 12 đến 256 ký tự.
5. Bấm Khởi tạo → Đăng nhập. Endpoint chỉ tạo admin khi chưa có admin, không tự reset mật khẩu tài khoản cũ.
6. Sau khi đăng nhập thành công, xóa SETUP_TOKEN ở Variables and Secrets và Deploy thay đổi.
7. Admin có thể tạo site, tài khoản, import/sửa dữ liệu, in QR, khóa/mở khóa và reset mật khẩu. Phiên đăng nhập 8 giờ; đổi/reset mật khẩu hoặc khóa tài khoản hủy phiên hiện có.

Tài khoản thật chưa được khởi tạo trong Cloudflare của anh. Tài khoản test trong tests/ chỉ dùng D1 local và không được đưa vào database production. Không chạy các test API hoặc browser trên production.

## F. Tạo site, tài khoản và dữ liệu

1. Admin nhập tên site → Tạo site → chọn đúng site trong danh sách.
2. Tạo manager hoặc scanner; tài khoản gắn site đang chọn. Manager import/sửa master data và quản lý kiểm kê của site. Scanner tra master data site và chỉ xem/sửa/xóa bản kiểm kê do chính tài khoản tạo. Admin chọn được tất cả site.
3. Tải template CSV; dùng Excel Data → From Text/CSV và đặt barcode/McSerialNumber thành Text để giữ số 0 đầu. Template là CSV tương thích Excel.
4. Các cột chuẩn: barcode, McSerialNumber, McName, McType, McBrand, McModel, AccountingCode, ManuSerialNo, Factory, CurrentLocation, Usedby, Position, Status, Remark, PurchaseDate. Cột bổ sung được giữ nguyên trong JSON.
5. Chọn file CSV/XLS/XLSX, sheet đầu tiên. Giới hạn 100 dòng/lượt, file tối đa 5 MB. Tách file lớn thành nhiều phần.
6. Barcode sẵn: điền cột barcode. Tự tạo: chọn các cột ghép và dấu nối, ví dụ Factory + McSerialNumber thành Factory A-COMP000001. Tất cả cột ghép phải có giá trị. McSerialNumber luôn bắt buộc.
7. Barcode và serial duy nhất trong site. Barcode đã có thì cập nhật. Serial trùng với một barcode khác làm hủy toàn bộ lượt import; không ghi dở dang. Site khác có thể dùng cùng barcode/serial.
8. Nạp danh sách → chọn thiết bị → sửa JSON → Lưu; giữ nguyên barcode khi sửa. Có thể xuất master data CSV.
9. Nên điền Factory để tải cache offline. Nhóm thiết bị lấy theo 4 ký tự đầu McSerialNumber theo luồng gốc.

Dữ liệu cách ly logic theo site_id trong một D1; không phải một database vật lý/site. Cache IndexedDB/localStorage tách theo tài khoản + site. Backend lấy site của manager/scanner từ tài khoản, bỏ qua site giả từ client. Admin có quyền truy cập mọi site.

## G. Scan, offline và PDF

Mở màn hình scan từ trang quản trị để thiết lập đúng phạm vi site. Tên người scan lấy từ tài khoản đăng nhập, chỉ chọn/nhập phòng ban. QR cũ 8 phần phân cách | giữ tra cứu theo EMS; QR mới tra bằng barcode nguyên văn hoặc McSerialNumber. Mã có dấu nối hoặc Unicode được giữ nguyên khi tra barcode trong cache.

Vào Setting → chọn loại máy/xưởng → tải cache trước khi mất mạng. Trang đang mở tiếp tục scan, lưu hàng đợi IndexedDB và bản dự phòng localStorage; khi có mạng, ứng dụng tra cứu và đồng bộ. Retry cùng client_scan_id không tạo bản trùng. Cùng tài khoản/site/mã/ngày Việt Nam chỉ có một bản QR; lần scan mới cập nhật thời gian gần nhất.

Bản này không cache toàn bộ trang đăng nhập bằng service worker: đóng/reload trang khi hoàn toàn offline hoặc đăng nhập mới offline chưa được hỗ trợ. Cần đăng nhập lại khi phiên hết hạn. Cache máy dùng chung không mã hóa; dữ liệu đã cache vẫn nằm trên thiết bị, cần quản lý thiết bị và tài khoản hệ điều hành phù hợp.

In QR: Nạp danh sách → chọn 1–300 nhãn (Ctrl/Shift chọn nhiều) → Tải PDF A4. Mỗi trang 24 nhãn, 3 cột × 8 hàng, QR khoảng 24 mm. In A4, Actual size/100%, tắt Fit to page. Nội dung QR giữ nguyên Unicode; chú thích PDF chuyển về ASCII để tương thích font. Thử quét tờ in trước khi in hàng loạt, nhất là barcode dài.

## H. Giới hạn và nghiệm thu

- Đã kiểm thử Workers/D1 local và Chromium headless; chưa deploy vào tài khoản Cloudflare của anh, chưa kiểm thử camera vật lý/điện thoại hoặc máy in thật.
- OCR eng/vie đã đóng gói cùng source; đã thử nhận dạng ảnh chữ tiếng Anh tạo bằng canvas. Độ chính xác ảnh thật, tiếng Việt có dấu, camera rung/thiếu sáng cần nghiệm thu riêng. Không cam kết OCR chính xác tuyệt đối.
- Không chuyển kết nối LAN SQL Server/MySQL sang cloud; export master data cũ rồi import D1. Không tự chuyển lịch sử/ảnh cũ.
- Không lưu ảnh scan lên cloud, chỉ lưu nội dung nhận dạng/bảng và kiểm kê. Cần R2/API upload riêng nếu muốn lưu ảnh.
- Danh sách kiểm kê và xuất kiểm kê giới hạn 10.000 bản/lượt; tải cache tối đa 50.000 tài sản/lượt. Đây chưa phải kiểm thử tải production quy mô lớn.
- Xuất master/kiểm kê là CSV tương thích Excel, không phải XLSX. Endpoint export_excel.php giữ URL tương thích.

## I. Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Chỉ thấy trang tĩnh, API không hoạt động | Dùng Workers Builds theo hướng dẫn, không chỉ upload public/ vào Pages |
| Cannot find package.json | Sửa Root directory hoặc cấu trúc repository |
| Database not found | Kiểm tra Database ID, database_name, Cloudflare account và token build |
| no such table: users/sessions/assets | Migration chưa chạy; dùng Deploy command ở mục D hoặc chạy SQL ở mục B |
| env.DB không tồn tại | Binding phải tên DB, đúng chữ hoa |
| Setup token không hợp lệ | Tạo SETUP_TOKEN trong runtime Variables and Secrets rồi Deploy thay đổi |
| Đã có admin nhưng khởi tạo không đổi mật khẩu | Bootstrap không reset admin; dùng chức năng reset mật khẩu từ admin còn truy cập được |
| Import báo trùng | Kiểm tra barcode và McSerialNumber trong cùng site; không xóa database để thử lại |
| Camera không mở | Dùng HTTPS, cho phép camera, đóng ứng dụng khác đang sử dụng camera |
| Quét offline không tìm thấy | Tải lại cache đúng site/xưởng/nhóm thiết bị; kiểm tra barcode nguyên văn |

## J. Tài liệu chính thức

- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/configuration/secrets/

Kiểm tra tài liệu ngày 26/10/2026; tên nhóm menu có thể thay đổi theo giao diện tài khoản.
