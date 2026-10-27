'use strict';


// v29: stable viewport sizing for iOS/Android browsers and responsive UI helpers
(function initDeviceUiHelpers() {
  function setVh() {
    var h = (window.visualViewport && window.visualViewport.height) ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-vh', (h * 0.01) + 'px');
  }
  setVh();
  window.addEventListener('resize', setVh, {passive:true});
  if (window.visualViewport) window.visualViewport.addEventListener('resize', setVh, {passive:true});
  document.documentElement.classList.toggle('is-touch', !!('ontouchstart' in window || navigator.maxTouchPoints > 0));
  document.documentElement.classList.toggle('is-ios', /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  document.documentElement.classList.toggle('is-android', /Android/i.test(navigator.userAgent));
})();

const $ = (id) => document.getElementById(id);

const state = {
  user: window.INITIAL_USER || '',
  scanDepartment: window.INITIAL_SCAN_DEPARTMENT || '',
  departmentSavedCount: 0,
  qrStream: null,
  ocrStream: null,
  qrLiveTimer: null,
  qrDecodeBusy: false,
  lastQrText: '',
  lastQrImageDataUrl: '',
  lastLookupKey: '',
  lastMachineRows: [],
  lastQrParsed: null,
  lastInventoryDatetime: '',
  lastQrComment: '',
  ocrWorker: null,
  ocrWorkerLang: '',
  ocrImageReady: false,
  ocrImageDataUrl: '',
  ocrTable: [],
  ocrRawText: '',
  ocrRotation: 0,
  editRecordId: 0,
  editTable: [],
  rowsById: {},
  lastServerQrAt: 0,
  qrLastFrameState: '',
  qrWaitingCheck: false,
  qrSaveBusy: false,
  ocrWaitingSave: false,
  ocrSaveBusy: false,
  qrScanPausedByScroll: false,
  qrScrollTimer: null,
  qrLiveScanSeq: 0,
  qrLastScanTickAt: 0,
  offlineFactory: '',
  offlineDeviceCode: 'COMP',
  offlineDeviceCodes: ['COMP'],
  dataSource: 'mssql',
  saveTarget: 'mysql',
  offlineDeviceCodeListLoaded: false,
  offlineDeviceCodeListLoading: false,
  offlineDeviceCodeListCount: 0,
  sessionScans: [],
  sessionScanEvents: 0,
  sessionCurrentCode: '',
  sessionPreviousCode: '',
  offlineFactoryListLoaded: false,
  offlineFactoryListLoading: false,
  offlineFactoryListError: '',
  offlineFactoryListCount: 0,
  offlineSyncBusy: false,
  offlineBulkDownloadBusy: false,
  qrNativeDetectorPromise: null,
  qrProcessSeq: 0,
  qrCurrentScanId: '',
  qrCurrentProcessBusy: false,
  qrSkipRequested: false,
  qrAutoOpenAttempted: false,
  qrLastAcceptedCode: '',
  qrBlankFrames: 3,
  qrLastAcceptedAt: 0,
  autoSyncTimer: null,
  qrListRefreshTimer: null,
  machineDbBackoffUntil: 0,
  machineDbFailureCount: 0,
  saveDbBackoffUntil: 0,
  saveDbFailureCount: 0,
  qrQueueWorkerBusy: false,
  qrQueueProcessTimer: null,
  qrQueueRefreshTimer: null,
  scanQueueScrollActive: false,
  scanQueuePendingRender: false,
  scanQueueScrollEndTimer: null,
  scanQueueLastItems: [],
  qrLastCapturedQueueId: 0,
  qrCurrentQueueItemId: 0,
  qrSkipQueueIds: new Set(),
  qrQueueGraceMs: 1800,
  isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
};

function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function pad2(n) { return String(n).padStart(2, '0'); }
function nowSqlLocal() {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function nextPaint() { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }
function cleanLookupCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function emsLookupKey(ems) { return cleanLookupCode(ems); }
function serialLookup8(serial) {
  const s = cleanLookupCode(serial);
  return s ? s.slice(0, 8) : '';
}
function setQrStatus(text) { $('qrStatusText').textContent = text; }
function setOcrStatus(text) { $('ocrStatusText').textContent = text; }
function setQrFrame(active, detected = false, hint = '') {
  const box = $('qrPreviewBox');
  const h = $('qrScanHint');
  if (!box) return;
  box.classList.toggle('has-frame', !!active);
  box.classList.toggle('scanning', !!active && !detected && !state.qrWaitingCheck);
  box.classList.toggle('qr-detected', !!active && !!detected && !state.qrWaitingCheck);
  box.classList.toggle('qr-waiting', !!active && !!state.qrWaitingCheck);
  if (h) {
    if (state.qrWaitingCheck) h.textContent = hint || 'Waiting check';
    else h.textContent = hint || (detected ? 'Đã nhận diện mã' : 'Đưa QR/Barcode vào khung');
  }
}
function pulseQrDetected() {
  setQrFrame(true, true, 'Đã nhận diện mã');
  setTimeout(() => {
    if (state.qrStream && !state.qrLiveTimer && !state.qrWaitingCheck) {
      setQrFrame(true, false, 'Đưa QR/Barcode vào khung');
    }
  }, 1500);
}

function enterQrWaitingCheck(message) {
  state.qrWaitingCheck = true;
  state.qrScanPausedByScroll = false;
  stopQrLiveScan(false);
  setQrFrame(true, false, 'Waiting check');
  setQrStatus(message || 'Waiting check: đang kiểm tra dữ liệu.');
}

function clearQrCurrentResult() {
  state.lastQrText = '';
  state.lastQrImageDataUrl = '';
  state.lastLookupKey = '';
  state.lastMachineRows = [];
  state.lastQrParsed = null;
  state.lastInventoryDatetime = '';
  state.qrWaitingCheck = false;
  state.qrCurrentScanId = '';
  state.qrCurrentProcessBusy = false;
  state.qrSkipRequested = false;
  if ($('btnQrSkipCurrent')) $('btnQrSkipCurrent').disabled = true;
  if ($('qrPreviewBox')) $('qrPreviewBox').classList.remove('qr-waiting');
  if ($('qrText')) $('qrText').value = '';
  if ($('qrLookupKey')) $('qrLookupKey').value = '';
  renderQrParsed(null);
  if ($('machineSummary')) $('machineSummary').textContent = 'Chưa có dữ liệu máy.';
  renderMachineRows([]);
}

async function resetQrForNextScan(resumeScan) {
  clearQrCurrentResult();
  if (state.qrStream) {
    if ($('qrVideo')) $('qrVideo').style.display = '';
    if ($('qrCanvas')) $('qrCanvas').style.display = 'none';
    setQrFrame(true, false, 'Đưa QR/Barcode vào khung');
    setQrStatus('Sẵn sàng scan tiếp.');
    if (resumeScan) {
      await startQrLiveScan(true);
    }
  } else {
    setQrFrame(false);
    setQrStatus('Sẵn sàng.');
  }
}

function showToast(message, type = 'info', timeout = 3200) {
  const box = $('toastContainer');
  if (!box) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" aria-label="Đóng">×</button>`;
  const close = () => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 220);
  };
  toast.querySelector('button').addEventListener('click', close);
  box.appendChild(toast);
  setTimeout(close, timeout);
}
function notifyError(message) { showToast(message || 'Có lỗi.', 'error', 4800); }
function notifySuccess(message) { showToast(message || 'Hoàn tất.', 'success', 3200); }
function notifyInfo(message) { showToast(message || '', 'info', 3200); }

// QR scan toast: one lightweight, auto-sliding notification only. Replacing the previous
// scan toast prevents continuous scanning from stacking dozens of DOM nodes on tablets.
function notifyQrCaptured(code, queueId, refreshed = false, duplicateCount = 0) {
  const box = $('toastContainer');
  if (!box) return;
  const previous = box.querySelector('.toast-scan');
  if (previous) previous.remove();

  const toast = document.createElement('div');
  toast.className = 'toast toast-success toast-scan';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const action = refreshed ? 'Đã cập nhật thời gian' : 'Đã scan';
  const repeat = refreshed && Number(duplicateCount || 0) > 0 ? ` • quét lại ${Number(duplicateCount)} lần` : '';
  toast.innerHTML = `<span>${action} <b>${escapeHtml(code || '')}</b>${queueId ? ` • Queue #${Number(queueId)}` : ''}${repeat}</span>`;
  box.appendChild(toast);

  const close = () => {
    if (!toast.isConnected) return;
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 220);
  };
  setTimeout(close, 1500);
}

// Không dùng alert popup blocking. Mọi thông báo script được chuyển thành toast.
window.alert = function(message) { showToast(String(message || ''), 'warning', 4200); };


function stripVietnameseAccents(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function normalizeCell(text) {
  let s = String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const strip = $('stripAccent') ? $('stripAccent').checked : true;
  if (strip) s = stripVietnameseAccents(s);
  return s;
}

function cleanWordText(text) {
  let s = normalizeCell(text);
  s = s.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  return s;
}

async function fetchJsonApi(url, opt, defaultMessage, timeoutMs = 0) {
  let res;
  const options = Object.assign({cache:'no-store'}, opt || {});
  let controller = null;
  let timer = null;
  if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
    controller = new AbortController();
    options.signal = controller.signal;
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    res = await fetch(url, options);
  } catch (cause) {
    const aborted = cause && cause.name === 'AbortError';
    const err = new Error(aborted ? `Server không phản hồi trong ${Math.ceil(timeoutMs / 1000)} giây.` : 'Không kết nối được server.');
    err.isNetworkError = true;
    err.isTimeout = aborted;
    err.cause = cause;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  let json;
  try {
    json = await res.json();
  } catch (cause) {
    const err = new Error('Server trả dữ liệu JSON không hợp lệ.');
    err.httpStatus = res.status;
    err.retryable = res.status >= 500;
    err.cause = cause;
    throw err;
  }

  if (!res.ok || !json.ok) {
    const err = new Error(json.message || defaultMessage || 'API error');
    err.httpStatus = res.status;
    err.retryable = res.status >= 500;
    throw err;
  }
  return json.data;
}

async function api(action, payload = null, query = '', timeoutMs = 0) {
  const opt = payload === null ? {} : {
    method: 'POST',
    headers: {'Content-Type':'application/json; charset=utf-8', 'X-CSRF-Token': window.KIEMKE_CSRF_TOKEN || ''},
    body: JSON.stringify(payload)
  };
  return fetchJsonApi(`api.php?action=${encodeURIComponent(action)}${query}`, opt, 'API error', timeoutMs);
}

async function machineApi(action, payload = null, timeoutMs = 0) {
  const opt = payload === null ? {} : {
    method: 'POST',
    headers: {'Content-Type':'application/json; charset=utf-8', 'X-CSRF-Token': window.KIEMKE_CSRF_TOKEN || ''},
    body: JSON.stringify(payload)
  };
  return fetchJsonApi(`machine_api.php?action=${encodeURIComponent(action)}`, opt, 'Machine API error', timeoutMs);
}

async function postJson(url, payload) {
  return fetchJsonApi(url, {
    method:'POST',
    headers:{'Content-Type':'application/json; charset=utf-8', 'X-CSRF-Token': window.KIEMKE_CSRF_TOKEN || ''},
    body: JSON.stringify(payload || {})
  }, 'Server error', 12000);
}


const OFFLINE_FACTORY_KEY = 'kiemke_active_factory';
const OFFLINE_DEVICE_CODE_KEY = 'kiemke_active_device_code';
const OFFLINE_DEVICE_CODES_KEY = 'kiemke_active_device_codes';
const DATA_SOURCE_KEY = 'kiemke_data_source';
const LOOKUP_TIMEOUT_MS = 1500;
// Đích lưu luôn là Cloudflare D1. Nguồn tra cứu Cloudflare D1/MSSQL là cấu hình độc lập.
const SAVE_TARGET = 'mysql';
const SAVE_TIMEOUT_MS = 15000;
const DEPARTMENT_HISTORY_KEY = 'kiemke_scan_departments_v1';
const DEPARTMENT_COUNT_CACHE_KEY = 'kiemke_department_counts_v1';

function normalizeDepartment(value) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 150); }
function getDepartmentHistory() {
  try { const value = JSON.parse(scopedStorage.getItem(DEPARTMENT_HISTORY_KEY) || '[]'); return Array.isArray(value) ? value.map(normalizeDepartment).filter(Boolean) : []; }
  catch (e) { return []; }
}
function renderDepartmentOptions(extraValues = []) {
  const list = $('departmentOptions'); if (!list) return;
  const unique = [];
  [...getDepartmentHistory(), ...(Array.isArray(extraValues) ? extraValues : [])].forEach(value => {
    const clean = normalizeDepartment(value);
    if (clean && !unique.some(x => x.toLocaleLowerCase('vi') === clean.toLocaleLowerCase('vi'))) unique.push(clean);
  });
  list.innerHTML = unique.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
}
function rememberDepartment(value) {
  const department = normalizeDepartment(value); if (!department) return;
  const values = [department, ...getDepartmentHistory().filter(x => x.toLocaleLowerCase('vi') !== department.toLocaleLowerCase('vi'))].slice(0, 50);
  try { scopedStorage.setItem(DEPARTMENT_HISTORY_KEY, JSON.stringify(values)); } catch (e) {}
  renderDepartmentOptions(values);
}
function departmentCountCacheId() { return `${state.user}|${state.scanDepartment}|${nowSqlLocal().slice(0,10)}`.toLocaleLowerCase('vi'); }
function readDepartmentSavedCount() { try { return Number((JSON.parse(scopedStorage.getItem(DEPARTMENT_COUNT_CACHE_KEY) || '{}'))[departmentCountCacheId()] || 0); } catch (e) { return 0; } }
function cacheDepartmentSavedCount(count) { try { const all = JSON.parse(scopedStorage.getItem(DEPARTMENT_COUNT_CACHE_KEY) || '{}'); all[departmentCountCacheId()] = Number(count || 0); scopedStorage.setItem(DEPARTMENT_COUNT_CACHE_KEY, JSON.stringify(all)); } catch (e) {} }
async function loadDepartmentStats() {
  state.departmentSavedCount = readDepartmentSavedCount(); renderSessionScanUi();
  if (!navigator.onLine || !state.user || !state.scanDepartment) return;
  try {
    const query = `&user=${encodeURIComponent(state.user)}&department=${encodeURIComponent(state.scanDepartment)}&date=${encodeURIComponent(nowSqlLocal().slice(0,10))}`;
    const data = await api('departmentStats', null, query, 3000);
    state.departmentSavedCount = Number(data.saved_count || 0); cacheDepartmentSavedCount(state.departmentSavedCount); renderSessionScanUi();
  } catch (e) {}
}
async function loadDepartmentOptions() {
  renderDepartmentOptions(); if (!navigator.onLine) return;
  try { const data = await api('listDepartments', null, '', 3000); (data.departments || []).forEach(rememberDepartment); renderDepartmentOptions(data.departments || []); } catch (e) {}
}

function offlineModuleReady() {
  return !!(window.InventoryOffline && typeof window.InventoryOffline.getMeta === 'function');
}

function normalizeDataSource(value) {
  return String(value || '').trim().toLowerCase() === 'mysql' ? 'mysql' : 'mssql';
}

function getSelectedDataSource() {
  const select = $('dataSourceSelect');
  const value = select ? normalizeDataSource(select.value) : normalizeDataSource(state.dataSource);
  return value || 'mssql';
}

function dataSourceLabel(source) {
  return normalizeDataSource(source) === 'mysql' ? 'Cloudflare D1 OCR DB' : 'Cloudflare D1';
}

function setSelectedDataSource(source) {
  source = normalizeDataSource(source);
  state.dataSource = source;
  const select = $('dataSourceSelect');
  if (select) select.value = source;
  try { scopedStorage.setItem(DATA_SOURCE_KEY, source); } catch (_) {}
  const note = $('sourceQueryNote');
  if (note) {
    note.innerHTML = source === 'mysql'
      ? '<b>Nguồn:</b> Cloudflare D1 • <code>assets (site hiện tại)</code>'
      : '<b>Nguồn:</b> Cloudflare D1 • <code>assets (site hiện tại)</code>';
  }
  const badge = $('dataSourceStatusBadge');
  if (badge) {
    badge.textContent = dataSourceLabel(source);
    badge.classList.toggle('mysql', source === 'mysql');
  }
}

function resetSourceScopeOptions() {
  renderDeviceCodeChecklist(['COMP'], ['COMP']);
  setSelectedDeviceCodes(['COMP']);
  setSelectedFactory('');
  clearServerFactoryOptions();
  state.offlineDeviceCodeListLoaded = false;
  state.offlineFactoryListLoaded = false;
  state.offlineFactoryListCount = 0;
  state.offlineFactoryListError = '';
}

function setAssetImportProgress(percent, text = '') {
  const wrap = $('assetImportProgressWrap');
  const bar = $('assetImportProgressBar');
  const label = $('assetImportProgressText');
  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  if (wrap) wrap.hidden = false;
  if (bar) bar.style.width = value + '%';
  if (label) label.textContent = text || `${Math.round(value)}%`;
}

function hideAssetImportProgress(delay = 0) {
  const fn = () => { const wrap = $('assetImportProgressWrap'); if (wrap) wrap.hidden = true; };
  if (delay > 0) setTimeout(fn, delay); else fn();
}

function renderAssetImportStatus(stats, message = '') {
  const host = $('assetImportStatus');
  const badge = $('assetImportBadge');
  stats = stats || {};
  const rows = Number(stats.row_count || 0);
  const latest = stats.latest_import || null;
  if (badge) {
    badge.textContent = rows > 0 ? `${rows.toLocaleString('vi-VN')} thiết bị` : 'Chưa có dữ liệu';
    badge.classList.toggle('ready', rows > 0);
  }
  if (!host) return;
  if (!rows && !latest) {
    host.innerHTML = escapeHtml(message || 'OCR_Scan_db chưa có dữ liệu danh mục import. Chọn file CSV/XLSX/XLS để import.');
    return;
  }
  const latestText = latest
    ? ` • Import gần nhất: <b>${escapeHtml(latest.source_file || '-')}</b> • ${escapeHtml(formatLocalDateTime(latest.created_at || ''))}`
    : '';
  host.innerHTML = `${message ? `<b>${escapeHtml(message)}</b> • ` : ''}Database <code>${escapeHtml(stats.database || 'ocr_scan_db')}</code> có <b>${rows.toLocaleString('vi-VN')}</b> thiết bị, <b>${Number(stats.device_code_count || 0).toLocaleString('vi-VN')}</b> loại, <b>${Number(stats.factory_count || 0).toLocaleString('vi-VN')}</b> xưởng${latestText}.`;
}

async function fetchAssetImportStatus(options = {}) {
  const silent = !!options.silent;
  try {
    const data = await fetchJsonApi('asset_import_api.php?action=status', {method:'GET', cache:'no-store'}, 'Import status error', 12000);
    renderAssetImportStatus(data || {});
    return data || {};
  } catch (e) {
    renderAssetImportStatus(null, e.message || 'Không đọc được trạng thái dữ liệu import trong OCR_Scan_db.');
    if (!silent) notifyError(e.message || 'Không đọc được dữ liệu import trong OCR_Scan_db.');
    return null;
  }
}

