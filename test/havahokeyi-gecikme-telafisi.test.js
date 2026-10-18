'use strict';
/* Hava hokeyi: gecikme telafisi — ekranda görülen temas vuruş olmalı. */
const assert = require('assert');
const E = require('../havahokeyi-engine.js');

function yeni() {
  const st = E.macBaslat({ seats: [0, 1], golHedefi: 5 });
  st.faz = 'oyun'; st.fazSn = 0;
  st.disk.x = 520; st.disk.y = 300; st.disk.vx = 0; st.disk.vy = 0;
  return st;
}
const R = E.DISK_R + E.TOKMAK_R;

/* 1) değme var: disk vurulur, bugüne ileri sarılır */
let st = yeni();
let d0 = { x: 300, y: 300, vx: 0, vy: 0 };
let ok = E.gecmisVurus(st, 0, { x: 300 - R + 6, y: 300, vx: 900, vy: 0 }, d0, 0.1);
assert.ok(ok, 'temas varken vuruş kabul edilmeli');
assert.ok(st.disk.vx > 500, 'disk güçlü hızlanmalı: ' + st.disk.vx);
assert.ok(st.disk.x > 300 + 40, 'disk bugüne ileri sarılmalı: ' + st.disk.x);

/* 2) değme yok: vuruş yok, disk değişmez */
st = yeni();
ok = E.gecmisVurus(st, 0, { x: 300 - R - 25, y: 300, vx: 900, vy: 0 }, { x: 300, y: 300, vx: 0, vy: 0 }, 0.1);
assert.strictEqual(ok, false);
assert.strictEqual(st.disk.x, 520);

/* 3) çift vuruş engeli */
st = yeni();
E.gecmisVurus(st, 0, { x: 300 - R + 6, y: 300, vx: 900, vy: 0 }, { x: 300, y: 300, vx: 0, vy: 0 }, 0.05);
const vx1 = st.disk.vx;
ok = E.gecmisVurus(st, 0, { x: 300 - R + 6, y: 300, vx: 900, vy: 0 }, { x: 300, y: 300, vx: 0, vy: 0 }, 0.05);
assert.strictEqual(ok, false); assert.strictEqual(st.disk.vx, vx1);

/* 4) normal çarpışma da vuruş sonrası bekleme ile çift itmeyi önler */
st = yeni(); st.disk.x = 300; st.tokmak[0].x = 300 - R + 3; st.tokmak[0].y = 300;
st.hedef[0] = { x: st.tokmak[0].x, y: 300 };
E.adim(st, 1 / 120);
assert.ok(st.bekle[0] > 0);

/* 5) çok uzaktaki sahte tokmak talebi reddedilir */
st = yeni(); st.tokmak[0].x = 120; st.tokmak[0].y = 100;
ok = E.gecmisVurus(st, 0, { x: 380, y: 400, vx: 0, vy: 0 }, { x: 400, y: 400, vx: 0, vy: 0 }, 0.1);
assert.strictEqual(ok, false);
console.log('OK hava hokeyi: gecikme telafisi');
