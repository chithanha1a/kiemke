'use strict';
const byId=id=>document.getElementById(id);
async function refreshSetupStatus(){
 try {
 const response=await fetch('/auth/setup-status',{cache:'no-store'});const result=await response.json();
 if(!result.ok){byId('setupState').textContent=result.message;return}
 const status=result.data;
 if(status.admin_exists){byId('setupState').textContent='Database đã có admin. Hãy đăng nhập; không cần khởi tạo lại.';byId('setupPanel').open=false;}
 else {byId('setupPanel').open=true;byId('setupState').textContent=status.token_configured?'Database chưa có admin. Token runtime đã được cấu hình. Hãy khởi tạo ở form bên dưới.':'Database chưa có admin và Worker chưa nhận SETUP_TOKEN. Thêm token runtime rồi Deploy, hoặc dùng file SQL tạo admin trong D1 Console.';}
 }catch{byId('setupState').textContent='Không kiểm tra được trạng thái. Kiểm tra kết nối và bản Worker đang triển khai.'}
}
byId('showToken').onchange=e=>{byId('setup').elements.token.type=e.target.checked?'text':'password'};
for(const [id,path] of [['login','login'],['setup','bootstrap']])byId(id).onsubmit=async event=>{
 event.preventDefault();const form=event.target,button=form.querySelector('button'),msg=byId(id==='setup'?'setupMsg':'msg');
 const payload=Object.fromEntries(new FormData(form));if(id==='setup')payload.token=String(payload.token||'').trim();
 button.disabled=true;msg.textContent='Đang xử lý…';
 try {
 const response=await fetch('/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();msg.textContent=result.message;
 if(result.ok&&id==='login'){location.href='/';return}
 if(result.ok&&id==='setup'){byId('login').elements.username.value=payload.username;form.elements.token.value='';form.elements.password.value='';await refreshSetupStatus();byId('msg').textContent=result.message;byId('login').elements.password.focus();}
 }catch{msg.textContent='Không kết nối được máy chủ hoặc response không phải JSON. Kiểm tra Network và log Worker.'}
 finally{button.disabled=false}
};
refreshSetupStatus();