function importAssetMasterFile() {
  const input = $('assetImportFile');
  const file = input && input.files ? input.files[0] : null;
  if (!file) { notifyInfo('Vui lòng chọn file CSV, XLSX hoặc XLS.'); return; }
  if (file.size > 30 * 1024 * 1024) { notifyError('File vượt giới hạn 30 MB.'); return; }

  const allowed = /\.(csv|xlsx|xls)$/i.test(file.name || '');
  if (!allowed) { notifyError('Chỉ hỗ trợ file CSV, XLSX hoặc XLS.'); return; }

  const btn = $('btnImportAssetFile');
  if (btn) btn.disabled = true;
  const host = $('assetImportStatus');
  if (host) host.textContent = `Đang upload ${file.name}...`;
  setAssetImportProgress(0, '0%');

  const form = new FormData();
  form.append('asset_file', file, file.name);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', 'asset_import_api.php?action=import', true);
  xhr.setRequestHeader('X-CSRF-Token', window.KIEMKE_CSRF_TOKEN || '');
  xhr.timeout = 240000;
  xhr.setRequestHeader('Accept', 'application/json');

  xhr.upload.onprogress = (ev) => {
    if (!ev.lengthComputable) return;
    const pct = Math.min(92, (ev.loaded / ev.total) * 92);
    setAssetImportProgress(pct, `Upload ${Math.round((ev.loaded / ev.total) * 100)}%`);
  };
  xhr.upload.onload = () => {
    setAssetImportProgress(94, 'Đang đọc và ghi OCR_Scan_db...');
    if (host) host.textContent = 'File đã upload • đang đọc Excel/CSV và ghi dữ liệu vào OCR_Scan_db...';
  };

  const finish = () => { if (btn) btn.disabled = false; };
  xhr.onerror = () => {
    finish(); hideAssetImportProgress(1200);
    const msg = 'Không kết nối được API import OCR_Scan_db.';
    if (host) host.textContent = msg;
    notifyError(msg);
  };
  xhr.ontimeout = () => {
    finish(); hideAssetImportProgress(1200);
    const msg = 'Import quá thời gian chờ. Kiểm tra PHP timeout hoặc kích thước file.';
    if (host) host.textContent = msg;
    notifyError(msg);
  };
  xhr.onload = async () => {
    finish();
    let json = null;
    try { json = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
    if (xhr.status < 200 || xhr.status >= 300 || !json || !json.ok) {
      hideAssetImportProgress(1200);
      const msg = json && json.message ? json.message : `Import lỗi HTTP ${xhr.status}.`;
      if (host) host.textContent = msg;
      notifyError(msg);
      return;
    }

    setAssetImportProgress(100, 'Hoàn tất');
    const data = json.data || {};
    renderAssetImportStatus(data.stats || {}, `Đã import ${Number(data.accepted_rows || 0).toLocaleString('vi-VN')} / ${Number(data.total_rows || 0).toLocaleString('vi-VN')} dòng`);
    notifySuccess(`Import OCR_Scan_db hoàn tất • ${Number(data.accepted_rows || 0).toLocaleString('vi-VN')} dòng.`);
    if (input) input.value = '';

    // Sau import, chọn nguồn Cloudflare D1 và nạp lại scope để người dùng có thể cache ngay.
    setSelectedDataSource('mysql');
    resetSourceScopeOptions();
    try {
      await loadDeviceCodesOnDemand({silent:true});
      await loadFactoriesOnDemand({silent:true});
      await refreshOfflineCacheUi();
    } catch (_) {}
    hideAssetImportProgress(1600);
  };
  xhr.send(form);
}

function normalizeDeviceCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

function normalizeDeviceCodes(values) {
  if (!Array.isArray(values)) values = String(values || '').split(/[,;\s]+/);
  const out = [];
  values.forEach(value => {
    const code = normalizeDeviceCode(value);
    if (code && !out.includes(code)) out.push(code);
  });
  return out.slice(0, 50);
}

function updateSelectedDeviceCodeCount() {
  const el = $('selectedDeviceCodeCount');
  if (!el) return;
  const count = getSelectedDeviceCodes().length;
  el.textContent = `${count} đã chọn / selected`;
}

function renderDeviceCodeChecklist(codes, selectedCodes = null) {
  const host = $('offlineDeviceCodeChecklist');
  if (!host) return;
  const current = selectedCodes === null ? getSelectedDeviceCodes() : normalizeDeviceCodes(selectedCodes);
  const all = normalizeDeviceCodes([...(Array.isArray(codes) ? codes : []), ...current]);
  if (!all.length) all.push('COMP');
  const selected = current.length ? current : [all.includes('COMP') ? 'COMP' : all[0]];
  host.innerHTML = all.map(code => `<label class="device-code-check"><input type="checkbox" value="${escapeHtml(code)}" ${selected.includes(code) ? 'checked' : ''}><span>${escapeHtml(code)}</span></label>`).join('');
  updateSelectedDeviceCodeCount();
}

function ensureDeviceCodeOption(code) {
  code = normalizeDeviceCode(code);
  const host = $('offlineDeviceCodeChecklist');
  if (!code || !host) return null;
  let input = Array.from(host.querySelectorAll('input[type="checkbox"]')).find(x => normalizeDeviceCode(x.value) === code);
  if (!input) {
    const label = document.createElement('label');
    label.className = 'device-code-check';
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(code)}"><span>${escapeHtml(code)}</span>`;
    host.appendChild(label);
    input = label.querySelector('input');
  }
  return input;
}

function getSelectedDeviceCodes() {
  const host = $('offlineDeviceCodeChecklist');
  if (host) {
    const checked = normalizeDeviceCodes(Array.from(host.querySelectorAll('input[type="checkbox"]:checked')).map(x => x.value));
    if (checked.length) return checked;
  }
  const fromState = normalizeDeviceCodes(state.offlineDeviceCodes || []);
  if (fromState.length) return fromState;
  const legacy = normalizeDeviceCode(state.offlineDeviceCode);
  return [legacy || 'COMP'];
}

function setSelectedDeviceCodes(codes) {
  codes = normalizeDeviceCodes(codes);
  if (!codes.length) codes = ['COMP'];
  state.offlineDeviceCodes = codes.slice();
  state.offlineDeviceCode = codes[0];
  try {
    scopedStorage.setItem(OFFLINE_DEVICE_CODES_KEY, JSON.stringify(codes));
    scopedStorage.setItem(OFFLINE_DEVICE_CODE_KEY, codes[0]);
  } catch (_) {}
  const host = $('offlineDeviceCodeChecklist');
  if (host) {
    codes.forEach(ensureDeviceCodeOption);
    host.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = codes.includes(normalizeDeviceCode(input.value)); });
  }
  updateSelectedDeviceCodeCount();
}

function getSelectedDeviceCode() {
  return getSelectedDeviceCodes()[0] || 'COMP';
}

function setSelectedDeviceCode(code) {
  setSelectedDeviceCodes([normalizeDeviceCode(code) || 'COMP']);
}

function preferredDeviceCodesForLookup(candidate, values = null) {
  const codes = normalizeDeviceCodes(values || getSelectedDeviceCodes());
  const prefix = normalizeDeviceCode(String(candidate || '').slice(0, 4));
  if (prefix && codes.includes(prefix)) return [prefix, ...codes.filter(x => x !== prefix)];
  return codes.length ? codes : ['COMP'];
}

function getSelectedFactory() {
  const select = $('offlineFactorySelect');
  const value = select ? String(select.value || '').trim() : '';
  return value || String(state.offlineFactory || '').trim();
}

function factoryOptionByValue(factory) {
  const select = $('offlineFactorySelect');
  factory = String(factory || '').trim();
  if (!select || !factory) return null;
  const norm = factory.toUpperCase();
  return Array.from(select.options).find(o => String(o.value || '').trim().toUpperCase() === norm) || null;
}

function updateFactoryOptionText(option) {
  if (!option || !option.value) return;
  const factory = option.dataset.factoryName || option.value;
  const count = Number(option.dataset.machineCount || 0);
  const tags = [];
  if (count > 0) tags.push(`${count.toLocaleString('vi-VN')} máy`);
  if (option.dataset.cached === '1') tags.push('cache');
  option.textContent = factory + (tags.length ? ' • ' + tags.join(' • ') : '');
}

function ensureFactoryOption(factory, flags = {}) {
  const select = $('offlineFactorySelect');
  factory = String(factory || '').trim();
  if (!select || !factory) return null;
  if (typeof flags === 'boolean') flags = {cached: flags};
  let option = factoryOptionByValue(factory);
  if (!option) {
    option = document.createElement('option');
    option.value = factory;
    select.appendChild(option);
  }
  option.dataset.factoryName = factory;
  if (flags.cached) option.dataset.cached = '1';
  if (flags.server) option.dataset.server = '1';
  if (Array.isArray(flags.deviceCodes)) option.dataset.deviceCodes = normalizeDeviceCodes(flags.deviceCodes).join(',');
  if (Number.isFinite(Number(flags.machineCount)) && Number(flags.machineCount) >= 0) option.dataset.machineCount = String(Number(flags.machineCount));
  updateFactoryOptionText(option);
  return option;
}

function clearServerFactoryOptions() {
  const select = $('offlineFactorySelect');
  if (!select) return;
  Array.from(select.options).forEach(option => {
    if (!option.value) return;
    option.remove();
  });
}

function setSelectedFactory(factory) {
  factory = String(factory || '').trim();
  state.offlineFactory = factory;
  try {
    if (factory) scopedStorage.setItem(OFFLINE_FACTORY_KEY, factory);
    else scopedStorage.removeItem(OFFLINE_FACTORY_KEY);
  } catch (_) {}
  const select = $('offlineFactorySelect');
  if (select && factory) {
    ensureFactoryOption(factory, {});
    const hit = factoryOptionByValue(factory);
    if (hit) select.value = hit.value;
  } else if (select) select.value = '';
}

function formatLocalDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  try { return d.toLocaleString('vi-VN'); } catch (_) { return d.toISOString(); }
}

function factoryServerStatusSuffix() {
  if (state.offlineFactoryListLoading) return ' Đang tải danh sách xưởng...';
  if (state.offlineFactoryListError) return ` Không tải được danh sách xưởng: ${state.offlineFactoryListError}`;
  if (state.offlineFactoryListLoaded) return ` ${dataSourceLabel(getSelectedDataSource())}: ${state.offlineFactoryListCount} xưởng.`;
  return '';
}

async function refreshOfflineCacheUi() {
  const badge = $('offlineStateBadge');
  const info = $('offlineCacheInfo');
  const syncBtn = $('btnSyncOfflineQueue');
  const selectedCodes = getSelectedDeviceCodes();
  const dataSource = getSelectedDataSource();
  const labelCodes = selectedCodes.length === 1 ? selectedCodes[0] : `${selectedCodes.length} loại`;

  if (!offlineModuleReady()) {
    if (badge) { badge.textContent = 'Không hỗ trợ cache'; badge.className = 'offline-badge offline-badge-bad'; }
    if (info) info.textContent = 'Trình duyệt không hỗ trợ IndexedDB.';
    if (syncBtn) syncBtn.disabled = true;
    return;
  }

  try {
    const allMetas = await window.InventoryOffline.listMeta();
    allMetas.forEach(m => ensureDeviceCodeOption(m.device_code || 'COMP'));
    setSelectedDeviceCodes(selectedCodes);
    const metas = allMetas.filter(m => selectedCodes.includes(normalizeDeviceCode(m.device_code || 'COMP')) && normalizeDataSource(m.data_source || m.source) === dataSource);
    const select = $('offlineFactorySelect');
    if (select) Array.from(select.options).forEach(o => { if (o.value) { delete o.dataset.cached; updateFactoryOptionText(o); } });

    const cacheByFactory = new Map();
    metas.forEach(meta => {
      const factory = String(meta.factory || meta.factory_norm || '').trim();
      if (!factory) return;
      const key = factory.toUpperCase();
      if (!cacheByFactory.has(key)) cacheByFactory.set(key, {factory, rows:0, codes:[]});
      const item = cacheByFactory.get(key);
      item.rows += Number(meta.row_count || 0);
      const code = normalizeDeviceCode(meta.device_code || 'COMP');
      if (code && !item.codes.includes(code)) item.codes.push(code);
    });
    cacheByFactory.forEach(item => ensureFactoryOption(item.factory, {cached:true, machineCount:item.rows, deviceCodes:item.codes}));

    const activeFactory = getSelectedFactory();
    const activeMetas = activeFactory ? metas.filter(m => String(m.factory || m.factory_norm || '').trim().toUpperCase() === activeFactory.toUpperCase()) : [];
    const queueCount = await window.InventoryOffline.queueCount();
    const totalRows = metas.reduce((sum, m) => sum + Number(m.row_count || 0), 0);
    const factoryCount = new Set(metas.map(m => String(m.factory || m.factory_norm || '').trim().toUpperCase()).filter(Boolean)).size;

    if (syncBtn) {
      syncBtn.textContent = `Đồng bộ (${queueCount})`;
      syncBtn.disabled = state.offlineSyncBusy || queueCount === 0;
    }
    if ($('btnDownloadOfflineCache')) $('btnDownloadOfflineCache').disabled = state.offlineBulkDownloadBusy || !activeFactory || !navigator.onLine;
    if ($('btnDeleteOfflineCache')) $('btnDeleteOfflineCache').disabled = !activeFactory || activeMetas.length === 0;
    if ($('btnDownloadAllOfflineCache')) $('btnDownloadAllOfflineCache').disabled = state.offlineBulkDownloadBusy || !navigator.onLine;
    if ($('btnDeleteAllOfflineCache')) $('btnDeleteAllOfflineCache').disabled = allMetas.length === 0;

    if (!activeFactory) {
      if (metas.length) {
        if (badge) { badge.textContent = `${labelCodes} • ${factoryCount} xưởng`; badge.className = 'offline-badge offline-badge-ok'; }
        const newest = metas.map(m => m.cached_at || m.downloaded_at || '').filter(Boolean).sort().pop() || '';
        if (info) info.textContent = `${dataSourceLabel(dataSource)} • ${selectedCodes.join(', ')}: đã cache ${factoryCount.toLocaleString('vi-VN')} xưởng / ${totalRows.toLocaleString('vi-VN')} thiết bị${newest ? ', cập nhật ' + formatLocalDateTime(newest) : ''}.` + factoryServerStatusSuffix();
      } else {
        if (badge) { badge.textContent = navigator.onLine ? `${labelCodes} • chưa cache` : `${labelCodes} • offline`; badge.className = 'offline-badge offline-badge-warn'; }
        if (info) info.textContent = `Chưa có cache ${dataSourceLabel(dataSource)} cho các loại: ${selectedCodes.join(', ')}. Chọn xưởng hoặc tải cache tất cả xưởng.` + factoryServerStatusSuffix();
      }
      return;
    }

    if (activeMetas.length) {
      const cachedCodes = activeMetas.map(m => normalizeDeviceCode(m.device_code || '')).filter(Boolean);
      const missing = selectedCodes.filter(code => !cachedCodes.includes(code));
      const rows = activeMetas.reduce((sum,m) => sum + Number(m.row_count || 0), 0);
      const newest = activeMetas.map(m => m.cached_at || m.downloaded_at || '').filter(Boolean).sort().pop() || '';
      if (badge) { badge.textContent = `${labelCodes} • cache sẵn sàng`; badge.className = missing.length ? 'offline-badge offline-badge-warn' : 'offline-badge offline-badge-ok'; }
      if (info) info.textContent = `${dataSourceLabel(dataSource)} • ${activeFactory}: ${rows.toLocaleString('vi-VN')} thiết bị • loại đã cache: ${cachedCodes.join(', ') || '-'}${missing.length ? ` • thiếu: ${missing.join(', ')}` : ''}${newest ? ` • cập nhật ${formatLocalDateTime(newest)}` : ''}.` + factoryServerStatusSuffix();
    } else {
      if (badge) { badge.textContent = `${labelCodes} • thiếu cache`; badge.className = 'offline-badge offline-badge-warn'; }
      if (info) info.textContent = `Xưởng ${activeFactory} chưa có cache cho các loại đã chọn: ${selectedCodes.join(', ')}.` + factoryServerStatusSuffix();
    }
  } catch (e) {
    if (badge) { badge.textContent = 'Lỗi cache'; badge.className = 'offline-badge offline-badge-bad'; }
    if (info) info.textContent = e.message || 'Không đọc được cache offline.';
  }
}

async function initOfflineUi() {
  if (!$('offlineFactorySelect')) return;
  let savedFactory = '';
  let savedCodes = ['COMP'];
  let savedSource = 'mssql';
  try {
    savedFactory = scopedStorage.getItem(OFFLINE_FACTORY_KEY) || '';
    const multiRaw = scopedStorage.getItem(OFFLINE_DEVICE_CODES_KEY) || '';
    if (multiRaw) {
      try { savedCodes = normalizeDeviceCodes(JSON.parse(multiRaw)); } catch (_) { savedCodes = normalizeDeviceCodes(multiRaw); }
    } else {
      savedCodes = normalizeDeviceCodes([scopedStorage.getItem(OFFLINE_DEVICE_CODE_KEY) || 'COMP']);
    }
    savedSource = 'mysql';
  } catch (_) {}
  setSelectedDataSource(savedSource);
  renderDeviceCodeChecklist(savedCodes.length ? savedCodes : ['COMP'], savedCodes.length ? savedCodes : ['COMP']);
  setSelectedDeviceCodes(savedCodes.length ? savedCodes : ['COMP']);
  if (savedFactory) setSelectedFactory(savedFactory);

  if (offlineModuleReady() && typeof window.InventoryOffline.compactQueueDuplicates === 'function') await window.InventoryOffline.compactQueueDuplicates().catch(() => {});
  await refreshOfflineCacheUi();
  if (navigator.onLine) loadDeviceCodesOnDemand({silent:true, auto:true}).catch(() => {});
}

async function loadDeviceCodesOnDemand(options = {}) {
  const btn = $('btnLoadDeviceCodes');
  const silent = !!options.silent;
  const previous = getSelectedDeviceCodes();
  if (state.offlineDeviceCodeListLoading) return [];
  state.offlineDeviceCodeListLoading = true;
  try {
    if (btn) { btn.disabled = true; if (!btn.dataset.oldText) btn.dataset.oldText = btn.textContent; btn.textContent = 'Đang tải...'; }
    const dataSource = getSelectedDataSource();
    const data = await machineApi('listDeviceCodes', {source:dataSource}, 12000);
    let codes = (Array.isArray(data.codes) ? data.codes : (Array.isArray(data.items) ? data.items.map(x => x.code || x) : []))
      .map(normalizeDeviceCode).filter(Boolean).filter((v,i,a) => a.indexOf(v) === i);
    if (offlineModuleReady()) {
      const metas = await window.InventoryOffline.listMeta().catch(() => []);
      const cachedCodes = metas.filter(m => normalizeDataSource(m.data_source || m.source) === dataSource).map(m => normalizeDeviceCode(m.device_code || '')).filter(Boolean);
      codes = normalizeDeviceCodes([...codes, ...cachedCodes]);
    }
    if (!codes.length) codes = ['COMP'];
    let chosen = previous.filter(code => codes.includes(code));
    if (!chosen.length) chosen = [codes.includes('COMP') ? 'COMP' : codes[0]];
    renderDeviceCodeChecklist(codes, chosen);
    setSelectedDeviceCodes(chosen);
    state.offlineDeviceCodeListLoaded = true;
    state.offlineDeviceCodeListCount = codes.length;
    if (!silent) notifySuccess(`Đã tải ${codes.length} loại thiết bị từ ${dataSourceLabel(dataSource)}.`);
    await loadFactoriesOnDemand({silent:true});
    return codes;
  } catch (e) {
    state.offlineDeviceCodeListLoaded = false;
    if (!silent) notifyError(e.message || 'Không tải được loại thiết bị.');
    return [];
  } finally {
    state.offlineDeviceCodeListLoading = false;
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.oldText || 'Lấy loại thiết bị'; }
    await refreshOfflineCacheUi();
  }
}

async function loadFactoriesOnDemand(options = {}) {
  const btn = $('btnLoadFactories');
  const silent = !!options.silent;
  const previousFactory = getSelectedFactory();
  const deviceCodes = getSelectedDeviceCodes();
  if (state.offlineFactoryListLoading) return [];
  state.offlineFactoryListLoading = true;
  state.offlineFactoryListError = '';
  try {
    if (btn) { btn.disabled = true; if (!btn.dataset.oldText) btn.dataset.oldText = btn.textContent; btn.textContent = 'Đang tải...'; }
    const dataSource = getSelectedDataSource();
    const data = await machineApi('listFactories', {device_codes:deviceCodes, device_code:deviceCodes[0], source:dataSource}, 20000);
    const rawItems = Array.isArray(data.items) && data.items.length ? data.items : (Array.isArray(data.factories) ? data.factories.map(factory => ({factory,machine_count:0,device_codes:deviceCodes})) : []);
    clearServerFactoryOptions();
    rawItems.forEach(item => ensureFactoryOption(typeof item === 'string' ? item : item.factory, {server:true, machineCount:Number(item && item.machine_count || 0), deviceCodes:Array.isArray(item && item.device_codes) ? item.device_codes : deviceCodes}));
    state.offlineFactoryListLoaded = true;
    state.offlineFactoryListCount = rawItems.length;
    if (previousFactory && factoryOptionByValue(previousFactory)) setSelectedFactory(previousFactory); else setSelectedFactory('');
    if (!rawItems.length) throw new Error(`Không có Factory nào cho loại thiết bị: ${deviceCodes.join(', ')}.`);
    if (!silent) notifySuccess(`Đã tải ${rawItems.length} xưởng cho ${deviceCodes.length} loại thiết bị.`);
    return rawItems;
  } catch (e) {
    state.offlineFactoryListLoaded = false;
    state.offlineFactoryListCount = 0;
    state.offlineFactoryListError = e.message || 'Không tải được danh sách xưởng.';
    if (!silent) notifyError(state.offlineFactoryListError);
    return [];
  } finally {
    state.offlineFactoryListLoading = false;
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.oldText || 'Lấy danh sách xưởng'; }
    await refreshOfflineCacheUi();
  }
}

async function downloadOneFactoryCache(factory, deviceCode) {
  deviceCode = normalizeDeviceCode(deviceCode || getSelectedDeviceCode()) || 'COMP';
  const dataSource = getSelectedDataSource();
  const data = await machineApi('downloadCache', {factory, device_code:deviceCode, source:dataSource}, 120000);
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const actualFactory = data.factory || factory;
  const actualCode = normalizeDeviceCode(data.device_code || deviceCode) || deviceCode;
  await window.InventoryOffline.replaceScopeCache(actualFactory, actualCode, rows, {
    factory: actualFactory, device_code: actualCode,
    downloaded_at: data.downloaded_at || new Date().toISOString(), cached_at:new Date().toISOString(),
    filter: data.filter || 'LEFT(McSerialNumber,4)=selected_device_code AND Factory=selected_factory', schema_version:data.schema_version || 5,
    data_source: data.data_source || dataSource, source: data.data_source || dataSource, source_name: data.source || data.source_name || ''
  });
  ensureFactoryOption(actualFactory, {cached:true, machineCount:rows.length, deviceCodes:[actualCode]});
  return {factory:actualFactory, device_code:actualCode, row_count:rows.length, data_source:data.data_source || dataSource};
}

