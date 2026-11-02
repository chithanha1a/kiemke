<?php
/**
 * v39 - Imported Excel/CSV master data stored inside the application's existing
 * OCR_Scan_db MySQL database. No secondary database is created or selected.
 *
 * Existing OCR tables (ocr_scan_records / ocr_scan_cells / ocr_text_scan_records)
 * are left untouched. This module only owns two additional tables:
 *   - asset_import_batches
 *   - asset_overview_import
 */

if (!defined('ASSET_SOURCE_DB')) { define('ASSET_SOURCE_DB', 'ocr_scan_db'); }
if (!defined('ASSET_SOURCE_TABLE')) { define('ASSET_SOURCE_TABLE', 'asset_overview_import'); }
if (!defined('ASSET_SOURCE_BATCH_TABLE')) { define('ASSET_SOURCE_BATCH_TABLE', 'asset_import_batches'); }

function asset_source_escape_identifier($name) {
    return str_replace('`', '``', (string)$name);
}

function asset_source_database_name($conn = null) {
    if ($conn) {
        $rs = @mysqli_query($conn, 'SELECT DATABASE() AS db_name');
        if ($rs && ($row = mysqli_fetch_assoc($rs))) {
            $name = trim((string)(isset($row['db_name']) ? $row['db_name'] : ''));
            if ($name !== '') return $name;
        }
    }
    return ASSET_SOURCE_DB;
}

function asset_source_qualified_name($conn = null) {
    return asset_source_database_name($conn) . '.' . ASSET_SOURCE_TABLE;
}

function asset_source_open($ensureSchema = true) {
    // v39 deliberately never creates a database; connect.php must select the
    // application's existing OCR_Scan_db database. $ensureSchema controls only
    // whether the two import tables are created when missing.
    $file = __DIR__ . '/connect.php';
    if (!file_exists($file)) { throw new RuntimeException('Không tìm thấy connect.php.'); }

    require $file;
    if (!isset($conn) || !$conn) {
        throw new RuntimeException('connect.php không tạo được kết nối MySQL.');
    }

    $configuredDb = isset($DB) ? trim((string)$DB) : '';
    $rsDb = @mysqli_query($conn, 'SELECT DATABASE() AS db_name');
    $rowDb = $rsDb ? mysqli_fetch_assoc($rsDb) : null;
    $currentDb = $rowDb ? trim((string)$rowDb['db_name']) : '';

    if ($configuredDb !== '' && ($currentDb === '' || strcasecmp($currentDb, $configuredDb) !== 0)) {
        // Only switch to the database already configured by connect.php. Never CREATE DATABASE.
        if (!@mysqli_select_db($conn, $configuredDb)) {
            throw new RuntimeException('Không chọn được database hiện có ' . $configuredDb . ': ' . mysqli_error($conn));
        }
        $currentDb = $configuredDb;
    }
    if ($currentDb === '') {
        throw new RuntimeException('Kết nối MySQL chưa chọn database OCR_Scan_db. Kiểm tra biến $DB trong connect.php.');
    }

    @mysqli_set_charset($conn, 'utf8mb4');
    if ($ensureSchema) asset_source_ensure_schema($conn);
    return $conn;
}

function asset_source_ensure_schema($conn) {
    $batch = asset_source_escape_identifier(ASSET_SOURCE_BATCH_TABLE);
    $table = asset_source_escape_identifier(ASSET_SOURCE_TABLE);

    // Only tables are created. The database itself is never created here.
    $sqlBatch = "CREATE TABLE IF NOT EXISTS `{$batch}` (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    if (!mysqli_query($conn, $sqlBatch)) {
        throw new RuntimeException('Không tạo được bảng ' . ASSET_SOURCE_BATCH_TABLE . ' trong OCR_Scan_db: ' . mysqli_error($conn));
    }

    // Canonical columns mirror Maintenance.dbo.Overview. raw_json preserves every
    // source column from the imported workbook/CSV so no Excel field is discarded.
    $sqlTable = "CREATE TABLE IF NOT EXISTS `{$table}` (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    if (!mysqli_query($conn, $sqlTable)) {
        throw new RuntimeException('Không tạo được bảng ' . ASSET_SOURCE_TABLE . ' trong OCR_Scan_db: ' . mysqli_error($conn));
    }
}

