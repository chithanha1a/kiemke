<?php
if (!defined('KIEMKE_JSON_API')) { define('KIEMKE_JSON_API', true); }
require_once __DIR__ . '/bootstrap.php';
header('Content-Type: application/json; charset=utf-8');
date_default_timezone_set('Asia/Ho_Chi_Minh');

$MAX_ROWS = 120;
$MAX_COLS = 30;
$MAX_LINES = 50;
$UPLOAD_DIR = __DIR__ . '/uploads';
if (!is_dir($UPLOAD_DIR)) { @mkdir($UPLOAD_DIR, 0775, true); }

function json_response($ok, $message = '', $data = null, $status = 200) {
    if ($status >= 400 && function_exists('app_log')) app_log('warning', 'api_error_response', array('status'=>$status,'action'=>isset($_GET['action']) ? $_GET['action'] : '','message'=>$message));
    http_response_code($status);
    echo json_encode(array('ok' => $ok, 'message' => $message, 'data' => $data), JSON_UNESCAPED_UNICODE);
    exit;
}

function read_json_body() {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') { return array(); }
    $data = json_decode($raw, true);
    if (!is_array($data)) { json_response(false, 'JSON không hợp lệ.', null, 400); }
    return $data;
}

function mysql_connection_failure_info($exception) {
    $code = (int)$exception->getCode();
    $reason = 'MYSQL_CONNECTION_FAILED';
    $message = 'Không kết nối được MySQL. Kiểm tra host, port và dịch vụ MySQL.';
    if ($code === 9001) { $reason = 'MYSQL_USER_MISSING'; $message = 'Thiếu tài khoản MySQL. Khai báo mysql_user hoặc KIEMKE_MYSQL_USER.'; }
    else if ($code === 9002) { $reason = 'MYSQLI_MISSING'; $message = 'PHP chưa bật extension mysqli. Hãy bật php_mysqli và khởi động lại web server/PHP-FPM.'; }
    else if ($code === 1045) { $reason = 'MYSQL_ACCESS_DENIED'; $message = 'MySQL từ chối đăng nhập. Kiểm tra user, password và quyền đăng nhập từ máy web server.'; }
    else if ($code === 1044) { $reason = 'MYSQL_DATABASE_ACCESS_DENIED'; $message = 'Tài khoản MySQL không có quyền truy cập database đã cấu hình.'; }
    else if ($code === 1049) { $reason = 'MYSQL_DATABASE_NOT_FOUND'; $message = 'Database MySQL đã cấu hình không tồn tại hoặc sai tên.'; }
    else if ($code === 2002 || $code === 2003) { $reason = 'MYSQL_CONNECTION_REFUSED'; $message = 'Không mở được kết nối đến MySQL. Kiểm tra IP, port, bind-address và firewall.'; }
    else if ($code === 2005) { $reason = 'MYSQL_HOST_NOT_FOUND'; $message = 'Không phân giải được hostname MySQL.'; }
    return array('reason_code'=>$reason, 'mysql_errno'=>$code, 'message'=>$message);
}

function include_db() {
    $file = __DIR__ . '/connect.php';
    if (!file_exists($file)) { json_response(false, 'Không tìm thấy file connect.php.', null, 500); }
    try { require $file; }
    catch (Throwable $e) {
        if (function_exists('app_log')) app_log('error', 'mysql_save_connection_failed', array('error'=>$e->getMessage()));
        $failure = mysql_connection_failure_info($e);
        json_response(false, $failure['message'] . ' Dữ liệu vẫn được giữ trong hàng đợi để thử lại. Request ID: ' . (function_exists('kiemke_request_id') ? kiemke_request_id() : 'n/a'), array('error_code'=>'MYSQL_CONNECTION_FAILED','reason_code'=>$failure['reason_code'],'mysql_errno'=>$failure['mysql_errno'],'retryable'=>true,'save_target'=>'mysql'), 503);
    }
    if (!isset($conn) || !($conn instanceof mysqli)) {
        json_response(false, 'File connect.php phải tạo biến $conn kiểu mysqli.', null, 500);
    }
    if (function_exists('mysqli_set_charset')) { @mysqli_set_charset($conn, 'utf8'); }
    // Safe and idempotent: make an older deployment writable before validating it.
    // This fixes production servers that received new PHP files before install.sql/migration.
    ensure_schema($conn);
    return $conn;
}

function esc($conn, $value) { return mysqli_real_escape_string($conn, (string)$value); }

function text_len($value) {
    return function_exists('mb_strlen') ? mb_strlen((string)$value, 'UTF-8') : strlen((string)$value);
}
function text_sub($value, $start, $length) {
    return function_exists('mb_substr') ? mb_substr((string)$value, $start, $length, 'UTF-8') : substr((string)$value, $start, $length);
}
function text_lower($value) {
    return function_exists('mb_strtolower') ? mb_strtolower((string)$value, 'UTF-8') : strtolower((string)$value);
}

function table_exists($conn, $table) {
    $rs = mysqli_query($conn, "SHOW TABLES LIKE '" . esc($conn, $table) . "'");
    return $rs && mysqli_num_rows($rs) > 0;
}

function column_exists($conn, $table, $column) {
    // Production hot path: đọc metadata cột một lần/request thay vì ~60 SHOW COLUMNS cho mỗi scan.
    static $cache = array();
    $connKey = is_object($conn) ? spl_object_hash($conn) : 'conn';
    $key = $connKey . ':' . $table;
    if (!isset($cache[$key])) {
        $cache[$key] = array();
        $rs = mysqli_query($conn, "SHOW COLUMNS FROM `" . esc($conn, $table) . "`");
        if ($rs) {
            while ($row = mysqli_fetch_assoc($rs)) {
                if (isset($row['Field'])) { $cache[$key][strtolower((string)$row['Field'])] = true; }
            }
        }
    }
    return isset($cache[$key][strtolower((string)$column)]);
}

function index_exists($conn, $table, $indexName) {
    // Tương tự, chỉ 1 SHOW INDEX/request rồi kiểm tra trong memory.
    static $cache = array();
    $connKey = is_object($conn) ? spl_object_hash($conn) : 'conn';
    $key = $connKey . ':' . $table;
    if (!isset($cache[$key])) {
        $cache[$key] = array();
        $rs = mysqli_query($conn, "SHOW INDEX FROM `" . esc($conn, $table) . "`");
        if ($rs) {
            while ($row = mysqli_fetch_assoc($rs)) {
                if (isset($row['Key_name'])) { $cache[$key][strtolower((string)$row['Key_name'])] = true; }
            }
        }
    }
    return isset($cache[$key][strtolower((string)$indexName)]);
}

function ensure_column($conn, $table, $column, $definition) {
    if (!column_exists($conn, $table, $column)) {
        $sql = "ALTER TABLE `{$table}` ADD `{$column}` {$definition}";
        if (!mysqli_query($conn, $sql)) { json_response(false, 'Lỗi cập nhật cấu trúc bảng: ' . mysqli_error($conn), null, 500); }
    }
}

