import {APP_VERSION} from './version.js';
import {BUILD_INFO} from './build-info.js';
import {hashPassword as password, normalizeSetupToken} from './auth.js';
import {buildAssets,clean,localDay,candidates,scanInstant,normalizeTable,csvCell} from './core.js';
const json=(data={},status=200,message='')=>Response.json({ok:status<400,message,data},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(s,m)=>{throw Object.assign(Error(m),{status:s})};
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
async function digest(s){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))}

const all=async(db,q,...v)=>(await db.prepare(q).bind(...v).all()).results;
const one=(db,q,...v)=>db.prepare(q).bind(...v).first();
const run=(db,q,...v)=>db.prepare(q).bind(...v).run();
const admin=u=>{if(u.role!=='admin')fail(403,'Chỉ admin được thực hiện')};
const manage=u=>{if(!['admin','manager'].includes(u.role))fail(403,'Không có quyền quản trị site')};
function record(r){return {...JSON.parse(r.data),id:r.id}}
const application = {async fetch(req,env){try{
 const url=new URL(req.url),p=url.pathname,db=env.DB;
 if(req.method!=='GET'&&req.headers.get('Origin')&&req.headers.get('Origin')!==url.origin)fail(403,'Origin không hợp lệ');
 if(Number(req.headers.get('content-length')||0)>2000000)fail(413,'Request quá lớn');
 let b={};
 const publicFiles=['/login.html','/ui.css','/version.json'];
 const isStatic=publicFiles.includes(p)||p.startsWith('/assets/');
 if(isStatic){if(!['GET','HEAD'].includes(req.method))fail(405,'Method không hợp lệ');return env.ASSETS.fetch(req)}
 const mutating=['/auth/bootstrap','/auth/login','/auth/logout','/api/user-status','/api/password'];
 const mutateActions=['setUser','pushQr','pushTable','deleteRecord','updateRecordTable','updateQrComment'];
 if((mutating.includes(p)||(p==='/api.php'&&mutateActions.includes(url.searchParams.get('action')))||(p==='/machine_api.php'&&['lookupQr','downloadCache','listFactories'].includes(url.searchParams.get('action'))))&&req.method!=='POST')fail(405,'Yêu cầu POST');
 if(!['GET','HEAD','POST'].includes(req.method))fail(405,'Method không hợp lệ');
 if(req.method==='POST'){const raw=await req.text();if(new TextEncoder().encode(raw).length>2000000)fail(413,'Request quá lớn');try{b=JSON.parse(raw)}catch{fail(400,'JSON không hợp lệ')}if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'JSON phải là object');}

 if(p==='/health/version'){if(req.method!=='GET')fail(405,'Yêu cầu GET');return Response.json(BUILD_INFO,{headers:{'Cache-Control':'no-store'}})}
 if(p==='/auth/setup-status'){
 if(req.method!=='GET')fail(405,'Yêu cầu GET');
 if(!db)return json({code:'D1_BINDING_MISSING',version:APP_VERSION},503,'Worker chưa có D1 binding tên DB.');
 try {
 const existing=await one(db,"SELECT id FROM users WHERE role='admin' LIMIT 1");
 return json({version:APP_VERSION,admin_exists:!!existing,token_configured:!!normalizeSetupToken(env.SETUP_TOKEN),database_ready:true});
 } catch { return json({code:'D1_SCHEMA_NOT_READY',version:APP_VERSION},503,'Chưa đọc được bảng users. Kiểm tra binding DB và chạy migration.'); }
 }
 if(p==='/auth/bootstrap'){
 const configured=normalizeSetupToken(env.SETUP_TOKEN),submitted=normalizeSetupToken(b.token);
 if(!configured)return json({code:'SETUP_TOKEN_MISSING'},503,'Worker đang chạy chưa nhận SETUP_TOKEN. Thêm biến runtime vào đúng Production và Deploy thay đổi.');
 if(!submitted)return json({code:'SETUP_TOKEN_EMPTY'},400,'Ô token khởi tạo đang trống. Nhập Value của SETUP_TOKEN, không nhập tên biến hoặc mật khẩu admin.');
 if(submitted!==configured)return json({code:'SETUP_TOKEN_MISMATCH'},403,'Token nhập vào không khớp SETUP_TOKEN của Worker đang chạy. Kiểm tra Value và URL Production.');
 if(!db)return json({code:'D1_BINDING_MISSING'},503,'Worker chưa có D1 binding tên DB.');
 if(typeof b.password!=='string'||b.password.length<12||b.password.length>256)fail(400,'Mật khẩu admin cần 12–256 ký tự');
 const username=clean(b.username)||'admin';if(username.length>100)fail(400,'Tên đăng nhập tối đa 100 ký tự');
 if(await one(db,"SELECT id FROM users WHERE role='admin' LIMIT 1"))return json({code:'ADMIN_ALREADY_EXISTS'},409,'Đã có admin trong database này. Dùng form Đăng nhập; khởi tạo không đổi mật khẩu admin cũ.');
 const id=crypto.randomUUID(),hash=await password(b.password);
 const result=await run(db,"INSERT INTO users(id,username,password,role,site_id,department,active) SELECT ?,?,?,'admin',NULL,'',1 WHERE NOT EXISTS(SELECT 1 FROM users WHERE role='admin')",id,username,hash);
 if(result.meta.changes!==1)return json({code:'ADMIN_ALREADY_EXISTS'},409,'Một yêu cầu khác đã tạo admin. Hãy đăng nhập bằng tài khoản đã tạo.');
 const created=await one(db,"SELECT id,username,role,active FROM users WHERE id=? AND role='admin'",id);
 if(!created)return json({code:'ADMIN_VERIFY_FAILED'},500,'Không xác nhận được admin vừa ghi. Kiểm tra đúng D1 đang bind với Worker.');
 return json({created:true,username:created.username,role:created.role,code:'ADMIN_CREATED'},201,'Đã tạo và xác nhận admin trong database. Bây giờ dùng form Đăng nhập phía trên.');
 }
 if(p==='/auth/login'){
 if(!await one(db,"SELECT id FROM users LIMIT 1"))return json({code:'ADMIN_NOT_INITIALIZED'},409,'Database chưa có tài khoản. Khởi tạo admin lần đầu hoặc chạy database/CREATE_FIRST_ADMIN.sql trong D1 Console trước khi đăng nhập.');
 const key=await digest((req.headers.get('CF-Connecting-IP')||'local')+':'+clean(b.username));
 const attempts=await one(db,'SELECT * FROM login_attempts WHERE key=?',key);
 if(attempts&&attempts.expires>Date.now()&&attempts.count>=10)fail(429,'Thử lại sau 15 phút');
 const u=await one(db,'SELECT * FROM users WHERE username=? AND active=1',clean(b.username));
 const check=await password(String(b.password||''),u?u.password.split(':')[0]:'invalid');
 if(!u||check!==u.password){await run(db,'INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=?',key,Date.now()+900000,Date.now(),Date.now()+900000);fail(401,'Sai tài khoản hoặc mật khẩu')}
 await run(db,'DELETE FROM login_attempts WHERE key=?',key);
 const token=crypto.randomUUID()+crypto.randomUUID();await run(db,'INSERT INTO sessions VALUES(?,?,?)',await digest(token),u.id,Date.now()+28800000);
 const r=json({role:u.role});r.headers.set('Set-Cookie',`session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);return r;
 }

 const cookie=req.headers.get('Cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]||'';
 const u=await one(db,'SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1',await digest(cookie),Date.now());
 if(!u){if(p.endsWith('.php')||p.startsWith('/api/')||p.startsWith('/auth/'))return json({},401,'Hãy đăng nhập');return Response.redirect(url.origin+'/login.html',302)}
 if(p==='/auth/logout'){await run(db,'DELETE FROM sessions WHERE token=?',await digest(cookie));const r=json();r.headers.set('Set-Cookie','session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return r}
 if(p==='/auth/me')return json({id:u.id,username:u.username,role:u.role,site_id:u.site_id,department:u.department});
 const protectedFiles=['/','/index.html','/scanner.html','/index.php','/admin.js','/session.js'];
 if(protectedFiles.includes(p)){if(!['GET','HEAD'].includes(req.method))fail(405,'Method không hợp lệ');const target=p==='/index.php'?'/scanner.html':p==='/'?'/index.html':p;const response=await env.ASSETS.fetch(new Request(new URL(target,url),req));const headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');return new Response(response.body,{status:response.status,headers})}
 const site=u.role==='admin'?(req.headers.get('X-Site')||url.searchParams.get('site')||''):u.site_id;
 if(p==='/api/sites'){if(req.method==='POST'){admin(u);await run(db,'INSERT INTO sites VALUES(?,?)',crypto.randomUUID(),clean(b.name)||fail(400,'Thiếu tên site'))}return json({rows:await all(db,u.role==='admin'?'SELECT * FROM sites':'SELECT * FROM sites WHERE id=?',...(u.role==='admin'?[]:[u.site_id]))})}
 if(p==='/api/users'){admin(u);if(req.method==='POST'){
 if(!['admin','manager','scanner'].includes(b.role)||!clean(b.username)||typeof b.password!=='string'||b.password.length<12||b.password.length>256)fail(400,'Thông tin tài khoản không hợp lệ');
 if(b.role!=='admin'&&!await one(db,'SELECT id FROM sites WHERE id=?',b.site_id))fail(400,'Site không tồn tại');
 await run(db,'INSERT INTO users VALUES(?,?,?,?,?,?,1)',crypto.randomUUID(),clean(b.username),await password(b.password),b.role,b.role==='admin'?null:b.site_id,clean(b.department));
 }return json({rows:await all(db,'SELECT id,username,role,site_id,department,active FROM users')})}
 if(p==='/api/user-status'){admin(u);if(b.id===u.id)fail(400,'Không khóa chính mình');if(typeof b.active!=='boolean'||!clean(b.id))fail(400,'Thông tin trạng thái không hợp lệ');if(!await one(db,'SELECT id FROM users WHERE id=?',b.id))fail(404,'Không tìm thấy tài khoản');await db.batch([db.prepare('UPDATE users SET active=? WHERE id=?').bind(b.active?1:0,b.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(b.id)]);return json()}
 if(p==='/api/password'){if(typeof b.password!=='string'||b.password.length<12||b.password.length>256)fail(400,'Mật khẩu tối thiểu 12 ký tự');const target=u.role==='admin'&&b.id?b.id:u.id;if(b.id&&u.role!=='admin'&&b.id!==u.id)fail(403,'Không có quyền đổi mật khẩu tài khoản khác');if(!await one(db,'SELECT id FROM users WHERE id=?',target))fail(404,'Không tìm thấy tài khoản');await db.batch([db.prepare('UPDATE users SET password=? WHERE id=?').bind(await password(b.password),target),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(target)]);return json()}
 if(!site||!await one(db,'SELECT id FROM sites WHERE id=?',site))fail(400,'Chọn site trước');
 if(p==='/api/assets'){
 if(req.method==='POST'){manage(u);const rows=buildAssets(b.rows,b.mode,b.columns,b.separator);const now=new Date().toISOString();
 // A conflicting serial with another barcode aborts the entire batch.
 const statements=rows.map(a=>db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(site_id,barcode) DO UPDATE SET serial=excluded.serial,factory=excluded.factory,device_code=excluded.device_code,data=excluded.data,updated_at=excluded.updated_at').bind(crypto.randomUUID(),site,a.barcode,a.serial,a.factory,a.device_code,JSON.stringify(a.data),now));
 statements.push(db.prepare('INSERT INTO imports VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),site,u.id,now,rows.length));await db.batch(statements);return json({count:rows.length})}
 const offset=Math.max(0,Number(url.searchParams.get('offset'))||0);return json({rows:(await all(db,'SELECT data FROM assets WHERE site_id=? ORDER BY serial LIMIT 100 OFFSET ?',site,offset)).map(r=>JSON.parse(r.data))});
 }
 const a=url.searchParams.get('action');
 const readScans=async()=>{const q=url.searchParams;const where=['site_id=?'],v=[site];
 if(u.role==='scanner'){where.push('user_id=?');v.push(u.id)}
 if(q.get('date')){where.push('scan_date=?');v.push(q.get('date'))}
 if(q.get('source_type')&&q.get('source_type')!=='all'){where.push('source=?');v.push(q.get('source_type'))}
 let rows=(await all(db,'SELECT * FROM scans WHERE '+where.join(' AND ')+' ORDER BY scan_date DESC,id DESC LIMIT 10000',...v)).map(record);
 if(q.get('user')&&q.get('all_users')!=='1')rows=rows.filter(r=>r.scan_user===q.get('user'));
 if(q.get('search'))rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q.get('search').toLowerCase()));return rows;};
 const assets=async()=> (await all(db,'SELECT data FROM assets WHERE site_id=? AND (?=\'\' OR factory=?) ORDER BY serial LIMIT 50000',site,clean(b.factory),clean(b.factory))).map(r=>JSON.parse(r.data));
 const lookup=async()=>{const keys=candidates(b);let found=[];for(const k of keys){found=await all(db,'SELECT data FROM assets WHERE site_id=? AND (barcode=? OR serial=?)',site,k,k);if(found.length)break}return found.map(r=>JSON.parse(r.data)).filter(r=>!b.factory||r.Factory===b.factory)};
 if(p==='/machine_api.php'){
 if(a==='listDeviceCodes')return json({codes:(await all(db,'SELECT DISTINCT device_code code FROM assets WHERE site_id=? ORDER BY code',site)).map(r=>r.code)});
 if(a==='listFactories'){let rows=await assets();if(b.device_codes?.length)rows=rows.filter(r=>b.device_codes.includes(r.McSerialNumber.slice(0,4).toUpperCase()));const f=[...new Set(rows.map(r=>r.Factory).filter(Boolean))];return json({factories:f,items:f.map(factory=>({factory,machine_count:rows.filter(r=>r.Factory===factory).length}))})}
 if(a==='downloadCache'){const rows=(await assets()).filter(r=>!b.device_code||r.McSerialNumber.slice(0,4).toUpperCase()===b.device_code);return json({rows,row_count:rows.length,factory:b.factory,device_code:b.device_code,downloaded_at:new Date().toISOString(),schema_version:5})}
 if(a==='lookupQr')return json({rows:await lookup(),lookup_key:b.lookup_key||candidates(b)[0],factory:b.factory,source:'server',data_source:'mysql'});
 if(a==='sourceStats')return json({stats:{row_count:(await one(db,'SELECT count(*) n FROM assets WHERE site_id=?',site)).n}});
 }
 if(p==='/asset_import_api.php'){if(a==='status')return json({stats:{row_count:(await one(db,'SELECT count(*) n FROM assets WHERE site_id=?',site)).n}});fail(400,'Import tại trang Quản trị')}
 if(p==='/api.php'){
 if(a==='setUser'){await run(db,'UPDATE users SET department=? WHERE id=?',clean(b.department),u.id);return json({user:u.username,department:clean(b.department)})} if(a==='getUser')return json({user:u.username,department:u.department});
 if(a==='listDepartments')return json({departments:(await all(db,"SELECT DISTINCT department FROM users WHERE site_id=? AND department<>''",site)).map(r=>r.department)});
 if(a==='saveTargetStatus')return json({available:true,save_target:'d1'});
 if(a==='departmentStats')return json({saved_count:(await one(db,'SELECT count(*) n FROM scans WHERE site_id=? AND user_id=? AND scan_date=?',site,u.id,localDay())).n});
 if(a==='pushQr'||a==='pushTable'){
 const source=a==='pushQr'?'qr':'ocr',text=clean(b.qr_text),client=clean(b.client_scan_id)||crypto.randomUUID();
 if(source==='qr'&&!text&&!b.lookup_key)fail(400,'QR rỗng');
 if(source==='ocr')b.table=normalizeTable(b.table);if(source==='qr'&&text.length>4000)fail(400,'QR quá dài');
 const instant=scanInstant(b.inventory_datetime),dt=instant.toISOString(),day=localDay(instant);
 const parts=text.split('|'),mr=source==='qr'?await lookup():[],m=mr[0]||{};
 const daily=source==='qr'?day+':'+(m.barcode||text.split('|')[0]||b.lookup_key):'ocr:'+await digest(JSON.stringify(b.table));
 const data={...b,scan_user:u.username,scan_department:u.department||clean(b.scan_department),source_type:source,scan_date:day,scan_datetime:dt,inventory_datetime:dt,raw_text:text||JSON.stringify(b.table),table:b.table||[['EMS',parts[0]||'']],qr_ems:parts[0]||'',qr_ems_lookup:b.lookup_key||parts[0]||'',qr_device_serial_no:parts[4]||'',scan_comment:clean(b.scan_comment),machine_rows:mr,machine_name:m.McName||'',machine_serial:m.McSerialNumber||'',machine_factory:m.Factory||'',machine_location:m.CurrentLocation||'',machine_status:m.Status||'',machine_json:JSON.stringify({overview_rows:mr}),row_count:b.table?.length||1};delete data.image_data_url;
 if(source==='qr')Object.assign(data,{
 qr_device_type:parts[1]||'',qr_device_model:parts[2]||'',qr_asset_code:parts[3]||'',qr_laptop_info:[parts[2],parts[3]].filter(Boolean).join('|'),
 qr_user_id:parts[5]||'',qr_user_dept:parts[6]||'',qr_last_check:parts[7]||'',qr_lookup_key:m.barcode||b.lookup_key||parts[0]||'',
 table:[['EMS',parts[0]||''],[parts[1]||'Device',[parts[2],parts[3]].filter(Boolean).join('|')],['Device Serial No',parts[4]||''],['User ID',parts[5]||''],["User's Dept",parts[6]||''],['Last Check',parts[7]||'']]
 });
 const inserted=await run(db,'INSERT INTO scans(site_id,user_id,client_id,daily_key,source,scan_date,data) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',site,u.id,client,daily,source,day,JSON.stringify(data));
 let row=await one(db,'SELECT * FROM scans WHERE site_id=? AND user_id=? AND client_id=?',site,u.id,client)||await one(db,'SELECT * FROM scans WHERE site_id=? AND user_id=? AND daily_key=?',site,u.id,daily);
 let updatedLatest=false;
 if(!inserted.meta.changes&&row.client_id!==client){
 const old=JSON.parse(row.data);
 if(scanInstant(data.inventory_datetime)>scanInstant(old.inventory_datetime)){
 const updated={...data,scan_comment:data.scan_comment||old.scan_comment};
 const result=await run(db,"UPDATE scans SET data=? WHERE id=? AND site_id=? AND julianday(json_extract(data,'$.inventory_datetime')) < julianday(?)",JSON.stringify(updated),row.id,site,data.inventory_datetime);
 updatedLatest=!!result.meta.changes;
 row=await one(db,'SELECT * FROM scans WHERE id=? AND site_id=?',row.id,site);
 }
 }
 return json({record:record(row),duplicate:!inserted.meta.changes,updated_latest:updatedLatest,save_target:'d1'});
 }
 if(a==='listRecords')return json({rows:await readScans()});
 if(['deleteRecord','updateRecordTable','updateQrComment'].includes(a)){
 const r=await one(db,'SELECT * FROM scans WHERE site_id=? AND (id=? OR client_id=?)',site,String(b.id||''),clean(b.client_scan_id));if(!r)fail(404,'Không tìm thấy');if(u.role==='scanner'&&r.user_id!==u.id)fail(403,'Không có quyền');
 if(a==='deleteRecord')await run(db,'DELETE FROM scans WHERE id=? AND site_id=?',r.id,site);else {const d=record(r);if(a==='updateRecordTable'){d.table=normalizeTable(b.table);d.row_count=d.table.length;d.raw_text=d.table.map(row=>row.join(' | ')).join('\n')}else {if(clean(b.scan_comment).length>1000)fail(400,'Ghi chú tối đa 1000 ký tự');d.scan_comment=clean(b.scan_comment)}await run(db,'UPDATE scans SET data=? WHERE id=? AND site_id=?',JSON.stringify(d),r.id,site)}return json({id:r.id});
 }
 }
 if(p==='/ocr_api.php'||p==='/qr_decode_api.php')fail(503,'Cloudflare dùng bộ nhận dạng trong trình duyệt; không có Python/PHP server fallback.');
 if(p==='/export_excel.php'){
 const rows=await readScans();
 const headings=['user','date','type','content','department','EMS','QR device','QR model','asset code','device serial','user ID','user department','last check','machine serial','machine name','machine type','brand','model','accounting code','factory','location','used by','position','manufacturer serial','purchase date','status','remark','scan comment','inventory datetime'];
 const lines=rows.map(d=>{const m=JSON.parse(d.machine_json||'{}').overview_rows?.[0]||{};return [d.scan_user,d.scan_date,d.source_type,d.raw_text,d.scan_department,d.qr_ems,d.qr_device_type,d.qr_device_model,d.qr_asset_code,d.qr_device_serial_no,d.qr_user_id,d.qr_user_dept,d.qr_last_check,m.McSerialNumber,m.McName,m.McType,m.McBrand,m.McModel,m.AccountingCode,m.Factory,m.CurrentLocation,m.Usedby,m.Position,m.ManuSerialNo,m.PurchaseDate,m.Status,m.Remark,d.scan_comment,d.inventory_datetime].map(csvCell).join(',')});
 return new Response('\ufeff'+[headings.map(csvCell).join(','),...lines].join('\r\n'),{headers:{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="inventory.csv"','Cache-Control':'no-store'}})
 }
 fail(404,'Đường dẫn / action không tồn tại');
 return env.ASSETS.fetch(new Request(new URL(p==='/index.php'?'/scanner.html':p,url),req));
 }catch(e){console.error(e.message);if(/UNIQUE constraint failed/.test(e.message))return json({},409,'Barcode, serial hoặc tài khoản đã tồn tại. Lượt ghi đã được hủy.');return json({},e.status||500,e.status?e.message:'Không xử lý được. Kiểm tra dữ liệu trùng, cấu hình D1 và log Worker.')}}};

export default {async fetch(request,env,ctx){
 const response=await application.fetch(request,env,ctx);
 const headers=new Headers(response.headers),path=new URL(request.url).pathname;
 headers.set('X-KiemKe-Version',APP_VERSION);headers.set('X-KiemKe-Build',BUILD_INFO.build_id);
 headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');headers.set('Referrer-Policy','strict-origin-when-cross-origin');
 if(path==='/'||path.endsWith('.html')||['/admin.js','/session.js','/ui.css','/assets/js/login.js','/version.json','/health/version'].includes(path))headers.set('Cache-Control','no-store');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}};
