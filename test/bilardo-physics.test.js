'use strict';
/* ============================================================================
 * BİLARDO FİZİK MOTORU — DOĞRULAMA
 * ============================================================================
 * Motor baştan yazıldı (gerçek katı-cisim + falso). Bu test fiziğin
 * DAVRANIŞINI kilitler: sayıları değil, bilardocunun masada gördüğü olguları.
 *
 *  1) Kayma → yuvarlanma geçişi teorik (5/7)·v₀ değerini vermeli.
 *  2) Çekme (draw)  : tam vuruştan sonra beyaz GERİ gelir.
 *  3) Takip (follow): beyaz İLERİ devam eder.
 *  4) Stun          : beyaz temas noktasında hemen hemen durur.
 *  5) Defleksiyon   : yan falso topu nişan doğrultusundan saptırır (squirt).
 *  6) Masse         : ısteka yükseltilip yan falso verilince yörünge BÜKÜLÜR.
 *  7) Throw         : kesme vuruşunda hedef top geometrik doğrultudan sapar.
 *  8) Bant + falso  : yan falso çıkış açısını değiştirir.
 *  9) Falso sönümü  : z ekseni dönüşü zamanla söner.
 * 10) Sağlamlık     : enerji artmaz, top masadan çıkmaz, iç içe geçmez,
 *                     simülasyon her zaman biter.
 * ========================================================================= */

const assert = require('assert');
const E = require('../bilardo-engine');
const P = E.physics, I = E._internals;
const R = I.R;

// --- yardımcılar -----------------------------------------------------------
function ball(id, x, y) {
  return { id, n: 0, type: id === 'cue' ? 'cue' : 'solid', x, y, z: 0,
           vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, potted: false };
}
// Bantsız serbest alanda simülasyon (saf fizik gözlemi için)
function freeSim(balls, secs) {
  let t = 0, moving = true;
  const st = { balls };
  while (moving && t < (secs || 12)) {
    moving = false;
    for (const b of balls) if (I.stepBall(b, P.dt)) moving = true;
    for (let i = 0; i < balls.length; i++)
      for (let j = i + 1; j < balls.length; j++)
        if (I.ballBall(balls[i], balls[j], null, t)) moving = true;
    t += P.dt;
  }
  return t;
}
function strike(b, angle, power, opts) {
  const o = opts || {};
  const k = I.cueStrike(angle, power, o.spinX || 0, o.spinY || 0, o.elevation || 0);
  b.vx = k.vx; b.vy = k.vy; b.vz = Math.max(0, k.vz);
  b.wx = k.wx; b.wy = k.wy; b.wz = k.wz;
  if (b.vz > 0) b.z = 1e-6;
  return k;
}
const speed = b => Math.hypot(b.vx, b.vy);
// Toplam kinetik enerji (doğrusal + dönme)
function energy(balls) {
  return balls.reduce((s, b) => s + 0.5 * I.M * (b.vx * b.vx + b.vy * b.vy + (b.vz || 0) ** 2)
    + 0.5 * I.I_BALL * (b.wx * b.wx + b.wy * b.wy + b.wz * b.wz), 0);
}

// ---- 1) kayma → yuvarlanma: v_son = (5/7)·v₀ ------------------------------
{
  const b = ball('cue', 0, 0);
  b.vx = 2.0;                                   // falsosuz, saf ileri hız
  let t = 0;
  while (t < 1.0) { I.stepBall(b, P.dt); t += P.dt; }   // geçiş ~0.4 s
  const u = Math.hypot(b.vx - R * b.wy, b.vy + R * b.wx);
  assert.ok(u < 1e-6, 'saf yuvarlanmaya geçmeli (temas noktası hızı ~0), u=' + u);
  const beklenen = (5 / 7) * 2.0;
  // 1 s içinde yuvarlanma sürtünmesi de biraz yavaşlatır; geçiş anı değeri
  // teorik değerin biraz altında olmalı ama %8'den fazla sapmamalı.
  assert.ok(Math.abs(b.vx - beklenen) / beklenen < 0.08,
    `kayma sonrası hız (5/7)·v₀≈${beklenen.toFixed(3)} olmalı, ölçülen ${b.vx.toFixed(3)}`);
  console.log('  ✓ 1) kayma→yuvarlanma geçişi teorik (5/7)·v₀ değerini veriyor');
}

