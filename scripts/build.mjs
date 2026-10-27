import {build} from 'esbuild';import {mkdir,copyFile,readdir} from 'node:fs/promises';
await build({entryPoints:['src/admin.js'],bundle:true,minify:true,platform:'browser',outfile:'public/admin.js'});
const vendor='public/assets/vendor';await mkdir(vendor+'/tesseract-core',{recursive:true});await mkdir(vendor+'/lang',{recursive:true});
for(const [from,to] of [
 ['node_modules/jsqr/dist/jsQR.js',vendor+'/jsQR.min.js'],
 ['node_modules/jsqr/LICENSE',vendor+'/jsQR.LICENSE.txt'],
 ['node_modules/tesseract.js/dist/tesseract.min.js',vendor+'/tesseract.min.js'],
 ['node_modules/tesseract.js/dist/worker.min.js',vendor+'/worker.min.js'],
 ['node_modules/tesseract.js/dist/tesseract.min.js.LICENSE.txt',vendor+'/tesseract.LICENSE.txt'],
 ['node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt',vendor+'/worker.LICENSE.txt'],
 ['node_modules/tesseract.js-core/LICENSE',vendor+'/tesseract-core/LICENSE'],
 ...['eng','vie'].map(lang=>[`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,vendor+`/lang/${lang}.traineddata.gz`])
])await copyFile(from,to);
for(const name of await readdir('node_modules/tesseract.js-core'))if(name.endsWith('.wasm.js'))await copyFile('node_modules/tesseract.js-core/'+name,vendor+'/tesseract-core/'+name);
console.log('Built admin UI; bundled jsQR, Tesseract worker/WASM and eng/vie language data.');
