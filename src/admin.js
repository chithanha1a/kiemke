import * as XLSX from 'xlsx';
import {createLabelsPdf} from './labels.js';
const $=id=>document.getElementById(id);
let me,rows=[],assets=[],siteRows=[],userRows=[],page=1,currentView='inventory',busy=false;
const viewInfo={inventory:['Danh mục thiết bị','Quản lý thiết bị, tra cứu thông tin và chuẩn bị cho kỳ kiểm kê.'],imports:['Nhập dữ liệu','Đưa danh mục thiết bị vào site từ Excel hoặc CSV.'],printing:['In tem QR','Tạo nhãn rõ nét, dễ quét và tối ưu giấy A4.'],accounts:['Tài khoản & phân quyền','Quản lý người dùng và quyền truy cập theo từng site.'],settings:['Cài đặt cá nhân','Quản lý mật khẩu và bảo mật tài khoản của anh.']};
const roleNames={admin:'Quản trị viên',manager:'Quản lý site',scanner:'Người kiểm kê'};
const canManage=()=>me&&me.role!=='scanner';
const siteId=()=>$('sites').value||'';
const siteName=()=>siteRows.find(r=>r.id===siteId())?.name||'Chưa chọn site';
const cell=(tag,text,className='')=>{const e=document.createElement(tag);e.textContent=String(text??'');if(className)e.className=className;return e};
function notify(text,type='info'){$('message').hidden=!text;$('message').textContent=text;$('message').className='notice '+type;for(const dlg of document.querySelectorAll('dialog[open]')){let e=dlg.querySelector('.dialog-message');if(!e){e=cell('p','','notice dialog-message');dlg.querySelector('.dialog-actions').before(e)}e.textContent=text;e.className='notice dialog-message '+type;e.hidden=!text}}
async function api(path,b,site=siteId()){
 const response=await fetch(path,{method:b?'POST':'GET',headers:{'Content-Type':'application/json','X-Site':site},body:b?JSON.stringify(b):undefined});
 let result;try{result=await response.json()}catch{throw Error('Không đọc được phản hồi máy chủ. Vui lòng thử lại.')}
 if(!result.ok){if(response.status===401)location.href='/login.html';throw Error(result.message||'Không xử lý được yêu cầu.')}
 return result.data;
}
function syncControls(){
 document.querySelectorAll('[data-needs-site]').forEach(e=>e.disabled=busy||!siteId());
 $('sites').disabled=busy;$('import').disabled=busy||!siteId()||!rows.length;$('pdf').disabled=busy||!siteId()||!$('labels').selectedOptions.length;
 $('export').disabled=busy||!siteId()||!assets.length;
 for(const id of ['reset','enable','disable'])$(id).disabled=busy||!$('uid').value;
 $('save').disabled=busy||!assets[$('asset').value];
}
function action(id,fn,success='Hoàn tất.'){$(id).onclick=async()=>{
 if(busy)return;busy=true;const button=$(id),original=button.innerHTML;button.disabled=true;button.textContent='Đang xử lý…';syncControls();notify('');
 try{const result=await fn();if(success&&result!==false)notify(success,'success')}catch(error){notify(error.message,'error')}
 finally{busy=false;button.innerHTML=original;button.disabled=false;syncControls()}
}}
function showView(view,updateHash=true){
 if(!viewInfo[view])view='inventory';if(view==='accounts'&&me?.role!=='admin')view='inventory';if(['imports','printing'].includes(view)&&!canManage())view='inventory';
 currentView=view;for(const p of document.querySelectorAll('.view-panel'))p.hidden=p.id!=='view-'+view;
 for(const nav of document.querySelectorAll('[data-view]')){nav.classList.toggle('active',nav.dataset.view===view);if(nav.dataset.view===view)nav.setAttribute('aria-current','page');else nav.removeAttribute('aria-current')}
 $('viewTitle').textContent=viewInfo[view][0];$('currentViewLabel').textContent=viewInfo[view][0];$('viewDescription').textContent=viewInfo[view][1];
 const dataView=['inventory','imports','printing'].includes(view);$('siteWorkspace').hidden=!dataView||!siteId();$('noSite').hidden=!dataView||!!siteId();
 if(updateHash)history.replaceState(null,'','#'+view);
}
for(const nav of document.querySelectorAll('[data-view]'))nav.onclick=()=>showView(nav.dataset.view);
for(const button of document.querySelectorAll('[data-go]'))button.onclick=()=>showView(button.dataset.go);
function openDialog(id){const d=$(id);const message=d.querySelector('.dialog-message');if(message)message.hidden=true;if(!d.open)d.showModal()}
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>{if(!busy)$(b.dataset.close).close()};
for(const d of document.querySelectorAll('dialog'))d.addEventListener('cancel',e=>{if(busy)e.preventDefault()});
$('siteName').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(!busy)$('createSite').click()}});
$('openSiteDialog').onclick=$('emptyCreateSite').onclick=()=>{$('siteName').value='';openDialog('siteDialog')};
$('openUserDialog').onclick=()=>{$('userSiteLabel').textContent='Site được gán: '+siteName();openDialog('userDialog')};
function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function csv(data){return '\ufeff'+XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(data.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,/^\s*[=+@-]/.test(String(v))?"'"+v:v])))))}
function metrics(){
 $('assetCount').textContent=assets.length.toLocaleString('vi-VN');$('factoryCount').textContent=new Set(assets.map(a=>a.Factory).filter(Boolean)).size.toLocaleString('vi-VN');
 const n=$('labels').selectedOptions.length,estimated=Math.ceil(n/24);$('selectedLabelCount').textContent=n;$('pageEstimate').textContent=n?estimated+' trang A4 dự kiến':'24 nhãn trên mỗi trang A4';$('printSelection').textContent=n+' nhãn · '+estimated+' trang';syncControls();
}
function renderAssets(){
 const q=$('assetSearch').value.trim().toLocaleLowerCase('vi-VN'),filtered=assets.map((data,index)=>({data,index})).filter(({data})=>!q||Object.values(data).join(' ').toLocaleLowerCase('vi-VN').includes(q));
 const size=Number($('pageSize').value),pages=Math.max(1,Math.ceil(filtered.length/size));page=Math.min(Math.max(1,page),pages);const start=(page-1)*size;const body=$('assetRows');body.replaceChildren();
 for(const {data:a,index} of filtered.slice(start,start+size)){
 const tr=document.createElement('tr'),name=cell('td','');name.append(cell('strong',a.McName||'Chưa đặt tên'),cell('small',[a.McBrand,a.McModel].filter(Boolean).join(' · ')||a.McType||'Thiết bị'));tr.append(name);
 const barcode=cell('td','');barcode.append(cell('code',a.barcode));tr.append(barcode,cell('td',a.McSerialNumber));const location=cell('td','');location.append(cell('strong',a.Factory||'—'),cell('small',a.CurrentLocation||'—'));tr.append(location);
 const status=cell('td',''),label=a.Status||'Chưa cập nhật',green=/^(in use|active|đang sử dụng|hoạt động|pass)$/i.test(label);status.append(cell('span',label,'badge '+(green?'badge-green':'badge-gray')));tr.append(status);
 if(canManage()){const td=cell('td',''),button=cell('button','Chỉnh sửa','btn btn-small btn-outline');button.dataset.editIndex=index;button.onclick=()=>{$('asset').value=index;edit();openDialog('assetDialog')};td.append(button);tr.append(td)}body.append(tr);
 }
 if(!filtered.length){const tr=cell('tr',''),td=cell('td','');td.colSpan=canManage()?6:5;const empty=cell('div','','empty-state');empty.append(cell('h2',assets.length?'Không tìm thấy thiết bị':'Danh mục đang trống'),cell('p',assets.length?'Thử tìm tên, serial, barcode hoặc xưởng khác.':canManage()?'Chọn “Nhập dữ liệu” để tải danh mục đầu tiên cho site này.':'Danh mục chưa được quản trị viên nhập dữ liệu.'));td.append(empty);tr.append(td);body.append(tr)}
 $('assetSummary').textContent=assets.length.toLocaleString('vi-VN')+' thiết bị · '+siteName();$('tableRange').textContent=filtered.length?(start+1)+'–'+Math.min(start+size,filtered.length)+' / '+filtered.length+' thiết bị':'0 thiết bị';$('pageNumber').textContent=page+' / '+pages;$('prevPage').disabled=page===1;$('nextPage').disabled=page>=pages;
}
$('assetSearch').oninput=()=>{page=1;renderAssets()};$('pageSize').onchange=()=>{page=1;renderAssets()};$('prevPage').onclick=()=>{page--;renderAssets()};$('nextPage').onclick=()=>{page++;renderAssets()};
async function load(){
 const scope=siteId();if(!scope){assets=[];renderAssets();metrics();return}const loaded=[];
 for(let offset=0;;offset+=100){const r=await api('/api/assets?offset='+offset,undefined,scope);loaded.push(...r.rows);if(r.rows.length<100)break}
 if(scope!==siteId())return;assets=loaded;
 const selectedSerial=assets[$('asset').value]?.McSerialNumber;for(const id of ['asset','labels'])$(id).replaceChildren(...assets.map((r,i)=>new Option(r.McSerialNumber+' · '+(r.McName||'Thiết bị'),i)));
 if(selectedSerial){const index=assets.findIndex(a=>a.McSerialNumber===selectedSerial);if(index>=0)$('asset').value=String(index)}
 page=1;edit();renderAssets();metrics();
}
const fields=[['McName','Tên thiết bị'],['McSerialNumber','Serial kiểm kê'],['barcode','Barcode'],['McType','Loại thiết bị'],['McBrand','Hãng'],['McModel','Model'],['Factory','Xưởng'],['CurrentLocation','Vị trí hiện tại'],['Usedby','Người sử dụng'],['Position','Bộ phận / vị trí'],['Status','Trạng thái'],['AccountingCode','Mã tài sản'],['ManuSerialNo','Serial nhà sản xuất'],['PurchaseDate','Ngày mua'],['Remark','Ghi chú']];
function edit(){
 const a=assets[$('asset').value];$('assetFields').replaceChildren();if(!a){$('edit').value='';return}
 $('editingTitle').textContent=a.McSerialNumber+' · '+siteName();$('edit').value=JSON.stringify(a,null,2);
 for(const [key,title]of fields){const label=cell('label',title,'field'),input=document.createElement(key==='Remark'?'textarea':'input');input.value=a[key]||'';input.dataset.assetField=key;input.setAttribute('aria-label',title);if(key==='barcode')input.readOnly=true;input.oninput=()=>{try{const data=JSON.parse($('edit').value);data[key]=input.value;$('edit').value=JSON.stringify(data,null,2)}catch{notify('Dữ liệu JSON chưa hợp lệ. Kiểm tra phần cột bổ sung.','error')}};label.append(input);$('assetFields').append(label)}
}
$('asset').onchange=edit;
function clearImport(){rows=[];$('file').value='';$('fileName').textContent='XLSX, XLS, CSV · tối đa 100 dòng / 5 MB';$('columns').replaceChildren();$('preview').replaceChildren(cell('div','Chọn file để xem trước nội dung.','empty-state compact'));$('importMeta').textContent='Chưa chọn file.';$('importBadge').textContent='Chưa có file';barcodePreview()}
function choose(){
 sessionStorage.setItem('site',siteId());sessionStorage.setItem('scope',me.id+':'+siteId());assets=[];page=1;clearImport();$('edit').value='';$('asset').replaceChildren();$('labels').replaceChildren();renderAssets();metrics();showView(currentView,false);
}
$('sites').onchange=async()=>{choose();try{await load()}catch(e){notify(e.message,'error')}};
async function initSites(preferred){const r=await api('/api/sites');siteRows=r.rows;const wanted=preferred||sessionStorage.getItem('site');$('sites').replaceChildren(...siteRows.map(r=>new Option(r.name,r.id)));if(!siteRows.length)$('sites').append(new Option('Chưa có site',''));if(siteRows.some(r=>r.id===wanted))$('sites').value=wanted;choose();await load()}
action('createSite',async()=>{const name=$('siteName').value.trim();if(!name)throw Error('Vui lòng nhập tên site.');const known=new Set(siteRows.map(r=>r.id));const r=await api('/api/sites',{name});const created=r.rows.find(r=>!known.has(r.id));await initSites(created?.id);$('siteDialog').close()},'Đã tạo site. Anh có thể nhập danh mục thiết bị.');
action('scan',async()=>{if(!siteId())throw Error('Chọn site trước khi mở màn hình scan.');location.href='/scanner.html'},'');
action('logout',async()=>{await api('/auth/logout',{});sessionStorage.clear();location.href='/login.html'},'');
action('template',()=>download(csv([{barcode:'COMP0001',McSerialNumber:'COMP0001',McName:'Laptop',McType:'Computer',McBrand:'Dell',McModel:'Latitude',AccountingCode:'AS001',ManuSerialNo:'SN001',Factory:'Factory A',CurrentLocation:'Office',Usedby:'User',Position:'IT',Status:'In use',Remark:'',PurchaseDate:'2026-10-27'}]),'asset-template.csv','text/csv'),'Đã tải template CSV.');
function barcodePreview(){const columns=[...$('columns').selectedOptions].map(o=>o.value),first=rows[0];$('generatedOptions').hidden=$('mode').value!=='generated';$('barcodeExample').textContent=!first?'—':$('mode').value==='existing'?(first.barcode||'Chưa có cột barcode'):(columns.length?columns.map(k=>first[k]||'∅').join($('separator').value):'Chọn các cột cần ghép');syncControls()}
$('mode').onchange=barcodePreview;$('columns').onchange=barcodePreview;$('separator').oninput=barcodePreview;
$('file').onchange=async event=>{const scope=siteId();try{
 const file=event.target.files[0];if(!file){clearImport();return}if(file.size>5000000)throw Error('File vượt 5 MB. Vui lòng chia nhỏ file.');
 const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),parsed=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false});if(scope!==siteId())return;if(!parsed.length)throw Error('File không có dòng dữ liệu.');if(parsed.length>100)throw Error('Tối đa 100 dòng mỗi lượt. Vui lòng tách file.');rows=parsed;
 const keys=Object.keys(rows[0]);$('columns').replaceChildren(...keys.map(k=>new Option(k,k)));$('fileName').textContent=file.name;$('importMeta').textContent=rows.length+' dòng · '+keys.length+' cột · Sheet: '+wb.SheetNames[0];$('importBadge').textContent=rows.length+' dòng';
 const table=cell('table','','data-table'),head=document.createElement('thead'),hr=document.createElement('tr');keys.forEach(k=>hr.append(cell('th',k)));head.append(hr);table.append(head);const body=document.createElement('tbody');for(const row of rows.slice(0,5)){const tr=document.createElement('tr');keys.forEach(k=>tr.append(cell('td',row[k])));body.append(tr)}table.append(body);$('preview').replaceChildren(table);$('previewNote').textContent='5 dòng đầu · dữ liệu sẽ được nhập vào '+siteName();barcodePreview();notify('Đã đọc file. Kiểm tra barcode trước khi xác nhận.');
 }catch(e){clearImport();notify(e.message,'error')}};
