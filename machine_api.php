<?php
if (!defined('KIEMKE_JSON_API')) { define('KIEMKE_JSON_API', true); }
require_once __DIR__ . '/bootstrap.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
header('X-Content-Type-Options: nosniff');
date_default_timezone_set('Asia/Ho_Chi_Minh');

if (!defined('KIEMKE_JSON_API')) { define('KIEMKE_JSON_API', true); }

const MAX_CACHE_ROWS = 100000;
const MAX_JSON_BODY = 1048576; // 1 MB

require_once __DIR__ . '/asset_source_db.php';

function normalize_data_source($value) {
    $v = strtolower(trim((string)$value));
    return $v === 'mysql' ? 'mysql' : 'mssql';
}

function request_data_source($body = array()) {
    if (is_array($body) && isset($body['source'])) return normalize_data_source($body['source']);
    if (isset($_GET['source'])) return normalize_data_source($_GET['source']);
    return 'mssql';
}

function json_response($ok, $message = '', $data = null, $status = 200) {
    if ($status >= 400 && function_exists('app_log')) app_log('warning', 'machine_api_error_response', array('status'=>$status,'action'=>isset($_GET['action']) ? $_GET['action'] : '','message'=>$message));
    http_response_code($status);
    echo json_encode(
        array('ok' => (bool)$ok, 'message' => (string)$message, 'data' => $data),
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

function read_json_body() {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') { return array(); }
    if (strlen($raw) > MAX_JSON_BODY) { json_response(false, 'Payload quá lớn.', null, 413); }
    $data = json_decode($raw, true);
    if (!is_array($data)) { json_response(false, 'JSON không hợp lệ.', null, 400); }
    return $data;
}

function include_mssql() {
    $file = __DIR__ . '/connect2.php';
    if (!file_exists($file)) {
        json_response(false, 'Không tìm thấy connect2.php.', null, 500);
    }

    try {
        // connect2.php ở chế độ API sẽ throw thay vì echo/die, nhờ vậy response luôn là JSON hợp lệ.
        require $file;
    } catch (Throwable $e) {
        json_response(false, 'Không kết nối được SQL Server Maintenance: ' . $e->getMessage(), null, 500);
    }

    if (!isset($conn2) || !$conn2) {
        json_response(false, 'connect2.php không tạo được kết nối $conn2.', null, 500);
    }
    return $conn2;
}

function mssql_error_message() {
    if (function_exists('sqlsrv_errors')) {
        $errs = sqlsrv_errors(SQLSRV_ERR_ERRORS);
        if (is_array($errs) && count($errs)) {
            $out = array();
            foreach ($errs as $e) {
                $code = isset($e['code']) ? $e['code'] : '';
                $message = isset($e['message']) ? $e['message'] : '';
                $out[] = '[' . $code . '] ' . $message;
            }
            return implode('; ', $out);
        }
    }
    return 'Không lấy được chi tiết lỗi SQL Server.';
}

function normalize_value($value) {
    if ($value instanceof DateTimeInterface) { return $value->format('Y-m-d H:i:s'); }
    if (is_null($value)) { return ''; }
    if (is_bool($value)) { return $value ? '1' : '0'; }
    return trim((string)$value);
}

function normalize_row($row) {
    $out = array();
    foreach ($row as $k => $v) { $out[$k] = normalize_value($v); }
    return $out;
}

function clean_lookup_code($value) {
    return preg_replace('/[^A-Z0-9]/', '', strtoupper((string)$value));
}

function normalize_factory($value) {
    $value = trim((string)$value);
    $value = preg_replace('/[\x00-\x1F\x7F]/u', '', $value);
    if (function_exists('mb_substr')) { return mb_substr($value, 0, 120, 'UTF-8'); }
    return substr($value, 0, 120);
}

function normalize_device_code($value, $default = 'COMP') {
    $value = strtoupper(preg_replace('/[^A-Z0-9]/i', '', trim((string)$value)));
    if ($value === '') { $value = strtoupper((string)$default); }
    return substr($value, 0, 4);
}

function normalize_device_codes($value, $fallback = 'COMP') {
    if (is_string($value)) { $value = preg_split('/[,;\s]+/', $value, -1, PREG_SPLIT_NO_EMPTY); }
    if (!is_array($value)) { $value = array(); }
    $out = array();
    foreach ($value as $item) {
        $code = normalize_device_code($item, '');
        if ($code !== '' && !in_array($code, $out, true)) { $out[] = $code; }
        if (count($out) >= 50) { break; }
    }
    if (!count($out) && $fallback !== '') { $out[] = normalize_device_code($fallback, 'COMP'); }
    return $out;
}

function request_device_codes($body = array(), $fallback = 'COMP') {
    if (is_array($body) && isset($body['device_codes'])) {
        $codes = normalize_device_codes($body['device_codes'], '');
        if (count($codes)) { return $codes; }
    }
    if (is_array($body) && isset($body['device_code'])) { return normalize_device_codes(array($body['device_code']), $fallback); }
    if (isset($_GET['device_codes'])) {
        $codes = normalize_device_codes($_GET['device_codes'], '');
        if (count($codes)) { return $codes; }
    }
    if (isset($_GET['device_code'])) { return normalize_device_codes(array($_GET['device_code']), $fallback); }
    return normalize_device_codes(array(), $fallback);
}

function ems_lookup_key($ems) { return clean_lookup_code($ems); }

function serial_lookup8($serial) {
    $s = clean_lookup_code($serial);
    return $s === '' ? '' : substr($s, 0, 8);
}

function parse_qr_asset($qrText) {
    $text = trim((string)$qrText);
    $parts = array_map('trim', explode('|', $text));
    while (count($parts) < 8) { $parts[] = ''; }

    $ems = isset($parts[0]) ? $parts[0] : '';
    $deviceType = isset($parts[1]) ? $parts[1] : '';
    $deviceModel = isset($parts[2]) ? $parts[2] : '';
    $assetCode = isset($parts[3]) ? $parts[3] : '';
    $deviceSerialNo = isset($parts[4]) ? $parts[4] : '';
    $userId = isset($parts[5]) ? $parts[5] : '';
    $userDept = isset($parts[6]) ? $parts[6] : '';
    $lastCheck = isset($parts[7]) ? $parts[7] : '';

    $deviceValue = $deviceModel;
    if ($assetCode !== '') { $deviceValue .= ($deviceValue !== '' ? '|' : '') . $assetCode; }

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
        'device_serial_info' => $deviceSerialNo
    );
}

function add_candidate(&$candidates, $value) {
    $value = clean_lookup_code($value);
    if ($value === '') { return; }
    if (strlen($value) >= 4 && strlen($value) <= 120 && !in_array($value, $candidates, true)) {
        $candidates[] = $value;
    }
}

function extract_lookup_candidates($qrText, $manualKey = '') {
    $candidates = array();
    $parsed = parse_qr_asset($qrText);
    if (trim((string)$manualKey) !== '') { add_candidate($candidates, $manualKey); }
    if ($parsed['lookup_ems'] !== '') { add_candidate($candidates, $parsed['ems']); }
    return array_values(array_slice($candidates, 0, 20));
}

function select_fields_sql() {
    return "[McName],[McType],[McBrand],[McModel],[McSerialNumber],[AccountingCode],[PowerConsmt],[PurchaseDate],[DPEnd],[LifeDuration],[DaysInUsed],[TotalCostOfOperation],[Freq],[MTBF_hrs],[OriginalBuyingCost],[AveOprtnCostBymonth],[Status],[Remark],[CurrentLocation],[UpdatedTime],[DeductionOfProperty],[Position],[ManuSerialNo],[Usedby],[CurrentStyle],[INLINE],[OFFLINE],[Bookedby],[NextStyle],[NewSewingLine],[NewInline],[NewOffline],[BookingDate],[Factory]";
}

/*
 * CONVERT đặt trước LTRIM/RTRIM để tương thích cả khi cột nguồn là VARCHAR/NVARCHAR/TEXT/NTEXT.
 * Không dùng ISNULL([Factory], '') trước CONVERT vì một số schema cũ dùng TEXT/NTEXT và có thể lỗi kiểu dữ liệu.
 */
function factory_expr_sql() {
    return "LTRIM(RTRIM(CONVERT(NVARCHAR(255), [Factory])))";
}

function serial_expr_sql() {
    return "UPPER(LTRIM(RTRIM(CONVERT(NVARCHAR(255), [McSerialNumber]))))";
}

function device_code_expr_sql() {
    return "LEFT(" . serial_expr_sql() . ", 4)";
}

function comp_filter_sql() {
    // Backward-compatible helper used only by older tests/docs. New queries use parameterized device code.
    return device_code_expr_sql() . " = 'COMP'";
}

function query_with_sqlsrv($conn2, $candidate, $factory = '', $deviceCode = 'COMP') {
    $serialExpr = serial_expr_sql();
    $factoryExpr = factory_expr_sql();
    $codeExpr = device_code_expr_sql();
    $factory = normalize_factory($factory);
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    $factorySql = $factory !== '' ? " AND {$factoryExpr} = ?" : '';

    // Inventory scope is controlled in Settings: device prefix + optional Factory.
    // Exact/prefix lookup avoids LIKE %...% full scans on Maintenance.dbo.Overview.
    $sql = "SELECT TOP (20) " . select_fields_sql() . "
            FROM [Maintenance].[dbo].[Overview]
            WHERE {$codeExpr} = ?
              AND ({$serialExpr} = ? OR {$serialExpr} LIKE ?){$factorySql}
            ORDER BY CASE
                WHEN {$serialExpr} = ? THEN 0
                ELSE 1
            END, [UpdatedTime] DESC";

    $params = array($deviceCode, $candidate, $candidate . '%');
    if ($factory !== '') { $params[] = $factory; }
    $params[] = $candidate;

    $stmt = sqlsrv_query($conn2, $sql, $params, array('QueryTimeout' => 4));
    if ($stmt === false) { json_response(false, 'Lỗi truy vấn máy: ' . mssql_error_message(), null, 500); }

    $rows = array();
    while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) { $rows[] = normalize_row($row); }
    if (function_exists('sqlsrv_free_stmt')) { @sqlsrv_free_stmt($stmt); }
    return $rows;
}

