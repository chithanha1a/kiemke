-- Chạy bằng tài khoản quản trị Cloudflare: D1 > kiemke > Console.
-- Chỉ tạo khi CHƯA có admin, không ghi đè hoặc reset tài khoản hiện có.
INSERT INTO users (id, username, password, role, site_id, department, active)
SELECT '01d744c8-159e-4512-8cac-2eefa657a706', 'admin', '8953f81a-27cf-46d4-a641-68a9e4f81b95:3166998b2ae0bf421f1581b9f0cb27c2c5241a1c182ad5f02326caae98fd1cf7', 'admin', NULL, '', 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
  AND NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');
SELECT changes() AS inserted_admin_rows;
SELECT username, role, active FROM users WHERE role = 'admin';