function asset_source_text($value, $limit = 4000) {
    if ($value === null) return '';
    if ($value instanceof DateTimeInterface) $value = $value->format('Y-m-d H:i:s');
    $value = trim((string)$value);
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value);
    if (function_exists('mb_substr')) return mb_substr($value, 0, $limit, 'UTF-8');
    return substr($value, 0, $limit);
}

function asset_source_header_key($value) {
    $value = asset_source_text($value, 255);
    $value = preg_replace('/^\xEF\xBB\xBF/', '', $value);
    $value = function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
    $value = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $value);
    return trim(preg_replace('/\s+/u', ' ', $value));
}

function asset_source_row_index($row) {
    $idx = array();
    foreach ((array)$row as $k => $v) $idx[asset_source_header_key($k)] = asset_source_text($v, 8000);
    return $idx;
}

function asset_source_pick($idx, $aliases, $default = '') {
    foreach ($aliases as $alias) {
        $key = asset_source_header_key($alias);
        if (array_key_exists($key, $idx) && trim((string)$idx[$key]) !== '') return asset_source_text($idx[$key]);
    }
    return asset_source_text($default);
}

function asset_source_infer_factory($idx) {
    $explicit = asset_source_pick($idx, array('Factory', 'Plant', 'Site', 'Xưởng', 'Xuong'));
    if ($explicit !== '') return asset_source_text($explicit, 160);

    $location = asset_source_pick($idx, array('Location'));
    $defaultLocation = asset_source_pick($idx, array('Default Location', 'DefaultLocation'));
    $text = strtoupper($location . ' | ' . $defaultLocation);

    if (preg_match('/\bFACTORY\s*([1-9])\b/i', $text, $m)) return 'Fac' . $m[1];
    if (preg_match('/(?:^|[-_\s])F([1-9])(?:[-_\s]|$)/i', $text, $m)) return 'Fac' . $m[1];
    if (strpos($text, 'R&D') !== false || preg_match('/(?:^|[-_])RD(?:[-_]|$)/i', $text)) return 'R&D';
    if (strpos($text, 'PCC') !== false) return 'PCC';

    $company = asset_source_pick($idx, array('Company'));
    if ($company !== '') return 'OTHER';
    return 'OTHER';
}