function query_with_pdo($conn2, $candidate, $factory = '', $deviceCode = 'COMP') {
    $serialExpr = serial_expr_sql();
    $factoryExpr = factory_expr_sql();
    $codeExpr = device_code_expr_sql();
    $factory = normalize_factory($factory);
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    $factorySql = $factory !== '' ? " AND {$factoryExpr} = ?" : '';

    $sql = "SELECT TOP (20) " . select_fields_sql() . "
            FROM [Maintenance].[dbo].[Overview]
            WHERE {$codeExpr} = ?
              AND ({$serialExpr} = ? OR {$serialExpr} LIKE ?){$factorySql}
            ORDER BY CASE
                WHEN {$serialExpr} = ? THEN 0
                ELSE 1
            END, [UpdatedTime] DESC";

    $params = array($deviceCode, $candidate, $candidate . '%');
    if ($factory !== '') { $params[] = $factory; }
    $params[] = $candidate;

    $stmt = $conn2->prepare($sql);
    $stmt->execute($params);
    $rows = array();
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) { $rows[] = normalize_row($row); }
    return $rows;
}

function query_machine($conn2, $candidate, $factory = '', $deviceCode = 'COMP') {
    if ($candidate === '') { return array(); }
    if ($conn2 instanceof PDO) { return query_with_pdo($conn2, $candidate, $factory, $deviceCode); }
    if (function_exists('sqlsrv_query')) { return query_with_sqlsrv($conn2, $candidate, $factory, $deviceCode); }
    json_response(false, 'Không hỗ trợ driver SQL Server. Cần extension sqlsrv hoặc PDO_SQLSRV.', null, 500);
}

