'use strict';
/*
 * HAVA HOKEYİ — FİZİK VE SENKRON (kullanıcı raporları):
 *   1) "olur olmadık fiziksel kuvvetler, temas etmeden uçmalar var"
 *   2) "kayma etkisini yok etmişsin (buz hokeyi gibi) ve mouse hizasında
 *       kontrol edilen tutamaçlar çok geriden geliyor — önceden %100 senkrondu"
 * Bu test:
 *   1) tokmak = bildirilen imleç konumu (geride kalma yok)
 *   2) disk kayar: dokunulmayan disk 3 sn sonra hızının çoğunu korur, hiç hızlanmaz
 *   3) banda/köşeye sıkışan disk fırlamaz ve takılı kalmaz (bant boyunca kayar)
 *   4) imleç yolu diske değmezse vuruş YOK (temassız kuvvet yok)
 *   5) GÖRÜŞ ZAMANLI TEMAS: oyuncu diski 150 ms geriden görürken değdiği an vuruş olur
 *   6) gecikme benzetimi: son geçmişte imleç diskin içinden geçmiyor
 *   7) durgun tokmak enerji eklemez; sert vuruş tavanı aşmaz; tünelleme yok
 *   8) kale çizgisini geçen disk son anda (görüş zamanında) kurtarılabilir
 */
const assert = require('assert');
const E = require('../havahokeyi-engine.js');
const R = E.DISK_R + E.TOKMAK_R;
const ADIM = 1 / 120;
const hiz = o => Math.hypot(o.vx, o.vy);
function oyun() {
  const st = E.macBaslat({ seats: [0, 1], golHedefi: 7 });
  for (let i = 0; i < 900 && st.faz !== 'oyun'; i++) E.adim(st, ADIM);
  E.hedefYaz(st, 1, 900, 100);
  return st;
}
function geriden(st, e) {                          // e anında görülen disk
  const g = st.gecmis; for (let k = g.length - 1; k >= 0; k--) if (g[k].e <= e) return g[k];
  return null;
}

