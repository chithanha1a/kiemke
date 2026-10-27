// Loaded before scanner code; no shared cache between identities or sites.
var DATA_SCOPE=sessionStorage.getItem('scope');
var ACTIVE_SITE=sessionStorage.getItem('site')||'';
if(!DATA_SCOPE) location.replace('/');
var scopedStorage={getItem:k=>localStorage.getItem(DATA_SCOPE+':'+k),setItem:(k,v)=>localStorage.setItem(DATA_SCOPE+':'+k,v),removeItem:k=>localStorage.removeItem(DATA_SCOPE+':'+k)};
const nativeFetch=window.fetch.bind(window);
window.fetch=(input,options={})=>{const headers=new Headers(options.headers||{});const dest=new URL(typeof input==='string'?input:input.url,location.href);if(dest.origin!==location.origin)return nativeFetch(input,options);if(sessionStorage.getItem('site')!==ACTIVE_SITE)return Promise.reject(new Error('Site đã thay đổi. Mở lại màn hình scan.'));headers.set('X-Site',ACTIVE_SITE);return nativeFetch(input,{...options,headers})};
// Verify the active identity before any cached scanner data can be displayed.
document.documentElement.style.visibility='hidden';
window.sessionReady=window.fetch('/auth/me').then(r=>r.json()).then(r=>{if(!r.ok||DATA_SCOPE!==r.data.id+':'+sessionStorage.getItem('site')||(r.data.role!=='admin'&&r.data.site_id!==sessionStorage.getItem('site'))){location.replace('/');throw Error('Phiên / site đã thay đổi')} document.documentElement.style.visibility='';return r.data});