// ---- 2/3/4) çekme, takip, stun -------------------------------------------
// Tam (düz) vuruştan HEMEN SONRA beyazın yönüne bakılır: nihai konum
// bantlardan sektiği için ölçüt olmaz.
function tamVurus(spinY) {
  const cue = ball('cue', 0, 0), obj = ball('1', 0.5, 0);
  strike(cue, 0, 0.4, { spinY });
  // temasa kadar ilerlet
  let t = 0;
  // GERÇEK temasa kadar ilerlet: ballBall() ancak toplar ÇAKIŞINCA (d < 2R)
  // impuls uygular; eşiğin hemen önünde durursak çarpışma hiç olmaz.
  while (t < 5 && Math.hypot(obj.x - cue.x, obj.y - cue.y) > 2 * R) {
    I.stepBall(cue, P.dt); I.stepBall(obj, P.dt); t += P.dt;
  }
  I.ballBall(cue, obj, null, t);
  const hemenSonra = cue.vx;
  const wyTemas = cue.wy;                 // temas ANINDAKİ falso (sonra sönüyor)
  const objHiz = obj.vx;
  // 0.4 s sonra beyaz nerede? (çekmede sürtünme falsoyu geri harekete çevirir)
  const x0 = cue.x;
  for (let k = 0; k < 0.4 / P.dt; k++) { I.stepBall(cue, P.dt); I.stepBall(obj, P.dt); }
  return { hemenSonra, netYerDegistirme: cue.x - x0, objHiz, wy: wyTemas };
}
{
  const cekme = tamVurus(-0.42);
  assert.ok(cekme.wy < -20, 'çekmede beyaz geri falsolu kalmalı, ωy=' + cekme.wy.toFixed(1));
  assert.ok(cekme.netYerDegistirme < -0.03,
    'ÇEKME: beyaz temas sonrası GERİ gelmeli, yer değiştirme=' + cekme.netYerDegistirme.toFixed(3));
  console.log('  ✓ 2) çekme (draw): beyaz temastan sonra geri geliyor');

  const takip = tamVurus(0.42);
  assert.ok(takip.netYerDegistirme > 0.05,
    'TAKİP: beyaz ileri devam etmeli, yer değiştirme=' + takip.netYerDegistirme.toFixed(3));
  console.log('  ✓ 3) takip (follow): beyaz ileri devam ediyor');

  const stun = tamVurus(-0.16);
  assert.ok(Math.abs(stun.netYerDegistirme) < Math.abs(takip.netYerDegistirme),
    'STUN çekme/takip arasında kalmalı');
  assert.ok(Math.abs(stun.hemenSonra) < 0.35 * Math.abs(stun.objHiz),
    'STUN: temas anında beyazın hızı hedefe göre çok küçük olmalı ' +
    `(beyaz ${stun.hemenSonra.toFixed(3)}, hedef ${stun.objHiz.toFixed(3)})`);
  console.log('  ✓ 4) stun: beyaz temas noktasında neredeyse duruyor');
}

// ---- 5) defleksiyon / squirt ---------------------------------------------
{
  const duz = I.cueStrike(0, 0.5, 0, 0, 0);
  const sag = I.cueStrike(0, 0.5, 0.45, 0, 0);
  const aciDuz = Math.atan2(duz.vy, duz.vx);
  const aciSag = Math.atan2(sag.vy, sag.vx);
  const sapmaDer = Math.abs(aciSag - aciDuz) * 180 / Math.PI;
  assert.ok(sapmaDer > 0.5 && sapmaDer < 6,
    'yan falso topu nişandan 0,5°-6° arasında saptırmalı (squirt), ölçülen ' + sapmaDer.toFixed(2) + '°');
  assert.ok(Math.abs(sag.wz) > 20, 'yan falso z ekseninde dönme üretmeli, ωz=' + sag.wz.toFixed(1));
  console.log('  ✓ 5) defleksiyon (squirt): yan falso çıkış doğrultusunu ' + sapmaDer.toFixed(2) + '° saptırıyor');
}