function device_code_list_sql() {
    // User-required scope source: SELECT DISTINCT LEFT(McSerialNumber,4) AS code ...
    // CONVERT keeps compatibility with TEXT/NTEXT legacy columns.
    $codeExpr = device_code_expr_sql();
    return "SELECT DISTINCT {$codeExpr} AS [code]
            FROM [Maintenance].[dbo].[Overview]
            WHERE NULLIF({$codeExpr}, '') IS NOT NULL
            ORDER BY {$codeExpr}";
}

function query_device_codes($conn2) {
    $sql = device_code_list_sql();
    $rows = array();
    if ($conn2 instanceof PDO) {
        $stmt = $conn2->prepare($sql);
        $stmt->execute();
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) { $rows[] = $row; }
    } elseif (function_exists('sqlsrv_query')) {
        $stmt = sqlsrv_query($conn2, $sql, array(), array('QueryTimeout' => 30));
        if ($stmt === false) { json_response(false, 'Lỗi tải loại thiết bị: ' . mssql_error_message(), null, 500); }
        while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) { $rows[] = $row; }
        if (function_exists('sqlsrv_free_stmt')) { @sqlsrv_free_stmt($stmt); }
    } else {
        json_response(false, 'Không hỗ trợ driver SQL Server. Cần extension sqlsrv hoặc PDO_SQLSRV.', null, 500);
    }
    $out = array();
    foreach ($rows as $row) {
        $code = normalize_device_code(isset($row['code']) ? $row['code'] : '', '');
        if ($code !== '' && !in_array($code, $out, true)) { $out[] = $code; }
    }
    sort($out, SORT_STRING);
    return $out;
}

