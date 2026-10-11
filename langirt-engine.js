'use strict';
/* ============================================================================
 * LANGIRT (Foosball) — SAF FİZİK MOTORU (sunucu yetkili)
 * ============================================================================
 * Yerel prototipin (src/lib/game-engine.ts) fiziği birebir taşındı: saha
 * ölçüleri, çubuk tanımları, çarpışma katsayıları ve şut formülü aynıdır.
 * Değişen tek şey KİMİN İŞLETTİĞİ: fizik artık sunucuda, sabit adımlarla
 * (50 Hz) işler; istemciler yalnız çubuk hedeflerini ve şut isteğini yollar,
 * karşılığında saniyede ~20 kez durum paketi alır.
 *
 * NEDEN SABİT ADIM: iki istemcinin kare hızı farklıdır. Fizik istemcide
 * işleseydi hızlı makinedeki oyuncu topu daha çok iterdi. Sabit adımla
 * herkes aynı maçı oynar.
 *
 * SAHA: 1000 × 600 birim. Kırmızı soldan sağa, mavi sağdan sola atar.
 * ========================================================================= */

const SAHA_EN = 1000;
const SAHA_BOY = 600;
const SAHA = {
  sol: 108, sag: 892, ust: 92, alt: 508,
  merkezX: 500, merkezY: 300,
  kaleUst: 220, kaleAlt: 380
};

/* Çubuklar: her takımın 4 çubuğu, çubuk başına oyuncu sayısı ve hareket
   sınırları. Sayılar prototipten birebir alındı. */
const CUBUKLAR = {
  kirmizi: [
    { x: 158, adet: 1, aralik: 0,  minY: 185, maxY: 415 },
    { x: 340, adet: 2, aralik: 86, minY: 180, maxY: 420 },
    { x: 535, adet: 5, aralik: 57, minY: 220, maxY: 380 },
    { x: 760, adet: 3, aralik: 82, minY: 195, maxY: 405 }
  ],
  mavi: [
    { x: 842, adet: 1, aralik: 0,  minY: 185, maxY: 415 },
    { x: 660, adet: 2, aralik: 86, minY: 180, maxY: 420 },
    { x: 465, adet: 5, aralik: 57, minY: 220, maxY: 380 },
    { x: 240, adet: 3, aralik: 82, minY: 195, maxY: 405 }
  ]
};
const TARAFLAR = ['kirmizi', 'mavi'];

const TOP_R = 12;
const OYUNCU_R = 22;
const GERI_SAYIM_SN = 2.35;
const CUBUK_HIZI = 620;          // birim/sn
const HIZ_TAVANI = 1030;
const ADIM_SN = 0.02;            // 50 Hz sabit fizik adımı

function kirp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function hedefKirp(taraf, cubuk, y) {
  const d = CUBUKLAR[taraf][cubuk] || CUBUKLAR[taraf][0];
  return kirp(y, d.minY, d.maxY);
}
/* Koltuk → takım. Koltuk 0 kırmızı (soldan sağa), koltuk 1 mavi. */
function tarafOf(seat) { return seat === 0 ? 'kirmizi' : 'mavi'; }
function seatOf(taraf) { return taraf === 'kirmizi' ? 0 : 1; }

/* ------------------------------------------------------------------- MAÇ */
function macBaslat(opts) {
  const o = opts || {};
  const hedef = [3, 5, 7, 10].includes(Number(o.hedefGol)) ? Number(o.hedefGol) : 5;
  const evY = SAHA.merkezY;
  return {
    kind: 'langirt',
    seats: (o.seats || [0, 1]).slice(0, 2),
    top: { x: SAHA.merkezX, y: evY, vx: 0, vy: 0 },
    cubuk:  { kirmizi: [evY, evY, evY, evY], mavi: [evY, evY, evY, evY] },
    hedefY: { kirmizi: [evY, evY, evY, evY], mavi: [evY, evY, evY, evY] },
    cubukHiz: { kirmizi: [0, 0, 0, 0], mavi: [0, 0, 0, 0] },
    skor: { kirmizi: 0, mavi: 0 },
    hedefGol: hedef,
    faz: 'gerisayim',            // gerisayim | oyun | gol | bitti
    fazSn: GERI_SAYIM_SN,
    gecenSn: 0,
    sonGolAtan: null,
    sonOlay: 'yok',              // yok | carpma | vurus | sut | gol
    olayNo: 0,
    baslamaSayisi: 0,
    status: 'playing',
    winner: null,
    result: null
  };
}