// ---- 6) masse: yükseltilmiş ısteka + yan falso → kavisli yörünge ----------
{
  function yorunge(elevation, spinX) {
    const b = ball('cue', 0, 0);
    strike(b, 0, 0.55, { spinX, elevation });
    const yol = [];
    let t = 0;
    while (t < 3 && (speed(b) > 0.01 || b.z > 0)) {
      I.stepBall(b, P.dt); t += P.dt;
      if (yol.length < 4000) yol.push([b.x, b.y]);
    }
    return yol;
  }
  // Kavis ölçüsü: yörüngenin başlangıç doğrultusundan en büyük yanal sapması
  function kavis(yol) {
    if (yol.length < 50) return 0;
    const [x0, y0] = yol[0];
    const [x1, y1] = yol[Math.min(40, yol.length - 1)];
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;                 // doğrultuya dik
    let max = 0;
    for (const [x, y] of yol) max = Math.max(max, Math.abs((x - x0) * nx + (y - y0) * ny));
    return max;
  }
  const duz = kavis(yorunge(0, 0));
  const masse = kavis(yorunge(45 * Math.PI / 180, 0.45));
  assert.ok(duz < 0.01, 'falsosuz düz vuruş düz gitmeli, sapma=' + duz.toFixed(4) + ' m');
  assert.ok(masse > 0.05,
    'MASSE: yükseltilmiş ısteka + yan falso yörüngeyi bükmeli, kavis=' + masse.toFixed(3) + ' m');
  console.log('  ✓ 6) masse: yörünge ' + (masse * 100).toFixed(1) + ' cm büküldü (düz vuruş ' + (duz * 1000).toFixed(1) + ' mm)');
}

// ---- 7) throw: kesme vuruşunda hedef top geometrik doğrultudan sapar ------
{
  // 30°'lik kesme: hayalet top doğrultusu ile gerçek çıkış doğrultusu
  const kes = 30 * Math.PI / 180;
  const obj = ball('1', 0.5, 0);
  const cue = ball('cue', 0.5 - Math.cos(kes) * 2 * R - 0.30, -Math.sin(kes) * 2 * R);
  // beyaz, hayalet top merkezine nişan alır
  const hedefX = obj.x - Math.cos(kes) * 2 * R, hedefY = obj.y - Math.sin(kes) * 2 * R;
  const aci = Math.atan2(hedefY - cue.y, hedefX - cue.x);
  strike(cue, aci, 0.4, {});
  let t = 0;
  // GERÇEK temasa kadar ilerlet: ballBall() ancak toplar ÇAKIŞINCA (d < 2R)
  // impuls uygular; eşiğin hemen önünde durursak çarpışma hiç olmaz.
  while (t < 5 && Math.hypot(obj.x - cue.x, obj.y - cue.y) > 2 * R) {
    I.stepBall(cue, P.dt); I.stepBall(obj, P.dt); t += P.dt;
  }
  const nx = (obj.x - cue.x), ny = (obj.y - cue.y);
  const geometrik = Math.atan2(ny, nx);              // merkezleri birleştiren doğrultu
  I.ballBall(cue, obj, null, t);
  const gercek = Math.atan2(obj.vy, obj.vx);
  const throwDer = (gercek - geometrik) * 180 / Math.PI;
  assert.ok(Math.abs(throwDer) > 0.2 && Math.abs(throwDer) < 8,
    'THROW: hedef top geometrik doğrultudan sapmalı (0,2°-8°), ölçülen ' + throwDer.toFixed(2) + '°');
  console.log('  ✓ 7) throw: kesme vuruşunda hedef top ' + throwDer.toFixed(2) + '° saptı');
}

// ---- 8) bant + yan falso: çıkış açısı değişir -----------------------------
{
  function bantCikis(spinX) {
    const b = ball('cue', P.tableLength / 2, P.tableWidth / 2);
    strike(b, -45 * Math.PI / 180, 0.45, { spinX });   // üst banda 45° ile
    let t = 0, vurdu = false;
    while (t < 4) {
      I.stepBall(b, P.dt);
      if (I.cushion(b, null, t)) { vurdu = true; break; }
      t += P.dt;
    }
    assert.ok(vurdu, 'banda çarpmalı');
    return Math.atan2(b.vy, b.vx) * 180 / Math.PI;
  }
  const falsosuz = bantCikis(0);
  const sagFalso = bantCikis(0.45);
  const solFalso = bantCikis(-0.45);
  const fark = Math.abs(sagFalso - solFalso);
  assert.ok(fark > 2,
    'BANT: yan falso çıkış açısını değiştirmeli, sağ/sol farkı=' + fark.toFixed(2) + '°');
  console.log('  ✓ 8) bant + falso: çıkış açısı sağ/sol falsoda ' + fark.toFixed(1) + '° farklı ' +
    `(falsosuz ${falsosuz.toFixed(1)}°)`);
}