function asset_source_map_row($row) {
    $idx = asset_source_row_index($row);
    $serial = asset_source_pick($idx, array('McSerialNumber', 'Asset Tag', 'AssetTag', 'EMS', 'Asset Code', 'AssetCode'));
    $serial = strtoupper(preg_replace('/\s+/u', '', $serial));
    $deviceCode = strtoupper(substr(preg_replace('/[^A-Z0-9]/i', '', $serial), 0, 4));

    $model = asset_source_pick($idx, array('McModel', 'Model', 'Model No.', 'Model No'));
    $name = asset_source_pick($idx, array('McName', 'Asset Name', 'AssetName'));
    if ($name === '') $name = $model !== '' ? $model : asset_source_pick($idx, array('Category'));

    $remarkParts = array_filter(array(
        asset_source_pick($idx, array('Notes')),
        asset_source_pick($idx, array('Notes.1', 'Notes 1', 'Notes_2'))
    ), function ($v) { return trim((string)$v) !== ''; });

    return array(
        'McName' => $name,
        'McType' => asset_source_pick($idx, array('McType', 'Category')),
        'McBrand' => asset_source_pick($idx, array('McBrand', 'Manufacturer')),
        'McModel' => $model,
        'McSerialNumber' => $serial,
        'AccountingCode' => asset_source_pick($idx, array('AccountingCode', 'FA code', 'FA Code', 'Fixed Asset Code')),
        'PowerConsmt' => asset_source_pick($idx, array('PowerConsmt', 'Power Consumption')),
        'PurchaseDate' => asset_source_pick($idx, array('PurchaseDate', 'Purchased')),
        'DPEnd' => asset_source_pick($idx, array('DPEnd', 'EOL', 'Warranty Expires')),
        'LifeDuration' => asset_source_pick($idx, array('LifeDuration', 'Warranty')),
        'DaysInUsed' => asset_source_pick($idx, array('DaysInUsed')),
        'TotalCostOfOperation' => asset_source_pick($idx, array('TotalCostOfOperation')),
        'Freq' => asset_source_pick($idx, array('Freq')),
        'MTBF_hrs' => asset_source_pick($idx, array('MTBF_hrs', 'MTBF hrs')),
        'OriginalBuyingCost' => asset_source_pick($idx, array('OriginalBuyingCost', 'Cost')),
        'AveOprtnCostBymonth' => asset_source_pick($idx, array('AveOprtnCostBymonth', 'Current Value')),
        'Status' => asset_source_pick($idx, array('Status')),
        'Remark' => implode(' | ', $remarkParts),
        'CurrentLocation' => asset_source_pick($idx, array('CurrentLocation', 'Location', 'Default Location')),
        'UpdatedTime' => asset_source_pick($idx, array('UpdatedTime', 'Updated At', 'Last Audit')),
        'DeductionOfProperty' => asset_source_pick($idx, array('DeductionOfProperty', 'Fully Depreciated')),
        'Position' => asset_source_pick($idx, array('Position', 'Title', 'Department')),
        'ManuSerialNo' => asset_source_pick($idx, array('ManuSerialNo', 'Serial', 'Service Tag')),
        'Usedby' => asset_source_pick($idx, array('Usedby', 'Username', 'Employee No.', 'Checked Out')),
        'CurrentStyle' => asset_source_pick($idx, array('CurrentStyle')),
        'INLINE' => asset_source_pick($idx, array('INLINE')),
        'OFFLINE' => asset_source_pick($idx, array('OFFLINE')),
        'Bookedby' => asset_source_pick($idx, array('Bookedby', 'Checked Out')),
        'NextStyle' => asset_source_pick($idx, array('NextStyle')),
        'NewSewingLine' => asset_source_pick($idx, array('NewSewingLine')),
        'NewInline' => asset_source_pick($idx, array('NewInline')),
        'NewOffline' => asset_source_pick($idx, array('NewOffline')),
        'BookingDate' => asset_source_pick($idx, array('BookingDate', 'Checkout Date')),
        'Factory' => asset_source_infer_factory($idx),
        'device_code' => $deviceCode,
        'raw_json' => json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    );
}

function asset_source_stats($conn) {
    $table = asset_source_escape_identifier(ASSET_SOURCE_TABLE);
    $batch = asset_source_escape_identifier(ASSET_SOURCE_BATCH_TABLE);
    $stats = array('database' => asset_source_database_name($conn), 'table' => ASSET_SOURCE_TABLE, 'qualified_table' => asset_source_qualified_name($conn), 'row_count' => 0, 'device_code_count' => 0, 'factory_count' => 0, 'latest_import' => null);
    $rs = mysqli_query($conn, "SELECT COUNT(*) AS row_count, COUNT(DISTINCT device_code) AS device_code_count, COUNT(DISTINCT Factory) AS factory_count FROM `{$table}`");
    if ($rs && ($row = mysqli_fetch_assoc($rs))) {
        $stats['row_count'] = (int)$row['row_count'];
        $stats['device_code_count'] = (int)$row['device_code_count'];
        $stats['factory_count'] = (int)$row['factory_count'];
    }
    $rs = mysqli_query($conn, "SELECT id,source_file,source_format,total_rows,accepted_rows,skipped_rows,created_at FROM `{$batch}` ORDER BY id DESC LIMIT 1");
    if ($rs && ($row = mysqli_fetch_assoc($rs))) $stats['latest_import'] = $row;
    return $stats;
}
