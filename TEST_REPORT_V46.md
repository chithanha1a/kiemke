# Báo cáo kiểm thử v46

Phạm vi: khôi phục hai file kết nối gốc, MySQL persistence, MSSQL/MySQL lookup, queue offline, phòng ban và hồi quy production.

Kết quả:

- Tương thích hai file connect gốc: 5/5 đạt.
- Phân loại lỗi kết nối MySQL: 8/8 đạt.
- Đường INSERT MySQL và phòng ban: 4/4 đạt.
- Static integrity: 19/19 đạt.
- Production integrity: 18/18 đạt.
- Department feature: 11/11 đạt.
- Fixed MySQL save: 14/14 đạt.
- PHP và JavaScript syntax: đạt.

Môi trường build không truy cập được hai IP database nội bộ. Kiểm thử kết nối live cần thực hiện trong LAN; endpoint `api.php?action=saveTargetStatus` phải trả `save_target=mysql` và `writable_connection=true`.