function applicableCodesForFactory(factory) {
  const selected = getSelectedDeviceCodes();
  const option = factoryOptionByValue(factory);
  const available = option && option.dataset.deviceCodes ? normalizeDeviceCodes(option.dataset.deviceCodes) : [];
  const hit = selected.filter(code => !available.length || available.includes(code));
  return hit.length ? hit : selected;
}

async function downloadOfflineCache() {
  const factory = getSelectedFactory();
  const deviceCodes = applicableCodesForFactory(factory);
  if (!factory) { notifyError('Chọn một xưởng hoặc dùng “Tải cache tất cả xưởng”.'); return; }
  if (!offlineModuleReady()) { notifyError('Trình duyệt không hỗ trợ cache offline.'); return; }
  if (!navigator.onLine) { notifyError('Thiết bị đang offline, không thể tải cache mới.'); return; }
  const btn = $('btnDownloadOfflineCache');
  state.offlineBulkDownloadBusy = true;
  try {
    if (btn) { btn.disabled=true; btn.dataset.oldText=btn.textContent; btn.textContent='Đang tải cache...'; }
    const results = []; const failed = [];
    for (const code of deviceCodes) {
      try { results.push(await downloadOneFactoryCache(factory, code)); }
      catch (e) { failed.push(`${code}: ${e.message || 'error'}`); }
    }
    await window.InventoryOffline.requestPersistentStorage();
    const rows = results.reduce((sum,r) => sum + Number(r.row_count || 0), 0);
    if (results.length) notifySuccess(`Đã cache ${rows.toLocaleString('vi-VN')} thiết bị • ${results.map(r=>r.device_code).join(', ')} • xưởng ${factory}.`);
    if (!results.length) throw new Error(failed[0] || 'Không tải được cache cho các loại đã chọn.');
    if (failed.length) notifyInfo(`Có ${failed.length} loại không có dữ liệu tại xưởng ${factory}.`);
  } catch(e) { notifyError(e.message || 'Tải cache thất bại.'); }
  finally { state.offlineBulkDownloadBusy=false; if (btn) { btn.disabled=false; btn.textContent=btn.dataset.oldText || 'Tải cache xưởng đã chọn / Selected factory'; } await refreshOfflineCacheUi(); }
}

async function downloadAllOfflineCaches() {
  if (state.offlineBulkDownloadBusy) return;
  if (!offlineModuleReady()) { notifyError('Trình duyệt không hỗ trợ cache offline.'); return; }
  if (!navigator.onLine) { notifyError('Thiết bị đang offline, không thể tải cache.'); return; }
  const btn=$('btnDownloadAllOfflineCache'); const info=$('offlineCacheInfo'); const deviceCodes=getSelectedDeviceCodes();
  state.offlineBulkDownloadBusy=true; let success=0,totalRows=0,completed=0; const failed=[];
  try {
    if (btn) { btn.disabled=true; if(!btn.dataset.oldText) btn.dataset.oldText=btn.textContent; btn.textContent='Đang lấy xưởng...'; }
    const dataSource=getSelectedDataSource();
    const data=await machineApi('listFactories',{device_codes:deviceCodes,device_code:deviceCodes[0],source:dataSource},20000);
    const rawItems=Array.isArray(data.items)?data.items:[];
    const tasks=[];
    rawItems.forEach(item => {
      const factory=String(item&&item.factory||'').trim();
      const codes=normalizeDeviceCodes(item&&item.device_codes||deviceCodes).filter(c=>deviceCodes.includes(c));
      codes.forEach(code => { if(factory) tasks.push({factory,code}); });
    });
    if(!tasks.length) throw new Error(`Không có xưởng cho loại: ${deviceCodes.join(', ')}.`);
    const workerCount=Math.max(1,Math.min(3,tasks.length)); let nextIndex=0;
    const worker=async()=>{ while(true){ const idx=nextIndex++; if(idx>=tasks.length)return; const task=tasks[idx]; try{ const result=await downloadOneFactoryCache(task.factory,task.code); success++; totalRows+=Number(result.row_count||0); }catch(e){ failed.push(`${task.code}/${task.factory}: ${e.message||'error'}`); }finally{ completed++; if(btn)btn.textContent=`Cache ${completed}/${tasks.length}`; if(info)info.textContent=`Đã xử lý ${completed}/${tasks.length} phạm vi cache.`; await sleep(20); } } };
    await Promise.all(Array.from({length:workerCount},()=>worker()));
    await window.InventoryOffline.requestPersistentStorage();
    if(success) notifySuccess(`Đã cache ${success}/${tasks.length} phạm vi, ${totalRows.toLocaleString('vi-VN')} thiết bị.`);
    if(failed.length) notifyError(`Có ${failed.length} phạm vi tải lỗi; có thể tải lại.`);
  } catch(e){ notifyError(e.message||'Không tải được cache.'); }
  finally{ state.offlineBulkDownloadBusy=false; if(btn){btn.disabled=false;btn.textContent=btn.dataset.oldText||'Tải cache tất cả xưởng / All factories';} await refreshOfflineCacheUi(); }
}

async function deleteOfflineCacheSelected() {
  const factory=getSelectedFactory(); const deviceCodes=getSelectedDeviceCodes();
  if(!factory){notifyError('Vui lòng chọn xưởng cần xóa cache.');return;}
  if(!offlineModuleReady())return;
  try{
    const dataSource=getSelectedDataSource(); let deleted=0;
    for (const code of deviceCodes) {
      const meta=await window.InventoryOffline.getMeta(factory,code,dataSource).catch(()=>null);
      if(meta){ await window.InventoryOffline.deleteScopeCache(factory,code,dataSource); deleted++; }
    }
    notifySuccess(`Đã xóa ${deleted} phạm vi cache tại ${factory}.`); await refreshOfflineCacheUi();
  } catch(e){notifyError(e.message||'Không xóa được cache.');}
}

async function deleteAllOfflineCaches() {
  if(!offlineModuleReady())return;
  try{ await window.InventoryOffline.deleteAllMachineCaches(); notifySuccess('Đã xóa toàn bộ cache máy. Hàng đợi scan vẫn được giữ.'); await refreshOfflineCacheUi(); }
  catch(e){notifyError(e.message||'Không xóa được toàn bộ cache.');}
}

async function lookupMachineOffline(qrText, lookupKey, parsed, factoryOverride='', deviceCodesOverride=null, dataSourceOverride='') {
  if(!offlineModuleReady()) throw new Error('Trình duyệt không hỗ trợ cache offline.');
  const factory=String(factoryOverride||getSelectedFactory()||'').trim();
  const dataSource=normalizeDataSource(dataSourceOverride||getSelectedDataSource());
  const candidate=String(qrText||'').split('|')[0].trim()||String(lookupKey||(parsed&&parsed.lookup_ems)||fallbackLookupCandidate(qrText)).trim();
  if(!candidate) throw new Error('Không có mã EMS/Barcode để tra cache offline.');
  const deviceCodes=preferredDeviceCodesForLookup(candidate, normalizeDeviceCodes(deviceCodesOverride || getSelectedDeviceCodes()));
  let hasAnyMeta=false; let fallbackMeta=null;
  for (const deviceCode of deviceCodes) {
    if(factory){
      const meta=await window.InventoryOffline.getMeta(factory,deviceCode,dataSource);
      if(!meta) continue;
      hasAnyMeta=true; if(!fallbackMeta) fallbackMeta=meta;
      const rows=await window.InventoryOffline.lookup(factory,deviceCode,candidate,20,dataSource);
      if(rows.length) return {lookup_key:candidate,candidates:[candidate],rows,qr_text:qrText,parsed:parsed||parseQrContent(qrText),factory,device_code:deviceCode,device_codes:deviceCodes,source:'offline_cache',data_source:dataSource,source_name:meta.source_name||'',cached_at:meta.cached_at||meta.downloaded_at||''};
    } else {
      const metas=(await window.InventoryOffline.listMeta()).filter(m=>normalizeDeviceCode(m.device_code||'COMP')===deviceCode && normalizeDataSource(m.data_source||m.source)===dataSource);
      if(!metas.length) continue;
      hasAnyMeta=true; if(!fallbackMeta) fallbackMeta=metas[0];
      const rows=await window.InventoryOffline.lookupAny(candidate,20,deviceCode,dataSource);
      if(rows.length){
        const sourceFactory=String(rows[0].Factory||'').trim();
        const meta=sourceFactory ? await window.InventoryOffline.getMeta(sourceFactory,deviceCode,dataSource).catch(()=>null) : metas[0];
        return {lookup_key:candidate,candidates:[candidate],rows,qr_text:qrText,parsed:parsed||parseQrContent(qrText),factory:sourceFactory,device_code:deviceCode,device_codes:deviceCodes,source:'offline_cache',data_source:dataSource,source_name:meta?(meta.source_name||''):'',cached_at:meta?(meta.cached_at||meta.downloaded_at||''):''};
      }
    }
  }
  if(!hasAnyMeta) throw new Error(`Chưa có cache cho các loại đã chọn: ${deviceCodes.join(', ')}${factory ? ` / ${factory}` : ''}.`);
  return {lookup_key:candidate,candidates:[candidate],rows:[],qr_text:qrText,parsed:parsed||parseQrContent(qrText),factory,device_code:deviceCodes[0],device_codes:deviceCodes,source:'offline_cache',data_source:dataSource,source_name:fallbackMeta?(fallbackMeta.source_name||''):'',cached_at:fallbackMeta?(fallbackMeta.cached_at||fallbackMeta.downloaded_at||''):''};
}

function newClientScanId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'scan-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '-' + Math.random().toString(16).slice(2);
}

function sessionDeviceCodeFromPayload(payload) {
  payload = payload || {};
  return String(payload.qr_text||'').split('|')[0].trim() || String(payload.lookup_key || (payload.qr_parsed && payload.qr_parsed.lookup_ems) || '').trim();
}

function sessionRowSummary(entry) {
  const row = entry && Array.isArray(entry.machine_rows) && entry.machine_rows.length ? entry.machine_rows[0] : {};
  return {
    name: String(row.McName || ''), serial: String(row.McSerialNumber || entry.code || ''),
    factory: String(row.Factory || ''), location: String(row.CurrentLocation || ''), status: String(row.Status || ''),
    usedby: String(row.Usedby || '')
  };
}

function renderSessionDevice(hostId, entry, emptyText) {
  const host = $(hostId);
  if (!host) return;
  if (!entry) { host.className = 'session-device-card empty'; host.textContent = emptyText; return; }

  const row = entry && Array.isArray(entry.machine_rows) && entry.machine_rows.length ? entry.machine_rows[0] : {};
  const r = sessionRowSummary(entry);
  const fallbackName = entry.lookup_error ? 'Lỗi tra cứu dữ liệu' : (entry.lookup_done ? 'Không tìm thấy dữ liệu máy' : 'Đang tra cứu thông tin máy');
  const status = String(row.Status || '').trim();
  const statusClass = /active|running|ok|good|available|normal/i.test(status)
    ? 'status-ok'
    : (/repair|stop|broken|inactive|bad|ng|hold|scrap/i.test(status) ? 'status-bad' : 'status-warn');
  const fields = [
    ['Tên máy', row.McName || fallbackName],
    ['Serial kiểm kê', row.McSerialNumber || entry.code || '-'],
    ['Loại', row.McType || '-'],
    ['Hãng', row.McBrand || '-'],
    ['Model', row.McModel || '-'],
    ['Mã tài sản', row.AccountingCode || '-'],
    ['Serial NSX', row.ManuSerialNo || '-'],
    ['Xưởng', row.Factory || '-'],
    ['Vị trí', row.CurrentLocation || '-'],
    ['Người sử dụng', row.Usedby || '-'],
    ['Bộ phận / vị trí', row.Position || '-'],
    ['Ngày mua', row.PurchaseDate || '-'],
    ['Cập nhật nguồn', row.UpdatedTime || '-']
  ];

  host.className = 'session-device-card session-device-card-full';
  host.innerHTML = `<div class="session-device-head">
      <div><strong>${escapeHtml(entry.code || r.serial || '-')}</strong><small>${escapeHtml(dataSourceLabel(entry.data_source || getSelectedDataSource()))}</small></div>
      <div class="session-device-head-tail"><span>${escapeHtml(formatLocalDateTime(entry.inventory_datetime || ''))}</span><b>x${Math.max(1, Number(entry.scan_count || 1))}</b></div>
    </div>
    <div class="session-device-status-row">
      <span class="status-badge ${statusClass}">${escapeHtml(status || (entry.lookup_done ? 'N/A' : 'Đang tra cứu'))}</span>
      <span class="lookup-origin">${escapeHtml(entry.source === 'server' ? 'ONLINE' : (entry.source && entry.source !== 'queue' ? 'OFFLINE' : 'QUEUE'))}</span>
    </div>
    <div class="session-device-fields">${fields.map(([label,value]) => `<div class="session-device-field"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</div>
    ${row.Remark ? `<div class="session-device-note"><span>Remark</span><b>${escapeHtml(row.Remark)}</b></div>` : ''}
    ${entry.scan_comment ? `<div class="session-device-note comment"><span>Ghi chú / Comment</span><b>${escapeHtml(entry.scan_comment)}</b></div>` : ''}`;
}

function renderSessionScanUi() {
  if ($('sessionScanCount')) $('sessionScanCount').textContent = String(state.sessionScans.length);
  if ($('sessionScanCountMirror')) $('sessionScanCountMirror').textContent = String(state.sessionScans.length);
  if ($('sessionScanEventCount')) $('sessionScanEventCount').textContent = String(state.sessionScanEvents);
  const departmentKey = normalizeDepartment(state.scanDepartment).toLocaleLowerCase('vi');
  const scanned = state.sessionScans.filter(entry => normalizeDepartment(entry.scan_department).toLocaleLowerCase('vi') === departmentKey).length;
  if ($('departmentScanCount')) $('departmentScanCount').textContent = `${scanned} / ${Number(state.departmentSavedCount || 0)}`;
  if ($('currentDepartmentText')) $('currentDepartmentText').textContent = state.scanDepartment || 'Chưa chọn phòng ban';
  const current = state.sessionScans.find(x => x.code === state.sessionCurrentCode) || null;
  const previous = state.sessionScans.find(x => x.code === state.sessionPreviousCode) || null;
  renderSessionDevice('sessionCurrentDevice', current, 'Chưa có thiết bị.');
  renderSessionDevice('sessionPreviousDevice', previous, 'Chưa có thiết bị trước đó.');
  const host = $('sessionScanList');
  if (!host) return;
  if (!state.sessionScans.length) { host.innerHTML = '<div class="session-list-empty">Danh sách bắt đầu lại khi reload web.</div>'; return; }
  host.innerHTML = state.sessionScans.map((entry, idx) => {
    const r = sessionRowSummary(entry);
    const ds = dataSourceLabel(entry.data_source || getSelectedDataSource());
    return `<div class="session-list-row"><span class="session-list-index">${idx + 1}</span><div><b>${escapeHtml(entry.code || '-')}</b><small>${escapeHtml(r.name || r.serial || 'Đang tra cứu')} • ${escapeHtml(ds)}</small></div><div class="session-list-tail"><span>${escapeHtml((entry.scan_count || 1) > 1 ? `x${entry.scan_count}` : '')}</span><time>${escapeHtml(String(entry.inventory_datetime || '').slice(11,19))}</time></div></div>`;
  }).join('');
}

function registerSessionCapture(payload, item) {
  const code = sessionDeviceCodeFromPayload(payload) || `SCAN-${state.sessionScanEvents + 1}`;
  state.sessionScanEvents++;
  const oldCurrent = state.sessionCurrentCode;
  if (oldCurrent && oldCurrent !== code) state.sessionPreviousCode = oldCurrent;
  state.sessionCurrentCode = code;
  const existingIndex = state.sessionScans.findIndex(x => x.code === code);
  let entry = existingIndex >= 0 ? state.sessionScans.splice(existingIndex, 1)[0] : {code, scan_count:0, machine_rows:[]};
  entry.client_scan_id = payload.client_scan_id || '';
  entry.inventory_datetime = payload.inventory_datetime || nowSqlLocal();
  entry.scan_comment = payload.scan_comment || '';
  entry.scan_department = normalizeDepartment(payload.scan_department || state.scanDepartment);
  entry.scan_count = Number(entry.scan_count || 0) + 1;
  entry.queue_id = Number(item && item.id || 0);
  entry.source = 'queue';
  entry.data_source = normalizeDataSource(payload.lookup_data_source || getSelectedDataSource());
  state.sessionScans.unshift(entry);
  renderSessionScanUi();
}

function updateSessionLookup(item, data) {
  const payload = item && item.payload ? item.payload : {};
  const code = sessionDeviceCodeFromPayload(payload);
  if (!code) return;
  const entry = state.sessionScans.find(x => x.code === code);
  if (!entry) return;
  entry.machine_rows = Array.isArray(data && data.rows) ? data.rows : [];
  entry.source = data && data.source ? data.source : entry.source;
  entry.data_source = normalizeDataSource((data && data.data_source) || payload.lookup_data_source || entry.data_source || getSelectedDataSource());
  entry.lookup_done = true;
  entry.lookup_error = '';
  entry.inventory_datetime = payload.inventory_datetime || entry.inventory_datetime;
  entry.scan_comment = payload.scan_comment || entry.scan_comment || '';
  renderSessionScanUi();
}

function updateSessionLookupError(item, message) {
  const payload = item && item.payload ? item.payload : {};
  const code = sessionDeviceCodeFromPayload(payload);
  const entry = state.sessionScans.find(x => x.code === code);
  if (!entry) return;
  entry.lookup_done = true;
  entry.lookup_error = String(message || 'Lookup error');
  renderSessionScanUi();
}

async function saveCurrentQrComment() {
  const input = $('qrComment');
  const comment = String(input ? input.value : '').trim().slice(0, 1000);
  if (!state.qrCurrentScanId) { notifyInfo('Chưa có thiết bị đang scan để cập nhật ghi chú.'); return; }
  state.lastQrComment = comment;
  const currentEntry = state.sessionScans.find(x => x.code === state.sessionCurrentCode);
  if (currentEntry) currentEntry.scan_comment = comment;
  let updatedQueue = false;
  if (offlineModuleReady() && typeof window.InventoryOffline.getQueuedByClientScanId === 'function') {
    const queued = await window.InventoryOffline.getQueuedByClientScanId(state.qrCurrentScanId).catch(() => null);
    if (queued) {
      const payload = Object.assign({}, queued.payload || {}, {scan_comment: comment});
      await window.InventoryOffline.updateQueueItem(queued.id, {payload});
      updatedQueue = true;
      scheduleRenderScanQueue(0);
    }
  }
  if (!updatedQueue && navigator.onLine) {
    try { await api('updateQrComment', {client_scan_id:state.qrCurrentScanId, scan_user:state.user, scan_comment:comment}, '', 3000); }
    catch (e) { notifyError(e.message || 'Không cập nhật được comment trên database.'); return; }
  }
  renderSessionScanUi();
  notifySuccess(comment ? 'Đã lưu ghi chú thiết bị / Device note saved.' : 'Đã xóa ghi chú thiết bị / Device note cleared.');
}

function buildCurrentQrSavePayload() {
  if (!state.qrCurrentScanId) state.qrCurrentScanId = newClientScanId();
  return {
    client_scan_id: state.qrCurrentScanId,
    scan_user: state.user,
    scan_department: state.scanDepartment,
    save_target: SAVE_TARGET,
    qr_text: $('qrText') ? $('qrText').value.trim() : String(state.lastQrText || '').trim(),
    lookup_key: $('qrLookupKey') ? $('qrLookupKey').value.trim() : String(state.lastLookupKey || '').trim(),
    qr_parsed: state.lastQrParsed,
    machine_rows: state.lastMachineRows,
    inventory_datetime: state.lastInventoryDatetime || nowSqlLocal(),
    image_data_url: state.lastQrImageDataUrl,
    scan_comment: state.lastQrComment || ($('qrComment') ? $('qrComment').value.trim() : ''),
    lookup_data_source: getSelectedDataSource(),
    lookup_device_codes: getSelectedDeviceCodes()
  };
}

function markOnlineSaveSuccess() {
  state.saveDbBackoffUntil = 0;
  state.saveDbFailureCount = 0;
}

function markOnlineSaveFailure() {
  state.saveDbFailureCount = Math.min(6, Number(state.saveDbFailureCount || 0) + 1);
  state.saveDbBackoffUntil = Date.now() + Math.min(30000, 5000 * state.saveDbFailureCount);
}

function isOnlineSaveBackoffActive() {
  return Number(state.saveDbBackoffUntil || 0) > Date.now();
}

async function saveQrToOfflineQueue(payload, reason) {
  if (!offlineModuleReady()) throw new Error('Không thể lưu hàng đợi offline trên trình duyệt này.');
  const item = await window.InventoryOffline.enqueueQr(payload, {
    status: 'pending_sync',
    factory: getSelectedFactory(),
    device_code: preferredDeviceCodesForLookup(payload.lookup_key || '', getSelectedDeviceCodes())[0],
    device_codes: getSelectedDeviceCodes(),
    data_source: getSelectedDataSource(),
    reason: reason || 'offline',
    lookup_key: payload.lookup_key || ''
  });
  await Promise.allSettled([refreshOfflineCacheUi(), renderScanQueue()]);
  return item;
}

function buildQrPayloadFromText(qrText, clientScanId, inventoryDatetime, scanComment = '') {
  qrText = String(qrText || '').trim();
  const parsed = parseQrContent(qrText);
  const lookupKey = parsed.lookup_ems || fallbackLookupCandidate(qrText);
  return {
    client_scan_id: clientScanId || newClientScanId(),
    scan_user: state.user || '',
    scan_department: state.scanDepartment || '',
    save_target: SAVE_TARGET,
    qr_text: qrText,
    lookup_key: lookupKey,
    qr_parsed: parsed,
    machine_rows: [],
    inventory_datetime: inventoryDatetime || nowSqlLocal(),
    image_data_url: '',
    scan_comment: String(scanComment || '').trim().slice(0, 1000),
    lookup_data_source: getSelectedDataSource(),
    lookup_device_codes: getSelectedDeviceCodes()
  };
}

function queueStatusText(status) {
  const map = {
    captured: 'Chờ tra cứu',
    processing_lookup: 'Đang tra cứu',
    lookup_failed: 'Chờ tra cứu lại',
    pending_sync: 'Chờ lưu',
    syncing: 'Đang lưu online',
    save_error: 'Lỗi lưu • giữ queue'
  };
  return map[String(status || '')] || 'Chờ xử lý';
}

function queueStatusClass(status) {
  status = String(status || '');
  if (status === 'pending_sync' || status === 'captured') return 'queue-status-wait';
  if (status === 'processing_lookup' || status === 'syncing') return 'queue-status-run';
  if (status === 'lookup_failed' || status === 'save_error') return 'queue-status-error';
  return '';
}

function queueItemCode(item) {
  const p = item && item.payload ? item.payload : {};
  return String(p.lookup_key || (p.qr_parsed && p.qr_parsed.lookup_ems) || fallbackLookupCandidate(p.qr_text || '') || p.qr_text || '').trim();
}

async function renderScanQueue(options = {}) {
  const countEl = $('scanQueueCount');
  const table = $('scanQueueTable');
  const tbody = table ? table.querySelector('tbody') : null;
  const scroller = $('scanQueueScroll');

  // On touch devices, rebuilding tbody while the finger is moving can cancel momentum
  // scrolling (especially iPad/Safari). Defer the DOM refresh until scrolling stops.
  if (!options.force && state.scanQueueScrollActive) {
    state.scanQueuePendingRender = true;
    return state.scanQueueLastItems || [];
  }

  if (!offlineModuleReady()) {
    if (countEl) countEl.textContent = '0';
    if ($('scanQueueTabCount')) { $('scanQueueTabCount').textContent = '0'; $('scanQueueTabCount').hidden = true; }
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty">Trình duyệt không hỗ trợ hàng đợi IndexedDB.</td></tr>';
    return [];
  }

  const oldScrollTop = scroller ? scroller.scrollTop : 0;
  const oldScrollLeft = scroller ? scroller.scrollLeft : 0;

  try {
    const items = await window.InventoryOffline.listQueue();
    state.scanQueueLastItems = items;
    if (countEl) countEl.textContent = `${items.length} chờ`;
    const tabCount = $('scanQueueTabCount');
    if (tabCount) {
      tabCount.textContent = String(items.length);
      tabCount.hidden = items.length < 1;
    }
    if ($('btnSyncOfflineQueue')) $('btnSyncOfflineQueue').textContent = `Đồng bộ (${items.length})`;
    const lastItem = items.length ? items[items.length - 1] : null;
    if ($('btnQrSkipCurrent')) $('btnQrSkipCurrent').disabled = !lastItem || String(lastItem.status || '') === 'syncing';
    if (!tbody) return items;

    if (!items.length) {
      state.qrLastCapturedQueueId = 0;
      tbody.innerHTML = '<tr><td colspan="6" class="empty">Hàng đợi trống. Camera có thể scan liên tục.</td></tr>';
    } else {
      const rows = items.slice(-20).reverse();
      tbody.innerHTML = rows.map((item, idx) => {
        const p = item.payload || {};
        const extra = item.extra || {};
        const time = formatLocalDateTime(item.created_at || p.inventory_datetime || '');
        const backend = dataSourceLabel(extra.data_source || p.lookup_data_source || getSelectedDataSource());
        const origin = extra.lookup_source || (String(item.status || '') === 'captured' ? 'Chưa tra cứu' : (navigator.onLine ? 'Online/cache' : 'Cache offline'));
        const source = `${backend} • ${origin} → Lưu Cloudflare D1`;
        const canSkip = String(item.status || '') !== 'syncing';
        return `<tr data-queue-row-id="${Number(item.id || 0)}">
          <td>${items.length - idx}</td>
          <td>${escapeHtml(time || '')}</td>
          <td><b>${escapeHtml(queueItemCode(item))}</b>${Number(item.duplicate_count || 0) > 0 ? `<div class="queue-rescan">Quét lại ${Number(item.duplicate_count)} lần • giữ 1 dòng</div>` : ''}</td>
          <td><span class="queue-status ${queueStatusClass(item.status)}">${escapeHtml(queueStatusText(item.status))}</span>${item.last_error ? `<div class="queue-error">${escapeHtml(item.last_error)}</div>` : ''}</td>
          <td>${escapeHtml(source)}</td>
          <td>${canSkip ? `<button type="button" class="secondary queue-skip-btn" data-skip-queue-id="${Number(item.id || 0)}">Bỏ qua</button>` : '<span class="muted">Đang lưu</span>'}</td>
        </tr>`;
      }).join('');
    }

    // Keep both axes stable like a DataTables scroll body. This prevents the table from
    // jumping back to the left/top every time a queue status changes in the background.
    if (scroller) {
      requestAnimationFrame(() => {
        scroller.scrollLeft = oldScrollLeft;
        scroller.scrollTop = oldScrollTop;
      });
    }
    return items;
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(e.message || 'Không đọc được hàng đợi.')}</td></tr>`;
    return [];
  }
}

