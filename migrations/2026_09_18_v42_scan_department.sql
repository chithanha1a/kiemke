-- Kiểm kê v42: chạy một lần trên database hiện hữu trước khi triển khai mã nguồn.
ALTER TABLE `ocr_scan_records`
  ADD COLUMN `scan_department` VARCHAR(150) NULL AFTER `scan_user`,
  ADD INDEX `idx_scan_department` (`scan_department`);

