<?php
// Copy to config.local.php OUTSIDE source control, restrict permission to the web-service account.
return array(
    'mysql_host' => '192.168.1.100',
    'mysql_port' => 3306,
    'mysql_user' => 'replace_me',
    'mysql_password' => 'replace_me',
    'mysql_database' => 'ocr_scan_db',
    'mssql_server' => '192.168.1.245,1433',
    'mssql_database' => 'Hr',
    'mssql_user' => 'replace_me',
    'mssql_password' => 'replace_me',
    'log_dir' => __DIR__ . '/storage/logs',
    'log_retention_days' => 14,
    'trust_proxy' => false,
    'auto_migrate' => true,
);