function finishScanQueueScrollSoon(delay = 180) {
  if (state.scanQueueScrollEndTimer) clearTimeout(state.scanQueueScrollEndTimer);
  state.scanQueueScrollEndTimer = setTimeout(() => {
    state.scanQueueScrollEndTimer = null;
    state.scanQueueScrollActive = false;
    if (state.scanQueuePendingRender) {
      state.scanQueuePendingRender = false;
      renderScanQueue({force:true}).catch(() => {});
    }
  }, delay);
}

function markScanQueueScrolling() {
  state.scanQueueScrollActive = true;
  pauseQrScanDuringScroll();
  finishScanQueueScrollSoon(200);
}

function initScanQueueScroller() {
  const scroller = $('scanQueueScroll');
  if (!scroller || scroller.dataset.scrollReady === '1') return;
  scroller.dataset.scrollReady = '1';

  // Native passive events: no preventDefault, therefore iPad/Android retain momentum scrolling.
  scroller.addEventListener('touchstart', () => {
    state.scanQueueScrollActive = true;
    finishScanQueueScrollSoon(260);
  }, {passive:true});
  scroller.addEventListener('touchmove', markScanQueueScrolling, {passive:true});
  scroller.addEventListener('scroll', markScanQueueScrolling, {passive:true});
  scroller.addEventListener('pointerdown', () => {
    state.scanQueueScrollActive = true;
    finishScanQueueScrollSoon(260);
  }, {passive:true});
  scroller.addEventListener('wheel', markScanQueueScrolling, {passive:true});
}

function scheduleRenderScanQueue(delay = 60) {
  if (state.scanQueueScrollActive) {
    state.scanQueuePendingRender = true;
    finishScanQueueScrollSoon(220);
    return;
  }
  if (state.qrQueueRefreshTimer) clearTimeout(state.qrQueueRefreshTimer);
  state.qrQueueRefreshTimer = setTimeout(() => {
    state.qrQueueRefreshTimer = null;
    renderScanQueue().catch(() => {});
  }, delay);
}

function scheduleScanQueueProcessing(delay = 0) {
  if (state.qrQueueProcessTimer) clearTimeout(state.qrQueueProcessTimer);
  state.qrQueueProcessTimer = setTimeout(() => {
    state.qrQueueProcessTimer = null;
    processScanQueue({silent:true}).catch(e => console.warn('Scan queue worker:', e));
  }, Math.max(0, Number(delay) || 0));
}

async function captureQrIntoQueue(qrText) {
  qrText = String(qrText || '').trim();
  if (!qrText) return null;
  if (!state.user) {
    $('userModal').hidden = false;
    throw new Error('Vui lòng nhập người scan trước khi quét.');
  }
  if (!state.scanDepartment) {
    $('userModal').hidden = false;
    throw new Error('Vui lòng chọn hoặc nhập phòng ban trước khi quét.');
  }
  if (!offlineModuleReady()) throw new Error('Trình duyệt không hỗ trợ IndexedDB để tạo hàng đợi scan.');

  const clientScanId = newClientScanId();
  const inventoryDatetime = nowSqlLocal();
  const scanComment = String($('qrComment') ? $('qrComment').value : '').trim().slice(0, 1000);
  const payload = buildQrPayloadFromText(qrText, clientScanId, inventoryDatetime, scanComment);
  const enqueueFn = typeof window.InventoryOffline.enqueueOrRefreshQr === 'function'
    ? window.InventoryOffline.enqueueOrRefreshQr
    : window.InventoryOffline.enqueueQr;
  const item = await enqueueFn(payload, {
    status: 'captured',
    factory: getSelectedFactory(),
    device_code: preferredDeviceCodesForLookup(payload.lookup_key || '', getSelectedDeviceCodes())[0],
    device_codes: getSelectedDeviceCodes(),
    data_source: getSelectedDataSource(),
    reason: 'continuous_scan_capture',
    lookup_key: payload.lookup_key || '',
    captured_at: new Date().toISOString()
  });
  const refreshedDuplicate = !!item._queue_refreshed;

  state.manualLookupText = null;
  state.manualLookupRevision = (state.manualLookupRevision || 0) + 1;
  if ($('btnSaveQrComment')) $('btnSaveQrComment').disabled = false;
  state.qrLastCapturedQueueId = Number(item.id || 0);
  state.qrCurrentScanId = clientScanId;
  state.lastQrText = qrText;
  state.lastQrParsed = payload.qr_parsed;
  state.lastLookupKey = payload.lookup_key;
  state.lastMachineRows = [];
  state.lastInventoryDatetime = inventoryDatetime;
  state.lastQrComment = scanComment;
  state.lastQrImageDataUrl = '';
  if ($('qrText')) $('qrText').value = qrText;
  if ($('qrLookupKey')) $('qrLookupKey').value = payload.lookup_key || '';
  if ($('btnQrSkipCurrent')) $('btnQrSkipCurrent').disabled = false;
  registerSessionCapture(payload, item);
  if ($('qrComment') && scanComment) $('qrComment').value = '';
  if ($('machineSummary')) $('machineSummary').innerHTML = `<span class="lookup-source lookup-source-online">QUEUE #${Number(item.id || 0)}</span><span><b>${escapeHtml(payload.lookup_key || qrText)}</b> • ${refreshedDuplicate ? 'đã cập nhật thời gian mới nhất' : 'đang tra cứu'}</span>`;
  renderMachineRows([]);
  renderQrParsed(payload.qr_parsed);
  setQrStatus(refreshedDuplicate
    ? `Queue #${Number(item.id || 0)}: mã trùng • đã cập nhật thời gian mới nhất • tiếp tục scan`
    : `Đã vào hàng đợi #${Number(item.id || 0)} • tiếp tục scan`);
  notifyQrCaptured(payload.lookup_key || qrText, Number(item.id || 0), refreshedDuplicate, Number(item.duplicate_count || 0));
  pulseQrDetected();
  scheduleRenderScanQueue(0);
  scheduleScanQueueProcessing(state.qrQueueGraceMs);
  return item;
}

async function displayQueueLookupResult(item, data) {
  if (!item || !data) return;
  // Continuous-scan UX: never let an older queued lookup overwrite the result of a
  // newer QR already visible under the camera. The queue still processes all items.
  updateSessionLookup(item, data);
  if (state.manualLookupText != null) return;
  const itemId = Number(item.id || 0);
  const latestId = Number(state.qrLastCapturedQueueId || 0);
  if (latestId && itemId && itemId !== latestId) return;
  const p = item.payload || {};
  state.qrCurrentScanId = p.client_scan_id || state.qrCurrentScanId;
  state.lastQrText = p.qr_text || '';
  state.lastQrParsed = data.parsed || p.qr_parsed || parseQrContent(p.qr_text || '');
  state.lastLookupKey = data.lookup_key || p.lookup_key || '';
  state.lastMachineRows = Array.isArray(data.rows) ? data.rows : [];
  state.lastInventoryDatetime = p.inventory_datetime || state.lastInventoryDatetime || nowSqlLocal();
  state.lastQrComment = String(p.scan_comment || '');
  if ($('qrText')) $('qrText').value = state.lastQrText;
  if ($('qrLookupKey')) $('qrLookupKey').value = state.lastLookupKey;
  renderQrParsed(state.lastQrParsed);
  renderMachineSummary(data);
}

async function skipQueuedScan(id, options = {}) {
  id = Number(id || 0);
  if (!id || !offlineModuleReady()) return false;
  state.qrSkipQueueIds.add(id);
  try {
    const item = await window.InventoryOffline.getQueueItem(id);
    if (!item) return false;
    if (String(item.status || '') === 'syncing') {
      state.qrSkipQueueIds.delete(id);
      if (!options.silent) notifyInfo('Bản ghi đang gửi lên server nên không thể bỏ qua an toàn.');
      return false;
    }
    await window.InventoryOffline.deleteQueueItem(id);
    if (state.qrLastCapturedQueueId === id) state.qrLastCapturedQueueId = 0;
    if (!options.silent) notifyInfo(`Đã bỏ qua bản scan trong queue #${id}.`);
    setQrStatus(`Đã bỏ qua queue #${id} • camera tiếp tục scan`);
    scheduleRenderScanQueue(0);
    await refreshOfflineCacheUi().catch(() => {});
    return true;
  } finally {
    // Keep the id in the skip set briefly so an in-flight lookup cannot save it after deletion.
    setTimeout(() => state.qrSkipQueueIds.delete(id), 10000);
  }
}

async function skipLastQueuedScan() {
  let id = Number(state.qrLastCapturedQueueId || 0);
  if (!id && offlineModuleReady()) {
    const items = await window.InventoryOffline.listQueue();
    const last = items.length ? items[items.length - 1] : null;
    id = last ? Number(last.id || 0) : 0;
  }
  if (!id) { notifyInfo('Không có bản scan nào đang chờ để bỏ qua.'); return; }
  await skipQueuedScan(id);
}

async function processOneQueueItem(item) {
  if (!item || !item.id) return {saved:0, failed:0, processed:0};
  const id = Number(item.id);
  if (state.qrSkipQueueIds.has(id)) return {saved:0, failed:0, processed:0};
  let current = await window.InventoryOffline.getQueueItem(id);
  if (!current) return {saved:0, failed:0, processed:0};

  state.qrCurrentQueueItemId = id;
  let status = String(current.status || 'pending_sync');
  let payload = Object.assign({}, current.payload || {});
  const extra = Object.assign({}, current.extra || {});

  if (status === 'captured') {
    const age = Date.now() - Date.parse(current.created_at || new Date().toISOString());
    if (age < state.qrQueueGraceMs) {
      scheduleScanQueueProcessing(state.qrQueueGraceMs - age + 30);
      return {saved:0, failed:0, processed:0};
    }
  }

  if (status === 'captured' || status === 'processing_lookup' || status === 'lookup_failed') {
    current = await window.InventoryOffline.updateQueueItem(id, {
      status: 'processing_lookup',
      attempt_count: Number(current.attempt_count || 0) + 1,
      last_error: ''
    });
    scheduleRenderScanQueue(0);
    if (state.qrSkipQueueIds.has(id) || !current) return {saved:0, failed:0, processed:0};

    payload = Object.assign({}, current.payload || {});
    const qrText = String(payload.qr_text || '').trim();
    const parsed = payload.qr_parsed || parseQrContent(qrText);
    const lookupKey = cleanLookupCode(payload.lookup_key || parsed.lookup_ems || fallbackLookupCandidate(qrText));
    const factory = String((current.extra && current.extra.factory) || '').trim();
    const inferredDeviceCode = normalizeDeviceCode(String(lookupKey || '').slice(0, 4));
    const storedCodes = normalizeDeviceCodes((current.extra && current.extra.device_codes) || payload.lookup_device_codes || []);
    const deviceCodes = preferredDeviceCodesForLookup(lookupKey, storedCodes.length ? storedCodes : (inferredDeviceCode ? [inferredDeviceCode, ...getSelectedDeviceCodes()] : getSelectedDeviceCodes()));
    const dataSource = normalizeDataSource((current.extra && current.extra.data_source) || getSelectedDataSource());

    try {
      const lookupClientScanId = String(payload.client_scan_id || current.client_scan_id || '');
      const data = await lookupMachineData(qrText, lookupKey, parsed, factory, deviceCodes, dataSource);
      if (state.qrSkipQueueIds.has(id)) return {saved:0, failed:0, processed:0};
      const latestAfterLookup = await window.InventoryOffline.getQueueItem(id);
      if (!latestAfterLookup) return {saved:0, failed:0, processed:0};
      const latestLookupScanId = String((latestAfterLookup.payload && latestAfterLookup.payload.client_scan_id) || latestAfterLookup.client_scan_id || '');
      if (lookupClientScanId && latestLookupScanId && lookupClientScanId !== latestLookupScanId) {
        // The same code was scanned again while this lookup was running. The newer capture
        // owns the queue row and its latest timestamp; never overwrite it with stale lookup data.
        scheduleScanQueueProcessing(state.qrQueueGraceMs);
        return {saved:0, failed:0, processed:1};
      }
      payload.lookup_key = data.lookup_key || lookupKey;
      payload.qr_parsed = data.parsed || parsed;
      payload.machine_rows = Array.isArray(data.rows) ? data.rows : [];
      current = await window.InventoryOffline.updateQueueItem(id, {
        status: 'pending_sync',
        last_error: '',
        payload: payload,
        extra: {
          lookup_source: data.source || 'server',
          data_source: data.data_source || dataSource,
          lookup_factory: data.factory || factory || '',
          lookup_at: new Date().toISOString()
        }
      });
      await displayQueueLookupResult(current || item, data);
      status = 'pending_sync';
      setQrStatus(`Queue #${id}: đã hiển thị từ ${data.source === 'server' ? 'DB online' : 'cache offline'} • chờ lưu`);
    } catch (e) {
      if (state.qrSkipQueueIds.has(id)) return {saved:0, failed:0, processed:0};
      const latestOnLookupError = await window.InventoryOffline.getQueueItem(id).catch(() => null);
      const latestErrorScanId = latestOnLookupError ? String((latestOnLookupError.payload && latestOnLookupError.payload.client_scan_id) || latestOnLookupError.client_scan_id || '') : '';
      const attemptedScanId = String(payload.client_scan_id || current.client_scan_id || '');
      if (latestOnLookupError && attemptedScanId && latestErrorScanId && attemptedScanId !== latestErrorScanId) {
        scheduleScanQueueProcessing(state.qrQueueGraceMs);
        return {saved:0, failed:0, processed:1};
      }
      updateSessionLookupError(current, e.message || 'Không tra cứu được database/cache.');
      await window.InventoryOffline.updateQueueItem(id, {
        status: 'lookup_failed',
        last_error: e.message || 'Không tra cứu được database/cache.',
        extra: { lookup_failed_at: new Date().toISOString() }
      });
      if (id === state.qrLastCapturedQueueId || id === state.qrCurrentQueueItemId) {
        if ($('machineSummary')) $('machineSummary').innerHTML = `<div class="lookup-source lookup-source-offline">QUEUE #${id} • LOOKUP ERROR</div>${escapeHtml(e.message || 'Không tra cứu được dữ liệu máy.')}`;
        renderMachineRows([]);
      }
      setQrStatus(`Queue #${id}: chưa tra cứu được • vẫn giữ an toàn trong máy`);
      scheduleRenderScanQueue(0);
      return {saved:0, failed:1, processed:1};
    }
  }

  if (state.qrSkipQueueIds.has(id)) return {saved:0, failed:0, processed:1};
  current = await window.InventoryOffline.getQueueItem(id);
  if (!current) return {saved:0, failed:0, processed:1};
  status = String(current.status || 'pending_sync');
  payload = Object.assign({}, current.payload || {});

  if (status === 'syncing') {
    // A previous page/tab may have died while sending. client_scan_id makes retry idempotent.
    await window.InventoryOffline.updateQueueItem(id, {status:'pending_sync'});
    status = 'pending_sync';
  }

  if (status === 'pending_sync' || status === 'save_error') {
    if (!navigator.onLine || isOnlineSaveBackoffActive()) {
      await window.InventoryOffline.updateQueueItem(id, {status:'pending_sync'});
      return {saved:0, failed:0, processed:1};
    }
    if (state.qrSkipQueueIds.has(id)) return {saved:0, failed:0, processed:1};

    await window.InventoryOffline.updateQueueItem(id, {
      status: 'syncing',
      attempt_count: Number(current.attempt_count || 0) + 1,
      last_error: ''
    });
    scheduleRenderScanQueue(0);
    const saveClientScanId = String(payload.client_scan_id || current.client_scan_id || '');
    try {
      const saveResult = await api('pushQr', payload, '', SAVE_TIMEOUT_MS);
      markOnlineSaveSuccess();
      if (state.qrSkipQueueIds.has(id)) return {saved:0, failed:0, processed:1};

      const latestAfterSave = await window.InventoryOffline.getQueueItem(id).catch(() => null);
      const latestSaveScanId = latestAfterSave ? String((latestAfterSave.payload && latestAfterSave.payload.client_scan_id) || latestAfterSave.client_scan_id || '') : '';
      if (latestAfterSave && saveClientScanId && latestSaveScanId && saveClientScanId !== latestSaveScanId) {
        // A re-scan refreshed this queue row during the request. Keep that latest scan in
        // IndexedDB. The server-side same-user/code/day guard will prevent another DB row.
        setQrStatus(`Queue #${id}: đã lưu lần trước • giữ lần scan mới nhất trong queue`);
        scheduleScanQueueProcessing(state.qrQueueGraceMs);
        scheduleQrListsRefresh();
        return {saved:1, failed:0, processed:1};
      }

      await window.InventoryOffline.deleteQueueItem(id);
      await loadDepartmentStats();
      if (state.qrLastCapturedQueueId === id) state.qrLastCapturedQueueId = 0;
      setQrStatus(saveResult && saveResult.duplicate
        ? (saveResult.updated_latest
            ? `Queue #${id}: QR đã có trong ngày • đã cập nhật thời gian mới nhất`
            : `Queue #${id}: dữ liệu cùng mã/ngày/người đã có • không ghi trùng`)
        : `Queue #${id}: đã lưu database online • camera vẫn scan`);
      scheduleQrListsRefresh();
      return {saved:1, failed:0, processed:1};
    } catch (e) {
      const latestOnSaveError = await window.InventoryOffline.getQueueItem(id).catch(() => null);
      const latestErrorScanId = latestOnSaveError ? String((latestOnSaveError.payload && latestOnSaveError.payload.client_scan_id) || latestOnSaveError.client_scan_id || '') : '';
      if (latestOnSaveError && saveClientScanId && latestErrorScanId && saveClientScanId !== latestErrorScanId) {
        // Do not stamp an old request failure onto a newer duplicate scan.
        scheduleScanQueueProcessing(state.qrQueueGraceMs);
        return {saved:0, failed:0, processed:1};
      }
      if (e.isNetworkError || e.retryable || e.isTimeout) {
        markOnlineSaveFailure();
        await window.InventoryOffline.updateQueueItem(id, {
          status: 'pending_sync',
          last_error: e.message || 'Lỗi kết nối khi lưu online.',
          extra: {save_failed_at:new Date().toISOString()}
        });
      } else {
        await window.InventoryOffline.updateQueueItem(id, {
          status: 'save_error',
          last_error: e.message || 'Lỗi dữ liệu khi lưu online.',
          extra: {save_failed_at:new Date().toISOString()}
        });
      }
      return {saved:0, failed:1, processed:1};
    }
  }

  return {saved:0, failed:0, processed:1};
}