function ensure_schema($conn) {
    $sql = "CREATE TABLE IF NOT EXISTS `ocr_scan_records` (
        `id` INT NOT NULL AUTO_INCREMENT,
        `scan_user` VARCHAR(100) NOT NULL,
        `scan_department` VARCHAR(150) NULL,
        `source_type` VARCHAR(30) NOT NULL DEFAULT 'ocr',
        `scan_date` DATE NOT NULL,
        `scan_time` TIME NOT NULL,
        `scan_datetime` DATETIME NOT NULL,
        `scan_year` INT NOT NULL,
        `scan_month` INT NOT NULL,
        `scan_day` INT NOT NULL,
        `scan_hour` INT NOT NULL,
        `scan_minute` INT NOT NULL,
        `scan_second` INT NOT NULL,
        `row_count` INT NOT NULL DEFAULT 0,
        `column_count` INT NOT NULL DEFAULT 0,
        `line_count` INT NOT NULL DEFAULT 0,
        `raw_text` LONGTEXT NULL,
        `normalized_text` LONGTEXT NULL,
        `table_json` LONGTEXT NULL,
        `content_hash` CHAR(64) NULL,
        `client_scan_id` VARCHAR(80) NULL,
        `qr_daily_key` CHAR(64) NULL,
        `scan_comment` VARCHAR(1000) NULL,
        `image_file` VARCHAR(255) NULL,
        `qr_lookup_key` VARCHAR(100) NULL,
        `qr_serial_lookup8` VARCHAR(20) NULL,
        `qr_ems_lookup` VARCHAR(100) NULL,
        `machine_status` VARCHAR(255) NULL,
        `machine_serial` VARCHAR(255) NULL,
        `machine_name` VARCHAR(255) NULL,
        `machine_type` VARCHAR(255) NULL,
        `machine_brand` VARCHAR(255) NULL,
        `machine_model` VARCHAR(255) NULL,
        `machine_accounting_code` VARCHAR(255) NULL,
        `machine_factory` VARCHAR(255) NULL,
        `machine_location` VARCHAR(255) NULL,
        `machine_usedby` VARCHAR(255) NULL,
        `machine_position` VARCHAR(255) NULL,
        `machine_remark` VARCHAR(1000) NULL,
        `machine_manu_serial` VARCHAR(255) NULL,
        `machine_purchase_date` VARCHAR(100) NULL,
        `machine_updated_time` VARCHAR(100) NULL,
        `machine_json` LONGTEXT NULL,
        `inventory_datetime` DATETIME NULL,
        `qr_ems` VARCHAR(100) NULL,
        `qr_device_type` VARCHAR(100) NULL,
        `qr_laptop_info` VARCHAR(700) NULL,
        `qr_device_model` VARCHAR(255) NULL,
        `qr_asset_code` VARCHAR(255) NULL,
        `qr_device_serial_no` VARCHAR(255) NULL,
        `qr_user_id` VARCHAR(255) NULL,
        `qr_device_serial_info` VARCHAR(700) NULL,
        `qr_user_dept` VARCHAR(255) NULL,
        `qr_last_check` VARCHAR(100) NULL,
        `line_01` TEXT NULL, `line_02` TEXT NULL, `line_03` TEXT NULL, `line_04` TEXT NULL, `line_05` TEXT NULL,
        `line_06` TEXT NULL, `line_07` TEXT NULL, `line_08` TEXT NULL, `line_09` TEXT NULL, `line_10` TEXT NULL,
        `line_11` TEXT NULL, `line_12` TEXT NULL, `line_13` TEXT NULL, `line_14` TEXT NULL, `line_15` TEXT NULL,
        `line_16` TEXT NULL, `line_17` TEXT NULL, `line_18` TEXT NULL, `line_19` TEXT NULL, `line_20` TEXT NULL,
        `line_21` TEXT NULL, `line_22` TEXT NULL, `line_23` TEXT NULL, `line_24` TEXT NULL, `line_25` TEXT NULL,
        `line_26` TEXT NULL, `line_27` TEXT NULL, `line_28` TEXT NULL, `line_29` TEXT NULL, `line_30` TEXT NULL,
        `line_31` TEXT NULL, `line_32` TEXT NULL, `line_33` TEXT NULL, `line_34` TEXT NULL, `line_35` TEXT NULL,
        `line_36` TEXT NULL, `line_37` TEXT NULL, `line_38` TEXT NULL, `line_39` TEXT NULL, `line_40` TEXT NULL,
        `line_41` TEXT NULL, `line_42` TEXT NULL, `line_43` TEXT NULL, `line_44` TEXT NULL, `line_45` TEXT NULL,
        `line_46` TEXT NULL, `line_47` TEXT NULL, `line_48` TEXT NULL, `line_49` TEXT NULL, `line_50` TEXT NULL,
        `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `updated_at` DATETIME NULL DEFAULT NULL,
        PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8";
    if (!mysqli_query($conn, $sql)) { json_response(false, 'Lỗi tạo bảng ocr_scan_records: ' . mysqli_error($conn), null, 500); }

    ensure_column($conn, 'ocr_scan_records', 'source_type', "VARCHAR(30) NOT NULL DEFAULT 'ocr'");
    ensure_column($conn, 'ocr_scan_records', 'row_count', "INT NOT NULL DEFAULT 0");
    ensure_column($conn, 'ocr_scan_records', 'column_count', "INT NOT NULL DEFAULT 0");
    ensure_column($conn, 'ocr_scan_records', 'line_count', "INT NOT NULL DEFAULT 0");
    ensure_column($conn, 'ocr_scan_records', 'raw_text', "LONGTEXT NULL");
    ensure_column($conn, 'ocr_scan_records', 'normalized_text', "LONGTEXT NULL");
    ensure_column($conn, 'ocr_scan_records', 'table_json', "LONGTEXT NULL");
    ensure_column($conn, 'ocr_scan_records', 'content_hash', "CHAR(64) NULL");
    ensure_column($conn, 'ocr_scan_records', 'client_scan_id', "VARCHAR(80) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_daily_key', "CHAR(64) NULL");
    ensure_column($conn, 'ocr_scan_records', 'scan_comment', "VARCHAR(1000) NULL");
    ensure_column($conn, 'ocr_scan_records', 'scan_department', "VARCHAR(150) NULL");
    ensure_column($conn, 'ocr_scan_records', 'image_file', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_lookup_key', "VARCHAR(100) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_serial_lookup8', "VARCHAR(20) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_ems_lookup', "VARCHAR(100) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_status', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_serial', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_name', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_type', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_brand', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_model', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_accounting_code', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_factory', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_location', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_usedby', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_position', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_remark', "VARCHAR(1000) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_manu_serial', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_purchase_date', "VARCHAR(100) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_updated_time', "VARCHAR(100) NULL");
    ensure_column($conn, 'ocr_scan_records', 'machine_json', "LONGTEXT NULL");
    ensure_column($conn, 'ocr_scan_records', 'inventory_datetime', "DATETIME NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_ems', "VARCHAR(100) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_device_type', "VARCHAR(100) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_laptop_info', "VARCHAR(700) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_device_model', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_asset_code', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_device_serial_no', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_user_id', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_device_serial_info', "VARCHAR(700) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_user_dept', "VARCHAR(255) NULL");
    ensure_column($conn, 'ocr_scan_records', 'qr_last_check', "VARCHAR(100) NULL");
    ensure_column($conn, 'ocr_scan_records', 'updated_at', "DATETIME NULL DEFAULT NULL");
    for ($i = 1; $i <= 50; $i++) {
        $col = 'line_' . str_pad((string)$i, 2, '0', STR_PAD_LEFT);
        ensure_column($conn, 'ocr_scan_records', $col, "TEXT NULL");
    }
    if (!index_exists($conn, 'ocr_scan_records', 'ux_content_hash')) { @mysqli_query($conn, "CREATE UNIQUE INDEX `ux_content_hash` ON `ocr_scan_records` (`content_hash`)"); }
    if (!index_exists($conn, 'ocr_scan_records', 'ux_client_scan_id')) { @mysqli_query($conn, "CREATE UNIQUE INDEX `ux_client_scan_id` ON `ocr_scan_records` (`client_scan_id`)"); }
    if (!index_exists($conn, 'ocr_scan_records', 'ux_qr_daily_key')) {
        if (!mysqli_query($conn, "CREATE UNIQUE INDEX `ux_qr_daily_key` ON `ocr_scan_records` (`qr_daily_key`)")) {
            app_log('warning', 'mysql_optional_unique_index_failed', array('index'=>'ux_qr_daily_key','error'=>mysqli_error($conn)));
        }
    }
    if (!index_exists($conn, 'ocr_scan_records', 'idx_scan_date')) { @mysqli_query($conn, "CREATE INDEX `idx_scan_date` ON `ocr_scan_records` (`scan_date`)"); }
    if (!index_exists($conn, 'ocr_scan_records', 'idx_scan_user')) { @mysqli_query($conn, "CREATE INDEX `idx_scan_user` ON `ocr_scan_records` (`scan_user`)"); }
    if (!index_exists($conn, 'ocr_scan_records', 'idx_scan_department')) { @mysqli_query($conn, "CREATE INDEX `idx_scan_department` ON `ocr_scan_records` (`scan_department`)"); }
    if (!index_exists($conn, 'ocr_scan_records', 'idx_source_type')) { @mysqli_query($conn, "CREATE INDEX `idx_source_type` ON `ocr_scan_records` (`source_type`)"); }
    if (!index_exists($conn, 'ocr_scan_records', 'idx_qr_device_serial_no')) { @mysqli_query($conn, "CREATE INDEX `idx_qr_device_serial_no` ON `ocr_scan_records` (`qr_device_serial_no`)"); }
    if (!index_exists($conn, 'ocr_scan_records', 'idx_qr_serial_lookup8')) { @mysqli_query($conn, "CREATE INDEX `idx_qr_serial_lookup8` ON `ocr_scan_records` (`qr_serial_lookup8`)"); }
    if (!index_exists($conn, 'ocr_scan_records', 'idx_qr_ems')) { @mysqli_query($conn, "CREATE INDEX `idx_qr_ems` ON `ocr_scan_records` (`qr_ems`)"); }
    if (!index_exists($conn, 'ocr_scan_records', 'idx_qr_ems_lookup')) { @mysqli_query($conn, "CREATE INDEX `idx_qr_ems_lookup` ON `ocr_scan_records` (`qr_ems_lookup`)"); }
    if (!index_exists($conn, 'ocr_scan_records', 'idx_qr_daily_user_code')) { @mysqli_query($conn, "CREATE INDEX `idx_qr_daily_user_code` ON `ocr_scan_records` (`source_type`,`scan_user`,`qr_ems_lookup`,`inventory_datetime`)"); }

    $sql2 = "CREATE TABLE IF NOT EXISTS `ocr_scan_cells` (
        `id` INT NOT NULL AUTO_INCREMENT,
        `record_id` INT NOT NULL,
        `row_no` INT NOT NULL,
        `col_no` INT NOT NULL,
        `cell_text` TEXT NULL,
        `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (`id`),
        UNIQUE KEY `ux_record_cell` (`record_id`, `row_no`, `col_no`),
        KEY `idx_record_id` (`record_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8";
    if (!mysqli_query($conn, $sql2)) { json_response(false, 'Lỗi tạo bảng ocr_scan_cells: ' . mysqli_error($conn), null, 500); }
}

function validate_runtime_schema($conn) {
    static $validated = false;
    if ($validated) return;
    if (!table_exists($conn, 'ocr_scan_records') || !table_exists($conn, 'ocr_scan_cells')) {
        json_response(false, 'Database chưa được cài đặt. Hãy chạy install.sql bằng tài khoản triển khai.', null, 503);
    }
    $requiredColumns = array('client_scan_id','qr_daily_key','scan_comment','scan_department','inventory_datetime','qr_ems_lookup','machine_json','qr_device_serial_no');
    foreach ($requiredColumns as $column) {
        if (!column_exists($conn, 'ocr_scan_records', $column)) {
            json_response(false, 'Database thiếu migration v42. Hãy chạy install.sql hoặc migration trước khi mở ứng dụng.', null, 503);
        }
    }
    if (!index_exists($conn, 'ocr_scan_records', 'ux_client_scan_id') || !index_exists($conn, 'ocr_scan_records', 'ux_qr_daily_key')) {
        json_response(false, 'Database thiếu unique index chống ghi trùng. Hãy chạy migration production.', null, 503);
    }
    $validated = true;
}

function clean_user_name($name) {
    $name = trim((string)$name);
    $name = preg_replace('/\s+/u', ' ', $name);
    $name = preg_replace('/[^\p{L}\p{N} _\.\-@]/u', '', $name);
    if (text_len($name) > 100) { $name = text_sub($name, 0, 100); }
    return $name;
}

function clean_department_name($name) {
    $name = trim((string)$name);
    $name = preg_replace('/\s+/u', ' ', $name);
    $name = preg_replace('/[^\p{L}\p{N} _\.\-\/&()]/u', '', $name);
    if (text_len($name) > 150) { $name = text_sub($name, 0, 150); }
    return $name;
}

function strip_vietnamese_accents($str) {
    $str = (string)$str;
    $map = array(
        'à'=>'a','á'=>'a','ạ'=>'a','ả'=>'a','ã'=>'a','â'=>'a','ầ'=>'a','ấ'=>'a','ậ'=>'a','ẩ'=>'a','ẫ'=>'a','ă'=>'a','ằ'=>'a','ắ'=>'a','ặ'=>'a','ẳ'=>'a','ẵ'=>'a',
        'è'=>'e','é'=>'e','ẹ'=>'e','ẻ'=>'e','ẽ'=>'e','ê'=>'e','ề'=>'e','ế'=>'e','ệ'=>'e','ể'=>'e','ễ'=>'e',
        'ì'=>'i','í'=>'i','ị'=>'i','ỉ'=>'i','ĩ'=>'i','ò'=>'o','ó'=>'o','ọ'=>'o','ỏ'=>'o','õ'=>'o','ô'=>'o','ồ'=>'o','ố'=>'o','ộ'=>'o','ổ'=>'o','ỗ'=>'o','ơ'=>'o','ờ'=>'o','ớ'=>'o','ợ'=>'o','ở'=>'o','ỡ'=>'o',
        'ù'=>'u','ú'=>'u','ụ'=>'u','ủ'=>'u','ũ'=>'u','ư'=>'u','ừ'=>'u','ứ'=>'u','ự'=>'u','ử'=>'u','ữ'=>'u','ỳ'=>'y','ý'=>'y','ỵ'=>'y','ỷ'=>'y','ỹ'=>'y','đ'=>'d',
        'À'=>'A','Á'=>'A','Ạ'=>'A','Ả'=>'A','Ã'=>'A','Â'=>'A','Ầ'=>'A','Ấ'=>'A','Ậ'=>'A','Ẩ'=>'A','Ẫ'=>'A','Ă'=>'A','Ằ'=>'A','Ắ'=>'A','Ặ'=>'A','Ẳ'=>'A','Ẵ'=>'A',
        'È'=>'E','É'=>'E','Ẹ'=>'E','Ẻ'=>'E','Ẽ'=>'E','Ê'=>'E','Ề'=>'E','Ế'=>'E','Ệ'=>'E','Ể'=>'E','Ễ'=>'E','Ì'=>'I','Í'=>'I','Ị'=>'I','Ỉ'=>'I','Ĩ'=>'I',
        'Ò'=>'O','Ó'=>'O','Ọ'=>'O','Ỏ'=>'O','Õ'=>'O','Ô'=>'O','Ồ'=>'O','Ố'=>'O','Ộ'=>'O','Ổ'=>'O','Ỗ'=>'O','Ơ'=>'O','Ờ'=>'O','Ớ'=>'O','Ợ'=>'O','Ở'=>'O','Ỡ'=>'O',
        'Ù'=>'U','Ú'=>'U','Ụ'=>'U','Ủ'=>'U','Ũ'=>'U','Ư'=>'U','Ừ'=>'U','Ứ'=>'U','Ự'=>'U','Ử'=>'U','Ữ'=>'U','Ỳ'=>'Y','Ý'=>'Y','Ỵ'=>'Y','Ỷ'=>'Y','Ỹ'=>'Y','Đ'=>'D'
    );
    return strtr($str, $map);
}

function normalize_cell($cell) {
    $cell = (string)$cell;
    $cell = str_replace(array("\r\n", "\r", "\n", "\t"), ' ', $cell);
    $cell = str_replace(array('‘','’','“','”'), array("'","'",'"','"'), $cell);
    $cell = strip_vietnamese_accents($cell);
    $cell = preg_replace('/[\x{00A0} ]+/u', ' ', $cell);
    $cell = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $cell);
    $cell = trim($cell);
    if (text_len($cell) > 700) { $cell = text_sub($cell, 0, 700); }
    return $cell;
}

function normalize_table($table, $maxRows, $maxCols) {
    $out = array();
    if (!is_array($table)) { return $out; }
    foreach ($table as $row) {
        if (!is_array($row)) { $row = array($row); }
        $new = array();
        foreach ($row as $cell) {
            $new[] = normalize_cell($cell);
            if (count($new) >= $maxCols) { break; }
        }
        while (count($new) && $new[count($new) - 1] === '') { array_pop($new); }
        if (count($new) && count(array_filter($new, function($x){ return trim((string)$x) !== ''; }))) { $out[] = $new; }
        if (count($out) >= $maxRows) { break; }
    }
    return $out;
}

function table_to_raw_text($table) {
    $lines = array();
    foreach ($table as $row) { $lines[] = implode("\t", $row); }
    return implode("\n", $lines);
}

function normalized_text_for_hash($sourceType, $table, $extra = '') {
    $txt = $sourceType . "\n" . table_to_raw_text($table) . "\n" . (string)$extra;
    $txt = strip_vietnamese_accents($txt);
    $txt = strtoupper($txt);
    $txt = preg_replace('/[^A-Z0-9\n\t _\.\-:\/\\\|#&+()]/', ' ', $txt);
    $txt = preg_replace('/[ \t]+/', ' ', $txt);
    $txt = preg_replace('/\n+/', "\n", $txt);
    return trim($txt);
}



function search_terms($search) {
    $search = trim(strip_vietnamese_accents((string)$search));
    if ($search === '') { return array(); }
    $parts = preg_split('/[\s,;\|]+/u', $search);
    $out = array();
    foreach ($parts as $p) {
        $p = trim($p);
        if ($p === '') { continue; }
        if (text_len($p) > 80) { $p = text_sub($p, 0, 80); }
        $k = text_lower($p);
        $out[$k] = $p;
        if (count($out) >= 12) { break; }
    }
    return array_values($out);
}

function build_fuzzy_search_where($conn, $search) {
    $terms = search_terms($search);
    if (!count($terms)) { return ''; }
    $fields = array(
        'id', 'source_type', 'scan_user', 'scan_department', 'scan_date', 'scan_time', 'scan_datetime',
        'raw_text', 'normalized_text', 'table_json',
        'qr_lookup_key', 'qr_ems', 'qr_ems_lookup', 'qr_laptop_info',
        'qr_device_type', 'qr_device_model', 'qr_asset_code', 'qr_device_serial_no',
        'qr_serial_lookup8', 'qr_user_id', 'qr_user_dept', 'qr_last_check', 'scan_comment',
        'machine_status', 'machine_serial', 'machine_name', 'machine_type', 'machine_brand',
        'machine_model', 'machine_accounting_code', 'machine_factory', 'machine_location', 'machine_usedby',
        'machine_position', 'machine_remark', 'machine_manu_serial', 'machine_purchase_date', 'machine_updated_time'
    );
    $and = array();
    foreach ($terms as $term) {
        $termRaw = esc($conn, $term);
        $termNorm = esc($conn, strip_vietnamese_accents($term));
        $or = array();
        foreach ($fields as $f) {
            if ($f === 'id') { $or[] = "CAST(`id` AS CHAR) LIKE '%{$termRaw}%'"; }
            else if ($f === 'normalized_text') { $or[] = "`normalized_text` LIKE '%{$termNorm}%'"; }
            else { $or[] = "`{$f}` LIKE '%{$termRaw}%'"; }
        }
        for ($i = 1; $i <= 50; $i++) {
            $col = 'line_' . str_pad((string)$i, 2, '0', STR_PAD_LEFT);
            $or[] = "`{$col}` LIKE '%{$termRaw}%'";
        }
        $and[] = '(' . implode(' OR ', $or) . ')';
    }
    return '(' . implode(' AND ', $and) . ')';
}

function clean_lookup_code($value) {
    return preg_replace('/[^A-Z0-9]/', '', strtoupper((string)$value));
}

function ems_lookup_key($ems) {
    // Yêu cầu hiện tại: dùng EMS để tra với Overview.McSerialNumber.
    return clean_lookup_code($ems);
}

function serial_lookup8($serial) {
    // Giữ tương thích dữ liệu cũ, không dùng làm key tra cứu chính ở bản này.
    $s = clean_lookup_code($serial);
    if ($s === '') { return ''; }
    return substr($s, 0, 8);
}

function parse_qr_asset($qrText) {
    $text = trim((string)$qrText);
    $parts = array_map('trim', explode('|', $text));
    while (count($parts) < 8) { $parts[] = ''; }
    $ems = normalize_cell(isset($parts[0]) ? $parts[0] : '');
    $deviceType = normalize_cell(isset($parts[1]) ? $parts[1] : '');
    $deviceModel = normalize_cell(isset($parts[2]) ? $parts[2] : '');
    $assetCode = normalize_cell(isset($parts[3]) ? $parts[3] : '');
    $deviceSerialNo = normalize_cell(isset($parts[4]) ? $parts[4] : '');
    $userId = normalize_cell(isset($parts[5]) ? $parts[5] : '');
    $userDept = normalize_cell(isset($parts[6]) ? $parts[6] : '');
    $lastCheck = normalize_cell(isset($parts[7]) ? $parts[7] : '');

    $deviceLabel = $deviceType !== '' ? $deviceType : 'Device';
    $deviceValue = $deviceModel;
    if ($assetCode !== '') { $deviceValue .= ($deviceValue !== '' ? '|' : '') . $assetCode; }
    $serialValue = $deviceSerialNo;

    return array(
        'ems' => $ems,
        'device_type' => $deviceType,
        'device_model' => $deviceModel,
        'asset_code' => $assetCode,
        'device_serial_no' => $deviceSerialNo,
        'user_id' => $userId,
        'user_dept' => $userDept,
        'last_check' => $lastCheck,
        'lookup_ems' => ems_lookup_key($ems),
        'lookup_serial_full' => clean_lookup_code($deviceSerialNo),
        'lookup_serial_8' => serial_lookup8($deviceSerialNo),
        'lookup_serial' => serial_lookup8($deviceSerialNo),
        'device_laptop_info' => $deviceValue,
        'device_serial_info' => $serialValue,
        'display_table' => array(
            array('EMS', $ems),
            array($deviceLabel, $deviceValue),
            array('Device Serial No', $deviceSerialNo),
            array('User ID', $userId),
            array("User's Dept", $userDept),
            array('Last Check', $lastCheck)
        )
    );
}


function qr_columns_from_display_table($table) {
    $out = array(
        'qr_ems' => '', 'qr_device_type' => '', 'qr_laptop_info' => '', 'qr_device_model' => '', 'qr_asset_code' => '',
        'qr_device_serial_no' => '', 'qr_user_id' => '', 'qr_device_serial_info' => '', 'qr_user_dept' => '', 'qr_last_check' => ''
    );
    if (!is_array($table)) { return $out; }
    foreach ($table as $row) {
        if (!is_array($row) || !isset($row[0])) { continue; }
        $label = normalize_cell($row[0]);
        $value = isset($row[1]) ? normalize_cell($row[1]) : '';
        $labelKey = strtoupper(preg_replace('/[^A-Z0-9]/', '', strip_vietnamese_accents($label)));
        if ($labelKey === 'EMS') { $out['qr_ems'] = $value; continue; }
        if ($labelKey === 'DEVICESERIALNO') {
            $out['qr_device_serial_info'] = $value;
            $parts = array_map('trim', explode('|', $value));
            if (isset($parts[0])) { $out['qr_device_serial_no'] = $parts[0]; }
            if (isset($parts[1]) && $out['qr_user_id'] === '') { $out['qr_user_id'] = $parts[1]; }
            continue;
        }
        if ($labelKey === 'USERID' || $labelKey === 'USERSID') { $out['qr_user_id'] = $value; continue; }
        if ($labelKey === 'USERSDEPT' || $labelKey === 'USERDEPT') { $out['qr_user_dept'] = $value; continue; }
        if ($labelKey === 'LASTCHECK' || $labelKey === 'LASTCHECKED') { $out['qr_last_check'] = $value; continue; }
        if ($labelKey !== '' && strpos($labelKey, 'MACHINE') !== 0 && !in_array($labelKey, array('MCSERIALNUMBER','ACCOUNTINGCODE','CURRENTLOCATION','USEDBY','UPDATEDTIME'), true)) {
            if ($out['qr_laptop_info'] === '') {
                $out['qr_device_type'] = $label;
                $out['qr_laptop_info'] = $value;
                $parts = array_map('trim', explode('|', $value));
                if (isset($parts[0])) { $out['qr_device_model'] = $parts[0]; }
                if (isset($parts[1])) { $out['qr_asset_code'] = $parts[1]; }
            }
        }
    }
    return $out;
}

function save_image_data_url($data_url, $upload_dir) {
    $data_url = (string)$data_url;
    if ($data_url === '') { return ''; }
    if (!preg_match('/^data:image\/(png|jpeg|jpg|webp);base64,/i', $data_url, $m)) { return ''; }
    $ext = strtolower($m[1]);
    if ($ext === 'jpeg') { $ext = 'jpg'; }
    $base64 = preg_replace('/^data:image\/(png|jpeg|jpg|webp);base64,/i', '', $data_url);
    $bin = base64_decode($base64, true);
    if ($bin === false || strlen($bin) < 20) { return ''; }
    if (strlen($bin) > 10 * 1024 * 1024) { return ''; }
    $name = 'scan_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    $path = rtrim($upload_dir, '/\\') . DIRECTORY_SEPARATOR . $name;
    if (file_put_contents($path, $bin) === false) { return ''; }
    return 'uploads/' . $name;
}

function insert_cells($conn, $record_id, $table) {
    mysqli_query($conn, "DELETE FROM ocr_scan_cells WHERE record_id=" . (int)$record_id);
    $values = array();
    foreach ($table as $rIndex => $row) {
        foreach ($row as $cIndex => $cell) {
            $cell = normalize_cell($cell);
            if ($cell === '') { continue; }
            $values[] = '(' . (int)$record_id . ',' . ((int)$rIndex + 1) . ',' . ((int)$cIndex + 1) . ", '" . esc($conn, $cell) . "')";
        }
    }
    if ($values) {
        $sql = "INSERT INTO ocr_scan_cells (`record_id`,`row_no`,`col_no`,`cell_text`) VALUES " . implode(',', $values);
        if (!mysqli_query($conn, $sql)) { json_response(false, 'Lỗi lưu chi tiết cell: ' . mysqli_error($conn), null, 500); }
    }
}

function fetch_cells($conn, $record_id) {
    $record_id = (int)$record_id;
    $cells = array();
    $rs = mysqli_query($conn, "SELECT row_no,col_no,cell_text FROM ocr_scan_cells WHERE record_id={$record_id} ORDER BY row_no ASC, col_no ASC");
    if ($rs) {
        while ($r = mysqli_fetch_assoc($rs)) {
            $rn = (int)$r['row_no']; $cn = (int)$r['col_no'];
            if (!isset($cells[$rn])) { $cells[$rn] = array(); }
            $cells[$rn][$cn] = $r['cell_text'];
        }
    }
    ksort($cells);
    $table = array();
    foreach ($cells as $rn => $cols) {
        ksort($cols);
        $maxCol = count($cols) ? max(array_keys($cols)) : 0;
        $row = array();
        for ($i = 1; $i <= $maxCol; $i++) { $row[] = isset($cols[$i]) ? $cols[$i] : ''; }
        $table[] = $row;
    }
    return $table;
}

function row_to_array($conn, $row) {
    $table = array();
    if (isset($row['table_json']) && trim((string)$row['table_json']) !== '') {
        $decoded = json_decode($row['table_json'], true);
        if (is_array($decoded)) { $table = $decoded; }
    }
    if (!$table && isset($row['id'])) { $table = fetch_cells($conn, (int)$row['id']); }
    if (!$table && isset($row['raw_text']) && trim((string)$row['raw_text']) !== '') {
        $lines = preg_split('/\r\n|\r|\n/', $row['raw_text']);
        foreach ($lines as $line) {
            $line = trim((string)$line);
            if ($line !== '') { $table[] = preg_split('/\t|\s{2,}|\|/', $line); }
        }
    }
    $lines = array();
    foreach ($table as $r) { $lines[] = implode(' | ', $r); }
    $qrFallback = qr_columns_from_display_table($table);
    return array(
        'id' => (int)$row['id'],
        'scan_user' => isset($row['scan_user']) ? $row['scan_user'] : '',
        'scan_department' => isset($row['scan_department']) ? $row['scan_department'] : '',
        'source_type' => isset($row['source_type']) ? $row['source_type'] : 'ocr',
        'scan_date' => isset($row['scan_date']) ? $row['scan_date'] : '',
        'scan_time' => isset($row['scan_time']) ? $row['scan_time'] : '',
        'scan_datetime' => isset($row['scan_datetime']) ? $row['scan_datetime'] : '',
        'row_count' => isset($row['row_count']) ? (int)$row['row_count'] : count($table),
        'column_count' => isset($row['column_count']) ? (int)$row['column_count'] : 0,
        'line_count' => isset($row['line_count']) ? (int)$row['line_count'] : count($lines),
        'raw_text' => isset($row['raw_text']) ? $row['raw_text'] : '',
        'normalized_text' => isset($row['normalized_text']) ? $row['normalized_text'] : '',
        'content_hash' => isset($row['content_hash']) ? $row['content_hash'] : '',
        'client_scan_id' => isset($row['client_scan_id']) ? $row['client_scan_id'] : '',
        'qr_daily_key' => isset($row['qr_daily_key']) ? $row['qr_daily_key'] : '',
        'image_file' => isset($row['image_file']) ? $row['image_file'] : '',
        'qr_lookup_key' => isset($row['qr_lookup_key']) ? $row['qr_lookup_key'] : '',
        'qr_serial_lookup8' => isset($row['qr_serial_lookup8']) ? $row['qr_serial_lookup8'] : '',
        'qr_ems_lookup' => isset($row['qr_ems_lookup']) ? $row['qr_ems_lookup'] : (isset($row['qr_lookup_key']) ? $row['qr_lookup_key'] : ''),
        'scan_comment' => isset($row['scan_comment']) ? $row['scan_comment'] : '',
        'machine_status' => isset($row['machine_status']) ? $row['machine_status'] : '',
        'machine_serial' => isset($row['machine_serial']) ? $row['machine_serial'] : '',
        'machine_name' => isset($row['machine_name']) ? $row['machine_name'] : '',
        'machine_type' => isset($row['machine_type']) ? $row['machine_type'] : '',
        'machine_brand' => isset($row['machine_brand']) ? $row['machine_brand'] : '',
        'machine_model' => isset($row['machine_model']) ? $row['machine_model'] : '',
        'machine_accounting_code' => isset($row['machine_accounting_code']) ? $row['machine_accounting_code'] : '',
        'machine_factory' => isset($row['machine_factory']) ? $row['machine_factory'] : '',
        'machine_location' => isset($row['machine_location']) ? $row['machine_location'] : '',
        'machine_usedby' => isset($row['machine_usedby']) ? $row['machine_usedby'] : '',
        'machine_position' => isset($row['machine_position']) ? $row['machine_position'] : '',
        'machine_remark' => isset($row['machine_remark']) ? $row['machine_remark'] : '',
        'machine_manu_serial' => isset($row['machine_manu_serial']) ? $row['machine_manu_serial'] : '',
        'machine_purchase_date' => isset($row['machine_purchase_date']) ? $row['machine_purchase_date'] : '',
        'machine_updated_time' => isset($row['machine_updated_time']) ? $row['machine_updated_time'] : '',
        'machine_json' => isset($row['machine_json']) ? $row['machine_json'] : '',
        'inventory_datetime' => isset($row['inventory_datetime']) ? $row['inventory_datetime'] : '',
        'qr_ems' => (isset($row['qr_ems']) && $row['qr_ems'] !== '') ? $row['qr_ems'] : $qrFallback['qr_ems'],
        'qr_device_type' => (isset($row['qr_device_type']) && $row['qr_device_type'] !== '') ? $row['qr_device_type'] : $qrFallback['qr_device_type'],
        'qr_laptop_info' => (isset($row['qr_laptop_info']) && $row['qr_laptop_info'] !== '') ? $row['qr_laptop_info'] : $qrFallback['qr_laptop_info'],
        'qr_device_model' => (isset($row['qr_device_model']) && $row['qr_device_model'] !== '') ? $row['qr_device_model'] : $qrFallback['qr_device_model'],
        'qr_asset_code' => (isset($row['qr_asset_code']) && $row['qr_asset_code'] !== '') ? $row['qr_asset_code'] : $qrFallback['qr_asset_code'],
        'qr_device_serial_no' => (isset($row['qr_device_serial_no']) && $row['qr_device_serial_no'] !== '') ? $row['qr_device_serial_no'] : $qrFallback['qr_device_serial_no'],
        'qr_user_id' => (isset($row['qr_user_id']) && $row['qr_user_id'] !== '') ? $row['qr_user_id'] : $qrFallback['qr_user_id'],
        'qr_device_serial_info' => (isset($row['qr_device_serial_info']) && $row['qr_device_serial_info'] !== '') ? $row['qr_device_serial_info'] : $qrFallback['qr_device_serial_info'],
        'qr_user_dept' => (isset($row['qr_user_dept']) && $row['qr_user_dept'] !== '') ? $row['qr_user_dept'] : $qrFallback['qr_user_dept'],
        'qr_last_check' => (isset($row['qr_last_check']) && $row['qr_last_check'] !== '') ? $row['qr_last_check'] : $qrFallback['qr_last_check'],
        'created_at' => isset($row['created_at']) ? $row['created_at'] : '',
        'updated_at' => isset($row['updated_at']) ? $row['updated_at'] : '',
        'table' => $table,
        'lines' => $lines
    );
}

function fetch_record_by_id($conn, $id) {
    $id = (int)$id;
    $rs = mysqli_query($conn, "SELECT * FROM ocr_scan_records WHERE id={$id} LIMIT 1");
    if (!$rs) { return null; }
    $row = mysqli_fetch_assoc($rs);
    return $row ? row_to_array($conn, $row) : null;
}

function now_parts() {
    $now = new DateTime('now', new DateTimeZone('Asia/Ho_Chi_Minh'));
    return array(
        'date' => $now->format('Y-m-d'), 'time' => $now->format('H:i:s'), 'dt' => $now->format('Y-m-d H:i:s'),
        'y' => (int)$now->format('Y'), 'm' => (int)$now->format('m'), 'd' => (int)$now->format('d'),
        'h' => (int)$now->format('H'), 'i' => (int)$now->format('i'), 's' => (int)$now->format('s')
    );
}

function normalize_inventory_datetime($value) {
    $value = trim((string)$value);
    if ($value === '') { return ''; }
    $dt = DateTime::createFromFormat('Y-m-d H:i:s', $value, new DateTimeZone('Asia/Ho_Chi_Minh'));
    $errors = DateTime::getLastErrors();
    if ($dt === false) { return ''; }
    if (is_array($errors) && (!empty($errors['warning_count']) || !empty($errors['error_count']))) { return ''; }
    return $dt->format('Y-m-d H:i:s');
}

function normalize_client_scan_id($value) {
    $value = trim((string)$value);
    if ($value === '') { return ''; }
    $value = preg_replace('/[^A-Za-z0-9._:\-]/', '', $value);
    return substr($value, 0, 80);
}

function clean_scan_comment($value) {
    $value = trim((string)$value);
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value);
    if (function_exists('mb_substr')) { return mb_substr($value, 0, 1000, 'UTF-8'); }
    return substr($value, 0, 1000);
}

function qr_daily_dedupe_code($lookupKey, $parsed, $qrText) {
    $candidates = array(
        $lookupKey,
        isset($parsed['lookup_ems']) ? $parsed['lookup_ems'] : '',
        isset($parsed['ems']) ? $parsed['ems'] : '',
        isset($parsed['lookup_serial_full']) ? $parsed['lookup_serial_full'] : '',
        isset($parsed['device_serial_no']) ? $parsed['device_serial_no'] : ''
    );
    foreach ($candidates as $candidate) {
        $code = clean_lookup_code($candidate);
        if ($code !== '') { return substr($code, 0, 100); }
    }
    // QR không theo mẫu: vẫn tạo identity ổn định từ nội dung QR để không sinh bản ghi trùng.
    return substr(clean_lookup_code($qrText), 0, 100);
}

function qr_daily_key($user, $inventoryDate, $dedupeCode, $department = '') {
    $userKey = text_lower(preg_replace('/\s+/u', ' ', trim((string)$user)));
    $dateKey = trim((string)$inventoryDate);
    $codeKey = clean_lookup_code($dedupeCode);
    if ($userKey === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateKey) || $codeKey === '') { return ''; }
    $departmentKey = text_lower(preg_replace('/\s+/u', ' ', trim((string)$department)));
    return hash('sha256', $userKey . '|' . $departmentKey . '|' . $dateKey . '|' . $codeKey);
}

function find_same_user_code_day_qr($conn, $user, $inventoryDate, $dedupeCode, $dailyKey = '', $department = '') {
    $inventoryDate = trim((string)$inventoryDate);
    $dedupeCode = clean_lookup_code($dedupeCode);
    if ($user === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $inventoryDate) || $dedupeCode === '') { return null; }

    if ($dailyKey !== '') {
        $rs = mysqli_query($conn, "SELECT id FROM ocr_scan_records WHERE qr_daily_key='" . esc($conn, $dailyKey) . "' LIMIT 1");
        if (!$rs) { json_response(false, 'Lỗi kiểm tra QR theo khóa ngày: ' . mysqli_error($conn), null, 500); }
        if ($row = mysqli_fetch_assoc($rs)) { return fetch_record_by_id($conn, (int)$row['id']); }
    }

    $dt = DateTime::createFromFormat('!Y-m-d', $inventoryDate);
    if (!$dt) { return null; }
    $start = $dt->format('Y-m-d') . ' 00:00:00';
    $dt->modify('+1 day');
    $end = $dt->format('Y-m-d') . ' 00:00:00';
    $u = esc($conn, $user);
    $c = esc($conn, $dedupeCode);
    $departmentEsc = esc($conn, clean_department_name($department));
    $startEsc = esc($conn, $start);
    $endEsc = esc($conn, $end);

    // inventory_datetime là thời điểm scan thực tế. scan_datetime chỉ dùng fallback cho dữ liệu cũ.
    $sql = "SELECT id FROM ocr_scan_records
            WHERE source_type='qr'
              AND scan_user='{$u}'
              AND COALESCE(scan_department,'')='{$departmentEsc}'
              AND ((inventory_datetime>='{$startEsc}' AND inventory_datetime<'{$endEsc}')
                   OR (inventory_datetime IS NULL AND scan_datetime>='{$startEsc}' AND scan_datetime<'{$endEsc}'))
              AND (qr_ems_lookup='{$c}' OR qr_lookup_key='{$c}' OR qr_ems='{$c}' OR machine_serial='{$c}')
            ORDER BY COALESCE(inventory_datetime,scan_datetime) DESC, id DESC LIMIT 1";
    $rs = mysqli_query($conn, $sql);
    if (!$rs) { json_response(false, 'Lỗi kiểm tra trùng QR trong ngày: ' . mysqli_error($conn), null, 500); }
    $row = mysqli_fetch_assoc($rs);
    return $row ? fetch_record_by_id($conn, (int)$row['id']) : null;
}

function sql_datetime_parts($value) {
    $dt = DateTime::createFromFormat('Y-m-d H:i:s', (string)$value, new DateTimeZone('Asia/Ho_Chi_Minh'));
    if (!$dt) { return null; }
    return array(
        'date' => $dt->format('Y-m-d'), 'time' => $dt->format('H:i:s'), 'dt' => $dt->format('Y-m-d H:i:s'),
        'y' => (int)$dt->format('Y'), 'm' => (int)$dt->format('m'), 'd' => (int)$dt->format('d'),
        'h' => (int)$dt->format('H'), 'i' => (int)$dt->format('i'), 's' => (int)$dt->format('s')
    );
}

function update_same_day_qr_latest_time($conn, $recordId, $inventoryDatetime, $clientScanId, $dailyKey, $scanComment = '') {
    $recordId = (int)$recordId;
    if ($recordId <= 0) { return array('updated_latest' => false, 'record' => null); }

    $rs = mysqli_query($conn, "SELECT inventory_datetime,scan_datetime,qr_daily_key FROM ocr_scan_records WHERE id={$recordId} LIMIT 1");
    if (!$rs) { json_response(false, 'Lỗi đọc bản ghi QR trùng: ' . mysqli_error($conn), null, 500); }
    $current = mysqli_fetch_assoc($rs);
    if (!$current) { return array('updated_latest' => false, 'record' => null); }

    $currentDt = trim((string)(isset($current['inventory_datetime']) && $current['inventory_datetime'] !== '' ? $current['inventory_datetime'] : $current['scan_datetime']));
    $incomingTs = strtotime($inventoryDatetime);
    $currentTs = $currentDt !== '' ? strtotime($currentDt) : false;
    $isNewer = ($incomingTs !== false) && ($currentTs === false || $incomingTs >= $currentTs);

    $sets = array();
    if ($dailyKey !== '' && (!isset($current['qr_daily_key']) || (string)$current['qr_daily_key'] === '')) {
        $sets[] = "qr_daily_key='" . esc($conn, $dailyKey) . "'";
    }

    if ($scanComment !== '') { $sets[] = "scan_comment='" . esc($conn, $scanComment) . "'"; }

    if ($isNewer) {
        $parts = sql_datetime_parts($inventoryDatetime);
        if ($parts) {
            $sets[] = "inventory_datetime='" . esc($conn, $parts['dt']) . "'";
            // QR hiển thị/ngày báo cáo phải phản ánh thời điểm scan thực tế, không phải lúc queue đồng bộ.
            $sets[] = "scan_date='" . esc($conn, $parts['date']) . "'";
            $sets[] = "scan_time='" . esc($conn, $parts['time']) . "'";
            $sets[] = "scan_datetime='" . esc($conn, $parts['dt']) . "'";
            $sets[] = "scan_year=" . (int)$parts['y'];
            $sets[] = "scan_month=" . (int)$parts['m'];
            $sets[] = "scan_day=" . (int)$parts['d'];
            $sets[] = "scan_hour=" . (int)$parts['h'];
            $sets[] = "scan_minute=" . (int)$parts['i'];
            $sets[] = "scan_second=" . (int)$parts['s'];
            if ($clientScanId !== '') { $sets[] = "client_scan_id='" . esc($conn, $clientScanId) . "'"; }
        }
    }
    if (count($sets)) {
        $sets[] = "updated_at=NOW()";
        if (!mysqli_query($conn, "UPDATE ocr_scan_records SET " . implode(',', $sets) . " WHERE id={$recordId} LIMIT 1")) {
            if (mysqli_errno($conn) !== 1062) {
                json_response(false, 'Lỗi cập nhật thời gian QR mới nhất: ' . mysqli_error($conn), null, 500);
            }
        }
    }

    return array('updated_latest' => $isNewer, 'record' => fetch_record_by_id($conn, $recordId));
}

function insert_record($conn, $user, $sourceType, $table, $rawText, $hash, $imageFile, $extra) {
    $now = now_parts();
    if (isset($extra['record_datetime']) && $extra['record_datetime'] !== '') {
        $eventParts = sql_datetime_parts($extra['record_datetime']);
        if ($eventParts) { $now = $eventParts; }
    }
    $maxCols = 0;
    foreach ($table as $r) { if (count($r) > $maxCols) { $maxCols = count($r); } }
    $tableJson = json_encode($table, JSON_UNESCAPED_UNICODE);
    $cols = array('scan_user','scan_department','source_type','scan_date','scan_time','scan_datetime','scan_year','scan_month','scan_day','scan_hour','scan_minute','scan_second','row_count','column_count','line_count','raw_text','normalized_text','table_json','content_hash','client_scan_id','qr_daily_key','scan_comment','image_file','qr_lookup_key','qr_serial_lookup8','qr_ems_lookup','machine_status','machine_serial','machine_name','machine_type','machine_brand','machine_model','machine_accounting_code','machine_factory','machine_location','machine_usedby','machine_position','machine_remark','machine_manu_serial','machine_purchase_date','machine_updated_time','machine_json','inventory_datetime','qr_ems','qr_device_type','qr_laptop_info','qr_device_model','qr_asset_code','qr_device_serial_no','qr_user_id','qr_device_serial_info','qr_user_dept','qr_last_check');
    $vals = array(
        "'" . esc($conn, $user) . "'",
        isset($extra['scan_department']) && $extra['scan_department'] !== '' ? "'" . esc($conn, $extra['scan_department']) . "'" : 'NULL',
        "'" . esc($conn, $sourceType) . "'", "'" . esc($conn, $now['date']) . "'", "'" . esc($conn, $now['time']) . "'", "'" . esc($conn, $now['dt']) . "'",
        $now['y'], $now['m'], $now['d'], $now['h'], $now['i'], $now['s'],
        count($table), $maxCols, count($table),
        "'" . esc($conn, $rawText) . "'",
        "'" . esc($conn, normalized_text_for_hash($sourceType, $table, isset($extra['hash_extra']) ? $extra['hash_extra'] : '')) . "'",
        "'" . esc($conn, $tableJson) . "'",
        "'" . esc($conn, $hash) . "'",
        isset($extra['client_scan_id']) && $extra['client_scan_id'] !== '' ? "'" . esc($conn, $extra['client_scan_id']) . "'" : 'NULL',
        isset($extra['qr_daily_key']) && $extra['qr_daily_key'] !== '' ? "'" . esc($conn, $extra['qr_daily_key']) . "'" : 'NULL',
        isset($extra['scan_comment']) && $extra['scan_comment'] !== '' ? "'" . esc($conn, $extra['scan_comment']) . "'" : 'NULL',
        $imageFile === '' ? 'NULL' : "'" . esc($conn, $imageFile) . "'",
        isset($extra['qr_lookup_key']) && $extra['qr_lookup_key'] !== '' ? "'" . esc($conn, $extra['qr_lookup_key']) . "'" : 'NULL',
        isset($extra['qr_serial_lookup8']) && $extra['qr_serial_lookup8'] !== '' ? "'" . esc($conn, $extra['qr_serial_lookup8']) . "'" : 'NULL',
        isset($extra['qr_ems_lookup']) && $extra['qr_ems_lookup'] !== '' ? "'" . esc($conn, $extra['qr_ems_lookup']) . "'" : 'NULL',
        isset($extra['machine_status']) && $extra['machine_status'] !== '' ? "'" . esc($conn, $extra['machine_status']) . "'" : 'NULL',
        isset($extra['machine_serial']) && $extra['machine_serial'] !== '' ? "'" . esc($conn, $extra['machine_serial']) . "'" : 'NULL',
        isset($extra['machine_name']) && $extra['machine_name'] !== '' ? "'" . esc($conn, $extra['machine_name']) . "'" : 'NULL',
        isset($extra['machine_type']) && $extra['machine_type'] !== '' ? "'" . esc($conn, $extra['machine_type']) . "'" : 'NULL',
        isset($extra['machine_brand']) && $extra['machine_brand'] !== '' ? "'" . esc($conn, $extra['machine_brand']) . "'" : 'NULL',
        isset($extra['machine_model']) && $extra['machine_model'] !== '' ? "'" . esc($conn, $extra['machine_model']) . "'" : 'NULL',
        isset($extra['machine_accounting_code']) && $extra['machine_accounting_code'] !== '' ? "'" . esc($conn, $extra['machine_accounting_code']) . "'" : 'NULL',
        isset($extra['machine_factory']) && $extra['machine_factory'] !== '' ? "'" . esc($conn, $extra['machine_factory']) . "'" : 'NULL',
        isset($extra['machine_location']) && $extra['machine_location'] !== '' ? "'" . esc($conn, $extra['machine_location']) . "'" : 'NULL',
        isset($extra['machine_usedby']) && $extra['machine_usedby'] !== '' ? "'" . esc($conn, $extra['machine_usedby']) . "'" : 'NULL',
        isset($extra['machine_position']) && $extra['machine_position'] !== '' ? "'" . esc($conn, $extra['machine_position']) . "'" : 'NULL',
        isset($extra['machine_remark']) && $extra['machine_remark'] !== '' ? "'" . esc($conn, $extra['machine_remark']) . "'" : 'NULL',
        isset($extra['machine_manu_serial']) && $extra['machine_manu_serial'] !== '' ? "'" . esc($conn, $extra['machine_manu_serial']) . "'" : 'NULL',
        isset($extra['machine_purchase_date']) && $extra['machine_purchase_date'] !== '' ? "'" . esc($conn, $extra['machine_purchase_date']) . "'" : 'NULL',
        isset($extra['machine_updated_time']) && $extra['machine_updated_time'] !== '' ? "'" . esc($conn, $extra['machine_updated_time']) . "'" : 'NULL',
        isset($extra['machine_json']) && $extra['machine_json'] !== '' ? "'" . esc($conn, $extra['machine_json']) . "'" : 'NULL',
        isset($extra['inventory_datetime']) && $extra['inventory_datetime'] !== '' ? "'" . esc($conn, $extra['inventory_datetime']) . "'" : "'" . esc($conn, $now['dt']) . "'",
        isset($extra['qr_ems']) && $extra['qr_ems'] !== '' ? "'" . esc($conn, $extra['qr_ems']) . "'" : 'NULL',
        isset($extra['qr_device_type']) && $extra['qr_device_type'] !== '' ? "'" . esc($conn, $extra['qr_device_type']) . "'" : 'NULL',
        isset($extra['qr_laptop_info']) && $extra['qr_laptop_info'] !== '' ? "'" . esc($conn, $extra['qr_laptop_info']) . "'" : 'NULL',
        isset($extra['qr_device_model']) && $extra['qr_device_model'] !== '' ? "'" . esc($conn, $extra['qr_device_model']) . "'" : 'NULL',
        isset($extra['qr_asset_code']) && $extra['qr_asset_code'] !== '' ? "'" . esc($conn, $extra['qr_asset_code']) . "'" : 'NULL',
        isset($extra['qr_device_serial_no']) && $extra['qr_device_serial_no'] !== '' ? "'" . esc($conn, $extra['qr_device_serial_no']) . "'" : 'NULL',
        isset($extra['qr_user_id']) && $extra['qr_user_id'] !== '' ? "'" . esc($conn, $extra['qr_user_id']) . "'" : 'NULL',
        isset($extra['qr_device_serial_info']) && $extra['qr_device_serial_info'] !== '' ? "'" . esc($conn, $extra['qr_device_serial_info']) . "'" : 'NULL',
        isset($extra['qr_user_dept']) && $extra['qr_user_dept'] !== '' ? "'" . esc($conn, $extra['qr_user_dept']) . "'" : 'NULL',
        isset($extra['qr_last_check']) && $extra['qr_last_check'] !== '' ? "'" . esc($conn, $extra['qr_last_check']) . "'" : 'NULL'
    );
    for ($i = 1; $i <= 50; $i++) {
        $col = 'line_' . str_pad((string)$i, 2, '0', STR_PAD_LEFT);
        $cols[] = $col;
        $line = isset($table[$i - 1]) ? implode(' | ', $table[$i - 1]) : '';
        $vals[] = $line === '' ? 'NULL' : "'" . esc($conn, $line) . "'";
    }
    $sql = "INSERT INTO ocr_scan_records (`" . implode('`,`', $cols) . "`) VALUES (" . implode(',', $vals) . ")";
    if (count($cols) !== count($vals)) {
        app_log('critical', 'mysql_insert_contract_mismatch', array('columns'=>count($cols),'values'=>count($vals),'source_type'=>$sourceType));
        json_response(false, 'Cấu trúc dữ liệu lưu MySQL không đồng bộ. Request ID: ' . kiemke_request_id(), null, 500);
    }
    if (!mysqli_query($conn, $sql)) {
        if (mysqli_errno($conn) == 1062) {
            // Race-safe idempotency: nếu hai retry đến gần như đồng thời, trả lại record đã tồn tại.
            $existingId = 0;
            if (isset($extra['client_scan_id']) && $extra['client_scan_id'] !== '') {
                $dupRs = mysqli_query($conn, "SELECT id FROM ocr_scan_records WHERE client_scan_id='" . esc($conn, $extra['client_scan_id']) . "' LIMIT 1");
                if ($dupRs && ($dupRow = mysqli_fetch_assoc($dupRs))) { $existingId = (int)$dupRow['id']; }
            }
            if ($existingId <= 0 && isset($extra['qr_daily_key']) && $extra['qr_daily_key'] !== '') {
                $dupRs = mysqli_query($conn, "SELECT id FROM ocr_scan_records WHERE qr_daily_key='" . esc($conn, $extra['qr_daily_key']) . "' LIMIT 1");
                if ($dupRs && ($dupRow = mysqli_fetch_assoc($dupRs))) { $existingId = (int)$dupRow['id']; }
            }
            if ($existingId <= 0) {
                $dupRs = mysqli_query($conn, "SELECT id FROM ocr_scan_records WHERE content_hash='" . esc($conn, $hash) . "' LIMIT 1");
                if ($dupRs && ($dupRow = mysqli_fetch_assoc($dupRs))) { $existingId = (int)$dupRow['id']; }
            }
            $updatedLatest = false;
            $record = $existingId > 0 ? fetch_record_by_id($conn, $existingId) : null;
            if ($existingId > 0 && isset($extra['qr_daily_key']) && $extra['qr_daily_key'] !== '' && isset($extra['inventory_datetime']) && $extra['inventory_datetime'] !== '') {
                $up = update_same_day_qr_latest_time(
                    $conn,
                    $existingId,
                    $extra['inventory_datetime'],
                    isset($extra['client_scan_id']) ? $extra['client_scan_id'] : '',
                    $extra['qr_daily_key'],
                    isset($extra['scan_comment']) ? $extra['scan_comment'] : ''
                );
                $updatedLatest = !empty($up['updated_latest']);
                $record = isset($up['record']) ? $up['record'] : $record;
            }
            return array('duplicate' => true, 'updated_latest' => $updatedLatest, 'record' => $record);
        }
        json_response(false, 'Lỗi lưu MySQL: ' . mysqli_error($conn), null, 500);
    }
    $id = mysqli_insert_id($conn);
    insert_cells($conn, $id, $table);
    return array('duplicate' => false, 'record' => fetch_record_by_id($conn, $id));
}

if (defined('KIEMKE_API_LIB_ONLY') && KIEMKE_API_LIB_ONLY) { return; }

$action = isset($_GET['action']) ? $_GET['action'] : '';
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'POST') { kiemke_require_csrf(); }

if ($action === 'setUser') {
    $body = read_json_body();
    $name = clean_user_name(isset($body['name']) ? $body['name'] : '');
    $department = clean_department_name(isset($body['department']) ? $body['department'] : '');
    if ($name === '') { json_response(false, 'Vui lòng nhập tên người scan.', null, 400); }
    if ($department === '') { json_response(false, 'Vui lòng nhập hoặc chọn phòng ban scan.', null, 400); }
    $_SESSION['scan_user'] = $name;
    $_SESSION['scan_department'] = $department;
    setcookie('scan_user', $name, time() + 365 * 24 * 60 * 60, '/', '', false, true);
    setcookie('scan_department', $department, time() + 365 * 24 * 60 * 60, '/', '', false, true);
    json_response(true, 'Đã lưu người scan và phòng ban.', array('user' => $name, 'department' => $department));
}

if ($action === 'getUser') {
    $user = isset($_SESSION['scan_user']) ? $_SESSION['scan_user'] : (isset($_COOKIE['scan_user']) ? $_COOKIE['scan_user'] : '');
    $department = isset($_SESSION['scan_department']) ? $_SESSION['scan_department'] : (isset($_COOKIE['scan_department']) ? $_COOKIE['scan_department'] : '');
    json_response(true, '', array('user' => $user, 'department' => $department));
}

if ($action === 'listDepartments') {
    $conn = include_db();
    $rs = mysqli_query($conn, "SELECT DISTINCT scan_department FROM ocr_scan_records WHERE scan_department IS NOT NULL AND scan_department<>'' ORDER BY scan_department LIMIT 500");
    if (!$rs) { json_response(false, 'Không tải được danh sách phòng ban: ' . mysqli_error($conn), null, 500); }
    $departments = array(); while ($row = mysqli_fetch_assoc($rs)) { $departments[] = $row['scan_department']; }
    json_response(true, '', array('departments' => $departments));
}

if ($action === 'departmentStats') {
    $conn = include_db();
    $user = clean_user_name(isset($_GET['user']) ? $_GET['user'] : '');
    $department = clean_department_name(isset($_GET['department']) ? $_GET['department'] : '');
    $date = isset($_GET['date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date']) ? $_GET['date'] : date('Y-m-d');
    if ($user === '' || $department === '') { json_response(false, 'Thiếu người scan hoặc phòng ban.', null, 400); }
    $sql = "SELECT COUNT(*) AS saved_count FROM ocr_scan_records WHERE source_type='qr' AND scan_user='" . esc($conn, $user) . "' AND scan_department='" . esc($conn, $department) . "' AND DATE(COALESCE(inventory_datetime,scan_datetime))='" . esc($conn, $date) . "'";
    $rs = mysqli_query($conn, $sql); if (!$rs) { json_response(false, 'Không đếm được dữ liệu phòng ban: ' . mysqli_error($conn), null, 500); }
    $row = mysqli_fetch_assoc($rs); json_response(true, '', array('saved_count' => (int)$row['saved_count'], 'date' => $date, 'department' => $department));
}

if ($action === 'saveTargetStatus') {
    $conn = include_db();
    $rs = mysqli_query($conn, 'SELECT DATABASE() AS database_name');
    $row = $rs ? mysqli_fetch_assoc($rs) : array();
    json_response(true, '', array('save_target'=>'mysql','database'=>isset($row['database_name']) ? $row['database_name'] : '','writable_connection'=>true));
}

if ($action === 'updateQrComment') {
    $conn = include_db();
    $body = read_json_body();
    $user = clean_user_name(isset($body['scan_user']) ? $body['scan_user'] : (isset($_SESSION['scan_user']) ? $_SESSION['scan_user'] : ''));
    $clientScanId = normalize_client_scan_id(isset($body['client_scan_id']) ? $body['client_scan_id'] : '');
    $recordIdInput = isset($body['id']) ? (int)$body['id'] : 0;
    $comment = clean_scan_comment(isset($body['scan_comment']) ? $body['scan_comment'] : '');
    if ($user === '' || ($clientScanId === '' && $recordIdInput <= 0)) { json_response(false, 'Thiếu người scan và định danh bản scan.', null, 400); }
    $userEsc = esc($conn, $user);
    if ($recordIdInput > 0) {
        $rs = mysqli_query($conn, "SELECT id FROM ocr_scan_records WHERE id={$recordIdInput} AND source_type='qr' AND scan_user='{$userEsc}' LIMIT 1");
    } else {
        $idEsc = esc($conn, $clientScanId);
        $rs = mysqli_query($conn, "SELECT id FROM ocr_scan_records WHERE source_type='qr' AND client_scan_id='{$idEsc}' AND scan_user='{$userEsc}' LIMIT 1");
    }
    if (!$rs) { json_response(false, 'Lỗi tìm bản ghi comment: ' . mysqli_error($conn), null, 500); }
    $row = mysqli_fetch_assoc($rs);
    if (!$row) { json_response(false, 'Không tìm thấy bản scan QR để cập nhật ghi chú / Device note record not found.', null, 404); }
    $recordId = (int)$row['id'];
    if (!mysqli_query($conn, "UPDATE ocr_scan_records SET scan_comment='" . esc($conn, $comment) . "', updated_at=NOW() WHERE id={$recordId} LIMIT 1")) {
        json_response(false, 'Lỗi cập nhật comment: ' . mysqli_error($conn), null, 500);
    }
    json_response(true, 'Đã cập nhật comment.', array('record' => fetch_record_by_id($conn, $recordId)));
}

if ($action === 'pushTable') {
    $conn = include_db();
    $body = read_json_body();
    $user = clean_user_name(isset($body['scan_user']) ? $body['scan_user'] : (isset($_SESSION['scan_user']) ? $_SESSION['scan_user'] : ''));
    if ($user === '') { json_response(false, 'Vui lòng nhập tên người scan trước khi save to server.', null, 400); }
    $table = normalize_table(isset($body['table']) ? $body['table'] : array(), $GLOBALS['MAX_ROWS'], $GLOBALS['MAX_COLS']);
    if (!count($table)) { json_response(false, 'Không có dữ liệu OCR hợp lệ để lưu.', null, 400); }
    $rawText = table_to_raw_text($table);
    $hash = hash('sha256', normalized_text_for_hash('ocr', $table, ''));
    $dupRs = mysqli_query($conn, "SELECT id FROM ocr_scan_records WHERE content_hash='" . esc($conn, $hash) . "' LIMIT 1");
    if (!$dupRs) { json_response(false, 'Lỗi kiểm tra trùng dữ liệu: ' . mysqli_error($conn), null, 500); }
    if ($dup = mysqli_fetch_assoc($dupRs)) { json_response(true, 'Dữ liệu OCR đã tồn tại, hệ thống không ghi trùng.', array('duplicate' => true, 'record' => fetch_record_by_id($conn, (int)$dup['id']))); }
    $imageFile = save_image_data_url(isset($body['image_data_url']) ? $body['image_data_url'] : '', $GLOBALS['UPLOAD_DIR']);
    $res = insert_record($conn, $user, 'ocr', $table, $rawText, $hash, $imageFile, array());
    $res['save_target'] = 'mysql';
    json_response(true, $res['duplicate'] ? 'Dữ liệu OCR đã tồn tại trong MySQL.' : 'Đã lưu dữ liệu OCR vào MySQL.', $res);
}

if ($action === 'pushQr') {
    $conn = include_db();
    $body = read_json_body();
    $user = clean_user_name(isset($body['scan_user']) ? $body['scan_user'] : (isset($_SESSION['scan_user']) ? $_SESSION['scan_user'] : ''));
    $scanDepartment = clean_department_name(isset($body['scan_department']) ? $body['scan_department'] : (isset($_SESSION['scan_department']) ? $_SESSION['scan_department'] : ''));
    $saveTarget = 'mysql';
    if ($user === '') { json_response(false, 'Vui lòng nhập tên người scan trước khi save to server.', null, 400); }
    if ($scanDepartment === '') { json_response(false, 'Vui lòng nhập phòng ban scan trước khi save to server.', null, 400); }

    $qrText = normalize_cell(isset($body['qr_text']) ? $body['qr_text'] : '');
    $parsed = parse_qr_asset($qrText);
    $manualKey = isset($body['lookup_key']) ? trim((string)$body['lookup_key']) : '';
    $lookupKey = $manualKey !== '' ? clean_lookup_code($manualKey) : ems_lookup_key($parsed['ems']);
    if ($lookupKey === '' && $parsed['lookup_ems'] !== '') { $lookupKey = $parsed['lookup_ems']; }
    if ($qrText === '' && $lookupKey === '') { json_response(false, 'Chưa có nội dung QR hoặc EMS để lưu.', null, 400); }

    $scanComment = clean_scan_comment(isset($body['scan_comment']) ? $body['scan_comment'] : '');

    // Idempotency cho offline queue/retry: cùng một lần scan chỉ ghi DB một lần,
    // kể cả khi request đã INSERT thành công nhưng client mất kết nối trước khi nhận response.
    $clientScanId = normalize_client_scan_id(isset($body['client_scan_id']) ? $body['client_scan_id'] : '');
    if ($clientScanId !== '') {
        $scanIdRs = mysqli_query($conn, "SELECT id FROM ocr_scan_records WHERE client_scan_id='" . esc($conn, $clientScanId) . "' LIMIT 1");
        if (!$scanIdRs) { json_response(false, 'Lỗi kiểm tra mã đồng bộ scan: ' . mysqli_error($conn), null, 500); }
        if ($scanIdRow = mysqli_fetch_assoc($scanIdRs)) {
            $existingId = (int)$scanIdRow['id'];
            if ($scanComment !== '') { mysqli_query($conn, "UPDATE ocr_scan_records SET scan_comment='" . esc($conn, $scanComment) . "', updated_at=NOW() WHERE id={$existingId} LIMIT 1"); }
            app_log('info', 'qr_sync_idempotent', array('record_id'=>$existingId,'client_scan_id'=>$clientScanId));
            json_response(true, 'Bản scan đã được đồng bộ trước đó.', array('duplicate' => true, 'record' => fetch_record_by_id($conn, $existingId)));
        }
    }

    $inventoryDatetime = normalize_inventory_datetime(isset($body['inventory_datetime']) ? $body['inventory_datetime'] : '');
    if ($inventoryDatetime === '') { $inventoryDatetime = date('Y-m-d H:i:s'); }

    $machineRows = isset($body['machine_rows']) && is_array($body['machine_rows']) ? $body['machine_rows'] : array();
    $first = count($machineRows) ? $machineRows[0] : array();

    // Production v35 duplicate rule: one QR/device code + physical scan day + person = one DB row.
    // The unique qr_daily_key makes the rule race-safe even when multiple tablets sync together.
    $inventoryDate = substr($inventoryDatetime, 0, 10);
    $dedupeCode = qr_daily_dedupe_code($lookupKey, $parsed, $qrText);
    $dailyKey = qr_daily_key($user, $inventoryDate, $dedupeCode, $scanDepartment);
    $sameDayRecord = $dedupeCode !== '' ? find_same_user_code_day_qr($conn, $user, $inventoryDate, $dedupeCode, $dailyKey, $scanDepartment) : null;
    if ($sameDayRecord) {
        // Không INSERT record mới. Nếu đây là lần scan mới hơn, chỉ cập nhật thời gian mới nhất
        // của record đã có. Điều này cũng xử lý đúng queue offline đồng bộ muộn.
        $up = update_same_day_qr_latest_time($conn, (int)$sameDayRecord['id'], $inventoryDatetime, $clientScanId, $dailyKey, $scanComment);
        app_log('info', 'qr_same_day_duplicate', array('record_id'=>(int)$sameDayRecord['id'],'dedupe_code'=>$dedupeCode,'inventory_date'=>$inventoryDate,'updated_latest'=>!empty($up['updated_latest'])));
        json_response(true, !empty($up['updated_latest'])
            ? 'QR đã có trong ngày; đã cập nhật thời gian scan mới nhất, không ghi thêm record.'
            : 'QR đã có trong ngày; không ghi trùng record.', array(
            'duplicate' => true,
            'updated_latest' => !empty($up['updated_latest']),
            'duplicate_scope' => 'same_user_code_day',
            'dedupe_code' => $dedupeCode,
            'inventory_date' => $inventoryDate,
            'record' => isset($up['record']) ? $up['record'] : $sameDayRecord
        ));
    }

    // Lưu QR theo cấu trúc yêu cầu. Không lưu toàn bộ raw QR thành dòng chính; raw QR vẫn lưu ở raw_text/hash để đối chiếu.
    $table = isset($parsed['display_table']) && is_array($parsed['display_table']) ? $parsed['display_table'] : array();
    if (!count($table)) { $table = array(array('QR Code', $qrText)); }

    if (count($machineRows)) {
        $table[] = array('Machine Status', isset($first['Status']) ? normalize_cell($first['Status']) : '');
        $table[] = array('Machine Name', isset($first['McName']) ? normalize_cell($first['McName']) : '');
        $table[] = array('Machine Type', isset($first['McType']) ? normalize_cell($first['McType']) : '');
        $table[] = array('Machine Brand', isset($first['McBrand']) ? normalize_cell($first['McBrand']) : '');
        $table[] = array('Machine Model', isset($first['McModel']) ? normalize_cell($first['McModel']) : '');
        $table[] = array('McSerialNumber', isset($first['McSerialNumber']) ? normalize_cell($first['McSerialNumber']) : '');
        $table[] = array('AccountingCode', isset($first['AccountingCode']) ? normalize_cell($first['AccountingCode']) : '');
        $table[] = array('CurrentLocation', isset($first['CurrentLocation']) ? normalize_cell($first['CurrentLocation']) : '');
        $table[] = array('Factory', isset($first['Factory']) ? normalize_cell($first['Factory']) : '');
        $table[] = array('Usedby', isset($first['Usedby']) ? normalize_cell($first['Usedby']) : '');
        $table[] = array('UpdatedTime', isset($first['UpdatedTime']) ? normalize_cell($first['UpdatedTime']) : '');
    } else {
        $table[] = array('Machine Result', 'Not Found');
    }

    $table = normalize_table($table, $GLOBALS['MAX_ROWS'], $GLOBALS['MAX_COLS']);
    $rawText = table_to_raw_text($table) . ($qrText !== '' ? "\nRAW_QR\t" . $qrText : '');
    // Cho phép cùng thiết bị được kiểm kê ở lần/thời điểm khác; retry của cùng scan được khóa bằng client_scan_id.
    $hash = hash('sha256', normalized_text_for_hash('qr', $table, $qrText . '|' . $lookupKey . '|' . $inventoryDatetime));
    $dupRs = mysqli_query($conn, "SELECT id FROM ocr_scan_records WHERE content_hash='" . esc($conn, $hash) . "' LIMIT 1");
    if (!$dupRs) { json_response(false, 'Lỗi kiểm tra trùng dữ liệu QR: ' . mysqli_error($conn), null, 500); }
    if ($dup = mysqli_fetch_assoc($dupRs)) {
        json_response(true, 'Dữ liệu QR đã tồn tại, hệ thống không ghi trùng.', array('duplicate' => true, 'record' => fetch_record_by_id($conn, (int)$dup['id'])));
    }

    $imageFile = save_image_data_url(isset($body['image_data_url']) ? $body['image_data_url'] : '', $GLOBALS['UPLOAD_DIR']);
    $extra = array(
        'client_scan_id' => $clientScanId,
        'scan_department' => $scanDepartment,
        'qr_daily_key' => $dailyKey,
        'scan_comment' => $scanComment,
        'record_datetime' => $inventoryDatetime,
        'qr_lookup_key' => $lookupKey,
        'qr_serial_lookup8' => $parsed['lookup_serial_8'],
        'qr_ems_lookup' => $lookupKey,
        'machine_status' => isset($first['Status']) ? normalize_cell($first['Status']) : '',
        // machine_serial là serial từ Overview nếu có; qr_device_serial_no bên dưới luôn là Device Serial No bóc tách từ QR.
        'machine_serial' => isset($first['McSerialNumber']) ? normalize_cell($first['McSerialNumber']) : '',
        'machine_name' => isset($first['McName']) ? normalize_cell($first['McName']) : '',
        'machine_type' => isset($first['McType']) ? normalize_cell($first['McType']) : '',
        'machine_brand' => isset($first['McBrand']) ? normalize_cell($first['McBrand']) : '',
        'machine_model' => isset($first['McModel']) ? normalize_cell($first['McModel']) : '',
        'machine_accounting_code' => isset($first['AccountingCode']) ? normalize_cell($first['AccountingCode']) : '',
        'machine_factory' => isset($first['Factory']) ? normalize_cell($first['Factory']) : '',
        'machine_location' => isset($first['CurrentLocation']) ? normalize_cell($first['CurrentLocation']) : '',
        'machine_usedby' => isset($first['Usedby']) ? normalize_cell($first['Usedby']) : '',
        'machine_position' => isset($first['Position']) ? normalize_cell($first['Position']) : '',
        'machine_remark' => isset($first['Remark']) ? normalize_cell($first['Remark']) : '',
        'machine_manu_serial' => isset($first['ManuSerialNo']) ? normalize_cell($first['ManuSerialNo']) : '',
        'machine_purchase_date' => isset($first['PurchaseDate']) ? normalize_cell($first['PurchaseDate']) : '',
        'machine_updated_time' => isset($first['UpdatedTime']) ? normalize_cell($first['UpdatedTime']) : '',
        'machine_json' => json_encode(array('qr_parsed' => $parsed, 'overview_rows' => $machineRows), JSON_UNESCAPED_UNICODE),
        'inventory_datetime' => $inventoryDatetime,
        'qr_ems' => $parsed['ems'],
        'qr_device_type' => $parsed['device_type'],
        'qr_laptop_info' => $parsed['device_laptop_info'],
        'qr_device_model' => $parsed['device_model'],
        'qr_asset_code' => $parsed['asset_code'],
        'qr_device_serial_no' => $parsed['device_serial_no'],
        'qr_user_id' => $parsed['user_id'],
        'qr_device_serial_info' => $parsed['device_serial_info'],
        'qr_user_dept' => $parsed['user_dept'],
        'qr_last_check' => $parsed['last_check'],
        'hash_extra' => $qrText . '|' . $lookupKey
    );
    $res = insert_record($conn, $user, 'qr', $table, $rawText, $hash, $imageFile, $extra);
    app_log('info', $res['duplicate'] ? 'qr_duplicate' : 'qr_saved', array(
        'record_id'=>isset($res['record']['id']) ? (int)$res['record']['id'] : 0,
        'client_scan_id'=>$clientScanId,
        'lookup_key'=>$lookupKey,
        'inventory_datetime'=>$inventoryDatetime,
        'machine_rows'=>count($machineRows),
        'lookup_data_source'=>isset($body['lookup_data_source']) && strtolower((string)$body['lookup_data_source']) === 'mysql' ? 'mysql' : 'mssql',
        'save_target'=>$saveTarget
    ));
    $res['save_target'] = $saveTarget;
    json_response(true, $res['duplicate'] ? 'Dữ liệu QR đã tồn tại trong MySQL.' : 'Đã lưu dữ liệu QR vào MySQL.', $res);
}

if ($action === 'listRecords') {
    $conn = include_db();
    $date = isset($_GET['date']) ? trim($_GET['date']) : '';
    $search = isset($_GET['search']) ? trim($_GET['search']) : '';
    $user = isset($_GET['user']) ? clean_user_name($_GET['user']) : '';
    $sourceType = isset($_GET['source_type']) ? trim($_GET['source_type']) : '';
    $allUsers = isset($_GET['all_users']) && (string)$_GET['all_users'] === '1';
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 5000;
    if ($limit < 1 || $limit > 10000) { $limit = 5000; }
    $where = array('1=1');
    if ($date !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        $dateEsc = esc($conn, $date);
        // QR records belong to the day they were physically scanned, even if an offline
        // queue is synchronized later. OCR keeps its existing server scan_date behavior.
        $where[] = "((source_type='qr' AND DATE(COALESCE(inventory_datetime,scan_datetime))='{$dateEsc}') OR (source_type<>'qr' AND scan_date='{$dateEsc}'))";
    }
    if ($sourceType !== '' && $sourceType !== 'all') { $where[] = "source_type='" . esc($conn, $sourceType) . "'"; }
    if (!$allUsers && $user !== '') { $where[] = "scan_user='" . esc($conn, $user) . "'"; }
    if ($allUsers && $user !== '') { $where[] = "scan_user LIKE '%" . esc($conn, $user) . "%'"; }
    if ($search !== '') {
        $searchWhere = build_fuzzy_search_where($conn, $search);
        if ($searchWhere !== '') { $where[] = $searchWhere; }
    }
    $sql = "SELECT * FROM ocr_scan_records WHERE " . implode(' AND ', $where) . " ORDER BY scan_datetime DESC, id DESC LIMIT {$limit}";
    $rs = mysqli_query($conn, $sql);
    if (!$rs) { json_response(false, 'Lỗi tải dữ liệu: ' . mysqli_error($conn), null, 500); }
    $rows = array();
    while ($row = mysqli_fetch_assoc($rs)) { $rows[] = row_to_array($conn, $row); }
    json_response(true, '', array('rows' => $rows));
}

if ($action === 'deleteRecord') {
    $conn = include_db();
    $body = read_json_body();
    $id = isset($body['id']) ? (int)$body['id'] : 0;
    if ($id <= 0) { json_response(false, 'ID không hợp lệ.', null, 400); }
    @mysqli_query($conn, "DELETE FROM ocr_scan_cells WHERE record_id={$id}");
    if (!mysqli_query($conn, "DELETE FROM ocr_scan_records WHERE id={$id} LIMIT 1")) { json_response(false, 'Lỗi xóa dữ liệu: ' . mysqli_error($conn), null, 500); }
    json_response(true, 'Đã xóa dữ liệu.', array('id' => $id));
}

if ($action === 'updateRecordTable') {
    $conn = include_db();
    $body = read_json_body();
    $id = isset($body['id']) ? (int)$body['id'] : 0;
    if ($id <= 0) { json_response(false, 'ID không hợp lệ.', null, 400); }
    $old = fetch_record_by_id($conn, $id);
    if (!$old) { json_response(false, 'Không tìm thấy record.', null, 404); }
    $sourceType = isset($old['source_type']) ? $old['source_type'] : 'ocr';
    $table = normalize_table(isset($body['table']) ? $body['table'] : array(), $GLOBALS['MAX_ROWS'], $GLOBALS['MAX_COLS']);
    if (!count($table)) { json_response(false, 'Không có dữ liệu hợp lệ để cập nhật.', null, 400); }
    $rawText = table_to_raw_text($table);
    $hash = hash('sha256', normalized_text_for_hash($sourceType, $table, ''));
    $dupRs = mysqli_query($conn, "SELECT id FROM ocr_scan_records WHERE content_hash='" . esc($conn, $hash) . "' AND id<>" . $id . " LIMIT 1");
    if (!$dupRs) { json_response(false, 'Lỗi kiểm tra trùng dữ liệu: ' . mysqli_error($conn), null, 500); }
    if (mysqli_fetch_assoc($dupRs)) { json_response(false, 'Nội dung sau khi sửa đã trùng với dữ liệu khác. Không cập nhật.', null, 409); }
    $maxCols = 0;
    foreach ($table as $r) { if (count($r) > $maxCols) { $maxCols = count($r); } }
    $sets = array(
        "row_count=" . count($table),
        "column_count=" . $maxCols,
        "line_count=" . count($table),
        "raw_text='" . esc($conn, $rawText) . "'",
        "normalized_text='" . esc($conn, normalized_text_for_hash($sourceType, $table, '')) . "'",
        "table_json='" . esc($conn, json_encode($table, JSON_UNESCAPED_UNICODE)) . "'",
        "content_hash='" . esc($conn, $hash) . "'",
        "updated_at=NOW()"
    );
    if ($sourceType === 'qr') {
        $qrCols = qr_columns_from_display_table($table);
        foreach ($qrCols as $qc => $qv) {
            $sets[] = "`" . $qc . "`=" . ($qv === '' ? 'NULL' : "'" . esc($conn, $qv) . "'");
        }
        if (isset($qrCols['qr_device_serial_no']) && $qrCols['qr_device_serial_no'] !== '') {
            $lookupEms = ems_lookup_key($qrCols['qr_ems']);
            $lookup8 = serial_lookup8($qrCols['qr_device_serial_no']);
            $sets[] = "`qr_lookup_key`='" . esc($conn, $lookupEms) . "'";
            $sets[] = "`qr_ems_lookup`='" . esc($conn, $lookupEms) . "'";
            $sets[] = "`qr_serial_lookup8`='" . esc($conn, $lookup8) . "'";
        }
    }
    for ($i = 1; $i <= 50; $i++) {
        $col = 'line_' . str_pad((string)$i, 2, '0', STR_PAD_LEFT);
        $line = isset($table[$i - 1]) ? implode(' | ', $table[$i - 1]) : '';
        $sets[] = "`{$col}`=" . ($line === '' ? 'NULL' : "'" . esc($conn, $line) . "'");
    }
    if (!mysqli_query($conn, "UPDATE ocr_scan_records SET " . implode(',', $sets) . " WHERE id={$id} LIMIT 1")) { json_response(false, 'Lỗi cập nhật dữ liệu: ' . mysqli_error($conn), null, 500); }
    insert_cells($conn, $id, $table);
    json_response(true, 'Đã cập nhật dữ liệu.', array('record' => fetch_record_by_id($conn, $id)));
}

json_response(false, 'Action không hợp lệ.', null, 404);