// 1) senkron
{
  const st = oyun();
  E.hedefYaz(st, 0, 333, 444);
  assert.deepStrictEqual({ x: st.tokmak[0].x, y: st.tokmak[0].y }, { x: 333, y: 444 }, 'tokmak imlecin TAM yerinde olmalı');
  console.log('  ✓ 1) tokmak bildirilen imleç konumunda (geride kalma yok)');
}
// 2) kayma
{
  const st = oyun();
  st.disk = { x: 250, y: 300, vx: 600, vy: 170 };
  E.hedefYaz(st, 0, 100, 100); E.hedefYaz(st, 1, 900, 500);
  let once = hiz(st.disk), artti = 0;
  for (let i = 0; i < 360; i++) {
    E.adim(st, ADIM);
    const h = hiz(st.disk); if (h > once + 1e-6) artti++; once = h;
    if (st.golBekle) break;
  }
  assert.strictEqual(artti, 0, 'dokunulmayan disk hızlanmamalı');
  assert.ok(st.golBekle || hiz(st.disk) > 0.45 * Math.hypot(600, 170), 'disk hava yastığında kaymalı (3 sn sonra hızın çoğu korunur): ' + hiz(st.disk).toFixed(0));
  console.log('  ✓ 2) disk kayıyor ve kendiliğinden hızlanmıyor');
}
// 3) sıkışma
for (const [ad, disk, yol] of [
  ['alt bant', { x: 300, y: E.ALAN.alt - E.DISK_R - 1 }, [[300, 380], [300, 520]]],
  ['köşe', { x: E.ALAN.sol + E.DISK_R + 1, y: E.ALAN.ust + E.DISK_R + 1 }, [[180, 180], [90, 90]]]]) {
  const st = oyun();
  st.disk = { x: disk.x, y: disk.y, vx: 0, vy: 0 };
  E.hedefYaz(st, 0, yol[0][0], yol[0][1]);
  let mx = 0;
  for (let i = 0; i <= 30; i++) {
    const f = i / 30;
    E.hedefYaz(st, 0, yol[0][0] + (yol[1][0] - yol[0][0]) * f, yol[0][1] + (yol[1][1] - yol[0][1]) * f);
    E.adim(st, ADIM); mx = Math.max(mx, hiz(st.disk));
  }
  for (let i = 0; i < 120; i++) { E.hedefYaz(st, 0, yol[1][0], yol[1][1]); E.adim(st, ADIM); mx = Math.max(mx, hiz(st.disk)); }
  const uz = Math.hypot(st.disk.x - disk.x, st.disk.y - disk.y);
  assert.ok(mx <= 560, ad + ' sıkışması diski fırlatmamalı — en yüksek: ' + mx.toFixed(0));
  assert.ok(uz > 25, ad + ': disk takılı kalmamalı, sıyrılıp çıkmalı (yol ' + uz.toFixed(0) + ')');
}
console.log('  ✓ 2b) banda/köşeye sıkışan disk fırlamıyor, takılı da kalmıyor');
// 4) temassız kuvvet yok
{
  const st = oyun();
  st.disk = { x: 300, y: 300, vx: 0, vy: 0 };
  for (let i = 0; i < 30; i++) { E.hedefYaz(st, 0, 150 + i * 4, 120); E.adim(st, ADIM); }
  assert.strictEqual(hiz(st.disk), 0, 'imleç diske değmeden disk kıpırdamamalı');
  console.log('  ✓ 3) imleç yolu diske değmezse hiçbir kuvvet yok');
}
// 5) görüş zamanlı temas
{
  const st = oyun();
  st.disk = { x: 420, y: 300, vx: -500, vy: 0 };
  E.hedefYaz(st, 0, 200, 300);
  for (let i = 0; i < 6; i++) E.adim(st, ADIM);
  const GECIKME = 0.15;
  let vurdu = false;
  for (let i = 0; i < 80 && !vurdu; i++) {
    E.adim(st, ADIM);
    const vt = st.gecenSn - GECIKME;
    const d = geriden(st, vt);
    if (!d) continue;
    /* oyuncu ekranda gördüğü diskin önüne tokmağını koyar */
    E.izEkle(st, 0, Math.min(449, d.x - R + 3), 300, vt);
    if (st.disk.vx > 0) vurdu = true;
  }
  assert.ok(vurdu, 'ekranda değen tokmak vuruş yapmalı (disk geri dönmeli)');
  console.log('  ✓ 4) görüş zamanlı temas: 150 ms geriden gören oyuncunun gördüğü değme vuruş oluyor');
}
// 6) gecikme benzetimi: imleç ile disk görüş anında iç içe geçmiyor
{
  for (const [D, ow] of [[0.08, 0.03], [0.2, 0.08]]) {
    const st = E.macBaslat({ seats: [0, 1], golHedefi: 99 });
    const kuyruk = []; const ptr = [{ x: 150, y: 300 }, { x: 850, y: 300 }]; const iz = [[], []];
    const kesin = new Map();
    for (let n = 0; n < 120 * 40; n++) {
      E.adim(st, ADIM); const simdi = st.gecenSn;
      while (kuyruk.length && kuyruk[0].varis <= simdi + 1e-9) { const k = kuyruk.shift(); E.izEkle(st, k.j, k.x, k.y, k.e); }
      for (const s of st.gecmis) if (s.e < simdi - 0.43) kesin.set(s.e.toFixed(5), s);
      if (st.faz !== 'oyun' || n % 2) continue;
      for (const j of [0, 1]) {
        const vt = simdi - D; const d = geriden(st, vt); if (!d) continue;
        const kendi = j === 0 ? d.x < 540 : d.x > 460;
        const h = kendi ? { x: d.x + (j === 0 ? -30 : 30), y: d.y + ((n / 40 | 0) % 3 - 1) * 25 } : { x: j === 0 ? 150 : 850, y: 300 };
        const p = ptr[j]; const dx = h.x - p.x, dy = h.y - p.y, u = Math.hypot(dx, dy), a = Math.min(u, 1400 / 60);
        if (u > 0) { p.x += dx / u * a; p.y += dy / u * a; } E.tokmakKirp(p, j);
        kuyruk.push({ varis: simdi + ow, j, x: p.x, y: p.y, e: vt }); iz[j].push({ e: vt, x: p.x, y: p.y });
      }
      kuyruk.sort((a, b) => a.varis - b.varis);
    }
    const kayit = [...kesin.values()].sort((a, b) => a.e - b.e);
    let derin = 0, ornek = 0;
    for (const j of [0, 1]) for (const p of iz[j]) {
      if (p.e > kayit[kayit.length - 1].e) continue;
      let lo = 0, hi = kayit.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (kayit[m].e <= p.e) lo = m; else hi = m - 1; }
      const d = kayit[lo]; if (!d || d.gol) continue; ornek++;
      if (R - Math.hypot(d.x - p.x, d.y - p.y) > 12) derin++;
    }
    assert.ok(ornek > 3000 && derin / ornek < 0.002, 'gecikmede imleç diskin içinden geçmemeli: ' + derin + '/' + ornek);
    console.log('  ✓ 5) ' + (D * 1000) + ' ms görüş + ' + (ow * 1000) + ' ms ağ gecikmesinde ' + ornek + ' örnekte iç içe geçme: ' + derin);
  }
}
// 7) durgun tokmak, tavan, tünelleme
{
  const st = oyun();
  E.hedefYaz(st, 0, 200, 300);
  for (let i = 0; i < 20; i++) E.adim(st, ADIM);
  st.disk = { x: 400, y: 300, vx: -800, vy: 0 };
  for (let i = 0; i < 60; i++) E.adim(st, ADIM);
  assert.ok(st.disk.vx > 0 && hiz(st.disk) < 800, 'durgun tokmaktan seken disk hızlanmamalı: ' + hiz(st.disk).toFixed(0));
  const s2 = oyun();
  s2.disk = { x: 400, y: 300, vx: 0, vy: 0 };
  let mx = 0;
  for (let i = 0; i <= 12; i++) { E.hedefYaz(s2, 0, 140 + i * 25, 300); E.adim(s2, ADIM); mx = Math.max(mx, hiz(s2.disk)); }
  for (let i = 0; i < 30; i++) { E.adim(s2, ADIM); mx = Math.max(mx, hiz(s2.disk)); }
  assert.ok(mx > 700 && mx <= E.DISK_TAVANI + 0.01, 'sert salınım güçlü ama tavan altında: ' + mx.toFixed(0));
  console.log('  ✓ 6) durgun tokmak enerji eklemiyor, sert vuruş ' + mx.toFixed(0) + ' (tavan ' + E.DISK_TAVANI + ')');
}
// 8) son an kurtarışı
{
  const st = oyun();
  E.hedefYaz(st, 0, 110, 130);                     // kaleci yolun dışında (ekranda geç kalmış)
  for (let i = 0; i < 30; i++) E.adim(st, ADIM);
  st.disk = { x: 260, y: 300, vx: -1000, vy: 0 };
  st.gecmis = [];
  let golAni = null;
  for (let i = 0; i < 40; i++) { E.adim(st, ADIM); if (st.golBekle && golAni === null) golAni = st.gecenSn; }
  assert.ok(golAni !== null && st.skor[1] === 0, 'gol çizgisi geçildi ama henüz kesinleşmedi');
  /* kaleci, görüş zamanında diskin önündeydi (bildirim geç geldi) */
  const vt = golAni - 0.15;
  const d = geriden(st, vt);
  E.izEkle(st, 0, Math.max(98, d.x - R - 30), 300, vt - 0.02);
  E.izEkle(st, 0, Math.max(98, d.x - R + 6), 300, vt);
  for (let i = 0; i < 60; i++) E.adim(st, ADIM);
  assert.strictEqual(st.skor[1], 0, 'görüş zamanındaki kurtarış golü iptal etmeli');
  assert.ok(st.disk.vx > 0, 'kurtarılan disk geri dönmeli');
  console.log('  ✓ 7) kale çizgisini geçen disk, görüş zamanındaki kurtarışla geri dönüyor');
}
console.log('OK hava hokeyi: imleç senkron, disk kayıyor, temas görüş zamanında, temassız kuvvet yok');