function factory_list_sql($deviceCode = 'COMP') {
    $factoryExpr = factory_expr_sql();
    $codeExpr = device_code_expr_sql();
    return "SELECT {$factoryExpr} AS [Factory], COUNT_BIG(1) AS [MachineCount]
            FROM [Maintenance].[dbo].[Overview]
            WHERE {$codeExpr} = ?
              AND NULLIF({$factoryExpr}, '') IS NOT NULL
            GROUP BY {$factoryExpr}
            ORDER BY {$factoryExpr}";
}

function normalize_factory_rows($rows) {
    $byKey = array();
    foreach ($rows as $row) {
        $factory = normalize_factory(isset($row['Factory']) ? $row['Factory'] : '');
        if ($factory === '') { continue; }
        $key = function_exists('mb_strtoupper') ? mb_strtoupper($factory, 'UTF-8') : strtoupper($factory);
        $count = isset($row['MachineCount']) ? (int)$row['MachineCount'] : 0;
        if (!isset($byKey[$key])) {
            $byKey[$key] = array('factory' => $factory, 'machine_count' => $count);
        } else {
            $byKey[$key]['machine_count'] += $count;
        }
    }
    return array_values($byKey);
}

function query_factories_sqlsrv($conn2, $deviceCode = 'COMP') {
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    $stmt = sqlsrv_query($conn2, factory_list_sql($deviceCode), array($deviceCode), array('QueryTimeout' => 30));
    if ($stmt === false) { json_response(false, 'Lỗi tải danh sách xưởng từ Maintenance.dbo.Overview: ' . mssql_error_message(), null, 500); }

    $rows = array();
    while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) { $rows[] = $row; }
    if (function_exists('sqlsrv_free_stmt')) { @sqlsrv_free_stmt($stmt); }
    return normalize_factory_rows($rows);
}

function query_factories_pdo($conn2, $deviceCode = 'COMP') {
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    $stmt = $conn2->prepare(factory_list_sql($deviceCode));
    $stmt->execute(array($deviceCode));
    $rows = array();
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) { $rows[] = $row; }
    return normalize_factory_rows($rows);
}

function query_factories($conn2, $deviceCode = 'COMP') {
    if ($conn2 instanceof PDO) { return query_factories_pdo($conn2, $deviceCode); }
    if (function_exists('sqlsrv_query')) { return query_factories_sqlsrv($conn2, $deviceCode); }
    json_response(false, 'Không hỗ trợ driver SQL Server. Cần extension sqlsrv hoặc PDO_SQLSRV.', null, 500);
}

function query_canonical_factory($conn2, $factory, $deviceCode = 'COMP') {
    $factory = normalize_factory($factory);
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    if ($factory === '') { return ''; }
    $factoryExpr = factory_expr_sql();
    $codeExpr = device_code_expr_sql();
    $sql = "SELECT TOP (1) {$factoryExpr} AS [Factory]\n"
         . "FROM [Maintenance].[dbo].[Overview]\n"
         . "WHERE {$codeExpr} = ? AND {$factoryExpr} = ?";

    if ($conn2 instanceof PDO) {
        $stmt = $conn2->prepare($sql);
        $stmt->execute(array($deviceCode, $factory));
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? normalize_factory(isset($row['Factory']) ? $row['Factory'] : '') : '';
    }
    if (function_exists('sqlsrv_query')) {
        $stmt = sqlsrv_query($conn2, $sql, array($deviceCode, $factory), array('QueryTimeout' => 10));
        if ($stmt === false) { json_response(false, 'Lỗi kiểm tra Factory: ' . mssql_error_message(), null, 500); }
        $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
        if (function_exists('sqlsrv_free_stmt')) { @sqlsrv_free_stmt($stmt); }
        return $row ? normalize_factory(isset($row['Factory']) ? $row['Factory'] : '') : '';
    }
    json_response(false, 'Không hỗ trợ driver SQL Server. Cần extension sqlsrv hoặc PDO_SQLSRV.', null, 500);
}

function cache_sql() {
    $factoryExpr = factory_expr_sql();
    $codeExpr = device_code_expr_sql();
    $top = MAX_CACHE_ROWS + 1;
    return "SELECT TOP ({$top}) " . select_fields_sql() . "
            FROM [Maintenance].[dbo].[Overview]
            WHERE {$codeExpr} = ?
              AND {$factoryExpr} = ?
            ORDER BY [McSerialNumber], [UpdatedTime] DESC";
}

function query_cache_sqlsrv($conn2, $factory, $deviceCode = 'COMP') {
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    $stmt = sqlsrv_query($conn2, cache_sql(), array($deviceCode, $factory), array('QueryTimeout' => 120));
    if ($stmt === false) { json_response(false, 'Lỗi tải dữ liệu cache xưởng: ' . mssql_error_message(), null, 500); }

    $rows = array();
    while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
        $rows[] = normalize_row($row);
        if (count($rows) > MAX_CACHE_ROWS) { break; }
    }
    if (function_exists('sqlsrv_free_stmt')) { @sqlsrv_free_stmt($stmt); }
    return $rows;
}

