'use strict';
/*
 * HAVA HOKEYİ — FİZİK DÜZELTMELERİ (kullanıcı raporları):
 *   "olur olmadık fiziksel kuvvetler, temas etmeden uçmalar", "taş zıplamaları"
 * Tokmağın imleci birebir izlediği (TOKMAK_HIZI 1500) ve diskin kaydığı asıl
 * oynanış korunur; yalnız hatalı kuvvetler giderilir:
 *   1) banda/köşeye sıkışan disk fırlamaz (en çok ~480) ve takılı kalmaz
 *   2) dokunulmayan disk kendiliğinden itilmez/hızlanmaz (eski 1,25 sn itmesi kalktı)
 *   3) görüş zamanlı bildirim yollayan oyuncunun gerçek zamanlı sunucu tokmağı
 *      diske vurmaz — vuruş yalnız bildirimle (gecmisVurus) işlenir
 *   4) bildirim temas göstermiyorsa vuruş yok; gösteriyorsa vuruş var
 *   5) tünelleme yok, durgun tokmak enerji eklemez
 */
const assert = require('assert');
const E = require('../havahokeyi-engine.js');
const R = E.DISK_R + E.TOKMAK_R;
const ADIM = 1 / 120;
const hiz = o => Math.hypot(o.vx, o.vy);
function oyun() {
  const st = E.macBaslat({ seats: [0, 1], golHedefi: 7 });
  for (let i = 0; i < 900 && st.faz !== 'oyun'; i++) E.adim(st, ADIM);
  st.tokmak[1] = { x: 900, y: 100, vx: 0, vy: 0 }; st.hedef[1] = { x: 900, y: 100 };
  return st;
}
// 1) sıkışma
for (const [ad, disk, bas, hedef] of [
  ['alt bant', { x: 300, y: E.ALAN.alt - E.DISK_R - 1 }, { x: 300, y: 380 }, { x: 300, y: 600 }],
  ['köşe', { x: E.ALAN.sol + E.DISK_R + 1, y: E.ALAN.ust + E.DISK_R + 1 }, { x: 200, y: 200 }, { x: 0, y: 0 }]]) {
  const st = oyun();
  st.disk = { x: disk.x, y: disk.y, vx: 0, vy: 0 };
  st.tokmak[0] = { x: bas.x, y: bas.y, vx: 0, vy: 0 }; st.hedef[0] = hedef;
  let mx = 0;
  for (let i = 0; i < 150; i++) { E.adim(st, ADIM); mx = Math.max(mx, hiz(st.disk)); }
  const yol = Math.hypot(st.disk.x - disk.x, st.disk.y - disk.y);
  assert.ok(mx <= 500, ad + ': sıkışan disk fırlamamalı — en yüksek ' + mx.toFixed(0));
  assert.ok(yol > 25, ad + ': disk takılı kalmamalı (yol ' + yol.toFixed(0) + ')');
}
console.log('  ✓ 1) banda/köşeye sıkışan disk fırlamıyor, takılı da kalmıyor');
// 2) kendiliğinden kuvvet yok
{
  const st = oyun();
  st.disk = { x: 250, y: 150, vx: 60, vy: 0 };
  st.tokmak[0] = { x: 100, y: 450, vx: 0, vy: 0 }; st.hedef[0] = { x: 100, y: 450 };
  let once = hiz(st.disk), artti = 0;
  for (let i = 0; i < 1200; i++) { E.adim(st, ADIM); const h = hiz(st.disk); if (h > once + 1e-6) artti++; once = h; }
  assert.strictEqual(artti, 0, 'dokunulmayan disk hızlanmamalı');
  console.log('  ✓ 2) dokunulmayan disk kendiliğinden itilmiyor (yalnız yavaşlıyor)');
}
// 3) bildirim yollayan oyuncunun sunucu tokmağı gerçek zamanlı vurmaz
{
  const st = oyun();
  st.izSon = [st.gecenSn, -9];
  st.disk = { x: 300, y: 300, vx: -600, vy: 0 };
  st.tokmak[0] = { x: 200, y: 300, vx: 0, vy: 0 }; st.hedef[0] = { x: 200, y: 300 };
  for (let i = 0; i < 12; i++) { st.izSon[0] = st.gecenSn; E.adim(st, ADIM); }
  assert.ok(st.disk.vx < 0, 'görüş zamanlı oyuncunun sunucu tokmağı diski kendiliğinden sektirmemeli');
  const s2 = oyun();
  s2.disk = { x: 300, y: 300, vx: -600, vy: 0 };
  s2.tokmak[0] = { x: 200, y: 300, vx: 0, vy: 0 }; s2.hedef[0] = { x: 200, y: 300 };
  for (let i = 0; i < 12; i++) E.adim(s2, ADIM);
  assert.ok(s2.disk.vx > 0, 'bildirimi olmayan (eski istemci) oyuncunun tokmağı yine çarpışır');
  console.log('  ✓ 3) vuruş yalnız oyuncunun görüş anı bildirimiyle; bildirimsiz istemcide eski davranış');
}
// 4) bildirimle vuruş: temas varsa var, yoksa yok
{
  const st = oyun();
  st.disk = { x: 520, y: 300, vx: 0, vy: 0 };
  assert.ok(E.gecmisVurus(st, 0, { x: 300 - R + 6, y: 300, vx: 900, vy: 0 }, { x: 300, y: 300, vx: 0, vy: 0 }, 0.1), 'temasta vuruş');
  assert.ok(st.disk.vx > 500, 'disk güçlü hızlanmalı');
  const s2 = oyun();
  s2.disk = { x: 520, y: 300, vx: 0, vy: 0 };
  assert.strictEqual(E.gecmisVurus(s2, 0, { x: 300 - R - 25, y: 300, vx: 900, vy: 0 }, { x: 300, y: 300, vx: 0, vy: 0 }, 0.1), false, 'temas yoksa vuruş yok');
  assert.strictEqual(s2.disk.x, 520);
  console.log('  ✓ 4) bildirimde temas yoksa hiçbir kuvvet yok');
}
// 5) tünelleme / durgun tokmak
{
  const st = oyun();
  st.tokmak[1] = { x: 700, y: 300, vx: 0, vy: 0 }; st.hedef[1] = { x: 700, y: 300 };
  st.disk = { x: 450, y: 300, vx: E.DISK_TAVANI, vy: 0 };
  let gecti = true;
  for (let i = 0; i < 90; i++) { E.adim(st, ADIM); if (st.disk.vx < 0) { gecti = false; break; } }
  assert.strictEqual(gecti, false, 'tam hızlı disk tokmağın içinden geçmemeli');
  assert.ok(Math.abs(st.disk.vx) < E.DISK_TAVANI, 'durgun tokmaktan seken disk hızlanmamalı');
  console.log('  ✓ 5) tünelleme yok, durgun tokmak enerji eklemiyor');
}
console.log('OK hava hokeyi: sıkışma, kendiliğinden kuvvet ve temassız vuruş düzeltmeleri');
