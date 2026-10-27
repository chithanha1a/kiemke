import {test} from 'node:test';import assert from 'node:assert/strict';import {buildAssets,localDay,candidates} from '../src/core.js';
test('existing barcode keeps zero prefix',()=>assert.equal(buildAssets([{barcode:'001',McSerialNumber:'000012'}])[0].barcode,'001'));
test('generated barcode',()=>assert.equal(buildAssets([{McSerialNumber:'COMP0001',Factory:'A'}],'generated',['Factory','McSerialNumber'],'-')[0].barcode,'A-COMP0001'));
test('missing column rejected',()=>assert.throws(()=>buildAssets([{McSerialNumber:'1'}],'generated',['missing'])));
test('duplicate rejected',()=>assert.throws(()=>buildAssets([{barcode:'a',McSerialNumber:'1'},{barcode:'a',McSerialNumber:'2'}])));
test('Vietnam date',()=>assert.equal(localDay(new Date('2026-10-23T18:00:00Z')),'2026-10-24'));
test('legacy QR EMS',()=>assert.ok(candidates({qr_text:'COMP0001|Laptop|X'}).includes('COMP0001')));
