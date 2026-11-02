<?php
if (!defined('KIEMKE_JSON_API')) define('KIEMKE_JSON_API', true);
require_once __DIR__ . '/bootstrap.php';
header('Content-Type: application/json; charset=utf-8');
date_default_timezone_set('Asia/Ho_Chi_Minh');
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
function strip_vietnamese_accents($str) {
    $map = array(
        'à'=>'a','á'=>'a','ạ'=>'a','ả'=>'a','ã'=>'a','â'=>'a','ầ'=>'a','ấ'=>'a','ậ'=>'a','ẩ'=>'a','ẫ'=>'a','ă'=>'a','ằ'=>'a','ắ'=>'a','ặ'=>'a','ẳ'=>'a','ẵ'=>'a',
        'è'=>'e','é'=>'e','ẹ'=>'e','ẻ'=>'e','ẽ'=>'e','ê'=>'e','ề'=>'e','ế'=>'e','ệ'=>'e','ể'=>'e','ễ'=>'e','ì'=>'i','í'=>'i','ị'=>'i','ỉ'=>'i','ĩ'=>'i',
        'ò'=>'o','ó'=>'o','ọ'=>'o','ỏ'=>'o','õ'=>'o','ô'=>'o','ồ'=>'o','ố'=>'o','ộ'=>'o','ổ'=>'o','ỗ'=>'o','ơ'=>'o','ờ'=>'o','ớ'=>'o','ợ'=>'o','ở'=>'o','ỡ'=>'o',
        'ù'=>'u','ú'=>'u','ụ'=>'u','ủ'=>'u','ũ'=>'u','ư'=>'u','ừ'=>'u','ứ'=>'u','ự'=>'u','ử'=>'u','ữ'=>'u','ỳ'=>'y','ý'=>'y','ỵ'=>'y','ỷ'=>'y','ỹ'=>'y','đ'=>'d',
        'À'=>'A','Á'=>'A','Ạ'=>'A','Ả'=>'A','Ã'=>'A','Â'=>'A','Ầ'=>'A','Ấ'=>'A','Ậ'=>'A','Ẩ'=>'A','Ẫ'=>'A','Ă'=>'A','Ằ'=>'A','Ắ'=>'A','Ặ'=>'A','Ẳ'=>'A','Ẵ'=>'A',
        'È'=>'E','É'=>'E','Ẹ'=>'E','Ẻ'=>'E','Ẽ'=>'E','Ê'=>'E','Ề'=>'E','Ế'=>'E','Ệ'=>'E','Ể'=>'E','Ễ'=>'E','Ì'=>'I','Í'=>'I','Ị'=>'I','Ỉ'=>'I','Ĩ'=>'I',
        'Ò'=>'O','Ó'=>'O','Ọ'=>'O','Ỏ'=>'O','Õ'=>'O','Ô'=>'O','Ồ'=>'O','Ố'=>'O','Ộ'=>'O','Ổ'=>'O','Ỗ'=>'O','Ơ'=>'O','Ờ'=>'O','Ớ'=>'O','Ợ'=>'O','Ở'=>'O','Ỡ'=>'O',
        'Ù'=>'U','Ú'=>'U','Ụ'=>'U','Ủ'=>'U','Ũ'=>'U','Ư'=>'U','Ừ'=>'U','Ứ'=>'U','Ự'=>'U','Ử'=>'U','Ữ'=>'U','Ỳ'=>'Y','Ý'=>'Y','Ỵ'=>'Y','Ỷ'=>'Y','Ỹ'=>'Y','Đ'=>'D'
    );
    return strtr((string)$str, $map);
}
function clean_cell($s) {
    $s = strip_vietnamese_accents((string)$s);
    $s = str_replace(array("\r\n", "\r", "\n", "\t"), ' ', $s);
    $s = str_replace(array('“','”','‘','’'), array('"','"',"'","'"), $s);
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s);
    $s = preg_replace('/\s+/u', ' ', $s);
    return trim($s);
}
function disabled_functions_array() {
    $disabled = ini_get('disable_functions');
    if (!$disabled) { return array(); }
    $arr = array_map('trim', explode(',', $disabled));
    return array_filter($arr, function($x){ return $x !== ''; });
}
function function_disabled($name) {
    return in_array($name, disabled_functions_array(), true);
}
function is_windows() {
    return strtoupper(substr(PHP_OS, 0, 3)) === 'WIN';
}
function shell_arg($value) {
    return escapeshellarg((string)$value);
}
function run_command($cmd, $env = array(), $cwd = null) {
    $result = array('ok'=>false, 'code'=>127, 'stdout'=>'', 'stderr'=>'', 'cmd'=>$cmd, 'method'=>'');
    $descriptors = array(
        0 => array('pipe', 'r'),
        1 => array('pipe', 'w'),
        2 => array('pipe', 'w')
    );
    if (function_exists('proc_open') && !function_disabled('proc_open')) {
        $result['method'] = 'proc_open';
        $process = @proc_open($cmd, $descriptors, $pipes, $cwd ? $cwd : null, count($env) ? $env : null);
        if (is_resource($process)) {
            fclose($pipes[0]);
            $result['stdout'] = stream_get_contents($pipes[1]);
            fclose($pipes[1]);
            $result['stderr'] = stream_get_contents($pipes[2]);
            fclose($pipes[2]);
            $result['code'] = proc_close($process);
            $result['ok'] = ($result['code'] === 0);
            return $result;
        }
    }
    if (function_exists('exec') && !function_disabled('exec')) {
        $result['method'] = 'exec';
        $out = array();
        $code = 127;
        @exec($cmd . ' 2>&1', $out, $code);
        $result['stdout'] = implode("\n", $out);
        $result['stderr'] = '';
        $result['code'] = $code;
        $result['ok'] = ($code === 0);
        return $result;
    }
    $result['stderr'] = 'PHP không cho phép chạy proc_open hoặc exec. Kiểm tra disable_functions trong php.ini.';
    return $result;
}
function load_ocr_config() {
    $cfg = array(
        'tesseract_path' => '',
        'tessdata_prefix' => '',
        'default_lang' => 'eng',
        'default_psm' => 11
    );
    $file = __DIR__ . '/ocr_config.php';
    if (file_exists($file)) {
        require $file;
        if (isset($TESSERACT_EXE)) { $cfg['tesseract_path'] = trim((string)$TESSERACT_EXE); }
        if (isset($TESSDATA_PREFIX)) { $cfg['tessdata_prefix'] = trim((string)$TESSDATA_PREFIX); }
        if (isset($OCR_LANG)) { $cfg['default_lang'] = preg_replace('/[^a-zA-Z+]/', '', (string)$OCR_LANG); }
        if (isset($OCR_PSM)) { $cfg['default_psm'] = (int)$OCR_PSM; }
    }
    if ($cfg['tesseract_path'] === '' && getenv('TESSERACT_EXE')) { $cfg['tesseract_path'] = trim((string)getenv('TESSERACT_EXE')); }
    if ($cfg['tessdata_prefix'] === '' && getenv('TESSDATA_PREFIX')) { $cfg['tessdata_prefix'] = trim((string)getenv('TESSDATA_PREFIX')); }
    return $cfg;
}
function candidate_paths($cfg) {
    $paths = array();
    if ($cfg['tesseract_path'] !== '') { $paths[] = $cfg['tesseract_path']; }
    $paths[] = __DIR__ . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'tesseract' . DIRECTORY_SEPARATOR . 'tesseract.exe';
    if (is_windows()) {
        $paths[] = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
        $paths[] = 'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe';
        $paths[] = 'D:\\Tesseract-OCR\\tesseract.exe';
        $paths[] = 'tesseract.exe';
        $paths[] = 'tesseract';
    } else {
        $paths[] = '/usr/bin/tesseract';
        $paths[] = '/usr/local/bin/tesseract';
        $paths[] = 'tesseract';
    }
    $seen = array();
    $out = array();
    foreach ($paths as $p) {
        $key = strtolower($p);
        if (isset($seen[$key])) { continue; }
        $seen[$key] = true;
        $out[] = $p;
    }
    return $out;
}
function build_env($cfg) {
    $env = $_ENV;
    if (!is_array($env)) { $env = array(); }
    if ($cfg['tessdata_prefix'] !== '') {
        $env['TESSDATA_PREFIX'] = $cfg['tessdata_prefix'];
    }
    return $env;
}
function test_tesseract_path($path, $cfg) {
    $isNameOnly = !preg_match('/[\\\/]/', $path);
    if (!$isNameOnly && !file_exists($path)) {
        return array('path'=>$path, 'exists'=>false, 'ok'=>false, 'code'=>null, 'version'=>'', 'error'=>'File không tồn tại.');
    }
    $cmd = shell_arg($path) . ' --version';
    $res = run_command($cmd, build_env($cfg));
    $txt = trim($res['stdout'] . "\n" . $res['stderr']);
    return array('path'=>$path, 'exists'=>$isNameOnly ? null : true, 'ok'=>$res['ok'], 'code'=>$res['code'], 'version'=>$res['ok'] ? $txt : '', 'error'=>$res['ok'] ? '' : $txt, 'method'=>$res['method']);
}
function find_tesseract() {
    $cfg = load_ocr_config();
    $diagnostics = array();
    foreach (candidate_paths($cfg) as $path) {
        $test = test_tesseract_path($path, $cfg);
        $diagnostics[] = $test;
        if ($test['ok']) {
            return array('found'=>true, 'path'=>$path, 'version'=>$test['version'], 'tessdata_prefix'=>$cfg['tessdata_prefix'], 'cfg'=>$cfg, 'diagnostics'=>$diagnostics);
        }
    }
    return array('found'=>false, 'path'=>'', 'version'=>'', 'tessdata_prefix'=>$cfg['tessdata_prefix'], 'cfg'=>$cfg, 'diagnostics'=>$diagnostics);
}
function project_tmp_dir() {
    $dir = __DIR__ . DIRECTORY_SEPARATOR . 'tmp' . DIRECTORY_SEPARATOR . 'ocr';
    if (!is_dir($dir)) { @mkdir($dir, 0775, true); }
    if (!is_writable($dir)) {
        $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'ocr_php_app';
        if (!is_dir($dir)) { @mkdir($dir, 0775, true); }
    }
    return $dir;
}
function save_data_url($dataUrl) {
    if (!preg_match('/^data:image\/(png|jpeg|jpg|webp);base64,/i', $dataUrl, $m)) { json_response(false, 'Ảnh OCR không hợp lệ.', null, 400); }
    $ext = strtolower($m[1]);
    if ($ext === 'jpeg') { $ext = 'jpg'; }
    $bin = base64_decode(preg_replace('/^data:image\/(png|jpeg|jpg|webp);base64,/i', '', $dataUrl), true);
    if ($bin === false || strlen($bin) < 50) { json_response(false, 'Không decode được ảnh OCR.', null, 400); }
    if (strlen($bin) > 14 * 1024 * 1024) { json_response(false, 'Ảnh quá lớn. Vui lòng chụp/crop nhỏ hơn.', null, 413); }
    $dir = project_tmp_dir() . DIRECTORY_SEPARATOR . 'job_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4));
    if (!@mkdir($dir, 0775, true)) { json_response(false, 'Không tạo được thư mục tạm OCR: ' . $dir, null, 500); }
    $path = $dir . DIRECTORY_SEPARATOR . 'image.' . $ext;
    if (file_put_contents($path, $bin) === false) { json_response(false, 'Không ghi được ảnh tạm OCR.', null, 500); }
    return array($path, $dir);
}
function parse_tsv_file($path) {
    if (!file_exists($path)) { return array(array(), array(), ''); }
    $tsv = file_get_contents($path);
    $lines = preg_split('/\r\n|\r|\n/', trim((string)$tsv));
    if (count($lines) <= 1) { return array(array(), array(), ''); }
    $header = str_getcsv(array_shift($lines), "\t");
    $idx = array();
    foreach ($header as $i => $h) { $idx[$h] = $i; }
    $words = array();
    $groups = array();
    foreach ($lines as $ln) {
        if (trim($ln) === '') { continue; }
        $cols = str_getcsv($ln, "\t");
        $text = isset($idx['text'], $cols[$idx['text']]) ? clean_cell($cols[$idx['text']]) : '';
        if ($text === '') { continue; }
        $conf = isset($idx['conf'], $cols[$idx['conf']]) ? (float)$cols[$idx['conf']] : 0;
        if ($conf < 10) { continue; }
        $left = isset($idx['left'], $cols[$idx['left']]) ? (int)$cols[$idx['left']] : 0;
        $top = isset($idx['top'], $cols[$idx['top']]) ? (int)$cols[$idx['top']] : 0;
        $width = isset($idx['width'], $cols[$idx['width']]) ? (int)$cols[$idx['width']] : 0;
        $height = isset($idx['height'], $cols[$idx['height']]) ? (int)$cols[$idx['height']] : 0;
        $word = array('text'=>$text,'confidence'=>$conf,'conf'=>$conf,'x0'=>$left,'y0'=>$top,'x1'=>$left+$width,'y1'=>$top+$height,'width'=>$width,'height'=>$height);
        $words[] = $word;
        $lineKey = implode('-', array(
            isset($idx['block_num'], $cols[$idx['block_num']]) ? $cols[$idx['block_num']] : '0',
            isset($idx['par_num'], $cols[$idx['par_num']]) ? $cols[$idx['par_num']] : '0',
            isset($idx['line_num'], $cols[$idx['line_num']]) ? $cols[$idx['line_num']] : (string)round($top / max(12, $height))
        ));
        if (!isset($groups[$lineKey])) { $groups[$lineKey] = array('top'=>$top,'words'=>array()); }
        $groups[$lineKey]['top'] = min($groups[$lineKey]['top'], $top);
        $groups[$lineKey]['words'][] = $word;
    }
    uasort($groups, function($a, $b){ return $a['top'] - $b['top']; });
    $table = array();
    foreach ($groups as $g) {
        usort($g['words'], function($a, $b){ return $a['x0'] - $b['x0']; });
        $cells = array();
        $cur = array();
        $prev = null;
        $avgH = 0;
        foreach ($g['words'] as $w) { $avgH += max(1, $w['height']); }
        $avgH = count($g['words']) ? $avgH / count($g['words']) : 16;
        foreach ($g['words'] as $w) {
            if ($prev !== null) {
                $gap = $w['x0'] - $prev['x1'];
                $threshold = max(22, $avgH * 1.35, min(90, $prev['width'] * 1.2));
                if ($gap > $threshold) {
                    $cell = clean_cell(implode(' ', $cur));
                    if ($cell !== '') { $cells[] = $cell; }
                    $cur = array();
                }
            }
            $cur[] = $w['text'];
            $prev = $w;
        }
        if (count($cur)) {
            $cell = clean_cell(implode(' ', $cur));
            if ($cell !== '') { $cells[] = $cell; }
        }
        if (count($cells)) { $table[] = $cells; }
    }
    $rawLines = array();
    foreach ($table as $r) { $rawLines[] = implode("\t", $r); }
    return array($words, $table, implode("\n", $rawLines));
}
function parse_txt_file($path) {
    if (!file_exists($path)) { return array(array(), array(), ''); }
    $txt = file_get_contents($path);
    $lines = preg_split('/\r\n|\r|\n/', trim((string)$txt));
    $table = array();
    foreach ($lines as $ln) {
        $ln = clean_cell($ln);
        if ($ln !== '') { $table[] = array($ln); }
    }
    return array(array(), $table, implode("\n", array_map(function($r){ return implode(' ', $r); }, $table)));
}
function cleanup_dir($dir) {
    if (!is_dir($dir)) { return; }
    $files = glob($dir . DIRECTORY_SEPARATOR . '*');
    if (is_array($files)) { foreach ($files as $f) { if (is_file($f)) { @unlink($f); } } }
    @rmdir($dir);
}
function normalize_langs($requested) {
    $requested = preg_replace('/[^a-zA-Z+]/', '', (string)$requested);
    if ($requested === '') { $requested = 'eng'; }
    $langs = array($requested);
    if (strpos($requested, 'eng') === false) { $langs[] = 'eng'; }
    $langs[] = 'eng';
    $out = array();
    foreach ($langs as $lg) { if ($lg !== '' && !in_array($lg, $out, true)) { $out[] = $lg; } }
    return $out;
}
function run_tesseract_job($info, $imagePath, $dir, $lang, $psm) {
    $lastErr = '';
    $commands = array();
    $env = build_env($info['cfg']);
    foreach (normalize_langs($lang) as $lg) {
        $base = $dir . DIRECTORY_SEPARATOR . 'out_' . preg_replace('/[^A-Za-z0-9_]+/', '_', $lg) . '_tsv';
        $cmd = shell_arg($info['path']) . ' ' . shell_arg($imagePath) . ' ' . shell_arg($base) . ' -l ' . shell_arg($lg) . ' --psm ' . (int)$psm . ' -c preserve_interword_spaces=1';
        if ($info['tessdata_prefix'] !== '') { $cmd .= ' --tessdata-dir ' . shell_arg($info['tessdata_prefix']); }
        $cmd .= ' tsv';
        $res = run_command($cmd, $env, $dir);
        $commands[] = array('lang'=>$lg, 'format'=>'tsv', 'code'=>$res['code'], 'stderr'=>trim($res['stderr']), 'stdout'=>trim($res['stdout']), 'method'=>$res['method']);
        $tsvFile = $base . '.tsv';
        if ($res['ok'] && file_exists($tsvFile) && filesize($tsvFile) > 0) {
            list($words, $table, $raw) = parse_tsv_file($tsvFile);
            if (count($table) || count($words)) { return array(true, $words, $table, $raw, $lg, $commands, 'tsv'); }
        }
        $lastErr = trim($res['stderr'] . "\n" . $res['stdout']);
    }
    // Fallback plain text output if TSV failed but engine can still produce text.
    foreach (normalize_langs($lang) as $lg) {
        $base = $dir . DIRECTORY_SEPARATOR . 'out_' . preg_replace('/[^A-Za-z0-9_]+/', '_', $lg) . '_txt';
        $cmd = shell_arg($info['path']) . ' ' . shell_arg($imagePath) . ' ' . shell_arg($base) . ' -l ' . shell_arg($lg) . ' --psm ' . (int)$psm . ' -c preserve_interword_spaces=1';
        if ($info['tessdata_prefix'] !== '') { $cmd .= ' --tessdata-dir ' . shell_arg($info['tessdata_prefix']); }
        $res = run_command($cmd, $env, $dir);
        $commands[] = array('lang'=>$lg, 'format'=>'txt', 'code'=>$res['code'], 'stderr'=>trim($res['stderr']), 'stdout'=>trim($res['stdout']), 'method'=>$res['method']);
        $txtFile = $base . '.txt';
        if ($res['ok'] && file_exists($txtFile) && filesize($txtFile) > 0) {
            list($words, $table, $raw) = parse_txt_file($txtFile);
            if (trim($raw) !== '') { return array(true, $words, $table, $raw, $lg, $commands, 'txt'); }
        }
        $lastErr = trim($res['stderr'] . "\n" . $res['stdout']);
    }
    return array(false, array(), array(), '', '', $commands, $lastErr !== '' ? $lastErr : 'Tesseract không trả kết quả OCR.');
}