// ---- 9) falso (z) sönümü --------------------------------------------------
{
  const b = ball('cue', 0, 0);
  b.wz = 60;
  let t = 0;
  while (t < 5 && Math.abs(b.wz) > 1e-6) { I.stepBall(b, P.dt); t += P.dt; }
  assert.ok(t > 0.5 && t < 4.5, 'falso birkaç saniyede sönmeli, ölçülen ' + t.toFixed(2) + ' s');
  console.log('  ✓ 9) falso sönümü: 60 rad/s yan falso ' + t.toFixed(2) + ' saniyede sönüyor');
}

// ---- 10) sağlamlık: enerji, sınırlar, çakışma, sonlanma -------------------
{
  let maxFrames = 0, maxDuration = 0;
  for (let deneme = 0; deneme < 12; deneme++) {
    const st = E.init();
    const E0 = energy(st.balls);
    const aci = (deneme / 12) * Math.PI * 2;
    const r = E.shoot(st, 0, aci, 0.35 + (deneme % 5) * 0.16, {
      spinX: ((deneme % 3) - 1) * 0.35,
      spinY: ((deneme % 4) - 1.5) * 0.25,
      elevation: (deneme % 6 === 5) ? 40 * Math.PI / 180 : 0
    });
    assert.ok(r.ok, 'atış kabul edilmeli: ' + JSON.stringify(r.reason));
    const s = r.shot;
    maxFrames = Math.max(maxFrames, s.frames.length);
    maxDuration = Math.max(maxDuration, s.duration);

    // (a) simülasyon üst sınıra dayanmadan bitmeli
    assert.ok(s.duration < P.maxTime - 0.5,
      'atış zaman sınırına dayanmamalı, süre=' + s.duration);

    // (b) hiçbir top masadan çıkmamalı, NaN olmamalı
    for (const b of st.balls) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'konum sayı olmalı');
      if (b.potted) continue;
      assert.ok(b.x > -0.02 && b.x < P.tableLength + 0.02 &&
                b.y > -0.02 && b.y < P.tableWidth + 0.02,
        `top masadan çıktı: ${b.id} (${b.x.toFixed(3)}, ${b.y.toFixed(3)})`);
    }
    // (c) duran toplar iç içe geçmemeli
    const kalan = st.balls.filter(b => !b.potted);
    for (let i = 0; i < kalan.length; i++)
      for (let j = i + 1; j < kalan.length; j++) {
        const d = Math.hypot(kalan[i].x - kalan[j].x, kalan[i].y - kalan[j].y);
        assert.ok(d > 2 * R - 1e-3,
          `toplar iç içe: ${kalan[i].id}-${kalan[j].id} d=${d.toFixed(5)} (2R=${(2 * R).toFixed(5)})`);
      }
    // (d) enerji hiçbir noktada başlangıcı aşmamalı (sürtünme + esneklik < 1)
    assert.ok(energy(st.balls) <= E0 + 1e-9, 'enerji artamaz');

    // (e) kareler geçerli: her kare her top için ya null ya 3 sayı
    for (const f of s.frames) {
      assert.strictEqual(f.length, st.balls.length, 'kare top sayısı sabit olmalı');
      for (const p of f) {
        if (p === null) continue;
        assert.strictEqual(p.length, 3, 'kare noktası [x,y,z] olmalı');
        assert.ok(p.every(Number.isFinite), 'kare noktası sayı olmalı');
      }
    }
  }
  console.log(`  ✓ 10) sağlamlık: 12 rastgele atış — enerji artmadı, top kaçmadı, iç içe geçme yok ` +
    `(en uzun ${maxDuration.toFixed(1)} s / ${maxFrames} kare)`);
}

// ---- 11) faul sonrası beyaz güvenli noktaya konur -------------------------
{
  const st = E.init();
  const cue = st.balls.find(b => b.id === 'cue');
  // baş noktayı bilerek doldur
  st.balls[1].x = P.tableLength * 0.25; st.balls[1].y = P.tableWidth / 2;
  cue.potted = true;
  I.respotCue(st);
  const d = Math.hypot(cue.x - st.balls[1].x, cue.y - st.balls[1].y);
  assert.ok(!cue.potted && d > 2 * R, 'beyaz dolu noktaya konmamalı, d=' + d.toFixed(4));
  console.log('  ✓ 11) faul sonrası beyaz, dolu noktaya değil güvenli boşluğa konuyor');
}

console.log('OK bilardo fiziği: falso, kayma/yuvarlanma, throw, bant, masse, defleksiyon');