function query_cache_pdo($conn2, $factory, $deviceCode = 'COMP') {
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    $stmt = $conn2->prepare(cache_sql());
    $stmt->execute(array($deviceCode, $factory));
    $rows = array();
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $rows[] = normalize_row($row);
        if (count($rows) > MAX_CACHE_ROWS) { break; }
    }
    return $rows;
}

function query_cache($conn2, $factory, $deviceCode = 'COMP') {
    if ($conn2 instanceof PDO) { return query_cache_pdo($conn2, $factory, $deviceCode); }
    if (function_exists('sqlsrv_query')) { return query_cache_sqlsrv($conn2, $factory, $deviceCode); }
    json_response(false, 'Không hỗ trợ driver SQL Server. Cần extension sqlsrv hoặc PDO_SQLSRV.', null, 500);
}


function mysql_select_fields_sql() {
    $fields = array('McName','McType','McBrand','McModel','McSerialNumber','AccountingCode','PowerConsmt','PurchaseDate','DPEnd','LifeDuration','DaysInUsed','TotalCostOfOperation','Freq','MTBF_hrs','OriginalBuyingCost','AveOprtnCostBymonth','Status','Remark','CurrentLocation','UpdatedTime','DeductionOfProperty','Position','ManuSerialNo','Usedby','CurrentStyle','INLINE','OFFLINE','Bookedby','NextStyle','NewSewingLine','NewInline','NewOffline','BookingDate','Factory');
    return implode(',', array_map(function($f){ return '`' . asset_source_escape_identifier($f) . '`'; }, $fields));
}

function include_mysql_source() {
    try { return asset_source_open(false); }
    catch (Throwable $e) { json_response(false, 'Không kết nối được nguồn MySQL import: ' . $e->getMessage(), null, 500); }
}

function mysql_stmt_rows_assoc($stmt) {
    $rows = array();
    if (function_exists('mysqli_stmt_get_result')) {
        $result = mysqli_stmt_get_result($stmt);
        if ($result) {
            while ($row = mysqli_fetch_assoc($result)) $rows[] = $row;
            mysqli_free_result($result);
            return $rows;
        }
    }

    // Fallback for PHP builds without mysqlnd / mysqli_stmt_get_result.
    $meta = mysqli_stmt_result_metadata($stmt);
    if (!$meta) return $rows;
    $row = array();
    $bind = array($stmt);
    while ($field = mysqli_fetch_field($meta)) {
        $row[$field->name] = null;
        $bind[] = &$row[$field->name];
    }
    if (count($bind) > 1) call_user_func_array('mysqli_stmt_bind_result', $bind);
    while (mysqli_stmt_fetch($stmt)) {
        $copy = array();
        foreach ($row as $k => $v) $copy[$k] = $v;
        $rows[] = $copy;
    }
    mysqli_free_result($meta);
    return $rows;
}

function query_device_codes_mysql($conn) {
    $table = asset_source_escape_identifier(ASSET_SOURCE_TABLE);
    $rs = mysqli_query($conn, "SELECT DISTINCT UPPER(LEFT(TRIM(`McSerialNumber`),4)) AS `code` FROM `{$table}` WHERE NULLIF(TRIM(`McSerialNumber`),'') IS NOT NULL ORDER BY `code`");
    if (!$rs) json_response(false, 'Lỗi tải loại thiết bị từ MySQL: ' . mysqli_error($conn), null, 500);
    $out = array();
    while ($row = mysqli_fetch_assoc($rs)) {
        $code = normalize_device_code(isset($row['code']) ? $row['code'] : '', '');
        if ($code !== '' && !in_array($code, $out, true)) $out[] = $code;
    }
    sort($out, SORT_STRING);
    return $out;
}

function query_factories_mysql($conn, $deviceCode = 'COMP') {
    $table = asset_source_escape_identifier(ASSET_SOURCE_TABLE);
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    $stmt = mysqli_prepare($conn, "SELECT `Factory`,COUNT(*) AS `MachineCount` FROM `{$table}` WHERE `device_code`=? AND NULLIF(TRIM(`Factory`),'') IS NOT NULL GROUP BY `Factory` ORDER BY `Factory`");
    if (!$stmt) json_response(false, 'Lỗi chuẩn bị danh sách xưởng MySQL: ' . mysqli_error($conn), null, 500);
    mysqli_stmt_bind_param($stmt, 's', $deviceCode);
    if (!mysqli_stmt_execute($stmt)) json_response(false, 'Lỗi tải danh sách xưởng MySQL: ' . mysqli_stmt_error($stmt), null, 500);
    $rows = mysql_stmt_rows_assoc($stmt);
    mysqli_stmt_close($stmt);
    return normalize_factory_rows($rows);
}

