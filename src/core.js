export const clean=v=>String(v??'').trim();
const invalid=message=>{throw Object.assign(Error(message),{status:400})};
export function buildAssets(rows,mode='existing',columns=[],separator='-'){
 if(!Array.isArray(rows)||!rows.length||rows.length>100)invalid('Mỗi lượt cần 1–100 dòng.');
 if(!['existing','generated'].includes(mode))invalid('Chế độ barcode không hợp lệ');
 if(mode==='generated'&&(!Array.isArray(columns)||!columns.length||columns.some(k=>typeof k!=='string')))invalid('Chọn ít nhất một cột ghép barcode');
 if(typeof separator!=='string'||separator.length>10)invalid('Dấu nối tối đa 10 ký tự');
 const seen=new Set(),serials=new Set();
 return rows.map((row,i)=>{
 if(!row||typeof row!=='object'||Array.isArray(row))invalid(`Dòng ${i+2}: dữ liệu không hợp lệ`);
 if(Object.keys(row).length>100)invalid('Tối đa 100 cột');
 const data=Object.fromEntries(Object.entries(row).map(([k,v])=>{if(v!==null&&typeof v==='object')invalid('Ô dữ liệu phải là text hoặc số');if(clean(v).length>4000)invalid('Mỗi ô tối đa 4000 ký tự');return [clean(k),clean(v)]}));
 const barcode=mode==='generated'?columns.map(k=>{if(!Object.hasOwn(data,k)||!data[k])invalid(`Dòng ${i+2}: thiếu cột ${k}`);return data[k]}).join(separator):data.barcode;
 const serial=data.McSerialNumber;
 if(!serial||!barcode||barcode.length>500||serial.length>255||/[\r\n]/.test(barcode))invalid(`Dòng ${i+2}: barcode / McSerialNumber không hợp lệ`);
 if(seen.has(barcode)||serials.has(serial))invalid(`Dòng ${i+2}: trùng barcode hoặc serial`);
 seen.add(barcode);serials.add(serial);return {data:{...data,barcode},barcode,serial,factory:data.Factory||'',device_code:serial.slice(0,4).toUpperCase()};
 });
}
export function localDay(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
export function candidates(b){return [...new Set([b.qr_text,b.lookup_key,String(b.qr_text||'').split('|')[0]].map(clean).filter(Boolean))];}
export function scanInstant(value){const text=clean(value)||new Date().toISOString();const d=new Date(/[zZ]|[+-]\d\d:\d\d$/.test(text)?text:text.replace(' ','T')+'+07:00');if(!Number.isFinite(d.getTime()))invalid('Thời gian không hợp lệ');return d;}
export function normalizeTable(table){if(!Array.isArray(table)||!table.length||table.length>120)invalid('Bảng cần 1–120 dòng');return table.map(row=>{if(!Array.isArray(row)||row.length>30)invalid('Mỗi dòng tối đa 30 cột');return row.map(v=>{if(v!==null&&typeof v==='object')invalid('Ô dữ liệu không hợp lệ');if(clean(v).length>4000)invalid('Mỗi ô tối đa 4000 ký tự');return clean(v)})});}
export const csvCell=value=>'"'+String(value??'').replace(/^(\s*[=+@-])/u,"'$1").replaceAll('"','""')+'"';
