# Sửa lỗi chưa có admin trong bảng users — bản 47.1.0

Ảnh D1 cho thấy bảng users đã có nhưng không có dòng dữ liệu. Các dòng login_attempts chỉ ghi lần đăng nhập thất bại; đăng nhập không tự tạo admin. Lỗi token khởi tạo xảy ra trước khi INSERT nên users trống là kết quả phù hợp. Ảnh không đủ để kết luận token runtime và nội dung form đã khớp.

## Cách xử lý ngay trên giao diện web Cloudflare

Cách này dùng quyền quản trị D1 của anh, không cần nhập token hoặc deploy bản mới trước. Database phải có schema của dự án như ảnh.

1. Tải ZIP mới và giải nén.
2. Mở Cloudflare → D1 SQL Database → database **kiemke** đang bind với Worker bằng tên **DB** → Console.
3. Mở file **database/CREATE_FIRST_ADMIN.sql** trong ZIP; copy toàn bộ nội dung, dán vào Console và Execute. Nếu console yêu cầu một statement/lượt, chạy lần lượt. INSERT đã chứa hash PBKDF2, không phải mật khẩu rõ.
4. Kết quả inserted_admin_rows = 1 nghĩa là tài khoản vừa được tạo. Nếu = 0 thì script không tạo: kiểm tra admin đã có hoặc username admin đã thuộc tài khoản khác. Script không reset hay ghi đè mật khẩu hiện có.
5. Kiểm tra:

```sql
SELECT username, role, active
FROM users
WHERE role = 'admin';
```

Phải thấy username admin, role admin, active 1.

6. Mở website bằng nút Visit ở đúng Worker. Dùng form **Đăng nhập** phía trên, không bấm Khởi tạo nữa.
7. Username/password tương ứng nằm trong **ADMIN_ACTIVATION.txt** của CHÍNH ZIP mới này. Mật khẩu đề nghị trong gói cũ không nhất thiết khớp với SQL mới. Nếu admin đã có từ trước, script không đổi mật khẩu; phải dùng mật khẩu đã đặt cho tài khoản đó.
8. Sau khi đăng nhập, đổi mật khẩu tại mục Đổi mật khẩu của tôi, rồi đăng nhập lại. Xóa SETUP_TOKEN khỏi runtime Production và Deploy vì token cũ đã xuất hiện trong ảnh.

Không xóa database, không xóa các bảng, không INSERT mật khẩu rõ và không dùng mật khẩu MySQL/Cloudflare làm mật khẩu ứng dụng.

## Nếu đã chèn admin nhưng vẫn không đăng nhập

- Mở /auth/me sau khi login: đăng nhập thành công sẽ trả ok:true. Không chia sẻ cookie.
- Dùng đúng URL Production từ Visit, không dùng preview của Worker khác.
- Kiểm tra Runtime binding DB thực sự trỏ đúng database vừa chạy SQL. Admin tạo trong database A không thể đăng nhập ở Worker đang bind database B.
- Nếu đã thử sai >=10 lần và bị 429, chờ hết 15 phút kể từ lần sai gần nhất. Không tiếp tục bấm đăng nhập liên tục.
- Chỉ chạy SELECT username,role,active để kiểm tra. Không gửi ảnh cột password/hash hoặc nội dung ADMIN_ACTIVATION.txt.

## Nội dung đã sửa trong mã nguồn

- /auth/setup-status cho biết phiên bản, có/không admin, token runtime đã có/chưa có và DB/schema đọc được hay chưa; không trả token hoặc hash.
- /auth/bootstrap phân biệt SETUP_TOKEN_MISSING (503), SETUP_TOKEN_EMPTY (400), SETUP_TOKEN_MISMATCH (403), ADMIN_ALREADY_EXISTS (409).
- Trim khoảng trắng đầu/cuối token hai phía, vẫn phân biệt chữ hoa/thường và giữ nguyên nội dung bên trong. Variable và Secret đều đọc qua env.SETUP_TOKEN; chọn Secret để giữ kín Value.
- Chỉ trả 201 ADMIN_CREATED sau khi INSERT đúng một dòng và đọc xác nhận tài khoản vừa tạo.
- Không còn thông báo “Nếu hệ thống trống, admin đã được tạo” khi thực tế không insert.
- /auth/login nếu users trống trả 409 ADMIN_NOT_INITIALIZED và hướng dẫn khởi tạo, không tăng bộ đếm sai mật khẩu.
- Giao diện có trạng thái khởi tạo, thông báo riêng cho từng form, chặn gửi lặp trong khi xử lý, và lựa chọn hiện token tại máy người dùng.

## Cập nhật Worker bằng GitHub web

Tải lên repository các file thay đổi: src/worker.js, src/auth.js, public/login.html, public/assets/js/login.js; các file hướng dẫn/test/script có thể cập nhật kèm. Giữ nguyên database_id thật trong wrangler.jsonc; đừng thay bằng REPLACE_WITH_D1_ID từ gói mẫu. Không upload ADMIN_ACTIVATION.txt hoặc .dev.vars.

Cloudflare Builds deploy lại theo cấu hình đã hướng dẫn. Sau deploy, mở /auth/setup-status: data.version phải là 48.0.0 (bản giao diện mới). Nếu vẫn 404 hoặc phiên bản cũ, website chưa chạy bản sửa mới. Dù chưa deploy mới, SQL tạo admin vẫn tương thích định dạng mật khẩu của bản 47.0.0.

Chưa có thay đổi nào được thực hiện trực tiếp trên Cloudflare của anh từ phiên làm việc này.
