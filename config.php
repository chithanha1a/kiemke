<?php
/**
 * Production configuration loader.
 * Secrets must come from environment variables or an untracked config.local.php.
 */

function kiemke_env($name, $default = '') {
    $value = getenv($name);
    return ($value === false || $value === '') ? $default : $value;
}

$local = array();
$localFile = __DIR__ . '/config.local.php';
if (is_file($localFile)) {
    $loaded = require $localFile;
    if (is_array($loaded)) { $local = $loaded; }
}

function kiemke_config_value($local, $key, $env, $default = '') {
    if (array_key_exists($key, $local) && $local[$key] !== '') { return $local[$key]; }
    return kiemke_env($env, $default);
}

return array(
    'mysql_host' => kiemke_config_value($local, 'mysql_host', 'KIEMKE_MYSQL_HOST', '127.0.0.1'),
    'mysql_port' => (int)kiemke_config_value($local, 'mysql_port', 'KIEMKE_MYSQL_PORT', '3306'),
    'mysql_user' => kiemke_config_value($local, 'mysql_user', 'KIEMKE_MYSQL_USER'),
    'mysql_password' => kiemke_config_value($local, 'mysql_password', 'KIEMKE_MYSQL_PASSWORD'),
    'mysql_database' => kiemke_config_value($local, 'mysql_database', 'KIEMKE_MYSQL_DATABASE', 'ocr_scan_db'),
    'mssql_server' => kiemke_config_value($local, 'mssql_server', 'KIEMKE_MSSQL_SERVER', '127.0.0.1,1433'),
    'mssql_database' => kiemke_config_value($local, 'mssql_database', 'KIEMKE_MSSQL_DATABASE', 'Hr'),
    'mssql_user' => kiemke_config_value($local, 'mssql_user', 'KIEMKE_MSSQL_USER'),
    'mssql_password' => kiemke_config_value($local, 'mssql_password', 'KIEMKE_MSSQL_PASSWORD'),
    'log_dir' => kiemke_config_value($local, 'log_dir', 'KIEMKE_LOG_DIR', __DIR__ . '/storage/logs'),
    'log_retention_days' => max(1, (int)kiemke_config_value($local, 'log_retention_days', 'KIEMKE_LOG_RETENTION_DAYS', '14')),
    'trust_proxy' => kiemke_config_value($local, 'trust_proxy', 'KIEMKE_TRUST_PROXY', '0') === '1',
    'auto_migrate' => kiemke_config_value($local, 'auto_migrate', 'KIEMKE_AUTO_MIGRATE', '1') === '1',
);
