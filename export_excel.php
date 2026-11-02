<?php
require_once __DIR__ . '/bootstrap.php';

function esc_html($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function db_esc($conn, $s) { return mysqli_real_escape_string($conn, (string)$s); }
function strip_vietnamese_accents_local($str) {
    $str = (string)$str;
    $map = array('à'=>'a','á'=>'a','ạ'=>'a','ả'=>'a','ã'=>'a','â'=>'a','ầ'=>'a','ấ'=>'a','ậ'=>'a','ẩ'=>'a','ẫ'=>'a','ă'=>'a','ằ'=>'a','ắ'=>'a','ặ'=>'a','ẳ'=>'a','ẵ'=>'a','è'=>'e','é'=>'e','ẹ'=>'e','ẻ'=>'e','ẽ'=>'e','ê'=>'e','ề'=>'e','ế'=>'e','ệ'=>'e','ể'=>'e','ễ'=>'e','ì'=>'i','í'=>'i','ị'=>'i','ỉ'=>'i','ĩ'=>'i','ò'=>'o','ó'=>'o','ọ'=>'o','ỏ'=>'o','õ'=>'o','ô'=>'o','ồ'=>'o','ố'=>'o','ộ'=>'o','ổ'=>'o','ỗ'=>'o','ơ'=>'o','ờ'=>'o','ớ'=>'o','ợ'=>'o','ở'=>'o','ỡ'=>'o','ù'=>'u','ú'=>'u','ụ'=>'u','ủ'=>'u','ũ'=>'u','ư'=>'u','ừ'=>'u','ứ'=>'u','ự'=>'u','ử'=>'u','ữ'=>'u','ỳ'=>'y','ý'=>'y','ỵ'=>'y','ỷ'=>'y','ỹ'=>'y','đ'=>'d','À'=>'A','Á'=>'A','Ạ'=>'A','Ả'=>'A','Ã'=>'A','Â'=>'A','Ầ'=>'A','Ấ'=>'A','Ậ'=>'A','Ẩ'=>'A','Ẫ'=>'A','Ă'=>'A','Ằ'=>'A','Ắ'=>'A','Ặ'=>'A','Ẳ'=>'A','Ẵ'=>'A','È'=>'E','É'=>'E','Ẹ'=>'E','Ẻ'=>'E','Ẽ'=>'E','Ê'=>'E','Ề'=>'E','Ế'=>'E','Ệ'=>'E','Ể'=>'E','Ễ'=>'E','Ì'=>'I','Í'=>'I','Ị'=>'I','Ỉ'=>'I','Ĩ'=>'I','Ò'=>'O','Ó'=>'O','Ọ'=>'O','Ỏ'=>'O','Õ'=>'O','Ô'=>'O','Ồ'=>'O','Ố'=>'O','Ộ'=>'O','Ổ'=>'O','Ỗ'=>'O','Ơ'=>'O','Ờ'=>'O','Ớ'=>'O','Ợ'=>'O','Ở'=>'O','Ỡ'=>'O','Ù'=>'U','Ú'=>'U','Ụ'=>'U','Ủ'=>'U','Ũ'=>'U','Ư'=>'U','Ừ'=>'U','Ứ'=>'U','Ự'=>'U','Ử'=>'U','Ữ'=>'U','Ỳ'=>'Y','Ý'=>'Y','Ỵ'=>'Y','Ỷ'=>'Y','Ỹ'=>'Y','Đ'=>'D');
    return strtr($str, $map);

}

function search_terms_local($search) {
    $search = trim(strip_vietnamese_accents_local((string)$search));
    if ($search === '') { return array(); }
    $parts = preg_split('/[\s,;\|]+/u', $search);
    $out = array();
    foreach ($parts as $p) {
        $p = trim($p);
        if ($p === '') { continue; }
        if (ex_text_len($p) > 80) { $p = ex_text_sub($p, 0, 80); }
        $out[ex_text_lower($p)] = $p;
        if (count($out) >= 12) { break; }
    }
    return array_values($out);
}

function build_fuzzy_search_where_local($conn, $search) {
    $terms = search_terms_local($search);
    if (!count($terms)) { return ''; }
    $fields = array('id','source_type','scan_user','scan_date','scan_time','scan_datetime','raw_text','normalized_text','table_json','qr_lookup_key','qr_ems','qr_ems_lookup','qr_laptop_info','qr_device_type','qr_device_model','qr_asset_code','qr_device_serial_no','qr_serial_lookup8','qr_user_id','qr_user_dept','qr_last_check','scan_comment','machine_status','machine_serial','machine_name','machine_type','machine_brand','machine_model','machine_accounting_code','machine_factory','machine_location','machine_usedby','machine_position','machine_remark','machine_manu_serial','machine_purchase_date','machine_updated_time');
    $and = array();
    foreach ($terms as $term) {
        $termRaw = db_esc($conn, $term);
        $termNorm = db_esc($conn, strip_vietnamese_accents_local($term));
        $or = array();
        foreach ($fields as $f) {
            if ($f === 'id') { $or[] = "CAST(`id` AS CHAR) LIKE '%{$termRaw}%'"; }
            else if ($f === 'normalized_text') { $or[] = "`normalized_text` LIKE '%{$termNorm}%'"; }
            else { $or[] = "`{$f}` LIKE '%{$termRaw}%'"; }
        }
        for ($i=1; $i<=50; $i++) {
            $col = 'line_' . str_pad((string)$i, 2, '0', STR_PAD_LEFT);
            $or[] = "`{$col}` LIKE '%{$termRaw}%'";
        }
        $and[] = '(' . implode(' OR ', $or) . ')';
    }
    return '(' . implode(' AND ', $and) . ')';
}

$file = __DIR__ . '/connect.php';
if (!file_exists($file)) { die('Không tìm thấy connect.php'); }
require $file;
if (!isset($conn) || !($conn instanceof mysqli)) { die('connect.php phải tạo biến $conn kiểu mysqli'); }
@mysqli_set_charset($conn, 'utf8');
// Đảm bảo export không lỗi với database cũ chưa có cột lookup EMS / serial cũ.
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `qr_serial_lookup8` VARCHAR(20) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `qr_ems_lookup` VARCHAR(100) NULL");
@mysqli_query($conn, "CREATE INDEX `idx_qr_serial_lookup8` ON `ocr_scan_records` (`qr_serial_lookup8`)");
@mysqli_query($conn, "CREATE INDEX `idx_qr_ems_lookup` ON `ocr_scan_records` (`qr_ems_lookup`)");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `scan_comment` VARCHAR(1000) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_type` VARCHAR(255) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_brand` VARCHAR(255) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_model` VARCHAR(255) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_accounting_code` VARCHAR(255) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_factory` VARCHAR(255) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_usedby` VARCHAR(255) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_position` VARCHAR(255) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_remark` VARCHAR(1000) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_manu_serial` VARCHAR(255) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_purchase_date` VARCHAR(100) NULL");
@mysqli_query($conn, "ALTER TABLE `ocr_scan_records` ADD `machine_updated_time` VARCHAR(100) NULL");

$date = isset($_GET['date']) ? trim($_GET['date']) : '';
$user = isset($_GET['user']) ? trim($_GET['user']) : '';
$search = isset($_GET['search']) ? trim($_GET['search']) : '';
$sourceType = isset($_GET['source_type']) ? trim($_GET['source_type']) : 'all';
$allUsers = isset($_GET['all_users']) && (string)$_GET['all_users'] === '1';

$where = array('1=1');
if ($date !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    $dateEsc = db_esc($conn, $date);
    $where[] = "((source_type='qr' AND DATE(COALESCE(inventory_datetime,scan_datetime))='{$dateEsc}') OR (source_type<>'qr' AND scan_date='{$dateEsc}'))";
}
if ($sourceType !== '' && $sourceType !== 'all') { $where[] = "source_type='" . db_esc($conn, $sourceType) . "'"; }
if (!$allUsers && $user !== '') { $where[] = "scan_user='" . db_esc($conn, $user) . "'"; }
if ($allUsers && $user !== '') { $where[] = "scan_user LIKE '%" . db_esc($conn, $user) . "%'"; }
if ($search !== '') {
    $searchWhere = build_fuzzy_search_where_local($conn, $search);
    if ($searchWhere !== '') { $where[] = $searchWhere; }
}

$sql = "SELECT * FROM ocr_scan_records WHERE " . implode(' AND ', $where) . " ORDER BY scan_datetime DESC, id DESC";
$rs = mysqli_query($conn, $sql);
if (!$rs) { die('Lỗi export: ' . mysqli_error($conn)); }

$filename = 'ocr_qr_report_' . date('Ymd_His') . '.xls';
header('Content-Type: application/vnd.ms-excel; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
echo "\xEF\xBB\xBF";
?>
<html><head><meta charset="utf-8"><style>td,th{border:1px solid #999;padding:5px;vertical-align:top}th{background:#d9eaf7}</style></head><body>
<table>
<thead>
<tr>
<th>ID</th><th>Loại / Type</th><th>Ngày / Date</th><th>Giờ / Time</th><th>Ngày giờ scan / Scan DateTime</th><th>Thời gian kiểm kê / Inventory Time</th><th>Người kiểm kê / User</th><th>Phòng ban scan / Scan Department</th><th>EMS</th><th>Thiết bị / Device</th><th>Serial thiết bị / Device Serial No</th><th>User ID</th><th>Bộ phận / User's Dept</th><th>Kiểm tra gần nhất / Last Check</th><th>Mã tra cứu / Lookup EMS</th><th>QR Lookup Key</th><th>Lookup Serial 8</th><th>Trạng thái / Machine Status</th><th>Overview McSerialNumber</th><th>Tên máy / Machine Name</th><th>Loại máy / Machine Type</th><th>Hãng / Brand</th><th>Model</th><th>Mã tài sản / Accounting Code</th><th>Xưởng / Factory</th><th>Vị trí / Location</th><th>Người sử dụng / Used By</th><th>Bộ phận-vị trí / Position</th><th>Serial NSX / Manufacturer Serial</th><th>Ngày mua / Purchase Date</th><th>Cập nhật nguồn / Source Updated</th><th>Remark</th><th>Ghi chú / Comment</th>
<?php for ($i=1;$i<=50;$i++): ?><th>Line <?php echo str_pad((string)$i,2,'0',STR_PAD_LEFT); ?></th><?php endfor; ?>
<th>Dữ liệu gốc / Raw Text</th>
</tr>
</thead><tbody>
<?php while ($row = mysqli_fetch_assoc($rs)): ?>
<tr>
<td><?php echo esc_html($row['id']); ?></td>
<td><?php echo esc_html(isset($row['source_type']) ? $row['source_type'] : ''); ?></td>
<td><?php echo esc_html($row['scan_date']); ?></td>
<td><?php echo esc_html($row['scan_time']); ?></td>
<td><?php echo esc_html($row['scan_datetime']); ?></td>
<td><?php echo esc_html(isset($row['inventory_datetime']) ? $row['inventory_datetime'] : $row['scan_datetime']); ?></td>
<td><?php echo esc_html($row['scan_user']); ?></td>
<td><?php echo esc_html(isset($row['scan_department']) ? $row['scan_department'] : ''); ?></td>
<td><?php echo esc_html(isset($row['qr_ems']) ? $row['qr_ems'] : ''); ?></td>
<td><?php echo esc_html(isset($row['qr_laptop_info']) ? $row['qr_laptop_info'] : ''); ?></td>
<td><?php echo esc_html(isset($row['qr_device_serial_no']) ? $row['qr_device_serial_no'] : ''); ?></td>
<td><?php echo esc_html(isset($row['qr_user_id']) ? $row['qr_user_id'] : ''); ?></td>
<td><?php echo esc_html(isset($row['qr_user_dept']) ? $row['qr_user_dept'] : ''); ?></td>
<td><?php echo esc_html(isset($row['qr_last_check']) ? $row['qr_last_check'] : ''); ?></td>
<td><?php echo esc_html(isset($row['qr_ems_lookup']) ? $row['qr_ems_lookup'] : (isset($row['qr_lookup_key']) ? $row['qr_lookup_key'] : '')); ?></td>
<td><?php echo esc_html(isset($row['qr_lookup_key']) ? $row['qr_lookup_key'] : ''); ?></td>
<td><?php echo esc_html(isset($row['qr_serial_lookup8']) ? $row['qr_serial_lookup8'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_status']) ? $row['machine_status'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_serial']) ? $row['machine_serial'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_name']) ? $row['machine_name'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_type']) ? $row['machine_type'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_brand']) ? $row['machine_brand'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_model']) ? $row['machine_model'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_accounting_code']) ? $row['machine_accounting_code'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_factory']) ? $row['machine_factory'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_location']) ? $row['machine_location'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_usedby']) ? $row['machine_usedby'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_position']) ? $row['machine_position'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_manu_serial']) ? $row['machine_manu_serial'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_purchase_date']) ? $row['machine_purchase_date'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_updated_time']) ? $row['machine_updated_time'] : ''); ?></td>
<td><?php echo esc_html(isset($row['machine_remark']) ? $row['machine_remark'] : ''); ?></td>
<td><?php echo esc_html(isset($row['scan_comment']) ? $row['scan_comment'] : ''); ?></td>
<?php for ($i=1;$i<=50;$i++): $col = 'line_' . str_pad((string)$i,2,'0',STR_PAD_LEFT); ?><td><?php echo esc_html(isset($row[$col]) ? $row[$col] : ''); ?></td><?php endfor; ?>
<td><?php echo esc_html(isset($row['raw_text']) ? $row['raw_text'] : ''); ?></td>
</tr>
<?php endwhile; ?>
</tbody></table></body></html>