async function processScanQueue(options = {}) {
  if (!offlineModuleReady() || state.qrQueueWorkerBusy) return {success:0, failed:0, processed:0};
  state.qrQueueWorkerBusy = true;
  state.offlineSyncBusy = true;
  const btn = $('btnSyncOfflineQueue');
  let success = 0;
  let failed = 0;
  let processed = 0;
  try {
    if (btn) btn.disabled = true;
    const items = await window.InventoryOffline.listQueue();
    if (!items.length) {
      if (!options.silent) notifyInfo('Hàng đợi đang trống.');
      return {success, failed, processed};
    }

    // Snapshot processing: new scans may continue to be added while this loop is running.
    for (const item of items) {
      const result = await processOneQueueItem(item);
      success += Number(result.saved || 0);
      failed += Number(result.failed || 0);
      processed += Number(result.processed || 0);
      await sleep(0);
    }

    if (!options.silent) {
      if (success) notifySuccess(`Đã lưu/đồng bộ ${success} bản scan.`);
      else if (!navigator.onLine) notifyInfo('Đã xử lý lookup offline; bản ghi sẽ tự lưu khi online.');
      else if (failed) notifyInfo('Một số bản scan vẫn được giữ trong queue để thử lại.');
    }
    return {success, failed, processed};
  } finally {
    state.qrCurrentQueueItemId = 0;
    state.qrQueueWorkerBusy = false;
    state.offlineSyncBusy = false;
    if (btn) btn.disabled = false;
    await Promise.allSettled([renderScanQueue(), refreshOfflineCacheUi()]);

    // If scans arrived while the worker was running, schedule the next snapshot.
    try {
      const remaining = await window.InventoryOffline.listQueue();
      if (remaining.some(x => ['captured','processing_lookup'].includes(String(x.status || '')))) {
        scheduleScanQueueProcessing(state.qrQueueGraceMs);
      }
    } catch (_) {}
  }
}

async function syncOfflineQueue(options = {}) {
  return processScanQueue(options);
}

function scheduleAutoSyncOfflineQueue(delay = 500) {
  if (state.autoSyncTimer) clearTimeout(state.autoSyncTimer);
  state.autoSyncTimer = setTimeout(() => {
    state.autoSyncTimer = null;
    processScanQueue({silent:true}).catch(() => {});
  }, delay);
}

function startAutoSyncLoop() {
  setInterval(() => {
    if (!state.qrQueueWorkerBusy) processScanQueue({silent:true}).catch(() => {});
  }, 10000);
}

function registerInventoryServiceWorker() { return; // Offline data queue is retained; application shell is not cached.

  if (!('serviceWorker' in navigator)) return;
  // Service Worker requires HTTPS or localhost. Failure is non-fatal on HTTP LAN.
  Promise.resolve({})
    .then(function (registration) { return registration.update().catch(function () {}); })
    .catch(function () {});
}

function isSecureCameraContext() {
  return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

async function initUser() {
  // index.php đã nạp session/cookie vào INITIAL_USER; không chờ network nếu đã có user để camera mở nhanh.
  if (!state.user || !state.scanDepartment) { try { const data = await api('getUser', null, '', 900); state.user = state.user || data.user || ''; state.scanDepartment = state.scanDepartment || data.department || ''; } catch(e) {} }
  if ($('currentUserText')) $('currentUserText').textContent = state.user || '(chưa nhập)';
  if ($('departmentInput')) $('departmentInput').value = state.scanDepartment || '';
  if ($('userNameInput')) { $('userNameInput').value=state.user; $('userNameInput').readOnly=true; }
  if (!state.user || !state.scanDepartment) { if ($('userModal')) $('userModal').hidden = false; }
  if (state.scanDepartment) rememberDepartment(state.scanDepartment);
  await Promise.allSettled([loadDepartmentOptions(), loadDepartmentStats()]);
}

async function saveUser() {
  const name = $('userNameInput').value.trim();
  const department = normalizeDepartment($('departmentInput').value);
  if (!name) { alert('Vui lòng nhập tên người scan.'); return; }
  if (!department) { alert('Vui lòng nhập hoặc chọn phòng ban scan.'); return; }
  try {
    const data = await api('setUser', {name, department});
    state.user = data.user || name;
    state.scanDepartment = data.department || department;
    rememberDepartment(state.scanDepartment);
    if ($('currentUserText')) $('currentUserText').textContent = state.user;
    if ($('userModal')) $('userModal').hidden = true;
    await loadDepartmentStats();
    await refreshCurrentTabLists();
    if (!state.qrStream) { state.qrAutoOpenAttempted = false; autoOpenQrCamera().catch(() => {}); }
  } catch(e) { notifyError(e.message); }
}

function switchTab(tabId) {
  const current = document.querySelector('.tab-panel.active');
  const currentId = current ? current.id : '';

  // Release the physical camera when leaving a scan tab. This avoids camera contention
  // between QR and OCR on iPad/Android and saves battery while reviewing the device list.
  if (currentId === 'tabQr' && tabId !== 'tabQr' && state.qrStream) qrStopCamera();
  if (currentId === 'tabOcr' && tabId !== 'tabOcr' && state.ocrStream) ocrStopCamera();

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === tabId));

  if (window.matchMedia && window.matchMedia('(max-width: 720px)').matches) {
    const panel = document.getElementById(tabId);
    if (panel) setTimeout(() => panel.scrollIntoView({behavior:'smooth', block:'start'}), 30);
  }

  // Returning to QR restores the local camera automatically only when browser security allows it.
  if (tabId === 'tabQr' && state.user && !state.qrStream && isSecureCameraContext()) {
    state.qrAutoOpenAttempted = false;
    setTimeout(() => autoOpenQrCamera().catch(() => {}), 80);
  }
  refreshCurrentTabLists();
}

async function startCamera(videoId, streamKey, zoomId) {
  stopCamera(streamKey, videoId);
  const video = $(videoId);
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    notifyError('Trình duyệt không hỗ trợ camera trực tiếp. Dùng nút upload/camera máy.');
    return false;
  }
  if (!isSecureCameraContext()) {
    notifyError('Camera trực tiếp cần HTTPS hoặc localhost. Dùng camera máy/upload nếu đang mở bằng HTTP nội bộ.');
    return false;
  }

  const candidates = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: { width: { ideal: 1024 }, height: { ideal: 768 } }, audio: false },
    { video: true, audio: false }
  ];
  let lastErr = null;
  for (const c of candidates) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(c);
      state[streamKey] = stream;
      if (video) {
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.muted = true;
        video.autoplay = true;
        video.srcObject = stream;
        video.style.display = '';
        await new Promise(resolve => {
          const done = () => resolve();
          if (video.readyState >= 2) return resolve();
          video.onloadedmetadata = done;
          setTimeout(resolve, 900);
        });
        try { await video.play(); } catch(_) {}
      }
      setupZoom(stream, zoomId);
      return true;
    } catch(e) { lastErr = e; }
  }
  const msg = lastErr && lastErr.name === 'NotAllowedError'
    ? 'Trình duyệt chưa cho phép camera. Kiểm tra quyền Camera trong browser.'
    : 'Không mở được camera: ' + (lastErr ? (lastErr.name + ' - ' + lastErr.message) : 'unknown');
  notifyError(msg);
  return false;
}

function stopCamera(streamKey, videoId) {
  if (state[streamKey]) { state[streamKey].getTracks().forEach(t => t.stop()); state[streamKey] = null; }
  if (videoId && $(videoId)) $(videoId).srcObject = null;
}

function setupZoom(stream, zoomId) {
  const track = stream && stream.getVideoTracks()[0];
  const range = $(zoomId);
  if (!range) return;
  range.min = 1; range.max = 4; range.step = 0.1; range.value = 1;
  if (track && track.getCapabilities) {
    const caps = track.getCapabilities();
    if (caps.zoom) { range.min = caps.zoom.min || 1; range.max = caps.zoom.max || 4; range.step = caps.zoom.step || 0.1; range.value = caps.zoom.min || 1; }
  }
}

async function applyZoom(streamKey, zoomId) {
  const range = $(zoomId); if (!range) return;
  const z = parseFloat(range.value || '1');
  const track = state[streamKey] && state[streamKey].getVideoTracks()[0];
  if (!track || !track.getCapabilities) return;
  const caps = track.getCapabilities();
  if (caps.zoom && track.applyConstraints) { try { await track.applyConstraints({advanced: [{zoom: z}]}); } catch(e) {} }
}

function videoFrameToCanvas(videoId, zoomId, targetMaxW = 1800) {
  const video = $(videoId);
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const z = parseFloat(($(zoomId) && $(zoomId).value) || '1');
  let sw = video.videoWidth, sh = video.videoHeight, sx = 0, sy = 0;
  if (z > 1.01) { sw = Math.round(sw / z); sh = Math.round(sh / z); sx = Math.round((video.videoWidth - sw) / 2); sy = Math.round((video.videoHeight - sh) / 2); }
  const maxW = Math.max(480, Number(targetMaxW) || 1800);
  const scale = sw > maxW ? maxW / sw : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  c.getContext('2d', {willReadFrequently:true}).drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function cloneCanvas(src) { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d', {willReadFrequently:true}).drawImage(src, 0, 0); return c; }
function cropCanvas(src, sx, sy, sw, sh) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw));
  c.height = Math.max(1, Math.round(sh));
  c.getContext('2d', {willReadFrequently:true}).drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
function centerQrCrop(src, ratio = 0.72) {
  const side = Math.max(1, Math.round(Math.min(src.width, src.height) * ratio));
  const sx = Math.max(0, Math.round((src.width - side) / 2));
  const sy = Math.max(0, Math.round((src.height - side) / 2));
  return cropCanvas(src, sx, sy, side, side);
}
function rotateCanvas(src, degrees) {
  const swap = Math.abs(degrees % 180) === 90;
  const c = document.createElement('canvas'); c.width = swap ? src.height : src.width; c.height = swap ? src.width : src.height;
  const ctx = c.getContext('2d', {willReadFrequently:true}); ctx.translate(c.width/2, c.height/2); ctx.rotate(degrees * Math.PI / 180); ctx.drawImage(src, -src.width/2, -src.height/2); return c;
}
function drawCanvasTo(destId, src) { const canvas = $(destId); canvas.width = src.width; canvas.height = src.height; canvas.getContext('2d', {willReadFrequently:true}).drawImage(src, 0, 0); canvas.style.display = ''; return canvas; }

function preprocessForOcr(src) {
  const c = cloneCanvas(src), ctx = c.getContext('2d', {willReadFrequently:true}), img = ctx.getImageData(0,0,c.width,c.height), d = img.data;
  for (let i=0;i<d.length;i+=4) { let g = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114; g = (g-128)*1.18 + 128; g = Math.max(0, Math.min(255, g)); d[i]=d[i+1]=d[i+2]=g; }
  ctx.putImageData(img,0,0); return c;
}
function thresholdCanvas(src) {
  const c = cloneCanvas(src), ctx = c.getContext('2d', {willReadFrequently:true}), img = ctx.getImageData(0,0,c.width,c.height), d = img.data;
  for (let i=0;i<d.length;i+=4) { let g = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114; g = (g-128)*1.35 + 128; g = g > 150 ? 255 : 0; d[i]=d[i+1]=d[i+2]=g; }
  ctx.putImageData(img,0,0); return c;
}

function resizeCanvasForDecode(src, minSide = 720, maxSide = 1800) {
  const w = src.width || 1, h = src.height || 1;
  const min = Math.min(w, h), max = Math.max(w, h);
  let scale = 1;
  if (min < minSide) scale = minSide / min;
  if (max * scale > maxSide) scale = maxSide / max;
  if (Math.abs(scale - 1) < 0.03) return cloneCanvas(src);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d', {willReadFrequently:true}).drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function grayscaleCanvas(src, contrast = 1.25) {
  const c = cloneCanvas(src), ctx = c.getContext('2d', {willReadFrequently:true}), img = ctx.getImageData(0,0,c.width,c.height), d = img.data;
  for (let i=0;i<d.length;i+=4) {
    let g = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
    g = (g - 128) * contrast + 128;
    g = Math.max(0, Math.min(255, g));
    d[i]=d[i+1]=d[i+2]=g;
  }
  ctx.putImageData(img,0,0);
  return c;
}

function qrSourceCrops(src) {
  const w = src.width, h = src.height;
  const crops = [cloneCanvas(src), centerQrCrop(src, 0.78), centerQrCrop(src, 0.92)];
  // Card tài sản thường đặt QR ở bên phải. Thêm các vùng phải/trung tâm để Safari/desktop đọc nhanh hơn.
  if (w > 4 && h > 4) {
    crops.push(cropCanvas(src, Math.round(w * 0.42), 0, Math.round(w * 0.58), h));
    crops.push(cropCanvas(src, Math.round(w * 0.35), Math.round(h * 0.08), Math.round(w * 0.60), Math.round(h * 0.84)));
    crops.push(cropCanvas(src, Math.round(w * 0.48), Math.round(h * 0.05), Math.round(w * 0.48), Math.round(h * 0.90)));
    crops.push(cropCanvas(src, 0, 0, w, Math.round(h * 0.78)));
  }
  return crops.filter(c => c.width > 40 && c.height > 40);
}

function makeQrDecodeVariants(src, fast = false) {
  const variants = [];
  const push = (c) => { if (c && c.width > 40 && c.height > 40) variants.push(c); };

  if (fast) {
    // Live scan: keep preprocessing intentionally small. Native BarcodeDetector gets
    // clean frames and jsQR gets only a center + full-frame fallback.
    const center = resizeCanvasForDecode(centerQrCrop(src, 0.82), 420, 900);
    const full = resizeCanvasForDecode(src, 420, 960);
    push(center);
    push(full);
    push(grayscaleCanvas(center, 1.18));
    return variants;
  }

  const crops = qrSourceCrops(src);
  for (const crop of crops) {
    const base = resizeCanvasForDecode(crop, 620, 1600);
    for (const deg of [0, 90, 180, 270]) {
      const r = deg ? rotateCanvas(base, deg) : cloneCanvas(base);
      push(r);
      push(grayscaleCanvas(r, 1.28));
      push(thresholdCanvas(r));
    }
  }
  return variants.slice(0, 72);
}

function isAssetQrText(text) {
  const parts = String(text || '').split('|').map(x => x.trim());
  if (parts.length < 6) return false;
  const selectedCodes = getSelectedDeviceCodes();
  const firstCode = cleanLookupCode(parts[0] || '');
  return selectedCodes.some(code => code && firstCode.indexOf(code) === 0 && firstCode.length > code.length) || /LAPTOP|DESKTOP|PRINTER|MONITOR/i.test(parts[1] || '') || /\bA\d{6,}[- ]?\d+/i.test(text);
}

async function tryDecodeAssetQrFromCanvas(src) {
  try {
    const qr = await decodeQrFromCanvas(src);
    if (isAssetQrText(qr)) return qr;
  } catch (e) { console.warn('Asset QR decode from OCR image failed:', e.message); }
  return '';
}

async function createNativeBarcodeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  if (state.qrNativeDetectorPromise) return state.qrNativeDetectorPromise;
  state.qrNativeDetectorPromise = (async () => {
    const preferred = ['qr_code','data_matrix','pdf417','code_128','code_39','code_93','ean_13','ean_8','upc_a','upc_e','itf','codabar'];
    try {
      let formats = preferred;
      if (typeof BarcodeDetector.getSupportedFormats === 'function') {
        const supported = await BarcodeDetector.getSupportedFormats();
        const filtered = preferred.filter(f => supported.indexOf(f) >= 0);
        if (filtered.length) formats = filtered;
      }
      return new BarcodeDetector({formats});
    } catch(e) {
      try { return new BarcodeDetector({formats:['qr_code']}); } catch(_) { return null; }
    }
  })();
  return state.qrNativeDetectorPromise;
}

async function decodeQrServer(src) {
  if (!window.QR_SERVER_FALLBACK) return '';
  const now = Date.now();
  if (now - state.lastServerQrAt < 950) return '';
  state.lastServerQrAt = now;
  try {
    const data = await postJson('qr_decode_api.php?action=decode', { image_data_url: src.toDataURL('image/jpeg', 0.78) });
    return String(data.qr_text || '').trim();
  } catch(e) {
    // Không spam lỗi trong live scan; chỉ log để debug.
    console.warn('Server QR fallback:', e.message);
    return '';
  }
}

async function decodeQrFromCanvas(src, fast = false) {
  const detector = await createNativeBarcodeDetector();
  if (detector) {
    // Native BarcodeDetector is substantially faster and also supports 1D barcodes.
    const nativeVariants = fast
      ? [src, centerQrCrop(src, 0.86)]
      : makeQrDecodeVariants(src, false).slice(0, 16);
    for (const c of nativeVariants) {
      try {
        const codes = await detector.detect(c);
        if (codes && codes.length) {
          const hit = codes.find(x => x && x.rawValue);
          if (hit && hit.rawValue) return String(hit.rawValue).trim();
        }
      } catch(e) {}
    }
  }

  // QR fallback for browsers without BarcodeDetector (or when native detection misses).
  const variants = makeQrDecodeVariants(src, fast);
  if (typeof jsQR === 'function') {
    for (let i = 0; i < variants.length; i++) {
      const c = variants[i];
      try {
        const ctx = c.getContext('2d', {willReadFrequently:true});
        const img = ctx.getImageData(0,0,c.width,c.height);
        const qr = jsQR(img.data, img.width, img.height, {inversionAttempts: fast && i === 0 ? 'dontInvert' : 'attemptBoth'});
        if (qr && qr.data) return String(qr.data).trim();
      } catch(e) {}
    }
  }

  // Nếu browser không có decoder local (không BarcodeDetector và jsQR CDN chưa sẵn sàng),
  // live scan vẫn có thể dùng server fallback với throttle ~1 giây khi đang online.
  const canUseServerFallback = !fast || (!detector && typeof jsQR !== 'function' && navigator.onLine);
  const serverQr = canUseServerFallback ? await decodeQrServer(src) : '';
  if (serverQr) return serverQr;
  return '';
}

