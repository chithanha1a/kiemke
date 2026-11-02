<?php
if (!defined('KIEMKE_JSON_API')) define('KIEMKE_JSON_API', true);
require_once __DIR__ . '/bootstrap.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');
date_default_timezone_set('Asia/Ho_Chi_Minh');
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'POST') kiemke_require_csrf();

if (!defined('ASSET_IMPORT_MAX_BYTES')) define('ASSET_IMPORT_MAX_BYTES', 30 * 1024 * 1024);
if (!defined('ASSET_IMPORT_MAX_ROWS')) define('ASSET_IMPORT_MAX_ROWS', 150000);

require_once __DIR__ . '/asset_source_db.php';

function asset_import_json($ok, $message = '', $data = null, $status = 200) {
    http_response_code($status);
    echo json_encode(array('ok' => (bool)$ok, 'message' => (string)$message, 'data' => $data), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function asset_import_uuid() {
    try { return bin2hex(random_bytes(16)); } catch (Throwable $e) { return sha1(uniqid('', true) . mt_rand()); }
}

function asset_import_safe_filename($name) {
    $name = basename(str_replace('\\', '/', (string)$name));
    $name = preg_replace('/[^\p{L}\p{N}._()\- ]+/u', '_', $name);
    $name = trim($name);
    if ($name === '') return 'asset-import';
    return function_exists('mb_substr') ? mb_substr($name, 0, 240, 'UTF-8') : substr($name, 0, 240);
}

function asset_import_bind($stmt, $types, &$values) {
    $refs = array($types);
    foreach ($values as $k => $v) $refs[] = &$values[$k];
    return call_user_func_array(array($stmt, 'bind_param'), $refs);
}

function asset_import_headers_from_row($row) {
    $headers = array();
    $used = array();
    foreach ((array)$row as $col => $value) {
        $header = asset_source_text($value, 255);
        if ($header === '') $header = 'Column_' . (count($headers) + 1);
        $base = $header; $n = 2;
        while (isset($used[asset_source_header_key($header)])) $header = $base . '_' . $n++;
        $used[asset_source_header_key($header)] = true;
        $headers[$col] = $header;
    }
    return $headers;
}

function asset_import_row_to_assoc($headers, $sheetRow) {
    $out = array();
    foreach ($headers as $col => $header) $out[$header] = array_key_exists($col, $sheetRow) ? asset_source_text($sheetRow[$col], 8000) : '';
    return $out;
}

function asset_import_prepare_statement($conn) {
    $fields = array('McName','McType','McBrand','McModel','McSerialNumber','AccountingCode','PowerConsmt','PurchaseDate','DPEnd','LifeDuration','DaysInUsed','TotalCostOfOperation','Freq','MTBF_hrs','OriginalBuyingCost','AveOprtnCostBymonth','Status','Remark','CurrentLocation','UpdatedTime','DeductionOfProperty','Position','ManuSerialNo','Usedby','CurrentStyle','INLINE','OFFLINE','Bookedby','NextStyle','NewSewingLine','NewInline','NewOffline','BookingDate','Factory','device_code');
    $columns = array_map(function($f){ return '`' . asset_source_escape_identifier($f) . '`'; }, $fields);
    $extra = array('`import_batch_id`','`source_file`','`source_row_no`','`raw_json`');
    $allColumns = array_merge($columns, $extra);
    $placeholders = implode(',', array_fill(0, count($allColumns), '?'));
    $updates = array();
    foreach ($fields as $f) {
        if ($f === 'McSerialNumber') continue;
        $id = asset_source_escape_identifier($f);
        $updates[] = "`{$id}`=VALUES(`{$id}`)";
    }
    $updates[] = '`import_batch_id`=VALUES(`import_batch_id`)';
    $updates[] = '`source_file`=VALUES(`source_file`)';
    $updates[] = '`source_row_no`=VALUES(`source_row_no`)';
    $updates[] = '`raw_json`=VALUES(`raw_json`)';
    $updates[] = '`imported_at`=NOW()';

    $table = asset_source_escape_identifier(ASSET_SOURCE_TABLE);
    $sql = "INSERT INTO `{$table}` (" . implode(',', $allColumns) . ") VALUES ({$placeholders}) ON DUPLICATE KEY UPDATE " . implode(',', $updates);
    $stmt = mysqli_prepare($conn, $sql);
    if (!$stmt) throw new RuntimeException('Không chuẩn bị được câu lệnh import: ' . mysqli_error($conn));
    return array($stmt, $fields);
}

function asset_import_file_to_mysql($filePath, $originalName, $mime = '') {
    if (!is_file($filePath)) throw new RuntimeException('Không tìm thấy file import.');
    $size = filesize($filePath);
    if ($size === false || $size <= 0) throw new RuntimeException('File import rỗng.');
    if ($size > ASSET_IMPORT_MAX_BYTES) throw new RuntimeException('File vượt giới hạn 30 MB.');

    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (!in_array($ext, array('csv','xlsx','xls'), true)) throw new RuntimeException('Chỉ hỗ trợ CSV, XLSX hoặc XLS.');

    $autoload = __DIR__ . '/vendor/autoload.php';
    if (!file_exists($autoload)) throw new RuntimeException('Thiếu vendor/autoload.php để đọc Excel/CSV.');
    require_once $autoload;

    $conn = asset_source_open(false);
    $batchUuid = asset_import_uuid();
    $safeName = asset_import_safe_filename($originalName);
    $sha = hash_file('sha256', $filePath);
    $format = strtoupper($ext);

    $reader = \PhpOffice\PhpSpreadsheet\IOFactory::createReaderForFile($filePath);
    if (method_exists($reader, 'setReadDataOnly')) $reader->setReadDataOnly(true);
    if ($reader instanceof \PhpOffice\PhpSpreadsheet\Reader\Csv) {
        $reader->setInputEncoding('UTF-8');
        $reader->setDelimiter(',');
        $reader->setEnclosure('"');
    }
    $spreadsheet = $reader->load($filePath);
    $sheet = $spreadsheet->getSheet(0);

    $headers = array();
    $totalRows = 0;
    $accepted = 0;
    $skipped = 0;

    $batchTable = asset_source_escape_identifier(ASSET_SOURCE_BATCH_TABLE);
    $stmtBatch = mysqli_prepare($conn, "INSERT INTO `{$batchTable}` (`batch_uuid`,`source_file`,`source_sha256`,`source_format`,`headers_json`,`total_rows`,`accepted_rows`,`skipped_rows`) VALUES (?,?,?,?,?,0,0,0)");
    if (!$stmtBatch) throw new RuntimeException('Không tạo được batch import: ' . mysqli_error($conn));
    $emptyHeaders = '[]';
    mysqli_stmt_bind_param($stmtBatch, 'sssss', $batchUuid, $safeName, $sha, $format, $emptyHeaders);
    if (!mysqli_stmt_execute($stmtBatch)) throw new RuntimeException('Không ghi được batch import: ' . mysqli_stmt_error($stmtBatch));
    $batchId = (int)mysqli_insert_id($conn);
    mysqli_stmt_close($stmtBatch);

    list($stmt, $fields) = asset_import_prepare_statement($conn);
    mysqli_begin_transaction($conn);
    try {
        foreach ($sheet->getRowIterator() as $rowObj) {
            $rowNo = $rowObj->getRowIndex();
            $cells = $sheet->rangeToArray('A' . $rowNo . ':' . $sheet->getHighestColumn() . $rowNo, '', true, true, true);
            $sheetRow = isset($cells[$rowNo]) ? $cells[$rowNo] : array();
            if ($rowNo === 1) {
                $headers = asset_import_headers_from_row($sheetRow);
                continue;
            }
            if ($totalRows >= ASSET_IMPORT_MAX_ROWS) throw new RuntimeException('File vượt giới hạn ' . ASSET_IMPORT_MAX_ROWS . ' dòng dữ liệu.');
            $totalRows++;
            $assoc = asset_import_row_to_assoc($headers, $sheetRow);
            $nonEmpty = false;
            foreach ($assoc as $v) { if (trim((string)$v) !== '') { $nonEmpty = true; break; } }
            if (!$nonEmpty) { $skipped++; continue; }

            $mapped = asset_source_map_row($assoc);
            // Preserve rows without asset tag as well; MySQL UNIQUE permits multiple NULL values.
            if ($mapped['McSerialNumber'] === '') $mapped['McSerialNumber'] = null;
            $values = array();
            foreach ($fields as $field) $values[] = array_key_exists($field, $mapped) ? $mapped[$field] : '';
            $values[] = $batchId;
            $values[] = $safeName;
            $values[] = $rowNo;
            $values[] = $mapped['raw_json'];
            // import_batch_id=int, source_file=string, source_row_no=int, raw_json=string.
            $types = str_repeat('s', count($fields)) . 'isis';
            if (!asset_import_bind($stmt, $types, $values)) throw new RuntimeException('Không bind được dữ liệu import.');
            if (!mysqli_stmt_execute($stmt)) throw new RuntimeException('Lỗi import dòng ' . $rowNo . ': ' . mysqli_stmt_error($stmt));
            $accepted++;
        }
        mysqli_commit($conn);
    } catch (Throwable $e) {
        mysqli_rollback($conn);
        mysqli_stmt_close($stmt);
        $spreadsheet->disconnectWorksheets();
        throw $e;
    }
    mysqli_stmt_close($stmt);
    $spreadsheet->disconnectWorksheets();

    $headersJson = json_encode(array_values($headers), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $sql = "UPDATE `{$batchTable}` SET headers_json=?,total_rows=?,accepted_rows=?,skipped_rows=? WHERE id=?";
    $stmtUpdate = mysqli_prepare($conn, $sql);
    if ($stmtUpdate) {
        mysqli_stmt_bind_param($stmtUpdate, 'siiii', $headersJson, $totalRows, $accepted, $skipped, $batchId);
        mysqli_stmt_execute($stmtUpdate);
        mysqli_stmt_close($stmtUpdate);
    }

    $stats = asset_source_stats($conn);
    return array(
        'database' => asset_source_database_name($conn),
        'table' => ASSET_SOURCE_TABLE,
        'batch_id' => $batchId,
        'batch_uuid' => $batchUuid,
        'source_file' => $safeName,
        'source_format' => $format,
        'source_sha256' => $sha,
        'total_rows' => $totalRows,
        'accepted_rows' => $accepted,
        'skipped_rows' => $skipped,
        'headers' => array_values($headers),
        'stats' => $stats
    );
}

if (defined('KIEMKE_ASSET_IMPORT_LIB_ONLY') && KIEMKE_ASSET_IMPORT_LIB_ONLY) return;

$action = isset($_GET['action']) ? trim((string)$_GET['action']) : '';
try {
    if ($action === 'status') {
        $conn = asset_source_open(false);
        asset_import_json(true, '', asset_source_stats($conn));
    }
    if ($action === 'import') {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') asset_import_json(false, 'Import yêu cầu POST.', null, 405);
        if (!isset($_FILES['asset_file'])) asset_import_json(false, 'Chưa chọn file Excel/CSV.', null, 400);
        $f = $_FILES['asset_file'];
        if (!isset($f['error']) || (int)$f['error'] !== UPLOAD_ERR_OK) asset_import_json(false, 'Upload file lỗi, mã: ' . (isset($f['error']) ? (int)$f['error'] : -1), null, 400);
        if ((int)$f['size'] > ASSET_IMPORT_MAX_BYTES) asset_import_json(false, 'File vượt giới hạn 30 MB.', null, 413);
        $data = asset_import_file_to_mysql($f['tmp_name'], $f['name'], isset($f['type']) ? $f['type'] : '');
        asset_import_json(true, 'Import dữ liệu thành công.', $data);
    }
    asset_import_json(false, 'Action không hợp lệ.', null, 404);
} catch (Throwable $e) {
    asset_import_json(false, $e->getMessage(), null, 500);
}