$action = isset($_GET['action']) ? $_GET['action'] : '';
$info = find_tesseract();
if ($action === 'status' || $action === 'diagnose') {
    $data = array(
        'available' => $info['found'],
        'path' => $info['path'],
        'version' => $info['version'],
        'tessdata_prefix' => $info['tessdata_prefix'],
        'php_os' => PHP_OS,
        'php_version' => PHP_VERSION,
        'disabled_functions' => array_values(disabled_functions_array()),
        'tmp_dir' => project_tmp_dir(),
        'diagnostics' => $info['diagnostics']
    );
    json_response(true, $info['found'] ? 'OCR server sẵn sàng.' : 'Không tìm thấy Tesseract OCR.', $data);
}
if ($action !== 'recognize') { json_response(false, 'Action không hợp lệ.', null, 404); }
if (!$info['found']) {
    json_response(false, 'OCR server chưa sẵn sàng: không tìm thấy tesseract.exe. Kiểm tra ocr_config.php hoặc mở ocr_api.php?action=diagnose để xem chi tiết.', array('missing_tesseract'=>true, 'diagnostics'=>$info['diagnostics']), 500);
}
$body = read_json_body();
$dataUrl = isset($body['image_data_url']) ? (string)$body['image_data_url'] : '';
$lang = isset($body['lang']) ? preg_replace('/[^a-zA-Z+]/', '', (string)$body['lang']) : $info['cfg']['default_lang'];
if ($lang === '') { $lang = $info['cfg']['default_lang'] ? $info['cfg']['default_lang'] : 'eng'; }
$psm = isset($body['psm']) ? (int)$body['psm'] : (int)$info['cfg']['default_psm'];
if ($psm < 3 || $psm > 13) { $psm = 11; }
list($imagePath, $tmpDir) = save_data_url($dataUrl);
list($ok, $words, $table, $raw, $usedLang, $commands, $detail) = run_tesseract_job($info, $imagePath, $tmpDir, $lang, $psm);
@unlink($imagePath);
if (!$ok) {
    $debugDir = $tmpDir;
    // giữ thư mục tạm nếu OCR lỗi để admin có thể kiểm tra ảnh/input trong thời gian ngắn
    json_response(false, 'Tesseract OCR lỗi: ' . $detail, array('path'=>$info['path'], 'tessdata_prefix'=>$info['tessdata_prefix'], 'commands'=>$commands, 'debug_tmp_dir'=>$debugDir), 500);
}
cleanup_dir($tmpDir);
json_response(true, 'OCR server hoàn tất.', array(
    'words' => $words,
    'table' => $table,
    'raw_text' => $raw,
    'engine' => 'server-tesseract',
    'lang' => $usedLang,
    'format' => $detail,
    'tesseract_path' => $info['path']
));
