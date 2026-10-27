'use strict';

/*
 * v40 Browser-side offline storage.
 * Cache scope = data source + Factory + 4-character McSerialNumber prefix selected in Settings.
 * Machine master data is NEVER downloaded automatically; only explicit Settings actions write snapshots.
 * Queue remains persistent and duplicate-safe across upgrades/reloads.
 */
(function (global) {
  const DB_NAME = 'kiemke_inventory_offline_' + window.DATA_SCOPE;
  const DB_VERSION = 10;
  const MACHINE_STORE = 'machines';
  const META_STORE = 'meta';
  const QUEUE_STORE = 'scan_queue';
  const MAX_LOOKUP_ROWS = 20;
  const LOCAL_QUEUE_KEY = 'kiemke_scan_queue_backup_v1';
  const MAX_LOCAL_QUEUE_ROWS = 500;

  function normalizeSerial(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function normalizeFactory(value) {
    return String(value || '').trim().toUpperCase();
  }

  function normalizeDeviceCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  }

  function normalizeSource(value) {
    return String(value || '').trim().toLowerCase() === 'mysql' ? 'mysql' : 'mssql';
  }

  function cacheScope(factory, deviceCode, source) {
    const f = normalizeFactory(factory);
    const c = normalizeDeviceCode(deviceCode);
    const s = normalizeSource(source);
    return f && c ? `${s}::${f}::${c}` : '';
  }

  function normalizeQueueUser(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  }

  function queueDedupeCode(payload) {
    const p = payload || {};
    const parsed = p.qr_parsed || {};
    const direct = p.lookup_key || parsed.lookup_ems || parsed.ems || parsed.lookup_serial_full || parsed.device_serial_no || p.qr_text || '';
    return String(p.qr_text || '').split('|')[0].trim() || String(direct).trim();
  }

  function queueScanDay(payload, fallbackDate) {
    const p = payload || {};
    const raw = String(p.inventory_datetime || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const d = fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate || Date.now());
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  }

  function publicMachineRow(source) {
    const row = Object.assign({}, source || {});
    delete row._cache_key;
    delete row.scope_norm;
    delete row.factory_norm;
    delete row.device_code_norm;
    delete row.source_norm;
    delete row.serial_norm;
    return row;
  }

  function requestToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB request failed.')); };
    });
  }

  function txToPromise(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted.')); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction failed.')); };
    });
  }

  let dbPromise = null;

  function configureMachineStore(store) {
    if (!store.indexNames.contains('by_scope_barcode')) store.createIndex('by_scope_barcode', ['scope_norm', 'barcode'], {unique:false});
    if (!store.indexNames.contains('by_barcode')) store.createIndex('by_barcode', 'barcode', {unique:false});
    if (!store.indexNames.contains('by_scope')) store.createIndex('by_scope', 'scope_norm', { unique: false });
    if (!store.indexNames.contains('by_scope_serial')) store.createIndex('by_scope_serial', ['scope_norm', 'serial_norm'], { unique: false });
    if (!store.indexNames.contains('by_serial')) store.createIndex('by_serial', 'serial_norm', { unique: false });
    if (!store.indexNames.contains('by_factory')) store.createIndex('by_factory', 'factory_norm', { unique: false });
    if (!store.indexNames.contains('by_device_code')) store.createIndex('by_device_code', 'device_code_norm', { unique: false });
    if (!store.indexNames.contains('by_source')) store.createIndex('by_source', 'source_norm', { unique: false });
  }

  function configureQueueStore(queue) {
    if (!queue.indexNames.contains('by_created_at')) queue.createIndex('by_created_at', 'created_at', { unique: false });
    if (!queue.indexNames.contains('by_client_scan_id')) queue.createIndex('by_client_scan_id', 'client_scan_id', { unique: false });
    if (!queue.indexNames.contains('by_status')) queue.createIndex('by_status', 'status', { unique: false });
    if (!queue.indexNames.contains('by_user_code')) queue.createIndex('by_user_code', ['scan_user_norm', 'code_norm'], { unique: false });
    if (!queue.indexNames.contains('by_user_code_day')) queue.createIndex('by_user_code_day', ['scan_user_norm', 'code_norm', 'scan_day'], { unique: false });
    if (!queue.indexNames.contains('by_user_department_code_day')) queue.createIndex('by_user_department_code_day', ['scan_user_norm', 'scan_department_norm', 'code_norm', 'scan_day'], { unique: false });
  }

  function openDb() {
    if (!('indexedDB' in global)) return Promise.reject(new Error('Trình duyệt không hỗ trợ IndexedDB.'));
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (event) {
        const db = req.result;
        const upgradeTx = req.transaction;
        const oldVersion = Number(event.oldVersion || 0);

        // Cache is disposable and can be downloaded again. v39 recreates cache stores
        // so MSSQL/MySQL snapshots can never be mixed. Pending scan queue is preserved.
        if (oldVersion < 8) {
          if (db.objectStoreNames.contains(MACHINE_STORE)) db.deleteObjectStore(MACHINE_STORE);
          if (db.objectStoreNames.contains(META_STORE)) db.deleteObjectStore(META_STORE);
        }

        let machines;
        if (!db.objectStoreNames.contains(MACHINE_STORE)) machines = db.createObjectStore(MACHINE_STORE, { keyPath: '_cache_key' });
        else machines = upgradeTx.objectStore(MACHINE_STORE);
        configureMachineStore(machines);

        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'scope_norm' });

        let queue;
        if (!db.objectStoreNames.contains(QUEUE_STORE)) queue = db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
        else queue = upgradeTx.objectStore(QUEUE_STORE);
        configureQueueStore(queue);

        // Normalize queue rows without deleting pending scans.
        try {
          const migrateReq = queue.openCursor();
          migrateReq.onsuccess = function () {
            const cursor = migrateReq.result;
            if (!cursor) return;
            const row = cursor.value || {};
            const payload = row.payload || {};
            const nextUser = normalizeQueueUser(payload.scan_user || '');
            const nextDepartment = normalizeQueueUser(payload.scan_department || '');
            const nextCode = queueDedupeCode(payload);
            const nextDay = queueScanDay(payload, row.created_at || row.updated_at || '');
            let changed = false;
            if (row.scan_user_norm !== nextUser) { row.scan_user_norm = nextUser; changed = true; }
            if (row.scan_department_norm !== nextDepartment) { row.scan_department_norm = nextDepartment; changed = true; }
            if (row.code_norm !== nextCode) { row.code_norm = nextCode; changed = true; }
            if (row.scan_day !== nextDay) { row.scan_day = nextDay; changed = true; }
            if (!Number(row.scan_revision || 0)) { row.scan_revision = 1; changed = true; }
            if (!Number.isFinite(Number(row.duplicate_count))) { row.duplicate_count = 0; changed = true; }
            if (changed) cursor.update(row);
            cursor.continue();
          };
        } catch (_) {}
      };

      req.onsuccess = function () {
        const db = req.result;
        db.onversionchange = function () { try { db.close(); } catch (_) {} dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { dbPromise = null; reject(req.error || new Error('Không mở được IndexedDB.')); };
      req.onblocked = function () { reject(new Error('IndexedDB đang bị khóa bởi tab khác. Hãy đóng tab cũ và thử lại.')); };
    });
    return dbPromise;
  }

  async function deleteScopeMachines(factory, deviceCode, source) {
    const scopeNorm = cacheScope(factory, deviceCode, source);
    if (!scopeNorm) return;
    const db = await openDb();
    const tx = db.transaction(MACHINE_STORE, 'readwrite');
    const store = tx.objectStore(MACHINE_STORE);
    const index = store.index('by_scope');
    const req = index.openKeyCursor(IDBKeyRange.only(scopeNorm));
    req.onsuccess = function () {
      const cursor = req.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    await txToPromise(tx);
  }

  async function deleteScopeMeta(factory, deviceCode, source) {
    const scopeNorm = cacheScope(factory, deviceCode, source);
    if (!scopeNorm) return;
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).delete(scopeNorm);
    await txToPromise(tx);
  }

  async function putMachineBatch(factory, deviceCode, rows, startIndex, source) {
    const factoryNorm = normalizeFactory(factory);
    const deviceCodeNorm = normalizeDeviceCode(deviceCode);
    const sourceNorm = normalizeSource(source);
    const scopeNorm = cacheScope(factoryNorm, deviceCodeNorm, sourceNorm);
    const db = await openDb();
    const tx = db.transaction(MACHINE_STORE, 'readwrite');
    const store = tx.objectStore(MACHINE_STORE);
    rows.forEach(function (sourceRow, localIndex) {
      const row = Object.assign({}, sourceRow || {});
      const serialNorm = normalizeSerial(row.McSerialNumber || '');
      if (!serialNorm || serialNorm.slice(0, 4) !== deviceCodeNorm) return;
      row.scope_norm = scopeNorm;
      row.factory_norm = factoryNorm;
      row.device_code_norm = deviceCodeNorm;
      row.source_norm = sourceNorm;
      row.serial_norm = serialNorm;
      row._cache_key = scopeNorm + '|' + serialNorm + '|' + String(startIndex + localIndex);
      store.put(row);
    });
    await txToPromise(tx);
  }

  async function replaceScopeCache(factory, deviceCode, rows, metadata) {
    const factoryText = String(factory || '').trim();
    const codeText = normalizeDeviceCode(deviceCode);
    const factoryNorm = normalizeFactory(factoryText);
    const sourceNorm = normalizeSource(metadata && (metadata.data_source || metadata.source));
    const scopeNorm = cacheScope(factoryNorm, codeText, sourceNorm);
    if (!factoryNorm) throw new Error('Chưa xác định xưởng để lưu cache.');
    if (!codeText) throw new Error('Chưa chọn loại thiết bị để lưu cache.');
    if (!Array.isArray(rows)) throw new Error('Dữ liệu cache không hợp lệ.');

    await deleteScopeMachines(factoryNorm, codeText, sourceNorm);
    await deleteScopeMeta(factoryNorm, codeText, sourceNorm);
    const BATCH = 750;
    for (let i = 0; i < rows.length; i += BATCH) await putMachineBatch(factoryText, codeText, rows.slice(i, i + BATCH), i, sourceNorm);

    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readwrite');
    const meta = Object.assign({
      scope_norm: scopeNorm,
      factory: factoryText,
      factory_norm: factoryNorm,
      device_code: codeText,
      device_code_norm: codeText,
      source: sourceNorm,
      data_source: sourceNorm,
      source_norm: sourceNorm,
      row_count: rows.length,
      cached_at: new Date().toISOString(),
      schema_version: 5
    }, metadata || {});
    meta.scope_norm = scopeNorm;
    meta.factory = factoryText;
    meta.factory_norm = factoryNorm;
    meta.device_code = codeText;
    meta.device_code_norm = codeText;
    meta.source = sourceNorm;
    meta.data_source = sourceNorm;
    meta.source_norm = sourceNorm;
    meta.row_count = rows.length;
    tx.objectStore(META_STORE).put(meta);
    await txToPromise(tx);
    return meta;
  }

  async function replaceFactoryCache(factory, rows, metadata) {
    return replaceScopeCache(factory, metadata && metadata.device_code ? metadata.device_code : 'COMP', rows, metadata);
  }

  async function deleteScopeCache(factory, deviceCode, source) {
    await deleteScopeMachines(factory, deviceCode, source);
    await deleteScopeMeta(factory, deviceCode, source);
  }

  async function deleteFactoryCache(factory, deviceCode, source) {
    if (deviceCode) return deleteScopeCache(factory, deviceCode, source);
    const metas = await listMeta();
    const f = normalizeFactory(factory);
    const src = normalizeSource(source);
    for (const m of metas) if (normalizeFactory(m.factory) === f && normalizeSource(m.data_source || m.source) === src) await deleteScopeCache(m.factory, m.device_code, src);
  }

  async function deleteAllMachineCaches() {
    const db = await openDb();
    const tx = db.transaction([MACHINE_STORE, META_STORE], 'readwrite');
    tx.objectStore(MACHINE_STORE).clear();
    tx.objectStore(META_STORE).clear();
    await txToPromise(tx);
  }

  async function getMeta(factory, deviceCode, source) {
    const scopeNorm = cacheScope(factory, deviceCode || 'COMP', source);
    if (!scopeNorm) return null;
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readonly');
    return requestToPromise(tx.objectStore(META_STORE).get(scopeNorm));
  }

  async function listMeta() {
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);
    if (typeof store.getAll === 'function') {
      const rows = await requestToPromise(store.getAll());
      return Array.isArray(rows) ? rows : [];
    }
    return new Promise(function (resolve, reject) {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = function () { const cursor = req.result; if (!cursor) { resolve(out); return; } out.push(cursor.value); cursor.continue(); };
      req.onerror = function () { reject(req.error || new Error('Không đọc được metadata cache.')); };
    });
  }

  async function cacheStats(source) {
    const src = source ? normalizeSource(source) : '';
    const metas = (await listMeta()).filter(function(m){ return !src || normalizeSource(m.data_source || m.source) === src; });
    return {
      scope_count: metas.length,
      factory_count: new Set(metas.map(function (m) { return normalizeFactory(m.factory); }).filter(Boolean)).size,
      row_count: metas.reduce(function (sum, m) { return sum + Number(m.row_count || 0); }, 0),
      metas: metas
    };
  }

  async function getAllByIndex(index, range, limit) {
    if (typeof index.getAll === 'function') {
      const rows = await requestToPromise(index.getAll(range, limit));
      return Array.isArray(rows) ? rows : [];
    }
    return new Promise(function (resolve, reject) {
      const out = [];
      const req = index.openCursor(range);
      req.onsuccess = function () { const cursor = req.result; if (!cursor || out.length >= limit) { resolve(out); return; } out.push(cursor.value); cursor.continue(); };
      req.onerror = function () { reject(req.error || new Error('Không đọc được cache.')); };
    });
  }

  async function lookup(factory, deviceCode, candidate, limit, source) {
    const sourceNorm = normalizeSource(source);
    const scopeNorm = cacheScope(factory, deviceCode, sourceNorm);
    const serialNorm = normalizeSerial(candidate);
    const maxRows = Math.max(1, Math.min(Number(limit) || MAX_LOOKUP_ROWS, MAX_LOOKUP_ROWS));
    if (!scopeNorm || !String(candidate||'').trim()) return [];
    const meta = await getMeta(factory, deviceCode, sourceNorm);
    if (!meta) return [];

    const db = await openDb();
    const exactTx=db.transaction(MACHINE_STORE,'readonly');
    const exact=await getAllByIndex(exactTx.objectStore(MACHINE_STORE).index('by_scope_barcode'),IDBKeyRange.only([scopeNorm,String(candidate||'').trim()]),maxRows);
    if(exact.length)return exact.map(publicMachineRow);
    if(!serialNorm)return [];
    let tx = db.transaction(MACHINE_STORE, 'readonly');
    let index = tx.objectStore(MACHINE_STORE).index('by_scope_serial');
    let rows = await getAllByIndex(index, IDBKeyRange.only([scopeNorm, serialNorm]), maxRows);
    if (rows.length) return rows.slice(0, maxRows).map(publicMachineRow);

    tx = db.transaction(MACHINE_STORE, 'readonly');
    index = tx.objectStore(MACHINE_STORE).index('by_scope_serial');
    rows = await getAllByIndex(index, IDBKeyRange.bound([scopeNorm, serialNorm], [scopeNorm, serialNorm + '\uffff']), maxRows);
    if (rows.length) return rows.slice(0, maxRows).map(publicMachineRow);

    tx = db.transaction(MACHINE_STORE, 'readonly');
    const scopeIndex = tx.objectStore(MACHINE_STORE).index('by_scope');
    return new Promise(function (resolve, reject) {
      const out = [];
      const req = scopeIndex.openCursor(IDBKeyRange.only(scopeNorm));
      req.onsuccess = function () {
        const cursor = req.result;
        if (!cursor || out.length >= maxRows) { resolve(out); return; }
        const row = cursor.value || {};
        if (String(row.serial_norm || '').indexOf(serialNorm) >= 0) out.push(publicMachineRow(row));
        cursor.continue();
      };
      req.onerror = function () { reject(req.error || new Error('Không tra cứu được cache offline.')); };
    });
  }

  async function lookupAny(candidate, limit, deviceCode, source) {
    const serialNorm = normalizeSerial(candidate);
    const codeNorm = normalizeDeviceCode(deviceCode || '');
    const sourceNorm = normalizeSource(source);
    const maxRows = Math.max(1, Math.min(Number(limit) || MAX_LOOKUP_ROWS, MAX_LOOKUP_ROWS));
    if (!String(candidate||'').trim()) return [];
    const db = await openDb();
    const exactTx=db.transaction(MACHINE_STORE,'readonly');
    const exact=(await getAllByIndex(exactTx.objectStore(MACHINE_STORE).index('by_barcode'),IDBKeyRange.only(String(candidate||'').trim()),maxRows*8)).filter(r=>(!codeNorm||r.device_code_norm===codeNorm)&&normalizeSource(r.source_norm)===sourceNorm);
    if(exact.length)return exact.slice(0,maxRows).map(publicMachineRow);
    if(!serialNorm)return [];
    let tx = db.transaction(MACHINE_STORE, 'readonly');
    let index = tx.objectStore(MACHINE_STORE).index('by_serial');
    let rows = await getAllByIndex(index, IDBKeyRange.only(serialNorm), maxRows * 8);
    rows = rows.filter(function (r) { return (!codeNorm || r.device_code_norm === codeNorm) && normalizeSource(r.source_norm) === sourceNorm; });
    if (rows.length) return rows.slice(0, maxRows).map(publicMachineRow);

    tx = db.transaction(MACHINE_STORE, 'readonly');
    index = tx.objectStore(MACHINE_STORE).index('by_serial');
    rows = await getAllByIndex(index, IDBKeyRange.bound(serialNorm, serialNorm + '\uffff'), maxRows * 8);
    rows = rows.filter(function (r) { return (!codeNorm || r.device_code_norm === codeNorm) && normalizeSource(r.source_norm) === sourceNorm; });
    if (rows.length) return rows.slice(0, maxRows).map(publicMachineRow);

    tx = db.transaction(MACHINE_STORE, 'readonly');
    index = tx.objectStore(MACHINE_STORE).index('by_serial');
    return new Promise(function (resolve, reject) {
      const out = [];
      const req = index.openCursor();
      req.onsuccess = function () {
        const cursor = req.result;
        if (!cursor || out.length >= maxRows) { resolve(out); return; }
        const row = cursor.value || {};
        if (normalizeSource(row.source_norm) === sourceNorm && (!codeNorm || row.device_code_norm === codeNorm) && String(row.serial_norm || '').indexOf(serialNorm) >= 0) out.push(publicMachineRow(row));
        cursor.continue();
      };
      req.onerror = function () { reject(req.error || new Error('Không tra cứu được cache toàn bộ phạm vi.')); };
    });
  }

  async function getQueuedByClientScanId(clientScanId) {
    clientScanId = String(clientScanId || '').trim();
    if (!clientScanId) return null;
    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    const store = tx.objectStore(QUEUE_STORE);
    if (!store.indexNames.contains('by_client_scan_id')) return null;
    return requestToPromise(store.index('by_client_scan_id').get(clientScanId));
  }

  async function enqueueQr(payload, extra) {
    const payloadCopy = Object.assign({}, payload || {});
    const clientScanId = String(payloadCopy.client_scan_id || '').trim();
    if (clientScanId) {
      const existing = await getQueuedByClientScanId(clientScanId);
      if (existing) return existing;
    }

    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const extraCopy = Object.assign({}, extra || {});
    const nowIso = new Date().toISOString();
    const record = {
      created_at: nowIso,
      updated_at: nowIso,
      client_scan_id: clientScanId,
      scan_user_norm: normalizeQueueUser(payloadCopy.scan_user || ''),
      scan_department_norm: normalizeQueueUser(payloadCopy.scan_department || ''),
      code_norm: queueDedupeCode(payloadCopy),
      scan_day: queueScanDay(payloadCopy, nowIso),
      scan_revision: 1,
      duplicate_count: 0,
      status: String(extraCopy.status || 'pending_sync'),
      attempt_count: 0,
      last_error: '',
      payload: payloadCopy,
      extra: extraCopy
    };
    // Images are intentionally excluded from the offline queue to protect device storage.
    if (Object.prototype.hasOwnProperty.call(record.payload, 'image_data_url')) {
      record.payload.image_data_url = '';
    }
    const done = txToPromise(tx);
    const id = await requestToPromise(tx.objectStore(QUEUE_STORE).add(record));
    await done;
    record.id = id;
    return record;
  }

  async function enqueueOrRefreshQr(payload, extra) {
    const payloadCopy = Object.assign({}, payload || {});
    const extraCopy = Object.assign({}, extra || {});
    const clientScanId = String(payloadCopy.client_scan_id || '').trim();
    const userNorm = normalizeQueueUser(payloadCopy.scan_user || '');
    const departmentNorm = normalizeQueueUser(payloadCopy.scan_department || '');
    const codeNorm = queueDedupeCode(payloadCopy);
    const scanDay = queueScanDay(payloadCopy, new Date());

    // Nếu thiếu identity/ngày scan đáng tin cậy, dùng enqueue thường để không merge nhầm dữ liệu.
    if (!userNorm || !codeNorm || !scanDay) return enqueueQr(payloadCopy, extraCopy);

    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      const index = store.index('by_user_department_code_day');
      const nowIso = new Date().toISOString();
      const req = index.get(IDBKeyRange.only([userNorm, departmentNorm, codeNorm, scanDay]));
      let saved = null;
      let refreshed = false;
      let failed = false;

      req.onsuccess = function () {
        const existing = req.result || null;
        let record;
        if (existing) {
          refreshed = true;
          record = Object.assign({}, existing);
          record.created_at = nowIso; // latest physical scan time shown in the queue
          record.updated_at = nowIso;
          record.client_scan_id = clientScanId;
          record.scan_user_norm = userNorm;
          record.scan_department_norm = departmentNorm;
          record.code_norm = codeNorm;
          record.scan_day = scanDay;
          record.scan_revision = Number(existing.scan_revision || 1) + 1;
          record.duplicate_count = Number(existing.duplicate_count || 0) + 1;
          record.status = String(extraCopy.status || 'captured');
          record.attempt_count = 0;
          record.last_error = '';
          record.payload = Object.assign({}, existing.payload || {}, payloadCopy);
          record.extra = Object.assign({}, existing.extra || {}, extraCopy, {
            duplicate_refreshed_at: nowIso,
            duplicate_count: Number(existing.duplicate_count || 0) + 1
          });
          // Do not keep image blobs in IndexedDB.
          if (Object.prototype.hasOwnProperty.call(record.payload, 'image_data_url')) record.payload.image_data_url = '';
          store.put(record);
        } else {
          record = {
            created_at: nowIso,
            updated_at: nowIso,
            client_scan_id: clientScanId,
            scan_user_norm: userNorm,
            scan_department_norm: departmentNorm,
            code_norm: codeNorm,
            scan_day: scanDay,
            scan_revision: 1,
            duplicate_count: 0,
            status: String(extraCopy.status || 'captured'),
            attempt_count: 0,
            last_error: '',
            payload: payloadCopy,
            extra: extraCopy
          };
          if (Object.prototype.hasOwnProperty.call(record.payload, 'image_data_url')) record.payload.image_data_url = '';
          const addReq = store.add(record);
          addReq.onsuccess = function () { record.id = addReq.result; };
          addReq.onerror = function () {
            failed = true;
            reject(addReq.error || new Error('Không thêm được QR vào hàng đợi offline.'));
            try { tx.abort(); } catch (_) {}
          };
        }
        saved = record;
      };
      req.onerror = function () {
        failed = true;
        reject(req.error || new Error('Không kiểm tra được QR trùng trong hàng đợi.'));
        try { tx.abort(); } catch (_) {}
      };
      tx.oncomplete = function () {
        if (failed) return;
        if (saved) {
          const out = Object.assign({}, saved);
          out._queue_refreshed = refreshed;
          resolve(out);
        } else {
          reject(new Error('Không cập nhật được hàng đợi QR.'));
        }
      };
      tx.onerror = function () { if (!failed) reject(tx.error || new Error('Không cập nhật được hàng đợi QR.')); };
      tx.onabort = function () { if (!failed) reject(tx.error || new Error('Giao dịch hàng đợi QR đã bị hủy.')); };
    });
  }

  async function listQueue() {
    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    const store = tx.objectStore(QUEUE_STORE);
    if (typeof store.getAll === 'function') {
      const rows = await requestToPromise(store.getAll());
      return Array.isArray(rows) ? rows.sort(function (a, b) { return Number(a.id || 0) - Number(b.id || 0); }) : [];
    }
    return new Promise(function (resolve, reject) {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = function () {
        const cursor = req.result;
        if (!cursor) { resolve(out); return; }
        out.push(cursor.value);
        cursor.continue();
      };
      req.onerror = function () { reject(req.error || new Error('Không đọc được hàng đợi offline.')); };
    });
  }

  async function compactQueueDuplicates() {
    const rows = await listQueue();
    const groups = new Map();
    rows.forEach(function (row) {
      const payload = row && row.payload ? row.payload : {};
      const userNorm = String(row.scan_user_norm || normalizeQueueUser(payload.scan_user || '')).trim();
      const departmentNorm = String(row.scan_department_norm || normalizeQueueUser(payload.scan_department || '')).trim();
      const codeNorm = String(row.code_norm || queueDedupeCode(payload)).trim();
      const scanDay = String(row.scan_day || queueScanDay(payload, row.created_at || row.updated_at || '')).trim();
      if (!userNorm || !codeNorm || !scanDay) return;
      const key = userNorm + '|' + departmentNorm + '|' + codeNorm + '|' + scanDay;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    let removed = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort(function (a, b) {
        const at = Date.parse(a.created_at || a.updated_at || '') || 0;
        const bt = Date.parse(b.created_at || b.updated_at || '') || 0;
        if (at !== bt) return bt - at;
        return Number(b.id || 0) - Number(a.id || 0);
      });
      const keep = group[0];
      const extras = group.slice(1);
      const repeatCount = group.reduce(function (sum, row) {
        return sum + Number(row.duplicate_count || 0);
      }, 0) + extras.length;
      await updateQueueItem(keep.id, {
        scan_user_norm: keep.scan_user_norm || normalizeQueueUser((keep.payload || {}).scan_user || ''),
        code_norm: keep.code_norm || queueDedupeCode(keep.payload || {}),
        scan_day: keep.scan_day || queueScanDay(keep.payload || {}, keep.created_at || keep.updated_at || ''),
        duplicate_count: repeatCount,
        extra: { duplicate_count: repeatCount, compacted_at: new Date().toISOString() }
      });
      for (const old of extras) {
        await deleteQueueItem(old.id);
        removed++;
      }
    }
    return {removed: removed, remaining: rows.length - removed};
  }

  async function deleteQueueItem(id) {
    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    tx.objectStore(QUEUE_STORE).delete(Number(id));
    await txToPromise(tx);
  }

  async function getQueueItem(id) {
    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    return requestToPromise(tx.objectStore(QUEUE_STORE).get(Number(id)));
  }

  async function updateQueueItem(id, patch) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      const req = store.get(Number(id));
      let next = null;
      let failed = false;

      req.onsuccess = function () {
        const current = req.result;
        if (!current) return;
        next = Object.assign({}, current, patch || {});
        if (patch && patch.payload) next.payload = Object.assign({}, current.payload || {}, patch.payload || {});
        if (patch && patch.extra) next.extra = Object.assign({}, current.extra || {}, patch.extra || {});
        next.updated_at = new Date().toISOString();
        try {
          store.put(next);
        } catch (e) {
          failed = true;
          reject(e);
          try { tx.abort(); } catch (_) {}
        }
      };
      req.onerror = function () {
        failed = true;
        reject(req.error || new Error('Không đọc được hàng đợi offline.'));
        try { tx.abort(); } catch (_) {}
      };
      tx.oncomplete = function () { if (!failed) resolve(next); };
      tx.onerror = function () { if (!failed) reject(tx.error || new Error('Không cập nhật được hàng đợi offline.')); };
      tx.onabort = function () { if (!failed) reject(tx.error || new Error('Giao dịch hàng đợi offline đã bị hủy.')); };
    });
  }

  async function listQueueByStatus(statuses) {
    const wanted = new Set((Array.isArray(statuses) ? statuses : [statuses]).map(function (x) { return String(x || ''); }).filter(Boolean));
    const rows = await listQueue();
    if (!wanted.size) return rows;
    return rows.filter(function (row) { return wanted.has(String(row.status || 'pending_sync')); });
  }

  async function queueCount() {
    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    return requestToPromise(tx.objectStore(QUEUE_STORE).count());
  }

  async function requestPersistentStorage() {
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') return false;
    try { return !!(await navigator.storage.persist()); } catch (_) { return false; }
  }

  async function storageEstimate() {
    if (!navigator.storage || typeof navigator.storage.estimate !== 'function') return null;
    try { return await navigator.storage.estimate(); } catch (_) { return null; }
  }

  function readLocalQueue() {
    try {
      const parsed = JSON.parse(scopedStorage.getItem(LOCAL_QUEUE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(function (row) { return row && Number.isFinite(Number(row.id)); }) : [];
    } catch (_) { return []; }
  }

  function writeLocalQueue(rows, required) {
    try {
      const clean = (Array.isArray(rows) ? rows : []).slice(-MAX_LOCAL_QUEUE_ROWS).map(function (row) {
        const copy = Object.assign({}, row || {});
        copy.payload = Object.assign({}, copy.payload || {});
        copy.extra = Object.assign({}, copy.extra || {});
        copy.payload.image_data_url = '';
        return copy;
      });
      scopedStorage.setItem(LOCAL_QUEUE_KEY, JSON.stringify(clean));
      return true;
    } catch (e) {
      if (required) throw new Error('Không thể lưu bản scan vào localStorage: ' + (e.message || 'storage full'));
      return false;
    }
  }

  function localQueueId() {
    return -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
  }

  function localUpsert(record, required) {
    const rows = readLocalQueue();
    const id = Number(record && record.id);
    const idx = rows.findIndex(function (row) { return Number(row.id) === id; });
    if (idx >= 0) rows[idx] = record; else rows.push(record);
    writeLocalQueue(rows, required);
    return record;
  }

  function localDelete(id) {
    const wanted = Number(id);
    writeLocalQueue(readLocalQueue().filter(function (row) { return Number(row.id) !== wanted; }), false);
  }

  function localEnqueue(payload, extra, refreshDuplicate) {
    const payloadCopy = Object.assign({}, payload || {});
    payloadCopy.image_data_url = '';
    const extraCopy = Object.assign({}, extra || {});
    const nowIso = new Date().toISOString();
    const userNorm = normalizeQueueUser(payloadCopy.scan_user || '');
    const departmentNorm = normalizeQueueUser(payloadCopy.scan_department || '');
    const codeNorm = queueDedupeCode(payloadCopy);
    const scanDay = queueScanDay(payloadCopy, nowIso);
    const rows = readLocalQueue();
    let existing = null;
    if (refreshDuplicate && userNorm && codeNorm && scanDay) {
      existing = rows.find(function (row) {
        return String(row.scan_user_norm || '') === userNorm && String(row.scan_department_norm || '') === departmentNorm && String(row.code_norm || '') === codeNorm && String(row.scan_day || '') === scanDay;
      }) || null;
    }
    if (!existing && payloadCopy.client_scan_id) {
      existing = rows.find(function (row) { return String(row.client_scan_id || '') === String(payloadCopy.client_scan_id); }) || null;
    }
    let record;
    if (existing) {
      record = Object.assign({}, existing, {
        created_at: refreshDuplicate ? nowIso : existing.created_at,
        updated_at: nowIso,
        client_scan_id: String(payloadCopy.client_scan_id || existing.client_scan_id || ''),
        scan_user_norm: userNorm,
        scan_department_norm: departmentNorm,
        code_norm: codeNorm,
        scan_day: scanDay,
        scan_revision: Number(existing.scan_revision || 1) + (refreshDuplicate ? 1 : 0),
        duplicate_count: Number(existing.duplicate_count || 0) + (refreshDuplicate ? 1 : 0),
        status: String(extraCopy.status || existing.status || 'pending_sync'),
        last_error: '',
        payload: Object.assign({}, existing.payload || {}, payloadCopy),
        extra: Object.assign({}, existing.extra || {}, extraCopy, {storage_backend:'localStorage'})
      });
    } else {
      record = {
        id: localQueueId(), created_at: nowIso, updated_at: nowIso,
        client_scan_id: String(payloadCopy.client_scan_id || ''),
        scan_user_norm: userNorm, scan_department_norm: departmentNorm, code_norm: codeNorm, scan_day: scanDay,
        scan_revision: 1, duplicate_count: 0,
        status: String(extraCopy.status || 'pending_sync'), attempt_count: 0, last_error: '',
        payload: payloadCopy, extra: Object.assign({}, extraCopy, {storage_backend:'localStorage'})
      };
    }
    localUpsert(record, true);
    const out = Object.assign({}, record);
    out._queue_refreshed = !!existing && !!refreshDuplicate;
    return out;
  }

  async function resilientEnqueueQr(payload, extra) {
    try {
      const record = await enqueueQr(payload, extra);
      localUpsert(record, false);
      return record;
    } catch (_) { return localEnqueue(payload, extra, false); }
  }

  async function resilientEnqueueOrRefreshQr(payload, extra) {
    try {
      const record = await enqueueOrRefreshQr(payload, extra);
      localUpsert(record, false);
      return record;
    } catch (_) { return localEnqueue(payload, extra, true); }
  }

  async function resilientListQueue() {
    const local = readLocalQueue();
    let dbRows = [];
    try { dbRows = await listQueue(); } catch (_) { return local.sort(function(a,b){return Number(a.id)-Number(b.id);}); }
    const byIdentity = new Map();
    dbRows.concat(local).forEach(function (row) {
      const identity = String(row.client_scan_id || '') || ('id:' + Number(row.id));
      const previous = byIdentity.get(identity);
      if (!previous || Date.parse(row.updated_at || row.created_at || '') >= Date.parse(previous.updated_at || previous.created_at || '')) byIdentity.set(identity, row);
    });
    const merged = Array.from(byIdentity.values()).sort(function(a,b){return Number(a.id)-Number(b.id);});
    writeLocalQueue(merged, false);
    return merged;
  }

  async function resilientGetQueueItem(id) {
    try {
      const row = await getQueueItem(id);
      if (row) return row;
    } catch (_) {}
    return readLocalQueue().find(function (row) { return Number(row.id) === Number(id); }) || null;
  }

  async function resilientGetQueuedByClientScanId(clientScanId) {
    try {
      const row = await getQueuedByClientScanId(clientScanId);
      if (row) return row;
    } catch (_) {}
    return readLocalQueue().find(function (row) { return String(row.client_scan_id || '') === String(clientScanId || ''); }) || null;
  }

  async function resilientUpdateQueueItem(id, patch) {
    let row = null;
    try { row = await updateQueueItem(id, patch); } catch (_) {}
    if (!row) {
      const current = await resilientGetQueueItem(id);
      if (!current) return null;
      row = Object.assign({}, current, patch || {});
      if (patch && patch.payload) row.payload = Object.assign({}, current.payload || {}, patch.payload || {});
      if (patch && patch.extra) row.extra = Object.assign({}, current.extra || {}, patch.extra || {});
      row.updated_at = new Date().toISOString();
    }
    localUpsert(row, true);
    return row;
  }

  async function resilientDeleteQueueItem(id) {
    try { await deleteQueueItem(id); } catch (_) {}
    localDelete(id);
  }

  async function resilientQueueCount() { return (await resilientListQueue()).length; }

  async function resilientListQueueByStatus(statuses) {
    const wanted = new Set((Array.isArray(statuses) ? statuses : [statuses]).map(String));
    const rows = await resilientListQueue();
    return wanted.size ? rows.filter(function(row){ return wanted.has(String(row.status || 'pending_sync')); }) : rows;
  }

  async function resilientCompactQueueDuplicates() {
    const rows = await resilientListQueue();
    const groups = new Map();
    rows.forEach(function (row) {
      const payload = row && row.payload ? row.payload : {};
      const key = String(row.scan_user_norm || normalizeQueueUser(payload.scan_user || '')) + '|' +
        String(row.scan_department_norm || normalizeQueueUser(payload.scan_department || '')) + '|' +
        String(row.code_norm || queueDedupeCode(payload)) + '|' +
        String(row.scan_day || queueScanDay(payload, row.created_at || row.updated_at || ''));
      if (key === '||') return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    let removed = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort(function(a,b){ return (Date.parse(b.updated_at || b.created_at || '') || 0) - (Date.parse(a.updated_at || a.created_at || '') || 0); });
      const keep = group[0];
      const duplicates = group.slice(1);
      await resilientUpdateQueueItem(keep.id, {duplicate_count:Number(keep.duplicate_count || 0) + duplicates.length});
      for (const row of duplicates) { await resilientDeleteQueueItem(row.id); removed++; }
    }
    return {removed:removed, remaining:rows.length-removed};
  }

  global.InventoryOffline = {
    normalizeSerial: normalizeSerial,
    normalizeFactory: normalizeFactory,
    normalizeDeviceCode: normalizeDeviceCode,
    normalizeSource: normalizeSource,
    cacheScope: cacheScope,
    replaceScopeCache: replaceScopeCache,
    replaceFactoryCache: replaceFactoryCache,
    deleteScopeCache: deleteScopeCache,
    deleteFactoryCache: deleteFactoryCache,
    deleteAllMachineCaches: deleteAllMachineCaches,
    getMeta: getMeta,
    listMeta: listMeta,
    cacheStats: cacheStats,
    lookup: lookup,
    lookupAny: lookupAny,
    enqueueQr: resilientEnqueueQr,
    enqueueOrRefreshQr: resilientEnqueueOrRefreshQr,
    listQueue: resilientListQueue,
    compactQueueDuplicates: resilientCompactQueueDuplicates,
    deleteQueueItem: resilientDeleteQueueItem,
    getQueueItem: resilientGetQueueItem,
    getQueuedByClientScanId: resilientGetQueuedByClientScanId,
    updateQueueItem: resilientUpdateQueueItem,
    listQueueByStatus: resilientListQueueByStatus,
    queueCount: resilientQueueCount,
    requestPersistentStorage: requestPersistentStorage,
    storageEstimate: storageEstimate
  };
})(window);