function parseQrContent(qrText) {
  const parts = String(qrText || '').split('|').map(x => normalizeCell(x));
  while (parts.length < 8) parts.push('');
  const ems = parts[0] || '';
  const deviceType = parts[1] || '';
  const deviceModel = parts[2] || '';
  const assetCode = parts[3] || '';
  const deviceSerialNo = parts[4] || '';
  const userId = parts[5] || '';
  const userDept = parts[6] || '';
  const lastCheck = parts[7] || '';
  const lookupSerialFull = cleanLookupCode(deviceSerialNo);
  const lookupSerial = serialLookup8(deviceSerialNo);
  const lookupEms = emsLookupKey(ems);
  const deviceLabel = deviceType || 'Device';
  const deviceValue = [deviceModel, assetCode].filter(Boolean).join('|');
  return {
    ems,
    device_type: deviceType,
    device_model: deviceModel,
    asset_code: assetCode,
    device_serial_no: deviceSerialNo,
    user_id: userId,
    user_dept: userDept,
    last_check: lastCheck,
    lookup_ems: lookupEms,
    lookup_serial_full: lookupSerialFull,
    lookup_serial_8: lookupSerial,
    lookup_serial: lookupSerial,
    device_laptop_info: deviceValue,
    device_serial_info: deviceSerialNo,
    display_table: [
      ['EMS', ems],
      [deviceLabel, deviceValue],
      ['Device Serial No', deviceSerialNo],
      ['User ID', userId],
      ["User's Dept", userDept],
      ['Last Check', lastCheck]
    ]
  };
}


function fallbackLookupCandidate(qrText) {
  const parsed = parseQrContent(qrText);
  if (parsed.lookup_ems) return parsed.lookup_ems;
  const parts = String(qrText || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const selectedCodes = getSelectedDeviceCodes();
  const emsLike = parts.find(p => selectedCodes.some(code => code && p.indexOf(code) === 0 && p.length > code.length));
  if (emsLike) return cleanLookupCode(emsLike);
  const any = parts.find(p => p.length >= 4);
  return any ? cleanLookupCode(any) : '';
}

function renderQrParsed(parsed) {
  const table = parsed && Array.isArray(parsed.display_table) ? parsed.display_table : [];
  if (!$('qrParsedTable')) return;
  const tbody = $('qrParsedTable').querySelector('tbody');
  if (!table.length) { tbody.innerHTML = '<tr><td colspan="2" class="empty">Chưa có dữ liệu QR đã tách.</td></tr>'; return; }
  let html = table.map(row => `<tr><th>${escapeHtml(row[0] || '')}</th><td>${escapeHtml(row[1] || '')}</td></tr>`).join('');
  if (parsed && (parsed.lookup_ems || parsed.ems)) {
    html += `<tr class="lookup-row"><th>Lookup McSerialNumber</th><td><b>${escapeHtml(parsed.lookup_ems || parsed.ems)}</b> <span class="muted">(EMS dùng để tra McSerialNumber)</span></td></tr>`;
  }
  tbody.innerHTML = html;
}

async function handleQrText(qrText, options = {}) {
  qrText = String(qrText || '').trim();
  if (!qrText) { setQrStatus('Không đọc được QR/Barcode.'); return null; }
  try {
    // Production v33: capture first, persist immediately, then background worker does lookup/save.
    // Camera is not stopped here, therefore DB/network latency never blocks the next scan.
    return await captureQrIntoQueue(qrText);
  } catch (e) {
    notifyError(e.message || 'Không đưa được QR/Barcode vào hàng đợi.');
    setQrStatus('Lỗi tạo hàng đợi scan.');
    return null;
  }
}

async function lookupMachineData(qrText, lookupKey, parsed, factory, deviceCodes = null, dataSourceOverride = '') {
  qrText = String(qrText || '').trim();
  lookupKey = cleanLookupCode(lookupKey || (parsed && parsed.lookup_ems) || fallbackLookupCandidate(qrText));
  parsed = parsed || parseQrContent(qrText);
  factory = String(factory || '').trim();
  deviceCodes = preferredDeviceCodesForLookup(lookupKey, normalizeDeviceCodes(deviceCodes || getSelectedDeviceCodes()));
  const dataSource = normalizeDataSource(dataSourceOverride || getSelectedDataSource());
  if (!qrText && !lookupKey) throw new Error('Chưa có nội dung QR/Barcode hoặc mã tra cứu.');

  let data = null;
  if (navigator.onLine) {
    const now = Date.now();
    const dbBackoffActive = Number(state.machineDbBackoffUntil || 0) > now;
    if (!dbBackoffActive) {
      try {
        data = await machineApi('lookupQr', {
          qr_text: qrText,
          lookup_key: lookupKey,
          factory: factory,
          device_code: deviceCodes[0],
          device_codes: deviceCodes,
          source: dataSource
        }, LOOKUP_TIMEOUT_MS);
        state.machineDbBackoffUntil = 0;
        state.machineDbFailureCount = 0;
      } catch (serverError) {
        state.machineDbFailureCount = Math.min(6, Number(state.machineDbFailureCount || 0) + 1);
        state.machineDbBackoffUntil = Date.now() + Math.min(15000, 3000 * state.machineDbFailureCount);
        try {
          data = await lookupMachineOffline(qrText, lookupKey, parsed, factory, deviceCodes, dataSource);
          data.source = 'offline_fallback';
          data.server_error = serverError.message || '';
        } catch (offlineError) {
          const err = new Error(`DB online lỗi: ${serverError.message || 'connection error'}; cache offline: ${offlineError.message || 'không khả dụng'}`);
          err.isNetworkError = !!serverError.isNetworkError;
          err.retryable = !!serverError.retryable;
          err.isTimeout = !!serverError.isTimeout;
          throw err;
        }
      }
    } else {
      data = await lookupMachineOffline(qrText, lookupKey, parsed, factory, deviceCodes, dataSource);
      data.source = 'offline_fallback';
      data.server_error = 'online_db_backoff';
    }
  } else {
    data = await lookupMachineOffline(qrText, lookupKey, parsed, factory, deviceCodes, dataSource);
  }
  return data;
}

async function lookupMachine(options = {}) {
  const qrText = $('qrLookupKey') ? $('qrLookupKey').value.trim() : '';
  const parsed = parseQrContent(qrText);
  const lookupKey = parsed.lookup_ems || fallbackLookupCandidate(qrText);
  const factory = getSelectedFactory();
  if (!qrText && !lookupKey) {
    const err = new Error('Chưa có nội dung QR/Barcode hoặc mã tra cứu.');
    if (options.throwOnError) throw err;
    notifyError(err.message);
    return null;
  }

  const revision = state.manualLookupRevision = (state.manualLookupRevision || 0) + 1;
  state.manualLookupText = qrText;
  if ($('btnSaveQrComment')) $('btnSaveQrComment').disabled = true;
  if ($('btnQrSkipCurrent')) $('btnQrSkipCurrent').disabled = true;
  renderQrParsed(parsed);
  renderMachineRows([]);
  try {
    setQrStatus(navigator.onLine ? 'DB online: đang tra cứu...' : 'Offline: đang tra cache máy...');
    if ($('machineSummary')) $('machineSummary').textContent = `Đang tra cứu mã ${lookupKey}...`;
    const data = await lookupMachineData(qrText, lookupKey, parsed, factory, getSelectedDeviceCodes(), getSelectedDataSource());
    if (revision !== state.manualLookupRevision || $('qrLookupKey').value.trim() !== qrText) return null;
    const rows = Array.isArray(data.rows) ? data.rows : [];
    renderQrParsed(data.parsed || parsed);
    renderMachineSummary(data);
    const sourceText = data.source === 'server' ? `${dataSourceLabel(data.data_source)} online` : `${dataSourceLabel(data.data_source)} cache offline`;
    setQrStatus(rows.length
      ? `Đã tra cứu ${sourceText} • ${rows.length} máy.`
      : `Đã tra cứu ${sourceText} • không tìm thấy máy.`);
    return data;
  } catch (e) {
    if (revision !== state.manualLookupRevision || $('qrLookupKey').value.trim() !== qrText) return null;
    setQrStatus('Tra cứu lỗi.');
    if ($('machineSummary')) $('machineSummary').textContent = e.message || 'Không tra cứu được dữ liệu.';
    renderMachineRows([]);
    if (options.throwOnError) throw e;
    notifyError(e.message || 'Tra cứu lỗi.');
    return null;
  }
}

function scheduleQrListsRefresh() {
  if (state.qrListRefreshTimer) clearTimeout(state.qrListRefreshTimer);
  state.qrListRefreshTimer = setTimeout(() => {
    state.qrListRefreshTimer = null;
    const active = document.querySelector('.tab-panel.active');
    if (active && active.id === 'tabScanned') loadQrList().catch(() => {});
  }, 1200);
}

function renderMachineSummary(data) {
  data = data || {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const el = $('machineSummary');
  if (!el) { renderMachineRows(rows); return; }

  const parsed = data.parsed || state.lastQrParsed || {};
  const lookup = data.lookup_key || (data.candidates || [])[0] || parsed.lookup_ems || parsed.ems || '';
  const factory = data.factory || getSelectedFactory() || '';
  const isOffline = data.source === 'offline_cache' || data.source === 'offline_fallback';
  const sourceLabel = isOffline ? 'OFFLINE' : 'ONLINE';
  const sourceClass = isOffline ? 'lookup-source-offline' : 'lookup-source-online';
  const cacheTime = isOffline && data.cached_at ? ` • ${escapeHtml(formatLocalDateTime(data.cached_at))}` : '';

  if (!rows.length) {
    el.innerHTML = `<span class="lookup-source ${sourceClass}">${sourceLabel}</span><span>Không tìm thấy <b>${escapeHtml(parsed.ems || lookup || '')}</b>${factory ? ` • ${escapeHtml(factory)}` : ''}</span>`;
    renderMachineRows([]);
    return;
  }

  el.innerHTML = `<span class="lookup-source ${sourceClass}">${sourceLabel}</span><span><b>${escapeHtml(lookup || rows[0].McSerialNumber || '')}</b> • ${rows.length} thiết bị${factory ? ` • ${escapeHtml(factory)}` : ''}${cacheTime}</span>`;
  renderMachineRows(rows);
}

function renderMachineRows(rows) {
  const host = $('machineResultCards');
  if (!host) return;
  if (!rows || !rows.length) {
    host.innerHTML = '<div class="machine-empty">Chưa có thông tin thiết bị.</div>';
    return;
  }

  const info = [
    ['Tên máy', 'McName'],
    ['Serial', 'McSerialNumber'],
    ['Loại', 'McType'],
    ['Hãng', 'McBrand'],
    ['Model', 'McModel'],
    ['Mã tài sản', 'AccountingCode'],
    ['Xưởng', 'Factory'],
    ['Vị trí', 'CurrentLocation'],
    ['Người sử dụng', 'Usedby'],
    ['Cập nhật', 'UpdatedTime']
  ];

  host.innerHTML = rows.map((r, index) => {
    const status = String(r.Status || '').trim();
    const cls = /active|running|ok|good|available|normal/i.test(status)
      ? 'status-ok'
      : (/repair|stop|broken|inactive|bad|ng|hold|scrap/i.test(status) ? 'status-bad' : 'status-warn');
    const items = info.map(([label, key]) => `<div class="machine-field"><span>${escapeHtml(label)}</span><b>${escapeHtml(r[key] || '-')}</b></div>`).join('');
    return `<article class="machine-result-card" data-machine-index="${index}">
      <div class="machine-card-head"><div><span class="machine-card-kicker">Thiết bị ${index + 1}</span><strong>${escapeHtml(r.McSerialNumber || r.McName || 'Không có serial')}</strong></div><span class="status-badge ${cls}">${escapeHtml(status || 'N/A')}</span></div>
      <div class="machine-info-grid">${items}</div>
    </article>`;
  }).join('');
}

async function qrStartCamera(autoScan = true) {
  if (state.qrStream) {
    if (autoScan && !state.qrLiveTimer && !state.qrWaitingCheck) await startQrLiveScan(true);
    return true;
  }
  const ok = await startCamera('qrVideo', 'qrStream', 'qrZoomRange');
  if (ok) {
    $('qrCanvas').style.display = 'none';
    setQrFrame(true, false, 'Đưa QR/Barcode vào khung');
    setQrStatus('Camera sẵn sàng • scan liên tục');
    if (autoScan) await startQrLiveScan(true);
  }
  return ok;
}

function qrStopCamera() {
  stopQrLiveScan(false);
  stopCamera('qrStream', 'qrVideo');
  setQrFrame(false);
  setQrStatus('Đã dừng camera QR/Barcode.');
}

async function autoOpenQrCamera() {
  if (state.qrAutoOpenAttempted || state.qrStream || !state.user) return;
  state.qrAutoOpenAttempted = true;
  if (!isSecureCameraContext()) {
    setQrStatus('Camera tự động cần HTTPS/localhost • bấm Mở camera hoặc dùng upload.');
    return;
  }
  try {
    await qrStartCamera(true);
  } catch (e) {
    console.warn('Auto camera start failed:', e);
  }
}

async function qrReadFrame() {
  const c = videoFrameToCanvas('qrVideo', 'qrZoomRange', 1400) || (state.lastQrImageDataUrl ? $('qrCanvas') : null);
  if (!c) { alert('Chưa có camera hoặc ảnh QR/Barcode.'); return; }
  const canvas = c instanceof HTMLCanvasElement ? c : cloneCanvas(c);
  drawCanvasTo('qrCanvas', canvas);
  state.lastQrImageDataUrl = $('qrCanvas').toDataURL('image/jpeg', .82);
  setQrFrame(true, false, 'Đang đọc trong khung...');
  setQrStatus('Đang đọc QR/Barcode');
  const qr = await decodeQrFromCanvas(canvas);
  if (qr) pulseQrDetected();
  await handleQrText(qr);
}

async function startQrLiveScan(fromCameraOpen = false) {
  if (!state.qrStream) await qrStartCamera(false);
  if (!state.qrStream) return;

  stopQrLiveScan(false);
  state.qrWaitingCheck = false;
  state.qrCurrentProcessBusy = false;
  setQrFrame(true, false, 'Đưa QR/Barcode vào khung');
  setQrStatus('Đang scan liên tục → hàng đợi');
  const seq = ++state.qrLiveScanSeq;

  state.qrLiveTimer = setInterval(async () => {
    if (seq !== state.qrLiveScanSeq) return;
    const activePanel = document.querySelector('.tab-panel.active');
    if (!activePanel || activePanel.id !== 'tabQr') return;
    if (state.qrDecodeBusy || state.qrScanPausedByScroll || document.hidden) return;

    const now = Date.now();
    const minDelay = state.isIOS ? 260 : 180;
    if (now - state.qrLastScanTickAt < minDelay) return;
    state.qrLastScanTickAt = now;

    state.qrDecodeBusy = true;
    try {
      // Small live frames keep jsQR/BarcodeDetector fast on mobile. Database work runs separately.
      const c = videoFrameToCanvas('qrVideo', 'qrZoomRange', 800);
      if (!c) return;
      const qr = String(await decodeQrFromCanvas(c, true) || '').trim();
      if (!qr) {
        state.qrBlankFrames = Math.min(12, state.qrBlankFrames + 1);
        return;
      }

      const sameCode = qr === state.qrLastAcceptedCode;
      // Avoid re-queuing a code that remains inside the frame. Once the camera sees blank frames,
      // the same asset may intentionally be scanned again.
      if (sameCode && state.qrBlankFrames < 2 && (now - state.qrLastAcceptedAt) < 8000) return;

      state.qrLastAcceptedCode = qr;
      state.qrLastAcceptedAt = now;
      state.qrBlankFrames = 0;
      await handleQrText(qr, {fromLive:true});
      // Do not stop camera and do not wait for DB lookup/save. Next code can be captured immediately.
      setQrFrame(true, false, 'Tiếp tục đưa mã kế tiếp vào khung');
    } catch(e) {
      console.error(e);
      setQrStatus('Scan lỗi tạm thời • đang thử lại...');
    } finally {
      state.qrDecodeBusy = false;
    }
  }, 90);
}

function stopQrLiveScan(show=true) {
  state.qrLiveScanSeq++;
  if (state.qrLiveTimer) { clearInterval(state.qrLiveTimer); state.qrLiveTimer = null; }
  if (state.qrStream && !state.qrWaitingCheck) setQrFrame(true, false, 'Đưa QR/Barcode vào khung');
  if (show && !state.qrWaitingCheck) setQrStatus('Đã dừng scan QR/Barcode.');
}

function pauseQrScanDuringScroll() {
  if (!state.qrStream || !state.qrLiveTimer || state.qrWaitingCheck) return;
  // touchmove can fire 60+ times/second. Rewriting camera/status DOM on every event makes
  // nested table scrolling feel locked on tablets, so only update UI on the transition.
  if (!state.qrScanPausedByScroll) {
    state.qrScanPausedByScroll = true;
    setQrFrame(true, false, 'Tạm dừng khi cuộn');
    setQrStatus('Tạm dừng scan khi cuộn trang...');
  }
  if (state.qrScrollTimer) clearTimeout(state.qrScrollTimer);
  state.qrScrollTimer = setTimeout(() => {
    state.qrScanPausedByScroll = false;
    if (state.qrStream && state.qrLiveTimer && !state.qrWaitingCheck) {
      setQrFrame(true, false, 'Đưa QR/Barcode vào khung');
      setQrStatus('Đang scan');
    }
  }, 420);
}

function loadQrFile(file) { if (!file) return; if (!file.type.startsWith('image/')) { alert('Vui lòng chọn file ảnh.'); return; } const img = new Image(); img.onload = async () => { const c = imageToCanvas(img); drawCanvasTo('qrCanvas', c); $('qrVideo').style.display = 'none'; setQrFrame(false); state.lastQrImageDataUrl = $('qrCanvas').toDataURL('image/jpeg', .88); setQrStatus('Đang đọc'); await handleQrText(await decodeQrFromCanvas(c)); }; img.src = URL.createObjectURL(file); }

async function pushQrServer() {
  if (!state.user) { $('userModal').hidden = false; return; }
  if (state.qrSaveBusy) return;
  const btn = $('btnPushQr');
  try {
    state.qrSaveBusy = true;
    if (btn) { btn.disabled = true; btn.dataset.oldText = btn.textContent; btn.textContent = 'Đang xử lý...'; }
    const manualText = $('qrLookupKey') ? $('qrLookupKey').value.trim() : '';
    if (state.manualLookupText != null || (manualText && manualText !== String(state.lastLookupKey || ''))) {
      if (!manualText) { notifyInfo('Vui lòng nhập mã cần lưu.'); return; }
      await captureQrIntoQueue(manualText);
    }
    let items = offlineModuleReady() ? await window.InventoryOffline.listQueue() : [];
    if (!items.length) {
      const qrText = $('qrText') ? $('qrText').value.trim() : String(state.lastQrText || '').trim();
      if (!qrText) { notifyInfo('Hàng đợi trống và chưa có QR/Barcode hiện tại.'); return; }
      await captureQrIntoQueue(qrText);
      items = await window.InventoryOffline.listQueue();
    }
    const result = await processScanQueue({silent:false});
    if (!navigator.onLine && items.length) notifyInfo('Đã giữ dữ liệu trong máy; hệ thống sẽ tự đồng bộ khi online.');
    if (result.success) scheduleQrListsRefresh();
  } catch (e) {
    notifyError(e.message || 'Không xử lý được hàng đợi QR/Barcode.');
  } finally {
    state.qrSaveBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.oldText || 'Đồng bộ ngay'; }
    await Promise.allSettled([refreshOfflineCacheUi(), renderScanQueue()]);
  }
}

function imageToCanvas(img) { const maxW = 1900, scale = img.width > maxW ? maxW / img.width : 1; const c = document.createElement('canvas'); c.width = Math.round(img.width*scale); c.height = Math.round(img.height*scale); c.getContext('2d', {willReadFrequently:true}).drawImage(img, 0, 0, c.width, c.height); return c; }

function maskQrCode(canvas) {
  if (!$('maskQr').checked || typeof jsQR === 'undefined') return canvas;
  const c = cloneCanvas(canvas), ctx = c.getContext('2d', {willReadFrequently:true});
  try { const img = ctx.getImageData(0,0,c.width,c.height); const qr = jsQR(img.data, img.width, img.height, {inversionAttempts:'attemptBoth'}); if (qr && qr.location) { const pts = [qr.location.topLeftCorner, qr.location.topRightCorner, qr.location.bottomLeftCorner, qr.location.bottomRightCorner]; const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y); const minX = Math.max(0, Math.min(...xs)-25), maxX = Math.min(c.width, Math.max(...xs)+25), minY = Math.max(0, Math.min(...ys)-25), maxY = Math.min(c.height, Math.max(...ys)+25); ctx.fillStyle = '#fff'; ctx.fillRect(minX, minY, maxX-minX, maxY-minY); } } catch(e) {}
  return c;
}

async function getWorker(lang) {
  if (typeof Tesseract === 'undefined' || !Tesseract.createWorker || window.TESSERACT_PLACEHOLDER) {
    throw new Error('Không tải được Tesseract.js online. Kiểm tra internet/CDN hoặc bật OCR server fallback.');
  }
  if (state.ocrWorker && state.ocrWorkerLang === lang) return state.ocrWorker;
  if (state.ocrWorker) { try { await state.ocrWorker.terminate(); } catch(e) {} state.ocrWorker = null; }
  state.ocrWorkerLang = lang;

  const options = {
    workerPath: '/assets/vendor/worker.min.js',
    corePath: '/assets/vendor/tesseract-core',
    logger: m => {
      if (m && m.status) {
        const pct = m.progress ? Math.round(m.progress * 100) : '';
        setOcrStatus(`${m.status} ${pct}%`);
      }
    }
  };

  // Online OCR: language data tải từ tessdata.projectnaptha.com để không cần cài Tesseract trên server.
  // Nếu CDN bị chặn, recognizeCanvas() sẽ tự fallback sang ocr_api.php khi OCR_SERVER_FALLBACK=true.
  if (window.TESSERACT_LANG_PATH) options.langPath = window.TESSERACT_LANG_PATH;

  state.ocrWorker = await Tesseract.createWorker(lang, 1, options);
  return state.ocrWorker;
}