function olay(st, ad) { st.sonOlay = ad; st.olayNo += 1; }

function basaDon(st) {
  st.top.x = SAHA.merkezX; st.top.y = SAHA.merkezY; st.top.vx = 0; st.top.vy = 0;
  for (const t of TARAFLAR) {
    st.cubuk[t].fill(SAHA.merkezY);
    st.hedefY[t].fill(SAHA.merkezY);
    st.cubukHiz[t].fill(0);
  }
  st.faz = 'gerisayim';
  st.fazSn = GERI_SAYIM_SN;
}
function baslamaVurusu(st) {
  st.faz = 'oyun';
  st.fazSn = 0;
  st.baslamaSayisi += 1;
  const yon = st.baslamaSayisi % 2 === 1 ? 1 : -1;
  st.top.vx = yon * 265;
  st.top.vy = st.baslamaSayisi % 3 === 0 ? 85 : -58;
  olay(st, 'vurus');
}
function golAt(st, atan) {
  st.skor[atan] += 1;
  st.sonGolAtan = atan;
  st.top.x = SAHA.merkezX; st.top.y = SAHA.merkezY; st.top.vx = 0; st.top.vy = 0;
  for (const t of TARAFLAR) {
    st.cubuk[t].fill(SAHA.merkezY);
    st.hedefY[t].fill(SAHA.merkezY);
    st.cubukHiz[t].fill(0);
  }
  olay(st, 'gol');
  if (st.skor[atan] >= st.hedefGol) {
    st.faz = 'bitti';
    st.fazSn = 0;
    macBitir(st, 'finished');
  } else {
    st.faz = 'gol';
    st.fazSn = 1.35;
  }
}
function hizTavani(top) {
  const h = Math.hypot(top.vx, top.vy);
  if (h > HIZ_TAVANI) { top.vx = (top.vx / h) * HIZ_TAVANI; top.vy = (top.vy / h) * HIZ_TAVANI; }
}

/* Top–oyuncu çarpışması: ilk temasta döner (prototiple aynı). */
function oyuncularlaCarpis(st) {
  const top = st.top;
  for (const taraf of TARAFLAR) {
    for (let c = 0; c < CUBUKLAR[taraf].length; c++) {
      const d = CUBUKLAR[taraf][c];
      const merkez = st.cubuk[taraf][c];
      const ilkY = merkez - ((d.adet - 1) * d.aralik) / 2;
      for (let i = 0; i < d.adet; i++) {
        const oy = ilkY + i * d.aralik;
        const dx = top.x - d.x, dy = top.y - oy;
        const uz = Math.hypot(dx, dy);
        if (uz >= OYUNCU_R + TOP_R - 1) continue;

        const nx = uz < 0.001 ? (taraf === 'kirmizi' ? -1 : 1) : dx / uz;
        const ny = uz < 0.001 ? 0 : dy / uz;
        const bindirme = OYUNCU_R + TOP_R - uz + 0.7;
        top.x += nx * bindirme;
        top.y += ny * bindirme;

        const gelen = top.vx * nx + top.vy * ny;
        if (gelen < 0) { top.vx -= 1.72 * gelen * nx; top.vy -= 1.72 * gelen * ny; }

        const yon = taraf === 'kirmizi' ? 1 : -1;
        const cHiz = st.cubukHiz[taraf][c] || 0;
        if (Math.abs(top.vx) < 145) top.vx = yon * 170;
        top.vy += (top.y - oy) * 0.95 + cHiz * 0.26;
        top.vx += yon * Math.min(Math.abs(cHiz) * 0.08, 82);
        hizTavani(top);
        olay(st, 'carpma');
        return;
      }
    }
  }
}

/* --------------------------------------------------------------- FİZİK ADIMI
   kontrol: { hedefY: {kirmizi:[...], mavi:[...]}, hassas: {kirmizi:bool,...} }
   Hassas mod: oyuncu "yavaş" sürüklerse çubuk daha az hızla gider (nişan). */