function query_canonical_factory_mysql($conn, $factory, $deviceCode = 'COMP') {
    $table = asset_source_escape_identifier(ASSET_SOURCE_TABLE);
    $factory = normalize_factory($factory);
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    if ($factory === '') return '';
    $stmt = mysqli_prepare($conn, "SELECT `Factory` FROM `{$table}` WHERE `device_code`=? AND UPPER(TRIM(`Factory`))=UPPER(?) LIMIT 1");
    if (!$stmt) json_response(false, 'Lỗi kiểm tra xưởng MySQL: ' . mysqli_error($conn), null, 500);
    mysqli_stmt_bind_param($stmt, 'ss', $deviceCode, $factory);
    if (!mysqli_stmt_execute($stmt)) json_response(false, 'Lỗi kiểm tra xưởng MySQL: ' . mysqli_stmt_error($stmt), null, 500);
    $rows = mysql_stmt_rows_assoc($stmt);
    mysqli_stmt_close($stmt);
    $row = count($rows) ? $rows[0] : null;
    return $row ? normalize_factory($row['Factory']) : '';
}

function query_cache_mysql($conn, $factory, $deviceCode = 'COMP') {
    $table = asset_source_escape_identifier(ASSET_SOURCE_TABLE);
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    $limit = MAX_CACHE_ROWS + 1;
    $sql = "SELECT " . mysql_select_fields_sql() . " FROM `{$table}` WHERE `device_code`=? AND UPPER(TRIM(`Factory`))=UPPER(?) ORDER BY `McSerialNumber`,`UpdatedTime` DESC LIMIT {$limit}";
    $stmt = mysqli_prepare($conn, $sql);
    if (!$stmt) json_response(false, 'Lỗi chuẩn bị cache MySQL: ' . mysqli_error($conn), null, 500);
    mysqli_stmt_bind_param($stmt, 'ss', $deviceCode, $factory);
    if (!mysqli_stmt_execute($stmt)) json_response(false, 'Lỗi tải cache MySQL: ' . mysqli_stmt_error($stmt), null, 500);
    $rawRows = mysql_stmt_rows_assoc($stmt);
    $rows = array();
    foreach ($rawRows as $row) {
        $rows[] = normalize_row($row);
        if (count($rows) > MAX_CACHE_ROWS) break;
    }
    mysqli_stmt_close($stmt);
    return $rows;
}

function query_machine_mysql($conn, $candidate, $factory = '', $deviceCode = 'COMP') {
    $table = asset_source_escape_identifier(ASSET_SOURCE_TABLE);
    $candidate = clean_lookup_code($candidate);
    $factory = normalize_factory($factory);
    $deviceCode = normalize_device_code($deviceCode, 'COMP');
    $factorySql = $factory !== '' ? " AND UPPER(TRIM(`Factory`))=UPPER(?)" : '';
    $sql = "SELECT " . mysql_select_fields_sql() . " FROM `{$table}` WHERE `device_code`=? AND (UPPER(TRIM(`McSerialNumber`))=? OR UPPER(TRIM(`McSerialNumber`)) LIKE ?){$factorySql} ORDER BY CASE WHEN UPPER(TRIM(`McSerialNumber`))=? THEN 0 ELSE 1 END, `UpdatedTime` DESC LIMIT 20";
    $stmt = mysqli_prepare($conn, $sql);
    if (!$stmt) json_response(false, 'Lỗi chuẩn bị lookup MySQL: ' . mysqli_error($conn), null, 500);
    $like = $candidate . '%';
    if ($factory !== '') mysqli_stmt_bind_param($stmt, 'sssss', $deviceCode, $candidate, $like, $factory, $candidate);
    else mysqli_stmt_bind_param($stmt, 'ssss', $deviceCode, $candidate, $like, $candidate);
    if (!mysqli_stmt_execute($stmt)) json_response(false, 'Lỗi lookup MySQL: ' . mysqli_stmt_error($stmt), null, 500);
    $rawRows = mysql_stmt_rows_assoc($stmt);
    $rows = array();
    foreach ($rawRows as $row) $rows[] = normalize_row($row);
    mysqli_stmt_close($stmt);
    return $rows;
}