function firstNumber() {
  for (let i = 0; i < arguments.length; i++) {
    const v = Number(arguments[i]);
    if (Number.isFinite(v) && v !== 0) return v;
  }
  return 0;
}

function extractWords(data) {
  const out = [];
  const words = Array.isArray(data.words) ? data.words : [];
  for (const w of words) {
    const text = cleanWordText(w.text || '');
    if (!text) continue;
    const conf = Number(w.confidence || w.conf || 0);
    if (conf < 25) continue;
    const b = w.bbox || w.boundingBox || w;
    const x0 = firstNumber(b.x0, b.left, b.x);
    const y0 = firstNumber(b.y0, b.top, b.y);
    const width0 = Number(b.width || 0);
    const height0 = Number(b.height || 0);
    const x1 = Number.isFinite(Number(b.x1)) && Number(b.x1) !== 0 ? Number(b.x1) : x0 + width0;
    const y1 = Number.isFinite(Number(b.y1)) && Number(b.y1) !== 0 ? Number(b.y1) : y0 + height0;
    const width = Math.max(1, x1 - x0);
    const height = Math.max(1, y1 - y0);
    if (height > width * 3.2 && text.length <= 4) continue;
    out.push({ text, conf, confidence: conf, x0, y0, x1, y1, cx:(x0+x1)/2, cy:(y0+y1)/2, width, height });
  }
  return out;
}

function groupWordsToRows(words) {
  const sorted = [...words].sort((a,b)=>a.cy-b.cy || a.x0-b.x0); const rows = [];
  for (const w of sorted) {
    let row = rows.find(r => Math.abs(r.cy - w.cy) <= Math.max(10, r.h * .72, w.height * .72));
    if (!row) { row = {cy:w.cy, h:w.height, words:[]}; rows.push(row); }
    row.words.push(w); row.cy = row.words.reduce((s,x)=>s+x.cy,0)/row.words.length; row.h = Math.max(row.h, w.height);
  }
  return rows.sort((a,b)=>a.cy-b.cy).map(r => ({...r, words:r.words.sort((a,b)=>a.x0-b.x0)}));
}

function groupRowToCells(words) {
  if (!words.length) return [];
  const sorted = [...words].sort((a,b)=>a.x0-b.x0); const cells = []; let cur = [sorted[0]];
  const avgH = sorted.reduce((s,w)=>s+w.height,0)/sorted.length;
  for (let i=1;i<sorted.length;i++) { const prev = sorted[i-1], w = sorted[i]; const gap = w.x0 - prev.x1; const threshold = Math.max(avgH*1.2, 22, prev.width*.75); if (gap > threshold) { cells.push(cur); cur = [w]; } else cur.push(w); }
  cells.push(cur);
  return cells.map(ws => ws.map(w=>w.text).join(' ').trim()).filter(Boolean);
}

function wordsToTable(words, rawText) {
  const rows = groupWordsToRows(words), table = [];
  for (const r of rows) { const cells = groupRowToCells(r.words).map(normalizeCell); if (cells.length) table.push(cells); }
  if (!table.length && rawText) String(rawText).split(/\r?\n/).map(normalizeCell).filter(Boolean).forEach(x => table.push([x]));
  return table;
}

function findValueFromTable(table, labels) {
  const normalizedLabels = labels.map(l => cleanLookupCode(l));
  for (const row of table || []) {
    const cells = (row || []).map(x => normalizeCell(x)).filter(Boolean);
    if (!cells.length) continue;
    const joined = cells.join(' ');
    const joinedKey = cleanLookupCode(joined);
    for (const label of normalizedLabels) {
      const idx = joinedKey.indexOf(label);
      if (idx === 0) {
        const labelText = labels[normalizedLabels.indexOf(label)];
        const re = new RegExp('^\\s*' + labelText.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '\\s*[:：=\\-]*\\s*', 'i');
        const byRegex = joined.replace(re, '').trim();
        if (byRegex && byRegex !== joined) return byRegex;
        if (cells.length >= 2) return cells.slice(1).join(' ').trim();
      }
    }
    if (cells.length >= 2) {
      const firstKey = cleanLookupCode(cells[0]);
      for (const label of normalizedLabels) if (firstKey === label || firstKey.indexOf(label) >= 0 || label.indexOf(firstKey) >= 0) return cells.slice(1).join(' ').trim();
    }
  }
  return '';
}

function findByRegex(text, patterns) {
  text = String(text || '').replace(/\r/g, '\n');
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return normalizeCell(m[1]);
  }
  return '';
}

