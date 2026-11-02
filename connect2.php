<?php
$config = isset($GLOBALS['KIEMKE_CONFIG']) ? $GLOBALS['KIEMKE_CONFIG'] : require __DIR__ . '/config.php';
$hostname=(string)$config['mssql_server'];
$dbname=(string)$config['mssql_database'];
$username=(string)$config['mssql_user'];
$password=(string)$config['mssql_password'];
// Backward-compatible fallback from the original connect2.php supplied by the
// project owner. Explicit config.local.php/environment values still win.
if ($username === '') {
    $hostname = '192.168.1.245,1433';
    $dbname = 'Hr';
    $username = 'user_prog3';
    $password = 'r2hI860R#zN4';
}
if ($username === '' || $password === '') { throw new RuntimeException('Thiếu cấu hình SQL Server production.'); }
$connectionInfo = array( "UID"=>$username,                            
                         "PWD"=>$password,                            
                         "Database"=>$dbname,"CharacterSet"=>"UTF-8"); 

/* Connect using SQL Server Authentication. */  
$conn2 = sqlsrv_connect( $hostname, $connectionInfo);  
if(!$conn2)
{
    $errors = function_exists('sqlsrv_errors') ? sqlsrv_errors() : array();
    $detail = is_array($errors) ? print_r($errors, true) : 'Unknown SQL Server connection error';
    if (function_exists('app_log')) app_log('error', 'mssql_connect_failed', array('server'=>$hostname,'database'=>$dbname,'error'=>$detail));
    if (defined('KIEMKE_JSON_API') && KIEMKE_JSON_API) throw new RuntimeException('Không kết nối được SQL Server. Request ID: ' . (function_exists('kiemke_request_id') ? kiemke_request_id() : 'n/a'));
    die('Không kết nối được SQL Server.');
}
?>