function factory_exists_in_list($factory, $factoryRows) {
    $wanted = function_exists('mb_strtoupper') ? mb_strtoupper(normalize_factory($factory), 'UTF-8') : strtoupper(normalize_factory($factory));
    foreach ($factoryRows as $item) {
        $name = isset($item['factory']) ? $item['factory'] : '';
        $key = function_exists('mb_strtoupper') ? mb_strtoupper(normalize_factory($name), 'UTF-8') : strtoupper(normalize_factory($name));
        if ($wanted !== '' && $wanted === $key) { return $name; }
    }
    return '';
}

if (defined('KIEMKE_MACHINE_API_LIB_ONLY') && KIEMKE_MACHINE_API_LIB_ONLY) { return; }

$action = isset($_GET['action']) ? trim((string)$_GET['action']) : '';
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'POST') { kiemke_require_csrf(); }

if ($action === 'listDeviceCodes') {
    $body = ($_SERVER['REQUEST_METHOD'] === 'POST') ? read_json_body() : array();
    $source = request_data_source($body);
    if ($source === 'mysql') {
        $conn = include_mysql_source();
        $codes = query_device_codes_mysql($conn);
        $sourceName = asset_source_qualified_name($conn);
        $queryText = 'SELECT DISTINCT LEFT(McSerialNumber,4) AS code FROM ' . $sourceName . ' ORDER BY LEFT(McSerialNumber,4)';
    } else {
        $conn2 = include_mssql();
        $codes = query_device_codes($conn2);
        $sourceName = '[Maintenance].[dbo].[Overview]';
        $queryText = 'SELECT DISTINCT LEFT(McSerialNumber,4) AS code FROM [Maintenance].[dbo].[Overview] ORDER BY LEFT(McSerialNumber,4)';
    }
    json_response(true, '', array('codes'=>$codes,'count'=>count($codes),'query'=>$queryText,'source'=>$sourceName,'data_source'=>$source));
}

if ($action === 'listFactories') {
    $body = ($_SERVER['REQUEST_METHOD'] === 'POST') ? read_json_body() : array();
    $source = request_data_source($body);
    $deviceCodes = request_device_codes($body, 'COMP');
    $byFactory = array();
    if ($source === 'mysql') {
        $conn = include_mysql_source();
        $sourceName = asset_source_qualified_name($conn);
        foreach ($deviceCodes as $deviceCode) {
            $rows = query_factories_mysql($conn, $deviceCode);
            foreach ($rows as $item) {
                $factory = normalize_factory(isset($item['factory']) ? $item['factory'] : '');
                if ($factory === '') continue;
                $key = function_exists('mb_strtoupper') ? mb_strtoupper($factory, 'UTF-8') : strtoupper($factory);
                if (!isset($byFactory[$key])) $byFactory[$key] = array('factory'=>$factory,'machine_count'=>0,'device_codes'=>array());
                $byFactory[$key]['machine_count'] += (int)(isset($item['machine_count']) ? $item['machine_count'] : 0);
                if (!in_array($deviceCode, $byFactory[$key]['device_codes'], true)) $byFactory[$key]['device_codes'][] = $deviceCode;
            }
        }
    } else {
        $conn2 = include_mssql();
        $sourceName = '[Maintenance].[dbo].[Overview]';
        foreach ($deviceCodes as $deviceCode) {
            $rows = query_factories($conn2, $deviceCode);
            foreach ($rows as $item) {
                $factory = normalize_factory(isset($item['factory']) ? $item['factory'] : '');
                if ($factory === '') continue;
                $key = function_exists('mb_strtoupper') ? mb_strtoupper($factory, 'UTF-8') : strtoupper($factory);
                if (!isset($byFactory[$key])) $byFactory[$key] = array('factory'=>$factory,'machine_count'=>0,'device_codes'=>array());
                $byFactory[$key]['machine_count'] += (int)(isset($item['machine_count']) ? $item['machine_count'] : 0);
                if (!in_array($deviceCode, $byFactory[$key]['device_codes'], true)) $byFactory[$key]['device_codes'][] = $deviceCode;
            }
        }
    }
    $items = array_values($byFactory);
    usort($items, function($a,$b){ return strcasecmp($a['factory'],$b['factory']); });
    $factories = array(); foreach ($items as $item) $factories[] = $item['factory'];
    json_response(true, '', array('factories'=>$factories,'items'=>$items,'count'=>count($items),'device_codes'=>$deviceCodes,'device_code'=>count($deviceCodes)===1?$deviceCodes[0]:'','filter'=>'LEFT(McSerialNumber,4) IN selected_device_codes','source'=>$sourceName,'data_source'=>$source));
}