function adim(st, dtSn, kontrol) {
  const dt = kirp(Number(dtSn) || 0, 0, 0.05);
  if (dt <= 0 || st.faz === 'bitti') return;
  const k = kontrol || {};

  for (const taraf of TARAFLAR) {
    const istenen = (k.hedefY || {})[taraf];
    const enHiz = ((k.hassas || {})[taraf] ? 285 : CUBUK_HIZI);
    for (let i = 0; i < CUBUKLAR[taraf].length; i++) {
      if (st.faz !== 'oyun') { st.cubukHiz[taraf][i] = 0; continue; }
      if (istenen && Number.isFinite(istenen[i])) {
        st.hedefY[taraf][i] = hedefKirp(taraf, i, istenen[i]);
      }
      const eski = st.cubuk[taraf][i];
      const fark = st.hedefY[taraf][i] - eski;
      const hareket = kirp(fark, -enHiz * dt, enHiz * dt);
      st.cubuk[taraf][i] = hedefKirp(taraf, i, eski + hareket);
      st.cubukHiz[taraf][i] = dt > 0 ? hareket / dt : 0;
    }
  }

  if (st.faz === 'gerisayim') {
    st.fazSn = Math.max(0, st.fazSn - dt);
    if (st.fazSn === 0) baslamaVurusu(st);
    return;
  }
  if (st.faz === 'gol') {
    st.fazSn = Math.max(0, st.fazSn - dt);
    if (st.fazSn === 0) basaDon(st);
    return;
  }
  if (st.faz !== 'oyun') return;

  st.gecenSn += dt;
  const top = st.top;
  top.x += top.vx * dt;
  top.y += top.vy * dt;

  if (top.y < SAHA.ust + TOP_R) {
    top.y = SAHA.ust + TOP_R; top.vy = Math.abs(top.vy) * 0.88; olay(st, 'carpma');
  } else if (top.y > SAHA.alt - TOP_R) {
    top.y = SAHA.alt - TOP_R; top.vy = -Math.abs(top.vy) * 0.88; olay(st, 'carpma');
  }

  const kaleAgzi = top.y > SAHA.kaleUst && top.y < SAHA.kaleAlt;
  if (top.x < SAHA.sol - TOP_R && kaleAgzi) { golAt(st, 'mavi'); return; }
  if (top.x > SAHA.sag + TOP_R && kaleAgzi) { golAt(st, 'kirmizi'); return; }

  if (top.x < SAHA.sol + TOP_R && !kaleAgzi) {
    top.x = SAHA.sol + TOP_R; top.vx = Math.abs(top.vx) * 0.86; olay(st, 'carpma');
  } else if (top.x > SAHA.sag - TOP_R && !kaleAgzi) {
    top.x = SAHA.sag - TOP_R; top.vx = -Math.abs(top.vx) * 0.86; olay(st, 'carpma');
  }

  oyuncularlaCarpis(st);
  const surtunme = Math.pow(0.998, dt * 60);
  top.vx *= surtunme; top.vy *= surtunme;
  if (Math.hypot(top.vx, top.vy) < 22) { top.vx *= 0.96; top.vy *= 0.96; }
}

/* ------------------------------------------------------------------- ŞUT
   Topa yakın bir çubukla vuruş. guc 0..1, nisanY sahadaki hedef yükseklik. */
function sut(st, taraf, girdi) {
  if (st.faz !== 'oyun') return { ok: false, reason: 'wrong_phase' };
  const g = girdi || {};
  const c = Math.max(0, Math.min(CUBUKLAR[taraf].length - 1, Math.round(Number(g.cubuk) || 0)));
  const d = CUBUKLAR[taraf][c];
  const merkez = st.cubuk[taraf][c];
  const ilkY = merkez - ((d.adet - 1) * d.aralik) / 2;
  let enYakin = Infinity, enYakinY = merkez;
  for (let i = 0; i < d.adet; i++) {
    const py = ilkY + i * d.aralik;
    const uz = Math.hypot(st.top.x - d.x, st.top.y - py);
    if (uz < enYakin) { enYakin = uz; enYakinY = py; }
  }
  /* Topa uzaksa vuruş yok — "havaya sallama" sayılmaz. */
  if (Math.abs(st.top.x - d.x) > 66 || enYakin > 78) return { ok: false, reason: 'top_uzak' };

  const guc = kirp(Number(g.guc) || 0, 0, 1);
  const yon = taraf === 'kirmizi' ? 1 : -1;
  const nisan = kirp(Number(g.nisanY), SAHA.ust + 28, SAHA.alt - 28);
  const aci = kirp((nisan - st.top.y) / 200, -0.78, 0.78);
  const cHiz = Math.abs(st.cubukHiz[taraf][c] || 0);
  const hiz = 400 + guc * 520 + Math.min(cHiz * 0.17, 105);
  st.top.x += yon * 7;
  st.top.vx = yon * hiz * Math.cos(aci);
  st.top.vy = hiz * Math.sin(aci) + (st.top.y - enYakinY) * 0.42;
  hizTavani(st.top);
  olay(st, guc > 0.67 ? 'sut' : 'vurus');
  return { ok: true, guc, hiz };
}

