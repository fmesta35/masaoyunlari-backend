'use strict';
/*
 * HAVA HOKEYİ — GERÇEKÇİ FİZİK (kullanıcı raporu):
 *   "hâlâ çok hızlı reaksiyonlar, olur olmadık fiziksel kuvvetler, temas
 *    etmeden uçmalar devam ediyor — gerçekçi fiziksel kurallar eşliğinde
 *    oynanabilir bir oyuna dönüştür"
 * Eski motorda ÖLÇÜLEN kusurlar ve bu testin karşılığı:
 *   · tokmak tek adımda 0 → 1500 birim/sn ışınlanıyordu      → 1) ivme sınırı
 *   · banda sıkışan disk 1300 birim/sn fırlıyordu             → 2) sıkışma
 *   · yavaşlayan disk kimse dokunmadan itiliyordu             → 3) kendiliğinden kuvvet yok
 *   · istemci beyanıyla temassız vuruş kabul ediliyordu       → 4) beyan yolu yok
 * Ayrıca: 5) durgun tokmak enerji eklemez, 6) salınım güç verir ama tavanı
 * aşmaz, 7) yavaş itme yavaş disk, 8) rastgele uzun oyunda temassız hızlanma
 * hiç yok, 9) servis diski durgun ve servis atanın yarısında.
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

// 1) tokmak ivme sınırlı: uzak hedefe tek adımda ışınlanmaz
{
  const st = oyun();
  st.tokmak[0] = { x: 150, y: 300, vx: 0, vy: 0 };
  E.hedefYaz(st, 0, 440, 300);
  E.adim(st, ADIM);
  assert.ok(hiz(st.tokmak[0]) <= E.TOKMAK_IVME * ADIM + 1, 'tek adımda hız ivme sınırını aşmamalı: ' + hiz(st.tokmak[0]));
  for (let i = 0; i < 120; i++) E.adim(st, ADIM);
  assert.ok(Math.abs(st.tokmak[0].x - 440) < 2, 'tokmak hedefe yetişmeli');
  console.log('  ✓ 1) tokmak hedefe ivme ve hız sınırıyla gidiyor (ışınlanma yok)');
}
// 2) sıkışma: banda / köşeye bastırılan disk fırlamaz
for (const [ad, disk, hedef] of [
  ['alt bant', { x: 300, y: E.ALAN.alt - E.DISK_R - 1 }, { x: 300, y: 600 }],
  ['köşe', { x: E.ALAN.sol + E.DISK_R + 1, y: E.ALAN.ust + E.DISK_R + 1 }, { x: 0, y: 0 }]]) {
  const st = oyun();
  st.disk = { x: disk.x, y: disk.y, vx: 0, vy: 0 };
  st.tokmak[0] = { x: Math.max(120, disk.x + 60), y: Math.max(120, disk.y - 90), vx: 0, vy: 0 };
  st.hedef[0] = hedef;
  let mx = 0;
  for (let i = 0; i < 120; i++) { E.adim(st, ADIM); mx = Math.max(mx, hiz(st.disk)); }
  assert.ok(mx <= 330, ad + ' sıkışması diski fırlatmamalı — en yüksek: ' + mx.toFixed(0));
}
console.log('  ✓ 2) banda/köşeye sıkışan disk fırlamıyor (en çok yavaş sıyrılma)');
// 3) kimse dokunmazsa disk yalnız yavaşlar
{
  const st = oyun();
  st.disk = { x: 250, y: 150, vx: 60, vy: 0 };
  st.tokmak[0] = { x: 100, y: 450, vx: 0, vy: 0 }; st.hedef[0] = { x: 100, y: 450 };
  let once = hiz(st.disk), artti = 0;
  for (let i = 0; i < 1200; i++) { E.adim(st, ADIM); const h = hiz(st.disk); if (h > once + 1e-6) artti++; once = h; }
  assert.strictEqual(artti, 0, 'dokunulmayan disk hiç hızlanmamalı');
  console.log('  ✓ 3) kendiliğinden kuvvet yok: dokunulmayan disk yalnız yavaşlıyor');
}
// 4) istemci "değdi" beyanı yolu kaldırıldı
assert.strictEqual(E.gecmisVurus, undefined, 'istemci beyanıyla vuruş fonksiyonu olmamalı');
{
  const fs = require('fs'), path = require('path');
  const sunucu = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const blok = sunucu.slice(sunucu.indexOf("socket.on('hokeyMove'"), sunucu.indexOf("socket.on('hokeyRenk'"));
  assert.ok(!/gecmisVurus|data\.vt|data\.px/.test(blok), 'sunucu istemcinin vuruş beyanını işlememeli');
  const istemci = fs.readFileSync(path.join(__dirname, '..', 'tools/oyun-kaynaklari/havahokeyi/src/Online.tsx'), 'utf8');
  assert.ok(!/hitDisk|advanceDisk|s\.pred\b/.test(istemci), 'istemci yerel vuruş tahmini yapmamalı');
}
console.log('  ✓ 4) vuruşu yalnız sunucu, kendi tokmak konumuyla belirliyor (temassız vuruş yolu yok)');
// 5) durgun tokmağa çarpan disk hızlanmaz
{
  const st = oyun();
  st.tokmak[0] = { x: 200, y: 300, vx: 0, vy: 0 }; st.hedef[0] = { x: 200, y: 300 };
  st.disk = { x: 400, y: 300, vx: -800, vy: 0 };
  for (let i = 0; i < 60; i++) E.adim(st, ADIM);
  assert.ok(st.disk.vx > 0 && hiz(st.disk) < 800 * 0.7, 'durgun tokmaktan seken disk yavaşlamalı: ' + hiz(st.disk).toFixed(0));
  console.log('  ✓ 5) durgun tokmağa çarpan disk enerji kaybederek sekiyor');
}
// 6) salınım güç verir, tavan aşılmaz; 7) yavaş itme yavaş disk
{
  const st = oyun();
  st.disk = { x: 400, y: 300, vx: 0, vy: 0 };
  st.tokmak[0] = { x: 400 - R - 200, y: 300, vx: 0, vy: 0 }; st.hedef[0] = { x: 449, y: 300 };
  let mx = 0; for (let i = 0; i < 60; i++) { E.adim(st, ADIM); mx = Math.max(mx, hiz(st.disk)); }
  assert.ok(mx > 700 && mx <= E.DISK_TAVANI + 0.01, 'sert salınım güçlü ama tavan altında: ' + mx.toFixed(0));
  const y = oyun();
  y.disk = { x: 300, y: 300, vx: 0, vy: 0 };
  y.tokmak[0] = { x: 300 - R - 3, y: 300, vx: 0, vy: 0 }; y.hedef[0] = { x: 300 - R + 2, y: 300 };
  let my = 0; for (let i = 0; i < 60; i++) { E.adim(y, ADIM); my = Math.max(my, hiz(y.disk)); }
  assert.ok(my < 250, 'yavaşça dokunan tokmak diski fırlatmamalı: ' + my.toFixed(0));
  console.log('  ✓ 6-7) güç salınımla kazanılıyor (sert ' + mx.toFixed(0) + ', hafif ' + my.toFixed(0) + ' birim/sn), tavan aşılmıyor');
}
// 8) rastgele uzun oyun: temas olmadan hız artışı hiç yok
{
  let ihlal = 0, adim = 0, enY = 0;
  for (let n = 0; n < 12; n++) {
    const st = E.macBaslat({ seats: [0, 1], golHedefi: 7 });
    let tohum = n * 977 + 1; const rnd = () => ((tohum = (tohum * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 120 * 60 && st.status === 'playing'; i++) {
      if (i % 20 === 0) for (const p of [0, 1]) {
        const d = st.disk;
        const tx = p === 0 ? Math.min(d.x - 30 + rnd() * 60, 450) : Math.max(d.x - 30 + rnd() * 60, 550);
        E.hedefYaz(st, p, rnd() < 0.7 ? tx : (p === 0 ? 150 : 850), d.y + (rnd() - 0.5) * 80);
      }
      const v0 = hiz(st.disk);
      const yakin = () => [0, 1].some(p => Math.hypot(st.disk.x - st.tokmak[p].x, st.disk.y - st.tokmak[p].y) < R + 15);
      const once = yakin();
      E.adim(st, ADIM); adim++;
      enY = Math.max(enY, hiz(st.disk));
      if (st.faz === 'oyun' && hiz(st.disk) > v0 + 2 && !once && !yakin()) ihlal++;
    }
  }
  assert.strictEqual(ihlal, 0, 'temas olmadan hızlanma olmamalı');
  assert.ok(enY <= E.DISK_TAVANI + 0.01, 'disk hiçbir durumda tavanı aşmamalı: ' + enY);
  console.log('  ✓ 8) ' + adim + ' adımlık rastgele oyunda temassız hızlanma 0, en yüksek disk hızı ' + enY.toFixed(0));
}
// 9) servis: gol yiyenin yarısında durgun disk
{
  const st = oyun();
  st.disk = { x: 990, y: 300, vx: 900, vy: 0 };          // koltuk 0 gol atıyor
  for (let i = 0; i < 20 && st.skor[0] === 0; i++) E.adim(st, ADIM);
  assert.strictEqual(st.skor[0], 1, 'gol sayılmalı');
  for (let i = 0; i < 900 && st.faz !== 'oyun'; i++) E.adim(st, ADIM);
  assert.ok(st.disk.x > 500 && hiz(st.disk) === 0, 'servis gol yiyenin (koltuk 1) yarısında durgun');
  console.log('  ✓ 9) servis diski gol yiyenin yarı sahasına durgun konuyor');
}
console.log('OK hava hokeyi: gerçekçi fizik (ivmeli tokmak, sıkışmada fırlama yok, temassız kuvvet yok)');
