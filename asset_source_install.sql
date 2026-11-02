-- Kiểm kê thiết bị v39 - Master data import nằm trong database OCR hiện hữu.
-- KHÔNG tạo database mới. Chỉ bổ sung đúng 2 bảng vào OCR_Scan_db:
--   1) asset_import_batches
--   2) asset_overview_import
--
-- Nếu tên database trên server khác chữ hoa/thường, đổi dòng USE bên dưới
-- cho đúng với $DB trong connect.php trước khi DBA chạy thủ công.
USE `ocr_scan_db`;

CREATE TABLE IF NOT EXISTS `asset_import_batches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `batch_uuid` VARCHAR(80) NOT NULL,
  `source_file` VARCHAR(255) NOT NULL,
  `source_sha256` CHAR(64) NOT NULL,
  `source_format` VARCHAR(20) NOT NULL,
  `headers_json` LONGTEXT NULL,
  `total_rows` INT NOT NULL DEFAULT 0,
  `accepted_rows` INT NOT NULL DEFAULT 0,
  `skipped_rows` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_batch_uuid` (`batch_uuid`),
  KEY `idx_source_sha256` (`source_sha256`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `asset_overview_import` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `McName` VARCHAR(255) NULL,
  `McType` VARCHAR(255) NULL,
  `McBrand` VARCHAR(255) NULL,
  `McModel` VARCHAR(255) NULL,
  `McSerialNumber` VARCHAR(255) NULL,
  `AccountingCode` VARCHAR(255) NULL,
  `PowerConsmt` VARCHAR(255) NULL,
  `PurchaseDate` VARCHAR(100) NULL,
  `DPEnd` VARCHAR(100) NULL,
  `LifeDuration` VARCHAR(100) NULL,
  `DaysInUsed` VARCHAR(100) NULL,
  `TotalCostOfOperation` VARCHAR(255) NULL,
  `Freq` VARCHAR(100) NULL,
  `MTBF_hrs` VARCHAR(100) NULL,
  `OriginalBuyingCost` VARCHAR(255) NULL,
  `AveOprtnCostBymonth` VARCHAR(255) NULL,
  `Status` VARCHAR(255) NULL,
  `Remark` TEXT NULL,
  `CurrentLocation` VARCHAR(255) NULL,
  `UpdatedTime` VARCHAR(100) NULL,
  `DeductionOfProperty` VARCHAR(255) NULL,
  `Position` VARCHAR(255) NULL,
  `ManuSerialNo` VARCHAR(255) NULL,
  `Usedby` VARCHAR(255) NULL,
  `CurrentStyle` VARCHAR(255) NULL,
  `INLINE` VARCHAR(255) NULL,
  `OFFLINE` VARCHAR(255) NULL,
  `Bookedby` VARCHAR(255) NULL,
  `NextStyle` VARCHAR(255) NULL,
  `NewSewingLine` VARCHAR(255) NULL,
  `NewInline` VARCHAR(255) NULL,
  `NewOffline` VARCHAR(255) NULL,
  `BookingDate` VARCHAR(100) NULL,
  `Factory` VARCHAR(160) NULL,
  `device_code` CHAR(4) NULL,
  `import_batch_id` BIGINT UNSIGNED NULL,
  `source_file` VARCHAR(255) NULL,
  `source_row_no` INT NULL,
  `raw_json` LONGTEXT NULL,
  `imported_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_mcserial` (`McSerialNumber`),
  KEY `idx_device_code` (`device_code`),
  KEY `idx_factory` (`Factory`),
  KEY `idx_device_factory` (`device_code`,`Factory`),
  KEY `idx_import_batch` (`import_batch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
