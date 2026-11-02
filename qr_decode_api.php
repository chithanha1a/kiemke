<?php
if (!defined('KIEMKE_JSON_API')) define('KIEMKE_JSON_API', true);
require_once __DIR__ . '/bootstrap.php';
header('Content-Type: application/json; charset=utf-8');
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'POST') kiemke_require_csrf();
function json_response($ok, $message = '', $data = null, $status = 200) {
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
function save_data_url($dataUrl) {
    if (!preg_match('/^data:image\/(png|jpeg|jpg|webp);base64,/i', $dataUrl, $m)) { json_response(false, 'Ảnh QR không hợp lệ.', null, 400); }
    $ext = strtolower($m[1]); if ($ext === 'jpeg') { $ext = 'jpg'; }
    $bin = base64_decode(preg_replace('/^data:image\/(png|jpeg|jpg|webp);base64,/i', '', $dataUrl), true);
    if ($bin === false || strlen($bin) < 50) { json_response(false, 'Không decode được ảnh QR.', null, 400); }
    if (strlen($bin) > 6 * 1024 * 1024) { json_response(false, 'Ảnh QR quá lớn.', null, 413); }
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'qr_' . bin2hex(random_bytes(6));
    @mkdir($dir, 0775, true);
    $path = $dir . DIRECTORY_SEPARATOR . 'qr.' . $ext;
    file_put_contents($path, $bin);
    return array($path, $dir);
}
function run_cmd($cmd, &$code = null) { $out = array(); @exec($cmd . ' 2>&1', $out, $code); return implode("\n", $out); }
function try_zbar($path) {
    $code = 1;
    $out = run_cmd('zbarimg -q --raw ' . escapeshellarg($path), $code);
    if ($code === 0 && trim($out) !== '') { return trim(preg_split('/\r\n|\r|\n/', $out)[0]); }
    return '';
}
function try_python_cv($path) {
    $script = __DIR__ . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'tools' . DIRECTORY_SEPARATOR . 'decode_qr.py';
    if (!file_exists($script)) { return ''; }
    foreach (array('python3', 'python') as $py) {
        $code = 1;
        $out = run_cmd($py . ' ' . escapeshellarg($script) . ' ' . escapeshellarg($path), $code);
        if ($code === 0 && trim($out) !== '') {
            $json = json_decode($out, true);
            if (is_array($json) && !empty($json['text'])) { return trim((string)$json['text']); }
        }
    }
    return '';
}
$action = isset($_GET['action']) ? $_GET['action'] : '';
if ($action !== 'decode') { json_response(false, 'Action không hợp lệ.', null, 404); }
$body = read_json_body();
list($path, $dir) = save_data_url(isset($body['image_data_url']) ? (string)$body['image_data_url'] : '');
$text = try_zbar($path);
if ($text === '') { $text = try_python_cv($path); }
@unlink($path); @rmdir($dir);
if ($text === '') { json_response(false, 'Không đọc được QR bằng server local. Trên Safari/Edge cũ hãy đặt jsQR.min.js thật hoặc cài zbarimg/python-opencv trên server.', null, 404); }
json_response(true, 'Đã đọc QR.', array('qr_text'=>$text));