if ($action === 'downloadCache') {
    $body = read_json_body();
    $source = request_data_source($body);
    $factory = normalize_factory(isset($body['factory']) ? $body['factory'] : '');
    $deviceCode = normalize_device_code(isset($body['device_code']) ? $body['device_code'] : 'COMP', 'COMP');
    if ($factory === '') json_response(false, 'Vui lòng chọn xưởng trước khi tải cache.', null, 400);

    if ($source === 'mysql') {
        $conn = include_mysql_source();
        $canonicalFactory = query_canonical_factory_mysql($conn, $factory, $deviceCode);
        if ($canonicalFactory === '') json_response(false, 'Nguồn MySQL không có dữ liệu cho ' . $deviceCode . ' / ' . $factory . '.', null, 404);
        $rows = query_cache_mysql($conn, $canonicalFactory, $deviceCode);
        $sourceName = asset_source_qualified_name($conn);
    } else {
        $conn2 = include_mssql();
        $canonicalFactory = query_canonical_factory($conn2, $factory, $deviceCode);
        if ($canonicalFactory === '') json_response(false, 'SQL Server không có dữ liệu cho ' . $deviceCode . ' / ' . $factory . '.', null, 404);
        $rows = query_cache($conn2, $canonicalFactory, $deviceCode);
        $sourceName = '[Maintenance].[dbo].[Overview]';
    }
    if (count($rows) > MAX_CACHE_ROWS) json_response(false, 'Số bản ghi vượt giới hạn ' . MAX_CACHE_ROWS . '.', null, 413);
    json_response(true, '', array('factory'=>$canonicalFactory,'device_code'=>$deviceCode,'rows'=>$rows,'row_count'=>count($rows),'downloaded_at'=>date('c'),'filter'=>'LEFT(McSerialNumber,4)=selected_device_code AND Factory=selected_factory','schema_version'=>5,'source'=>$sourceName,'data_source'=>$source));
}

if ($action === 'lookupQr') {
    $body = read_json_body();
    $source = request_data_source($body);
    $qrText = isset($body['qr_text']) ? (string)$body['qr_text'] : '';
    $manualKey = isset($body['lookup_key']) ? (string)$body['lookup_key'] : '';
    $factory = normalize_factory(isset($body['factory']) ? $body['factory'] : '');
    $deviceCodes = request_device_codes($body, 'COMP');
    $parsed = parse_qr_asset($qrText);
    $candidates = extract_lookup_candidates($qrText, $manualKey);
    if (!count($candidates)) json_response(false, 'Không lấy được EMS từ QR code để tra cứu McSerialNumber.', array('parsed'=>$parsed), 400);

    $foundRows = array(); $usedKey = ''; $usedDeviceCode = count($deviceCodes) ? $deviceCodes[0] : 'COMP';
    if ($source === 'mysql') $conn = include_mysql_source(); else $conn2 = include_mssql();
    foreach ($candidates as $candidate) {
        $candidatePrefix = normalize_device_code(substr(clean_lookup_code($candidate), 0, 4), '');
        $orderedCodes = $deviceCodes;
        if ($candidatePrefix !== '' && in_array($candidatePrefix, $orderedCodes, true)) {
            $orderedCodes = array_values(array_unique(array_merge(array($candidatePrefix), $orderedCodes)));
        }
        foreach ($orderedCodes as $deviceCode) {
            $rows = $source === 'mysql' ? query_machine_mysql($conn, $candidate, $factory, $deviceCode) : query_machine($conn2, $candidate, $factory, $deviceCode);
            if (count($rows)) { $foundRows = $rows; $usedKey = $candidate; $usedDeviceCode = $deviceCode; break 2; }
        }
    }
    if ($usedKey === '') $usedKey = $candidates[0];
    json_response(true, '', array('lookup_key'=>$usedKey,'candidates'=>$candidates,'rows'=>$foundRows,'qr_text'=>$qrText,'parsed'=>$parsed,'factory'=>$factory,'device_code'=>$usedDeviceCode,'device_codes'=>$deviceCodes,'source'=>'server','data_source'=>$source,'source_name'=>$source === 'mysql' ? asset_source_qualified_name($conn) : '[Maintenance].[dbo].[Overview]'));
}

if ($action === 'sourceStats') {
    $body = ($_SERVER['REQUEST_METHOD'] === 'POST') ? read_json_body() : array();
    $source = request_data_source($body);
    if ($source === 'mysql') {
        $conn = include_mysql_source();
        json_response(true, '', array('data_source'=>'mysql','source_name'=>asset_source_qualified_name($conn),'stats'=>asset_source_stats($conn)));
    }
    json_response(true, '', array('data_source'=>'mssql','source_name'=>'[Maintenance].[dbo].[Overview]','stats'=>array('managed_externally'=>true)));
}

json_response(false, 'Action không hợp lệ.', null, 404);
