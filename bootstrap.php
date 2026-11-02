<?php
if (!defined('KIEMKE_BOOTSTRAPPED')) {
    define('KIEMKE_BOOTSTRAPPED', true);
    date_default_timezone_set('Asia/Ho_Chi_Minh');
    $GLOBALS['KIEMKE_CONFIG'] = require __DIR__ . '/config.php';

    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_set_cookie_params(array(
            'lifetime' => 0, 'path' => '/', 'secure' => $https,
            'httponly' => true, 'samesite' => 'Lax'
        ));
        session_start();
    }
    if (empty($_SESSION['csrf_token'])) {
        try { $_SESSION['csrf_token'] = bin2hex(random_bytes(32)); }
        catch (Throwable $e) { $_SESSION['csrf_token'] = hash('sha256', session_id() . microtime(true)); }
    }

    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin');
    header("Permissions-Policy: camera=(self), microphone=(), geolocation=()");
}

function kiemke_request_id() {
    static $id = null;
    if ($id !== null) return $id;
    $incoming = isset($_SERVER['HTTP_X_REQUEST_ID']) ? (string)$_SERVER['HTTP_X_REQUEST_ID'] : '';
    if ($incoming !== '' && preg_match('/^[A-Za-z0-9._-]{8,80}$/', $incoming)) $id = $incoming;
    else {
        try { $id = bin2hex(random_bytes(12)); }
        catch (Throwable $e) { $id = substr(hash('sha256', uniqid('', true)), 0, 24); }
    }
    header('X-Request-ID: ' . $id);
    return $id;
}

function kiemke_redact_context($value, $depth = 0) {
    if ($depth > 5) return '[depth-limit]';
    if (!is_array($value)) {
        $text = (string)$value;
        return strlen($text) > 2000 ? substr($text, 0, 2000) . '[truncated]' : $text;
    }
    $out = array();
    foreach ($value as $key => $item) {
        $keyText = strtolower((string)$key);
        if (preg_match('/pass|password|secret|token|authorization|cookie/', $keyText)) $out[$key] = '[redacted]';
        else $out[$key] = kiemke_redact_context($item, $depth + 1);
    }
    return $out;
}

function kiemke_client_ip() {
    $config = isset($GLOBALS['KIEMKE_CONFIG']) ? $GLOBALS['KIEMKE_CONFIG'] : array();
    if (!empty($config['trust_proxy']) && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        return trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
    }
    return isset($_SERVER['REMOTE_ADDR']) ? (string)$_SERVER['REMOTE_ADDR'] : '';
}

function app_log($level, $event, $context = array()) {
    $config = isset($GLOBALS['KIEMKE_CONFIG']) ? $GLOBALS['KIEMKE_CONFIG'] : array();
    $dir = isset($config['log_dir']) ? (string)$config['log_dir'] : (__DIR__ . '/storage/logs');
    if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) return false;
    $record = array(
        'timestamp' => date('c'),
        'level' => strtoupper((string)$level),
        'event' => (string)$event,
        'request_id' => kiemke_request_id(),
        'method' => isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'CLI',
        'path' => isset($_SERVER['REQUEST_URI']) ? strtok($_SERVER['REQUEST_URI'], '?') : '',
        'ip' => kiemke_client_ip(),
        'user' => isset($_SESSION['scan_user']) ? (string)$_SESSION['scan_user'] : '',
        'context' => kiemke_redact_context(is_array($context) ? $context : array('value' => $context)),
    );
    $line = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
    $ok = @file_put_contents($dir . '/app-' . date('Y-m-d') . '.jsonl', $line, FILE_APPEND | LOCK_EX) !== false;
    if (mt_rand(1, 200) === 1) {
        $retention = isset($config['log_retention_days']) ? (int)$config['log_retention_days'] : 14;
        $cutoff = time() - max(1, $retention) * 86400;
        foreach ((array)glob($dir . '/app-*.jsonl') as $file) if (@filemtime($file) < $cutoff) @unlink($file);
    }
    return $ok;
}

function kiemke_csrf_token() { return isset($_SESSION['csrf_token']) ? (string)$_SESSION['csrf_token'] : ''; }

function kiemke_require_csrf() {
    $provided = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? (string)$_SERVER['HTTP_X_CSRF_TOKEN'] : '';
    $expected = kiemke_csrf_token();
    if ($expected === '' || $provided === '' || !hash_equals($expected, $provided)) {
        app_log('warning', 'csrf_rejected');
        if (function_exists('json_response')) json_response(false, 'Phiên làm việc không hợp lệ. Vui lòng tải lại trang.', null, 403);
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(array('ok'=>false,'message'=>'Phiên làm việc không hợp lệ. Vui lòng tải lại trang.','data'=>null), JSON_UNESCAPED_UNICODE);
        exit;
    }
}

kiemke_request_id();

set_exception_handler(function ($e) {
    app_log('error', 'uncaught_exception', array(
        'type'=>get_class($e), 'message'=>$e->getMessage(),
        'file'=>basename($e->getFile()), 'line'=>$e->getLine()
    ));
    if (!headers_sent()) http_response_code(500);
    $message = 'Lỗi hệ thống. Request ID: ' . kiemke_request_id();
    if (defined('KIEMKE_JSON_API') && KIEMKE_JSON_API) {
        if (!headers_sent()) header('Content-Type: application/json; charset=utf-8');
        echo json_encode(array('ok'=>false,'message'=>$message,'data'=>null), JSON_UNESCAPED_UNICODE);
    } else {
        echo htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
    }
    exit;
});

register_shutdown_function(function () {
    $error = error_get_last();
    if (!$error || !in_array($error['type'], array(E_ERROR,E_PARSE,E_CORE_ERROR,E_COMPILE_ERROR), true)) return;
    app_log('critical', 'fatal_error', array('message'=>$error['message'],'file'=>basename($error['file']),'line'=>$error['line']));
});
