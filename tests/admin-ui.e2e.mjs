import {chromium} from 'playwright';import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:8787';if(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base))throw Error('Local only');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
await page.goto(base+'/login.html');await page.waitForFunction(()=>document.querySelector('#setupState').textContent.includes('Database chưa có admin'));
assert.equal(await page.locator('#setupPanel').getAttribute('open'),'');
await page.locator('#setup [name=token]').fill('wrong');await page.locator('#setup [name=password]').fill('valid-ui-password-123');await page.locator('#setup button').click();await page.waitForFunction(()=>document.querySelector('#setupMsg').textContent.includes('không khớp'));
assert.equal(await page.locator('#msg').textContent(),'');
await page.locator('#setup [name=token]').fill('  local-test-only-setup-token  ');await page.locator('#setup button').click();await page.waitForFunction(()=>document.querySelector('#setupState').textContent.includes('Database đã có admin'));
assert.equal(await page.locator('#login [name=username]').inputValue(),'admin');assert.equal(await page.locator('#setup [name=token]').inputValue(),'');assert.equal(await page.locator('#setup [name=password]').inputValue(),'');
await page.locator('#login [name=password]').fill('valid-ui-password-123');await page.locator('#login button').click();await page.waitForURL(base+'/');await page.waitForFunction(()=>document.querySelector('#who').textContent.includes('admin'));
assert.deepEqual(errors,[]);console.log('PASS: empty DB status, wrong-token message, trimmed-token admin creation, password/token fields cleared, admin login, 0 uncaught page errors.');
}finally{await browser.close()}