/* Çubuk hedeflerini doğrula ve yaz (istemciden gelen ham veri). */
function hedefYaz(st, taraf, dizi) {
  if (!Array.isArray(dizi)) return { ok: false, reason: 'gecersiz_hamle' };
  const n = CUBUKLAR[taraf].length;
  for (let i = 0; i < n; i++) {
    const v = Number(dizi[i]);
    if (Number.isFinite(v)) st.hedefY[taraf][i] = hedefKirp(taraf, i, v);
  }
  return { ok: true };
}

/* --------------------------------------------------------------- BİTİŞ */
function macBitir(st, reason) {
  st.status = 'finished';
  st.faz = 'bitti';
  const k = st.skor.kirmizi, m = st.skor.mavi;
  const winner = k === m ? null : (k > m ? seatOf('kirmizi') : seatOf('mavi'));
  st.winner = winner;
  st.result = { reason: reason || 'finished', winner, skor: Object.assign({}, st.skor),
                sure: Math.round(st.gecenSn) };
  return st.result;
}
function pesEt(st, seat) {
  if (st.status !== 'playing') return st.result;
  const rakip = st.seats.find(s => s !== seat);
  st.status = 'finished';
  st.faz = 'bitti';
  st.winner = rakip === undefined ? null : rakip;
  st.result = { reason: 'resign', winner: st.winner, skor: Object.assign({}, st.skor),
                sure: Math.round(st.gecenSn) };
  return st.result;
}

/* --------------------------------------------------------------- GÖRÜNÜM
   Langırtta gizli bilgi yoktur: herkes aynı sahayı görür. Paket küçük
   tutulur, saniyede ~20 kez gidiyor; sayılar yuvarlanır. */
function yuvarla(v) { return Math.round(Number(v) * 10) / 10; }
function gorunum(st, seat, ekstra) {
  return Object.assign({
    kind: 'langirt',
    status: st.status,
    faz: st.faz,
    fazSn: yuvarla(st.fazSn),
    seat: (seat === 0 || seat === 1) ? seat : null,
    taraf: (seat === 0 || seat === 1) ? tarafOf(seat) : null,
    seats: st.seats.slice(),
    saha: SAHA, sahaEn: SAHA_EN, sahaBoy: SAHA_BOY,
    cubuklar: CUBUKLAR,
    top: { x: yuvarla(st.top.x), y: yuvarla(st.top.y),
           vx: yuvarla(st.top.vx), vy: yuvarla(st.top.vy) },
    cubuk: { kirmizi: st.cubuk.kirmizi.map(yuvarla), mavi: st.cubuk.mavi.map(yuvarla) },
    skor: Object.assign({}, st.skor),
    hedefGol: st.hedefGol,
    gecenSn: Math.round(st.gecenSn),
    sonGolAtan: st.sonGolAtan,
    sonOlay: st.sonOlay,
    olayNo: st.olayNo,
    winner: st.winner,
    result: st.result
  }, ekstra || {});
}

module.exports = {
  SAHA, SAHA_EN, SAHA_BOY, CUBUKLAR, TARAFLAR, TOP_R, OYUNCU_R,
  GERI_SAYIM_SN, CUBUK_HIZI, HIZ_TAVANI, ADIM_SN,
  tarafOf, seatOf, hedefKirp, macBaslat, adim, sut, hedefYaz,
  macBitir, pesEt, gorunum
};