action('import',async()=>{if(!rows.length)throw Error('Chọn file có dữ liệu trước.');const result=await api('/api/assets',{rows,mode:$('mode').value,columns:[...$('columns').selectedOptions].map(o=>o.value),separator:$('separator').value});await load();$('importMeta').textContent='Đã import thành công '+result.count+' dòng vào '+siteName();$('previewNote').textContent='Đã nhập '+result.count+' dòng. Có thể chuyển sang Danh mục thiết bị để kiểm tra.'},'Đã import dữ liệu vào site.');
action('load',load,'Danh mục đã được cập nhật.');
action('save',async()=>{let data;try{data=JSON.parse($('edit').value)}catch{throw Error('Dữ liệu JSON không hợp lệ.')}if(data.barcode!==assets[$('asset').value]?.barcode)throw Error('Giữ nguyên barcode khi sửa thiết bị.');await api('/api/assets',{rows:[data]});await load();$('assetDialog').close()},'Đã lưu thông tin thiết bị.');
action('export',async()=>{await load();download(csv(assets),'assets.csv','text/csv')},'Đã xuất danh mục thiết bị.');
$('labels').onchange=metrics;$('selectAllLabels').onclick=()=>{if(assets.length>300){notify('Chỉ có thể in 300 nhãn mỗi lượt. Đã chọn 300 thiết bị đầu.');}for(const [i,o] of [...$('labels').options].entries())o.selected=i<300;metrics()};$('clearLabels').onclick=()=>{for(const o of $('labels').options)o.selected=false;metrics()};
action('pdf',async()=>{const selected=[...$('labels').selectedOptions].map(o=>assets[o.value]);download(await createLabelsPdf(selected),'qr-labels-a4.pdf','application/pdf')},'Đã tạo PDF A4. Khi in, chọn Actual size / 100%.');
async function users(){const r=await api('/api/users');userRows=r.rows;const table=cell('table','','data-table'),thead=document.createElement('thead'),hr=document.createElement('tr');['Tài khoản','Quyền truy cập','Site / Phòng ban','Trạng thái','Thao tác'].forEach(t=>hr.append(cell('th',t)));thead.append(hr);table.append(thead);const body=document.createElement('tbody');for(const user of userRows){const tr=document.createElement('tr'),who=cell('td','');who.append(cell('strong',user.username),cell('small',user.id===me.id?'Tài khoản của anh':''));tr.append(who,cell('td',roleNames[user.role]||user.role));const site=cell('td','');site.append(cell('strong',user.role==='admin'?'Toàn hệ thống':siteRows.find(s=>s.id===user.site_id)?.name||'—'),cell('small',user.department||'—'));tr.append(site);const status=cell('td','');status.append(cell('span',user.active?'Đang hoạt động':'Đã khóa','badge '+(user.active?'badge-green':'badge-red')));tr.append(status);const td=cell('td',''),btn=cell('button','Quản lý','btn btn-small btn-outline');btn.onclick=()=>{$('uid').value=user.id;$('selectedUserLabel').textContent='Đang chọn: '+user.username+' · '+(roleNames[user.role]||user.role);$('newpass').value='';syncControls();$('newpass').focus()};td.append(btn);tr.append(td);body.append(tr)}table.append(body);$('users').replaceChildren(table)}
action('createUser',async()=>{if(!$('username').value.trim())throw Error('Nhập tên đăng nhập.');if($('password').value.length<12)throw Error('Mật khẩu cần ít nhất 12 ký tự.');if($('role').value!=='admin'&&!siteId())throw Error('Chọn site trước khi tạo manager hoặc scanner.');await api('/api/users',{username:$('username').value.trim(),password:$('password').value,role:$('role').value,site_id:siteId(),department:$('department').value});$('password').value='';await users();$('userDialog').close()},'Đã tạo tài khoản.');
action('reset',async()=>{if(!$('uid').value)throw Error('Chọn tài khoản cần quản lý.');if($('newpass').value.length<12)throw Error('Mật khẩu cần ít nhất 12 ký tự.');const name=userRows.find(u=>u.id===$('uid').value)?.username||'';if(!confirm('Đặt lại mật khẩu và kết thúc phiên đăng nhập của '+name+'?'))return false;await api('/api/password',{id:$('uid').value,password:$('newpass').value});$('newpass').value='';if($('uid').value===me.id)location.href='/login.html'},'Đã cập nhật yêu cầu quản lý tài khoản.');
for(const [id,active]of [['disable',false],['enable',true]])action(id,async()=>{if(!$('uid').value)throw Error('Chọn tài khoản cần quản lý.');if(!active&&!confirm('Khóa tài khoản này và kết thúc các phiên đăng nhập?'))return false;await api('/api/user-status',{id:$('uid').value,active});await users()},'Đã cập nhật yêu cầu quản lý tài khoản.');
action('ownreset',async()=>{if($('ownpass').value.length<12)throw Error('Mật khẩu cần ít nhất 12 ký tự.');await api('/api/password',{password:$('ownpass').value});location.href='/login.html'},'');
(async()=>{try{
 me=await api('/auth/me');$('who').textContent=me.username+' · '+(roleNames[me.role]||me.role);$('avatar').textContent=me.username.slice(0,1).toUpperCase();
 document.querySelectorAll('.admin').forEach(e=>e.hidden=me.role!=='admin');document.querySelectorAll('.manage').forEach(e=>e.hidden=me.role==='scanner');document.querySelector('.non-admin-empty').hidden=me.role==='admin';
 showView(location.hash.slice(1)||'inventory',false);await initSites();if(me.role==='admin')await users();syncControls();
 }catch(e){notify(e.message,'error')}})();