function normalizeAssetOcrTable(table, rawText) {
  const lines = [];
  for (const r of table || []) if (Array.isArray(r)) lines.push(r.join(' '));
  const text = [String(rawText || ''), lines.join('\n')].join('\n');

  let ems = findValueFromTable(table, ['EMS', 'EMSD']);
  if (!ems) ems = findByRegex(text, [/\b(?:EMS|EMSD)\s*[:：=\-]?\s*([A-Z0-9]{4,20})/i, /\b(COMP\d{3,})\b/i]);

  let deviceType = findValueFromTable(table, ['Device Type']);
  if (!deviceType) deviceType = findByRegex(text, [/\bDevice\s*Type\s*[:：=\-]?\s*([A-Z][A-Z0-9 _\-]{2,30})/i]);
  if (!deviceType && /\bLAPTOP\b/i.test(text)) deviceType = 'LAPTOP';

  let model = findValueFromTable(table, ['Device Model']);
  if (!model) model = findByRegex(text, [/\bDevice\s*Model\s*[:：=\-]?\s*([A-Z0-9][A-Z0-9 _\-]{4,80})/i, /\b(ACER\s+SWIFT\s+SF\d{3,4}\-\d{2})\b/i]);

  let asset = findValueFromTable(table, ['Asset Code', 'AccountingCode']);
  if (!asset) asset = findByRegex(text, [/\bAsset\s*Code\s*[:：=\-]?\s*([A-Z0-9][A-Z0-9\-]{5,40})/i, /\b(A\d{7,}\-\d{4,})\b/i]);

  let serial = findValueFromTable(table, ['Device Serial No', 'Device Serial Number', 'Device Serial', 'Serial No']);
  if (!serial) serial = findByRegex(text, [/\bDevice\s*Serial\s*(?:No|Number)?\s*[:：=\-]?\s*([A-Z0-9]{10,80})/i, /\b([A-Z]{2,}\d[A-Z0-9]{10,})\b/i]);

  let userId = findValueFromTable(table, ["User's ID", 'User ID', 'Users ID']);
  if (!userId) userId = findByRegex(text, [/\bUser'?s?\s*ID\s*[:：=\-]?\s*([A-Z0-9]{5,30})/i, /\b(A\dA\d{6,})\b/i]);

  let dept = findValueFromTable(table, ["User's Dept", 'User Dept', 'Users Dept']);
  if (!dept) dept = findByRegex(text, [/\bUser'?s?\s*Dept\s*[:：=\-]?\s*([A-Za-z][A-Za-z0-9 &\-]{3,80})/i, /\b(Technology\s+and\s+Automation)\b/i]);

  let last = findValueFromTable(table, ['Last Check', 'Last Checked']);
  if (!last) last = findByRegex(text, [/\bLast\s*Check(?:ed)?\s*[:：=\-]?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?)/i, /\b(\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2})\b/]);

  const hasAssetShape = [ems, deviceType, model, asset, serial, userId, dept, last].filter(Boolean).length >= 4;
  if (!hasAssetShape) return table;
  return [
    ['EMS', ems],
    [deviceType || 'LAPTOP', [model, asset].filter(Boolean).join('|')],
    ['Device Serial No', serial],
    ['User ID', userId],
    ["User's Dept", dept],
    ['Last Check', last]
  ].filter(r => r[1]);
}

function scoreOcr(words, table, text) { const meaningful = words.filter(w=>/[A-Za-z0-9]/.test(w.text) && w.text.length>=2); const avg = meaningful.length ? meaningful.reduce((s,w)=>s+w.conf,0)/meaningful.length : 0; const multi = table.filter(r=>r.length>=2).length; const known = (text || '').match(/Device|Asset|Serial|Model|EMSD|EMS|User|Checked|Mc|Status|Factory|Location|Code|LAPTOP|ACER|SWIFT|COMP/gi) || []; const patterns = (text || '').match(/COMP\d{3,}|A\d{7,}-\d{4}|[A-Z]{2,}\d[A-Z0-9]{10,}|A\dA\d{6,}|Technology\s+and\s+Automation/gi) || []; const garbage = meaningful.filter(w => /^[A-Za-z]{1,2}$/.test(w.text)).length; return avg*2 + meaningful.length*3 + table.length*8 + multi*30 + known.length*35 + patterns.length*90 - garbage*6; }

async function recognizeCanvasServer(canvas, deg) {
  const lang = $('ocrLang').value || 'eng';
  const psm = $('ocrMode').value === 'table' ? '11' : '6';
  setOcrStatus('Đang OCR bằng server local...');
  const data = await postJson('ocr_api.php?action=recognize', {
    image_data_url: canvas.toDataURL('image/jpeg', 0.86),
    lang: lang,
    psm: psm,
    mode: $('ocrMode').value || 'table'
  });
  const words = Array.isArray(data.words) ? extractWords({words:data.words}) : [];
  const table = Array.isArray(data.table) ? data.table : [];
  const raw = data.raw_text || table.map(r => (r || []).join(' ')).join('\n');
  return { deg, data:{ text: raw, words: data.words || [] }, words, table, score: scoreOcr(words, table, raw) + 20 };
}

async function recognizeCanvas(src, deg) {
  let c = rotateCanvas(src, deg);
  c = maskQrCode(c);
  c = preprocessForOcr(c);

  if (window.OCR_FORCE_SERVER === true && window.OCR_SERVER_FALLBACK) {
    return await recognizeCanvasServer(c, deg);
  }

  try {
    setOcrStatus('Đang OCR online bằng Tesseract.js...');
    const worker = await getWorker($('ocrLang').value || 'eng');
    await worker.setParameters({
      tessedit_pageseg_mode: $('ocrMode').value === 'table' ? '11' : '6',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });
    const ret = await worker.recognize(c);
    const data = ret.data || {};
    const words = extractWords(data);
    const table = $('ocrMode').value === 'table'
      ? wordsToTable(words, data.text || '')
      : String(data.text || '').split(/\r?\n/).map(normalizeCell).filter(Boolean).map(x => [x]);
    return {deg, data, words, table, score: scoreOcr(words, table, data.text || '')};
  } catch(e) {
    console.warn('Online OCR failed, fallback server OCR:', e.message);
    if (window.OCR_SERVER_FALLBACK) {
      try { return await recognizeCanvasServer(c, deg); }
      catch(serverErr) { throw new Error('OCR online lỗi: ' + e.message + '. OCR server fallback cũng lỗi: ' + serverErr.message); }
    }
    throw e;
  }
}

async function checkOcrServerStatus() {
  setOcrStatus('Đang kiểm tra OCR online...');
  const onlineOk = (typeof Tesseract !== 'undefined' && !!Tesseract.createWorker && !window.TESSERACT_PLACEHOLDER);
  if (onlineOk) {
    notifySuccess('OCR online sẵn sàng: Tesseract.js đã tải từ CDN.');
    setOcrStatus('OCR online sẵn sàng.');
    return;
  }

  if (!window.OCR_SERVER_FALLBACK) {
    setOcrStatus('OCR online chưa sẵn sàng.');
    notifyError('Không tải được Tesseract.js online. Kiểm tra internet hoặc CDN.');
    return;
  }

  setOcrStatus('OCR online lỗi, đang kiểm tra server fallback...');
  try {
    const res = await fetch('ocr_api.php?action=diagnose', { cache: 'no-store' });
    const json = await res.json();
    const data = json.data || {};
    if (data.available) {
      setOcrStatus('OCR server fallback sẵn sàng.');
      notifySuccess('OCR server fallback OK: ' + (data.path || 'tesseract') + '.');
    } else {
      setOcrStatus('OCR chưa sẵn sàng.');
      notifyError('Không tải được Tesseract.js online và server chưa có Tesseract OCR.');
    }
  } catch (e) {
    setOcrStatus('Không kiểm tra được OCR.');
    notifyError('Không kiểm tra được OCR: ' + e.message);
  }
}

async function runOcr() {
  if (!state.ocrImageReady) { alert('Chưa có ảnh để OCR.'); return; }
  setOcrStatus('Đang xử lý ảnh...');
  $('rawText').value = '';
  const src = $('ocrCanvas');

  // Ưu tiên đọc QR trong ảnh OCR nếu có. Với Asset Verification Card, QR chứa dữ liệu chuẩn hơn OCR chữ nhỏ.
  // Việc này sửa lỗi OCR ra ký tự rác và vẫn giữ đúng định dạng dòng/cột yêu cầu.
  try {
    setOcrStatus('Đang kiểm tra QR trong ảnh...');
    const qrText = await tryDecodeAssetQrFromCanvas(src);
    if (qrText) {
      const parsed = parseQrContent(qrText);
      state.ocrTable = parsed.display_table.filter(r => r[1]);
      state.ocrRawText = qrText;
      state.ocrImageDataUrl = $('ocrCanvas').toDataURL('image/jpeg', .88);
      renderEditTable('ocrTable', state.ocrTable);
      $('rawText').value = qrText;
      $('ocrMeta').textContent = `Đã đọc dữ liệu chuẩn từ QR trong ảnh. Dòng: ${state.ocrTable.length}. Có thể sửa từng ô trước khi save to server.`;
      state.ocrWaitingSave = true;
      setOcrStatus('Waiting check: kiểm tra/sửa dữ liệu rồi Save.');
      return;
    }
  } catch (qrErr) {
    console.warn('Skip asset QR OCR path:', qrErr.message);
  }

  setOcrStatus('Đang OCR...');
  const degrees = $('tryRotations').checked ? [state.ocrRotation, (state.ocrRotation+90)%360, (state.ocrRotation+270)%360, (state.ocrRotation+180)%360] : [state.ocrRotation];
  let best = null;
  try {
    for (const d of degrees) {
      const r = await recognizeCanvas(src, d);
      if (!best || r.score > best.score) best = r;
    }
    state.ocrTable = normalizeAssetOcrTable(best.table, best.data.text || '');
    state.ocrRawText = best.data.text || '';
    state.ocrRotation = best.deg;
    state.ocrImageDataUrl = $('ocrCanvas').toDataURL('image/jpeg', .88);
    renderEditTable('ocrTable', state.ocrTable);
    $('rawText').value = state.ocrRawText;
    const maxCols = state.ocrTable.reduce((m,r)=>Math.max(m,r.length),0);
    $('ocrMeta').textContent = `OCR xong. Góc chọn: ${best.deg}°. Dòng: ${state.ocrTable.length}. Cột tối đa: ${maxCols}. Có thể sửa từng ô trước khi save to server.`;
    state.ocrWaitingSave = true;
    setOcrStatus('Waiting check: kiểm tra/sửa dữ liệu rồi Save.');
  } catch(e) {
    console.error(e);
    setOcrStatus('OCR lỗi.');
    notifyError('OCR lỗi: ' + e.message);
  }
}


async function ocrStartCamera() { const ok = await startCamera('ocrVideo', 'ocrStream', 'ocrZoomRange'); if (ok) { $('ocrCanvas').style.display = 'none'; setOcrStatus('Camera OCR đã mở.'); } }
function ocrStopCamera() { stopCamera('ocrStream', 'ocrVideo'); setOcrStatus('Đã dừng camera OCR.'); }
async function ocrCapture() { const c = videoFrameToCanvas('ocrVideo', 'ocrZoomRange'); if (!c) { alert('Camera OCR chưa sẵn sàng.'); return; } drawCanvasTo('ocrCanvas', c); $('ocrVideo').style.display = 'none'; state.ocrImageReady = true; state.ocrRotation = 0; state.ocrImageDataUrl = $('ocrCanvas').toDataURL('image/jpeg', .88); await runOcr(); }
function loadOcrFile(file) { if (!file) return; if (!file.type.startsWith('image/')) { alert('Vui lòng chọn file ảnh.'); return; } const img = new Image(); img.onload = async () => { const c = imageToCanvas(img); drawCanvasTo('ocrCanvas', c); $('ocrVideo').style.display = 'none'; state.ocrImageReady = true; state.ocrRotation = 0; state.ocrImageDataUrl = $('ocrCanvas').toDataURL('image/jpeg', .88); setOcrStatus('Đang OCR'); await runOcr(); }; img.src = URL.createObjectURL(file); }
function rotateOcrCanvas(deg) { if (!state.ocrImageReady) return; const rotated = rotateCanvas(cloneCanvas($('ocrCanvas')), deg); drawCanvasTo('ocrCanvas', rotated); state.ocrImageDataUrl = $('ocrCanvas').toDataURL('image/jpeg', .88); }

function resetOcrForNextScan() {
  state.ocrWaitingSave = false;
  state.ocrImageReady = false;
  state.ocrImageDataUrl = '';
  state.ocrTable = [];
  state.ocrRawText = '';
  if ($('rawText')) $('rawText').value = '';
  if ($('ocrMeta')) $('ocrMeta').textContent = 'Sẵn sàng OCR.';
  renderEditTable('ocrTable', []);
  if (state.ocrStream && $('ocrVideo')) {
    $('ocrVideo').style.display = '';
    if ($('ocrCanvas')) $('ocrCanvas').style.display = 'none';
    setOcrStatus('Sẵn sàng chụp OCR tiếp.');
  } else {
    setOcrStatus('Sẵn sàng.');
  }
}

function getTableFromDom(tableId) { const rows = []; const tbody = $(tableId).querySelector('tbody'); tbody.querySelectorAll('tr[data-row]').forEach(tr => { const row = []; tr.querySelectorAll('input[data-cell]').forEach(inp => row.push(normalizeCell(inp.value))); while (row.length && row[row.length-1] === '') row.pop(); if (row.some(x=>x!=='')) rows.push(row); }); return rows; }
function renderEditTable(tableId, table) {
  const el = $(tableId); const maxCols = Math.max(1, table.reduce((m,r)=>Math.max(m,r.length),0));
  let thead = '<tr><th>#</th>'; for (let c=0;c<maxCols;c++) thead += `<th>Col ${pad2(c+1)}</th>`; thead += '<th>Thao tác</th></tr>'; el.querySelector('thead').innerHTML = thead;
  if (!table.length) { el.querySelector('tbody').innerHTML = `<tr><td colspan="${maxCols+2}" class="empty">Chưa có dữ liệu.</td></tr>`; return; }
  el.querySelector('tbody').innerHTML = table.map((row,r) => `<tr data-row="${r}"><td><b>${r+1}</b></td>${Array.from({length:maxCols}).map((_,c)=>`<td><input data-cell="${c}" value="${escapeHtml(row[c] || '')}"></td>`).join('')}<td class="row-tools"><button type="button" data-del-row="${r}" data-target="${tableId}" class="secondary">Xóa dòng</button></td></tr>`).join('');
}
function addRow(tableId) { const t = getTableFromDom(tableId); const maxCols = Math.max(1, t.reduce((m,r)=>Math.max(m,r.length),0)); t.push(Array(maxCols).fill('')); renderEditTable(tableId, t); }
function addCol(tableId) { const t = getTableFromDom(tableId); if (!t.length) t.push(['']); t.forEach(r => r.push('')); renderEditTable(tableId, t); }
function deleteRow(tableId, rowIndex) { const t = getTableFromDom(tableId); t.splice(rowIndex,1); renderEditTable(tableId,t); }

async function pushOcrServer() {
  if (!state.user) { $('userModal').hidden = false; return; }
  const table = getTableFromDom('ocrTable');
  if (!table.length) { notifyError('Không có dữ liệu OCR để save to server.'); return; }
  if (state.ocrSaveBusy) return;
  const btn = $('btnPushOcr');
  try {
    state.ocrSaveBusy = true;
    if (btn) { btn.disabled = true; btn.dataset.oldText = btn.textContent; btn.textContent = 'Saving...'; }
    setOcrStatus('Đang save to server...');
    const data = await api('pushTable', {scan_user:state.user, save_target:SAVE_TARGET, table, image_data_url:state.ocrImageDataUrl}, '', SAVE_TIMEOUT_MS);
    notifySuccess(data.duplicate ? 'OCR đã tồn tại. Sẵn sàng scan tiếp.' : 'Đã lưu OCR. Sẵn sàng scan tiếp.');
    await loadOcrList();
    resetOcrForNextScan();
  } catch(e) {
    notifyError(e.message);
    setOcrStatus('Save lỗi. Waiting check: kiểm tra rồi Save lại.');
  } finally {
    state.ocrSaveBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.oldText || 'Save'; }
  }
}

function renderMiniTable(table) { if (!table || !table.length) return ''; return '<table class="mini-table">' + table.map(row => '<tr>' + row.map(c => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>').join('') + '</table>'; }
function indexRows(rows) { rows.forEach(r => { state.rowsById[String(r.id)] = r; }); }

function openEditModal(id) {
  const record = state.rowsById[String(id)];
  if (!record) { notifyError('Không tìm thấy dữ liệu cần sửa / Record not found.'); return; }
  state.editRecordId = Number(record.id || id || 0);
  state.editTable = Array.isArray(record.table) ? record.table.map(row => Array.isArray(row) ? row.slice() : []) : [];
  renderEditTable('editTable', state.editTable);
  const noteField = $('editDeviceNoteField');
  const note = $('editDeviceNote');
  const isQr = String(record.source_type || '').toLowerCase() === 'qr';
  if (noteField) noteField.hidden = !isQr;
  if (note) note.value = isQr ? String(record.scan_comment || '') : '';
  $('editModal').hidden = false;
}

async function saveEditRecord() {
  const id = Number(state.editRecordId || 0);
  if (!id) { notifyError('ID không hợp lệ / Invalid record ID.'); return; }
  const record = state.rowsById[String(id)] || {};
  const table = getTableFromDom('editTable');
  if (!table.length) { notifyError('Không có dữ liệu để lưu / No data to save.'); return; }
  const btn = $('btnSaveEdit');
  try {
    if (btn) { btn.disabled = true; btn.dataset.oldText = btn.textContent; btn.textContent = 'Đang lưu / Saving...'; }
    const data = await api('updateRecordTable', {id, table});
    if (String(record.source_type || '').toLowerCase() === 'qr' && $('editDeviceNote')) {
      await api('updateQrComment', {id, scan_user:record.scan_user || state.user, scan_comment:$('editDeviceNote').value.trim()});
    }
    if (data && data.record) state.rowsById[String(id)] = data.record;
    $('editModal').hidden = true;
    notifySuccess('Đã cập nhật dữ liệu / Record updated.');
    await refreshCurrentTabLists();
  } catch (e) { notifyError(e.message || 'Không cập nhật được dữ liệu / Update failed.'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.oldText || 'Lưu sửa / Save'; } }
}

async function deleteRecord(id) {
  id = Number(id || 0);
  if (!id) return;
  if (!window.confirm('Xóa bản ghi này? / Delete this record?')) return;
  try {
    await api('deleteRecord', {id});
    delete state.rowsById[String(id)];
    notifySuccess('Đã xóa dữ liệu / Record deleted.');
    await refreshCurrentTabLists();
  } catch (e) { notifyError(e.message || 'Không xóa được dữ liệu / Delete failed.'); }
}

function renderQrRecordInfo(r) {
  const label = r.qr_device_type || 'LAPTOP';
  return `<table class="mini-table qr-mini">
    <tr><th>EMS</th><td>${escapeHtml(r.qr_ems || '')}</td></tr>
    <tr><th>${escapeHtml(label)}</th><td>${escapeHtml(r.qr_laptop_info || '')}</td></tr>
    <tr><th>Device Serial No</th><td>${escapeHtml(r.qr_device_serial_no || '')}</td></tr>
    <tr><th>User ID</th><td>${escapeHtml(r.qr_user_id || '')}</td></tr>
    <tr><th>User's Dept</th><td>${escapeHtml(r.qr_user_dept || '')}</td></tr>
    <tr><th>Last Check</th><td>${escapeHtml(r.qr_last_check || '')}</td></tr>
    <tr><th>Lookup EMS</th><td><b>${escapeHtml(r.qr_ems_lookup || r.qr_lookup_key || r.qr_ems || '')}</b></td></tr>
  </table>`;
}

function overviewRecordValue(record, directField, overviewField) {
  const direct = String(record && record[directField] != null ? record[directField] : '').trim();
  if (direct) return direct;
  try {
    const parsed = record && record.machine_json ? JSON.parse(record.machine_json) : null;
    const row = parsed && Array.isArray(parsed.overview_rows) && parsed.overview_rows.length ? parsed.overview_rows[0] : {};
    return String(row && row[overviewField] != null ? row[overviewField] : '').trim();
  } catch (_) { return ''; }
}

function qrReportQueryParams() {
  const allUsers = !!($('qrAllUsers') && $('qrAllUsers').checked);
  return {
    source_type: 'qr',
    date: $('qrFilterDate') ? ($('qrFilterDate').value || '') : '',
    user: allUsers ? '' : (state.user || ''),
    search: $('qrFilterSearch') ? ($('qrFilterSearch').value || '') : '',
    all_users: allUsers ? '1' : '0'
  };
}

function exportQrExcel() {
  const params = qrReportQueryParams();
  const query = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  window.location.href = `export_excel.php?${query}&site=${encodeURIComponent(window.ACTIVE_SITE || '')}`;
}

async function loadQrList() {
  const params = qrReportQueryParams();
  const query = '&' + Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const tbody = $('qrListTable').querySelector('tbody');
  tbody.innerHTML = '<tr><td colspan="27" class="empty">Đang tải / Loading...</td></tr>';
  try {
    const data = await api('listRecords', null, query);
    const rows = data.rows || [];
    indexRows(rows);
    $('qrListCount').textContent = `${rows.length} dòng / rows`;
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="28" class="empty">Không có dữ liệu QR / No QR data.</td></tr>'; return; }
    tbody.innerHTML = rows.map(r => {
      const machineType = overviewRecordValue(r, 'machine_type', 'McType');
      const machineBrand = overviewRecordValue(r, 'machine_brand', 'McBrand');
      const machineModel = overviewRecordValue(r, 'machine_model', 'McModel');
      const accounting = overviewRecordValue(r, 'machine_accounting_code', 'AccountingCode');
      const factory = overviewRecordValue(r, 'machine_factory', 'Factory');
      const location = overviewRecordValue(r, 'machine_location', 'CurrentLocation');
      const usedBy = overviewRecordValue(r, 'machine_usedby', 'Usedby');
      const position = overviewRecordValue(r, 'machine_position', 'Position');
      const manuSerial = overviewRecordValue(r, 'machine_manu_serial', 'ManuSerialNo');
      const purchaseDate = overviewRecordValue(r, 'machine_purchase_date', 'PurchaseDate');
      const sourceUpdated = overviewRecordValue(r, 'machine_updated_time', 'UpdatedTime');
      const remark = overviewRecordValue(r, 'machine_remark', 'Remark');
      return `<tr>
        <td>${r.id}</td><td>${escapeHtml(r.inventory_datetime || r.scan_datetime)}</td><td>${escapeHtml(r.scan_user)}</td><td>${escapeHtml(r.scan_department || '')}</td>
        <td>${escapeHtml(r.qr_ems||'')}</td><td>${escapeHtml(r.qr_laptop_info||'')}</td><td><b>${escapeHtml(r.qr_device_serial_no||'')}</b></td>
        <td>${escapeHtml(r.qr_user_id||'')}</td><td><b>${escapeHtml(r.qr_ems_lookup || r.qr_lookup_key || r.qr_ems || '')}</b></td>
        <td>${escapeHtml(r.qr_user_dept||'')}</td><td>${escapeHtml(r.qr_last_check||'')}</td><td>${escapeHtml(r.machine_status||'')}</td>
        <td>${escapeHtml(r.machine_name||'')}</td><td>${escapeHtml(r.machine_serial||'')}</td><td>${escapeHtml(machineType)}</td><td>${escapeHtml(machineBrand)}</td>
        <td>${escapeHtml(machineModel)}</td><td>${escapeHtml(accounting)}</td><td>${escapeHtml(factory)}</td><td>${escapeHtml(location)}</td><td>${escapeHtml(usedBy)}</td>
        <td>${escapeHtml(position)}</td><td>${escapeHtml(manuSerial)}</td><td>${escapeHtml(purchaseDate)}</td><td>${escapeHtml(sourceUpdated)}</td><td>${escapeHtml(remark)}</td>
        <td class="device-note-cell">${escapeHtml(r.scan_comment||'')}</td>
        <td class="row-tools"><button type="button" data-edit-id="${r.id}" class="secondary">Sửa / Edit</button><button type="button" data-delete-id="${r.id}" class="secondary">Xóa / Delete</button></td>
      </tr>`;
    }).join('');
  } catch(e) { tbody.innerHTML = `<tr><td colspan="28" class="empty">${escapeHtml(e.message)}</td></tr>`; }
}

async function loadOcrList() {
  const query = `&source_type=ocr&date=${encodeURIComponent($('ocrFilterDate').value||'')}&user=${encodeURIComponent(state.user||'')}&search=${encodeURIComponent($('ocrFilterSearch').value||'')}&all_users=${$('ocrAllUsers').checked?'1':'0'}`;
  const tbody = $('ocrListTable').querySelector('tbody'); tbody.innerHTML = '<tr><td colspan="5" class="empty">Đang tải...</td></tr>';
  try { const data = await api('listRecords', null, query); const rows = data.rows || []; indexRows(rows); $('ocrListCount').textContent = `${rows.length} dòng`; if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">Không có dữ liệu OCR.</td></tr>'; return; }
    tbody.innerHTML = rows.map(r => `<tr><td>${r.id}</td><td>${escapeHtml(r.scan_datetime)}</td><td>${escapeHtml(r.scan_user)}</td><td>${renderMiniTable(r.table||[])}</td><td class="row-tools"><button type="button" data-edit-id="${r.id}" class="secondary">Edit</button><button type="button" data-delete-id="${r.id}" class="secondary">Delete</button></td></tr>`).join('');
  } catch(e) { tbody.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(e.message)}</td></tr>`; }
}

async function refreshAllLists() { await Promise.allSettled([loadQrList(), loadOcrList()]); }
async function refreshCurrentTabLists() {
  const active = document.querySelector('.tab-panel.active');
  if (!active) return;
  if (active.id === 'tabScanned') await Promise.allSettled([loadQrList(), renderScanQueue({force:true})]);
  else if (active.id === 'tabOcr') await loadOcrList();
  else if (active.id === 'tabSettings') await Promise.allSettled([refreshOfflineCacheUi(), fetchAssetImportStatus({silent:true})]);
}

document.addEventListener('click', (e) => { const queueSkip = e.target.closest('[data-skip-queue-id]'); if (queueSkip) { skipQueuedScan(Number(queueSkip.dataset.skipQueueId || 0)); return; } const del = e.target.closest('[data-del-row]'); if (del) { deleteRow(del.dataset.target, Number(del.dataset.delRow)); return; } const edit = e.target.closest('[data-edit-id]'); if (edit) { openEditModal(edit.dataset.editId); return; } const delRec = e.target.closest('[data-delete-id]'); if (delRec) { deleteRecord(delRec.dataset.deleteId); return; } });

window.addEventListener('DOMContentLoaded', async () => {
  try { await window.sessionReady; } catch(e) { return; }
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  await initUser();
  await initOfflineUi();
  renderSessionScanUi();
  registerInventoryServiceWorker();

  $('btnSaveUser').addEventListener('click', saveUser);
  $('btnChangeUser').addEventListener('click', () => { $('userNameInput').value = state.user || ''; $('departmentInput').value = state.scanDepartment || ''; renderDepartmentOptions(); $('userModal').hidden = false; });

  $('btnQrStartCamera').addEventListener('click', qrStartCamera);
  $('btnQrStopCamera').addEventListener('click', qrStopCamera);
  $('btnQrStartLive').addEventListener('click', startQrLiveScan);
  $('btnQrStopLive').addEventListener('click', () => stopQrLiveScan(true));
  $('btnQrReadFrame').addEventListener('click', qrReadFrame);
  $('qrImageInput').addEventListener('change', e => loadQrFile(e.target.files[0]));
  $('qrZoomRange').addEventListener('input', () => applyZoom('qrStream', 'qrZoomRange'));
  $('btnLookupMachine').addEventListener('click', () => lookupMachine());
  $('qrLookupKey').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      lookupMachine();
    }
  });
  $('btnPushQr').addEventListener('click', pushQrServer);
  if ($('btnSaveQrComment')) $('btnSaveQrComment').addEventListener('click', () => saveCurrentQrComment().catch(e => notifyError(e.message || 'Không cập nhật được comment.')));
  if ($('btnQrSkipCurrent')) { $('btnQrSkipCurrent').disabled = true; $('btnQrSkipCurrent').addEventListener('click', skipLastQueuedScan); }
  $('btnLoadQrList').addEventListener('click', loadQrList);
  if ($('btnExportQrExcel')) $('btnExportQrExcel').addEventListener('click', exportQrExcel);
  $('qrAllUsers').addEventListener('change', loadQrList);
  $('qrFilterDate').addEventListener('change', loadQrList);
  let qrFilterTimer = null;
  $('qrFilterSearch').addEventListener('input', () => {
    clearTimeout(qrFilterTimer);
    qrFilterTimer = setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active && active.id === 'tabScanned') loadQrList().catch(() => {});
    }, 320);
  });

  if ($('dataSourceSelect')) {
    $('dataSourceSelect').addEventListener('change', async () => {
      const source = normalizeDataSource($('dataSourceSelect').value);
      setSelectedDataSource(source);
      resetSourceScopeOptions();
      if (source === 'mysql') await fetchAssetImportStatus({silent:true});
      if (navigator.onLine) {
        await loadDeviceCodesOnDemand({silent:true});
        await loadFactoriesOnDemand({silent:true});
      }
      await refreshOfflineCacheUi();
      notifyInfo(`Đã chuyển nguồn tra cứu sang ${dataSourceLabel(source)}.`);
    });
  }
  if ($('btnRefreshSource')) {
    $('btnRefreshSource').addEventListener('click', async () => {
      if (getSelectedDataSource() === 'mysql') await fetchAssetImportStatus({silent:true});
      await loadDeviceCodesOnDemand({silent:false});
      await refreshOfflineCacheUi();
    });
  }
  if ($('btnImportAssetFile')) $('btnImportAssetFile').addEventListener('click', importAssetMasterFile);
  if ($('btnRefreshImportStatus')) $('btnRefreshImportStatus').addEventListener('click', () => fetchAssetImportStatus({silent:false}));
  if ($('assetImportFile')) {
    $('assetImportFile').addEventListener('change', () => {
      const file = $('assetImportFile').files && $('assetImportFile').files[0];
      if ($('assetImportStatus') && file) $('assetImportStatus').textContent = `${file.name} • ${(file.size / 1024 / 1024).toFixed(2)} MB • sẵn sàng import.`;
    });
  }

  if ($('offlineDeviceCodeChecklist')) {
    $('offlineDeviceCodeChecklist').addEventListener('change', async (event) => {
      if (!event.target.matches('input[type="checkbox"]')) return;
      let codes = normalizeDeviceCodes(Array.from($('offlineDeviceCodeChecklist').querySelectorAll('input[type="checkbox"]:checked')).map(x => x.value));
      if (!codes.length) {
        event.target.checked = true;
        codes = [normalizeDeviceCode(event.target.value) || 'COMP'];
        notifyInfo('Cần chọn ít nhất một loại thiết bị / Select at least one device type.');
      }
      setSelectedDeviceCodes(codes);
      setSelectedFactory('');
      clearServerFactoryOptions();
      if (navigator.onLine) await loadFactoriesOnDemand({silent:true});
      await refreshOfflineCacheUi();
    });
  }
  if ($('btnSelectAllDeviceCodes')) $('btnSelectAllDeviceCodes').addEventListener('click', async () => {
    const codes = normalizeDeviceCodes(Array.from($('offlineDeviceCodeChecklist').querySelectorAll('input[type="checkbox"]')).map(x => x.value));
    setSelectedDeviceCodes(codes); setSelectedFactory(''); clearServerFactoryOptions();
    if (navigator.onLine) await loadFactoriesOnDemand({silent:true});
    await refreshOfflineCacheUi();
  });
  if ($('btnClearDeviceCodes')) $('btnClearDeviceCodes').addEventListener('click', async () => {
    const all = normalizeDeviceCodes(Array.from($('offlineDeviceCodeChecklist').querySelectorAll('input[type="checkbox"]')).map(x => x.value));
    const fallback = all.includes('COMP') ? 'COMP' : (all[0] || 'COMP');
    setSelectedDeviceCodes([fallback]); setSelectedFactory(''); clearServerFactoryOptions();
    if (navigator.onLine) await loadFactoriesOnDemand({silent:true});
    await refreshOfflineCacheUi();
  });
  if ($('btnLoadDeviceCodes')) $('btnLoadDeviceCodes').addEventListener('click', loadDeviceCodesOnDemand);

  if ($('offlineFactorySelect')) {
    $('offlineFactorySelect').addEventListener('change', async () => {
      setSelectedFactory($('offlineFactorySelect').value || '');
      await refreshOfflineCacheUi();
    });
  }
  if ($('btnLoadFactories')) $('btnLoadFactories').addEventListener('click', loadFactoriesOnDemand);
  if ($('btnDownloadOfflineCache')) $('btnDownloadOfflineCache').addEventListener('click', downloadOfflineCache);
  if ($('btnDownloadAllOfflineCache')) $('btnDownloadAllOfflineCache').addEventListener('click', downloadAllOfflineCaches);
  if ($('btnDeleteOfflineCache')) $('btnDeleteOfflineCache').addEventListener('click', deleteOfflineCacheSelected);
  if ($('btnDeleteAllOfflineCache')) $('btnDeleteAllOfflineCache').addEventListener('click', deleteAllOfflineCaches);
  if ($('btnSyncOfflineQueue')) $('btnSyncOfflineQueue').addEventListener('click', syncOfflineQueue);

  $('btnOcrStartCamera').addEventListener('click', ocrStartCamera);
  $('btnOcrStopCamera').addEventListener('click', ocrStopCamera);
  $('btnOcrCapture').addEventListener('click', ocrCapture);
  $('ocrSystemCameraInput').addEventListener('change', e => loadOcrFile(e.target.files[0]));
  $('ocrUploadInput').addEventListener('change', e => loadOcrFile(e.target.files[0]));
  $('ocrZoomRange').addEventListener('input', () => applyZoom('ocrStream', 'ocrZoomRange'));
  $('btnOcrRotateLeft').addEventListener('click', () => rotateOcrCanvas(-90));
  $('btnOcrRotateRight').addEventListener('click', () => rotateOcrCanvas(90));
  $('btnRunOcr').addEventListener('click', runOcr);
  $('btnCheckOcrServer').addEventListener('click', checkOcrServerStatus);
  $('btnOcrAddRow').addEventListener('click', () => addRow('ocrTable'));
  $('btnOcrAddCol').addEventListener('click', () => addCol('ocrTable'));
  $('btnPushOcr').addEventListener('click', pushOcrServer);
  $('btnLoadOcrList').addEventListener('click', loadOcrList);
  $('ocrAllUsers').addEventListener('change', loadOcrList);
  $('ocrFilterDate').addEventListener('change', loadOcrList);
  let ocrFilterTimer = null;
  $('ocrFilterSearch').addEventListener('input', () => {
    clearTimeout(ocrFilterTimer);
    ocrFilterTimer = setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active && active.id === 'tabOcr') loadOcrList().catch(() => {});
    }, 320);
  });

  // Tối ưu khi người dùng cuộn trang: camera vẫn mở nhưng tạm ngừng decode QR để tránh chậm/giật.
  window.addEventListener('scroll', pauseQrScanDuringScroll, {passive: true});
  window.addEventListener('touchmove', pauseQrScanDuringScroll, {passive: true});
  window.addEventListener('online', () => {
    refreshOfflineCacheUi();
    scheduleAutoSyncOfflineQueue(250);
    loadDeviceCodesOnDemand({silent:true}).catch(() => {});
    notifyInfo('Đã có kết nối mạng • hệ thống tự đồng bộ hàng đợi offline.');
  });
  window.addEventListener('offline', () => {
    refreshOfflineCacheUi();
    notifyInfo('Thiết bị đang offline • tra cứu sẽ dùng cache máy đã tải.');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      state.qrScanPausedByScroll = true;
      setQrStatus(state.qrWaitingCheck ? 'Waiting check.' : 'Tạm dừng scan khi màn hình ẩn.');
    } else if (state.qrStream && state.qrLiveTimer && !state.qrWaitingCheck) {
      state.qrScanPausedByScroll = false;
      setQrFrame(true, false, 'Đưa QR/Barcode vào khung');
      setQrStatus('Đang scan');
    }
  });

  $('btnCloseEdit').addEventListener('click', () => { $('editModal').hidden = true; });
  $('btnEditAddRow').addEventListener('click', () => addRow('editTable'));
  $('btnEditAddCol').addEventListener('click', () => addCol('editTable'));
  $('btnSaveEdit').addEventListener('click', saveEditRecord);

  if (typeof Tesseract !== 'undefined' && Tesseract.createWorker && !window.TESSERACT_PLACEHOLDER) {
    notifyInfo('OCR online sẵn sàng.');
  } else if (window.OCR_SERVER_FALLBACK) {
    notifyInfo('OCR online chưa tải được; hệ thống sẽ thử OCR server fallback nếu có.');
  }
  // Trạng thái danh mục import trong OCR_Scan_db được tải nhẹ ở nền; không tự tải snapshot máy về cache.
  fetchAssetImportStatus({silent:true}).catch(() => {});

  // Khởi tạo vùng cuộn queue trước camera để thao tác tablet không bị decode/render nền chặn gesture.
  initScanQueueScroller();

  // Scanner là luồng ưu tiên: không tải bảng lịch sử khi đang ở màn hình camera.
  autoOpenQrCamera().catch(() => {});
  renderScanQueue().catch(() => {});
  startAutoSyncLoop();
  scheduleScanQueueProcessing(900);
});

window.addEventListener('beforeunload', async () => {
  stopQrLiveScan(false); stopCamera('qrStream','qrVideo'); stopCamera('ocrStream','ocrVideo');
  if (state.ocrWorker) { try { await state.ocrWorker.terminate(); } catch(e) {} }
});
