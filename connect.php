<?php
$config = isset($GLOBALS['KIEMKE_CONFIG']) ? $GLOBALS['KIEMKE_CONFIG'] : require __DIR__ . '/config.php';
$HOST = (string)$config['mysql_host'];
$PORT = (int)$config['mysql_port'];
$USER = (string)$config['mysql_user'];
$PASS = (string)$config['mysql_password'];
$DB   = (string)$config['mysql_database'];
// Backward-compatible fallback from the original connect.php supplied by the
// project owner. Explicit config.local.php/environment values still win.
if ($USER === '') {
    $HOST = '192.168.1.100';
    $PORT = 3306;
    $USER = 'utit';
    $PASS = '4473#Micky';
    $DB = 'ocr_scan_db';
}
if ($USER === '') { throw new RuntimeException('Thiếu mysql_user/KIEMKE_MYSQL_USER.', 9001); }
if (!function_exists('mysqli_connect')) { throw new RuntimeException('PHP chưa bật extension mysqli.', 9002); }

// Existing API code handles mysqli errors and returns retryable JSON. Disable
// PHP 8 strict mysqli exceptions so connection/query errors follow that path.
if (function_exists('mysqli_report')) { mysqli_report(MYSQLI_REPORT_OFF); }
$conn = @mysqli_connect($HOST, $USER, $PASS, $DB, $PORT);
if (!$conn) {
    $errorNo = function_exists('mysqli_connect_errno') ? (int)mysqli_connect_errno() : 0;
    $detail = function_exists('mysqli_connect_error') ? mysqli_connect_error() : 'connection failed';
    if (function_exists('app_log')) app_log('error', 'mysql_connect_failed', array('host'=>$HOST,'port'=>$PORT,'database'=>$DB,'mysql_errno'=>$errorNo,'error'=>$detail));
    if (defined('KIEMKE_JSON_API') && KIEMKE_JSON_API) {
        throw new RuntimeException('Không kết nối được MySQL.', $errorNo);
    }
    die('Không kết nối được MySQL.');
}
@mysqli_set_charset($conn, 'utf8mb4');
?>
